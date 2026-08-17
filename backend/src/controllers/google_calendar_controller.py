"""Google Calendar: sync de eventos vía service account (credenciales en ApiConnection)."""

from __future__ import annotations

import json
from datetime import datetime, time, timedelta, timezone
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException
from pony.orm import db_session

from src.models import ApiConnection, Lead

router = APIRouter(prefix="/gcal", tags=["gcal"], redirect_slashes=False)

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
GCAL_JOB_ID = "auto_sync_gcal"
GCAL_AUTO_INTERVAL_MINUTES = 60
_GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
_SKIP_EVENT_STATUSES = frozenset({"cancelled"})
_SKIP_ATTENDEE_STATUSES = frozenset({"declined"})


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _uid_int(user_id: str) -> int:
    try:
        return int(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.")


def _rows_for_user(user_id: int) -> list[Lead]:
    return [r for r in list(Lead.select()) if int(r.user_id) == user_id]


def _to_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _parse_gcal_start(start: dict[str, Any] | None) -> datetime | None:
    if not isinstance(start, dict):
        return None
    raw = str(start.get("dateTime") or start.get("date") or "").strip()
    if not raw:
        return None
    try:
        if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
            dt = datetime.fromisoformat(f"{raw}T00:00:00").replace(tzinfo=AR_TZ)
            return _to_naive_utc(dt)
        cleaned = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            tz_name = str(start.get("timeZone") or "").strip()
            dt = dt.replace(tzinfo=ZoneInfo(tz_name) if tz_name else timezone.utc)
        return _to_naive_utc(dt)
    except (ValueError, KeyError):
        return None


def _parse_gcal_created(raw: str | None) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        return _to_naive_utc(dt)
    except ValueError:
        return None


def _load_gcal_connection(uid: int) -> dict[str, Any]:
    with db_session:
        conn = ApiConnection.get(user_id=uid, platform="google_calendar")
        if conn is None:
            raise HTTPException(
                status_code=400,
                detail='No hay conexión Google Calendar. Configurá la plataforma "google_calendar" en Conexiones API.',
            )
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        calendar_id = str(creds.get("calendar_id") or "").strip()
        sa_raw = creds.get("service_account_json")
        if isinstance(sa_raw, dict):
            sa_json = json.dumps(sa_raw)
        else:
            sa_json = str(sa_raw or "").strip()
        if not calendar_id:
            raise HTTPException(status_code=400, detail="Falta calendar_id en las credenciales de Google Calendar.")
        if not sa_json:
            raise HTTPException(
                status_code=400,
                detail="Falta service_account_json (JSON de cuenta de servicio) en las credenciales de Google Calendar.",
            )
        last_sync = conn.last_sync_at
        return {
            "calendar_id": calendar_id,
            "service_account_json": sa_json,
            "last_sync_at": last_sync,
        }


def _service_account_info(sa_json: str) -> dict[str, Any]:
    try:
        info = json.loads(sa_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail="service_account_json no es un JSON válido.",
        ) from exc
    if not isinstance(info, dict):
        raise HTTPException(status_code=400, detail="service_account_json debe ser un objeto JSON.")
    if not str(info.get("client_email") or "").strip() or not str(info.get("private_key") or "").strip():
        raise HTTPException(
            status_code=400,
            detail="El JSON de la cuenta de servicio no tiene client_email o private_key.",
        )
    return info


def _build_calendar_service(sa_json: str) -> Any:
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Faltan dependencias de Google Calendar (google-auth, google-api-python-client).",
        ) from exc

    info = _service_account_info(sa_json)
    credentials = service_account.Credentials.from_service_account_info(
        info,
        scopes=[_GCAL_SCOPE],
    )
    return build("calendar", "v3", credentials=credentials, cache_discovery=False), str(info.get("client_email") or "")


def _window_ar() -> tuple[datetime, datetime]:
    hoy = datetime.now(AR_TZ).date()
    inicio = datetime.combine(hoy, time.min, tzinfo=AR_TZ)
    fin = datetime.combine(hoy + timedelta(days=7), time.max, tzinfo=AR_TZ)
    return inicio, fin


def _fetch_events(service: Any, calendar_id: str) -> list[dict[str, Any]]:
    from googleapiclient.errors import HttpError

    inicio, fin = _window_ar()
    events: list[dict[str, Any]] = []
    page_token: str | None = None
    try:
        while True:
            request = service.events().list(
                calendarId=calendar_id,
                timeMin=inicio.isoformat(),
                timeMax=fin.isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=250,
                pageToken=page_token,
            )
            data = request.execute()
            items = data.get("items") or []
            if isinstance(items, list):
                events.extend(item for item in items if isinstance(item, dict))
            page_token = str(data.get("nextPageToken") or "").strip() or None
            if not page_token:
                break
    except HttpError as exc:
        status = int(getattr(exc.resp, "status", 0) or 0)
        if status in (401, 403):
            raise HTTPException(
                status_code=502,
                detail="Google Calendar rechazó la cuenta de servicio. Revisá el JSON y que el calendario esté compartido con el email de la cuenta.",
            ) from exc
        if status == 404:
            raise HTTPException(
                status_code=502,
                detail="No se encontró el calendario. Revisá el Calendar ID.",
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=f"Error Google Calendar {status}: {exc.reason or exc}",
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo contactar a Google Calendar: {exc!s}") from exc
    return events


def _skip_emails(calendar_id: str, sa_email: str) -> set[str]:
    skip = {sa_email.strip().casefold()}
    if "@" in calendar_id:
        skip.add(calendar_id.strip().casefold())
    skip.discard("")
    return skip


def _event_people(event: dict[str, Any], skip_emails: set[str]) -> list[tuple[str, str]]:
    people: list[tuple[str, str]] = []
    seen: set[str] = set()
    attendees = event.get("attendees") or []
    if isinstance(attendees, list):
        for attendee in attendees:
            if not isinstance(attendee, dict):
                continue
            status = str(attendee.get("responseStatus") or "").strip().casefold()
            if status in _SKIP_ATTENDEE_STATUSES:
                continue
            email = str(attendee.get("email") or "").strip()
            name = str(attendee.get("displayName") or "").strip()
            email_key = email.casefold()
            if email_key and email_key in skip_emails:
                continue
            if attendee.get("self") or attendee.get("resource"):
                continue
            identity = email_key or name.casefold()
            if not identity or identity in seen:
                continue
            seen.add(identity)
            people.append((name, email))

    if people:
        return people

    summary = str(event.get("summary") or "").strip()
    organizer = event.get("organizer") if isinstance(event.get("organizer"), dict) else {}
    org_email = str(organizer.get("email") or "").strip()
    org_name = str(organizer.get("displayName") or "").strip()
    if org_email and org_email.casefold() not in skip_emails:
        return [(org_name or summary, org_email)]
    if summary:
        return [(summary, "")]
    return []


def _find_lead(user_id: int, name: str, email: str) -> Lead | None:
    rows = _rows_for_user(user_id)
    email_key = email.strip().casefold()
    if email_key:
        matches = [r for r in rows if (r.email or "").strip().casefold() == email_key]
        if matches:
            matches.sort(key=lambda r: r.created_at.timestamp() if r.created_at else 0.0, reverse=True)
            return matches[0]
    name_key = name.strip().casefold()
    if name_key:
        matches = [r for r in rows if (r.nombre or "").strip().casefold() == name_key]
        if matches:
            matches.sort(key=lambda r: r.created_at.timestamp() if r.created_at else 0.0, reverse=True)
            return matches[0]
    return None


@db_session
def _apply_event_to_lead(
    user_id: int,
    *,
    name: str,
    email: str,
    call_at: datetime | None,
    agendo_at: datetime | None,
) -> str:
    display_name = name.strip() or (email.split("@")[0] if email else "Evento Google Calendar")
    row = _find_lead(user_id, display_name, email)

    if row is not None:
        if call_at is not None:
            row.call = call_at
        if agendo_at is not None:
            row.agendo = agendo_at
        row.agendo_en = "Google Calendar"
        return "updated"

    Lead(
        user_id=user_id,
        nombre=display_name,
        email=email or "",
        call=call_at,
        agendo=agendo_at or call_at,
        status="Agendado",
        agendo_en="Google Calendar",
    )
    return "created"


@db_session
def _touch_gcal_last_sync(user_id: int) -> None:
    conn = ApiConnection.get(user_id=user_id, platform="google_calendar")
    if conn is None:
        return
    now = datetime.utcnow()
    conn.last_sync_at = now
    conn.updated_at = now


def _run_gcal_sync(uid: int) -> dict[str, Any]:
    conn = _load_gcal_connection(uid)
    service, sa_email = _build_calendar_service(conn["service_account_json"])
    events = _fetch_events(service, conn["calendar_id"])
    skip_emails = _skip_emails(conn["calendar_id"], sa_email)
    created = 0
    updated = 0
    skipped = 0

    for event in events:
        status = str(event.get("status") or "").strip().casefold()
        if status in _SKIP_EVENT_STATUSES:
            skipped += 1
            continue
        call_at = _parse_gcal_start(event.get("start") if isinstance(event.get("start"), dict) else None)
        if call_at is None:
            skipped += 1
            continue
        agendo_at = _parse_gcal_created(str(event.get("created") or "") or None)
        people = _event_people(event, skip_emails)
        if not people:
            skipped += 1
            continue
        for name, email in people:
            result = _apply_event_to_lead(
                uid,
                name=name,
                email=email,
                call_at=call_at,
                agendo_at=agendo_at,
            )
            if result == "created":
                created += 1
            else:
                updated += 1

    _touch_gcal_last_sync(uid)
    return {
        "synced": created + updated,
        "created": created,
        "updated": updated,
        "events": len(events),
        "skipped": skipped,
    }


def run_gcal_auto_sync_for_user(uid: int) -> dict[str, Any]:
    try:
        result = _run_gcal_sync(uid)
    except HTTPException as exc:
        return {"user_id": uid, "skipped": True, "reason": str(exc.detail)}
    return {"user_id": uid, "skipped": False, "sync": result}


def list_gcal_user_ids_with_creds() -> list[int]:
    with db_session:
        rows = list(
            ApiConnection.select_by_sql(
                "SELECT * FROM apiconnection WHERE platform = $platform",
                {"platform": "google_calendar"},
            )
        )
        out: list[int] = []
        for row in rows:
            creds = row.credentials if isinstance(row.credentials, dict) else {}
            calendar_id = str(creds.get("calendar_id") or "").strip()
            sa_raw = creds.get("service_account_json")
            has_json = bool(sa_raw) if isinstance(sa_raw, dict) else bool(str(sa_raw or "").strip())
            if calendar_id and has_json:
                out.append(int(row.user_id))
        return out


@router.get("/sync-status")
def gcal_sync_status(
    user_id: Annotated[str, Depends(require_user_id)],
):
    uid = _uid_int(user_id)
    with db_session:
        conn = ApiConnection.get(user_id=uid, platform="google_calendar")
        if conn is None:
            raise HTTPException(
                status_code=400,
                detail='No hay conexión Google Calendar. Configurá la plataforma "google_calendar" en Conexiones API.',
            )
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        last_sync = conn.last_sync_at
        calendar_id = str(creds.get("calendar_id") or "").strip()
        sa_raw = creds.get("service_account_json")
        has_json = bool(sa_raw) if isinstance(sa_raw, dict) else bool(str(sa_raw or "").strip())
        enabled = bool(calendar_id and has_json)

    next_run: str | None = None
    try:
        from src.services.sync_scheduler_service import next_job_run_time

        nxt = next_job_run_time(GCAL_JOB_ID)
        if nxt is not None:
            next_run = nxt.isoformat()
    except Exception:
        next_run = None

    return {
        "enabled": enabled,
        "interval_minutes": GCAL_AUTO_INTERVAL_MINUTES,
        "last_sync_at": last_sync.isoformat() + "Z" if last_sync else None,
        "next_run_at": next_run,
    }


@router.post("/sync")
def sync_gcal(
    user_id: Annotated[str, Depends(require_user_id)],
):
    uid = _uid_int(user_id)
    return _run_gcal_sync(uid)
