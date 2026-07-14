import re
from datetime import date, datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from pony.orm import ObjectNotFound, db_session

from src.lead_display_utils import compute_dias_para_agendar, lead_display_nombre
from src.models import CallReport as CallReportEntity
from src.models import Lead as LeadEntity, ReelContent, StorySequence, YoutubeContent
from src.schemas import (
    LeadCreateRequest,
    LeadOut,
    LeadPatchRequest,
    LeadsListResponse,
    LeadsMetricsOut,
)
from src.services.programs_services import (
    build_program_norm_price_map,
    program_price_usd_for_prog_raw,
)
from src.services.call_report_service import (
    analyze_call_report,
    get_or_create_report,
    is_fathom_link,
    normalize_fathom_url,
)

router = APIRouter(prefix="/api/leads", tags=["leads"], redirect_slashes=False)

_AR = ZoneInfo("America/Argentina/Buenos_Aires")

_STORY_AGENDA_PREFIX = "story:"
_YOUTUBE_AGENDA_PREFIX = "youtube:"


def _normalize_channel_anchor_value(user_id_int: int, raw: str | None) -> str:
    """Valor canónico para `punto_agenda` o `via`: bio, reel id, story:<id>, youtube:<id>, texto libre."""
    s = (str(raw) if raw is not None else "").strip()
    if not s:
        return ""
    low = s.casefold()
    if low == "bio":
        return "bio"
    if low.startswith(_STORY_AGENDA_PREFIX):
        rest = s[len(_STORY_AGENDA_PREFIX) :].strip()
        try:
            sid = int(rest)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="punto_agenda de historia inválido.",
            ) from None
        try:
            seq = StorySequence.get(id=sid)
        except ObjectNotFound as e:
            raise HTTPException(
                status_code=400,
                detail="Secuencia de historia no encontrada.",
            ) from e
        if int(seq.user_id) != user_id_int:
            raise HTTPException(status_code=400, detail="Secuencia de historia no encontrada.")
        return f"{_STORY_AGENDA_PREFIX}{sid}"
    if low.startswith(_YOUTUBE_AGENDA_PREFIX):
        rest = s[len(_YOUTUBE_AGENDA_PREFIX) :].strip()
        try:
            yid = int(rest)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Referencia de YouTube inválida (usar youtube:<id>).",
            ) from None
        try:
            yrow = YoutubeContent.get(id=yid)
        except ObjectNotFound as e:
            raise HTTPException(status_code=400, detail="Video de YouTube no encontrado.") from e
        if int(yrow.user_id) != user_id_int:
            raise HTTPException(status_code=400, detail="Video de YouTube no encontrado.")
        return f"{_YOUTUBE_AGENDA_PREFIX}{yid}"
    try:
        rid = int(s)
    except ValueError:
        rid = None
    if rid is not None:
        try:
            row = ReelContent.get(id=rid, user_id=user_id_int)
            return str(row.id)
        except ObjectNotFound:
            pass
        try:
            seq = StorySequence.get(id=rid)
        except ObjectNotFound:
            seq = None
        if seq is not None and int(seq.user_id) == user_id_int:
            return f"{_STORY_AGENDA_PREFIX}{rid}"
    try:
        insta_row = ReelContent.get(instagram_id=s)
    except ObjectNotFound:
        insta_row = None
    if insta_row is not None and int(insta_row.user_id) == user_id_int:
        return str(insta_row.id)
    return s


def _normalize_punto_agenda_value(user_id_int: int, raw: str | None) -> str:
    """Normaliza `punto_agenda`: reel, historia, youtube, bio, u otro texto."""
    return _normalize_channel_anchor_value(user_id_int, raw)


def _normalize_via_value(user_id_int: int, raw: str | None) -> str:
    """Normaliza `via` / entry_channel con los mismos tokens que punto_agenda (sin sumar métricas por campo)."""
    return _normalize_channel_anchor_value(user_id_int, raw)


def _lead_effective_dt(row: LeadEntity) -> datetime | None:
    """Fecha para mes AR y orden en listados: conversación bot o alta.

    `primer_contacto` es solo un dato de control en la UI; no debe mover el lead
    de mes al editarlo (GET /leads ?month=, campo `month` en la respuesta)."""
    return row.fecha_bot or row.created_at


def _lead_month_ar(row: LeadEntity) -> tuple[int, int] | None:
    """(año, mes) en Argentina; mismo criterio de calendario que métricas de reels."""
    dt = _lead_effective_dt(row)
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    d_utc = dt.replace(tzinfo=timezone.utc)
    d_ar = d_utc.astimezone(_AR)
    return (d_ar.year, d_ar.month)


def _lead_month_string_ar(row: LeadEntity) -> str | None:
    """YYYY-MM del mes operativo (mismo criterio que GET /leads ?month=)."""
    mb = _lead_month_ar(row)
    if mb is None:
        return None
    y, m = mb
    return f"{y}-{m:02d}"


def _lead_sort_ts(row: LeadEntity) -> float:
    dt = _lead_effective_dt(row)
    if dt is None:
        return 0.0
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return float(dt.replace(tzinfo=timezone.utc).timestamp())


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _dt_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


def _agendo_en_looks_like_iso_datetime(val: str | None) -> bool:
    s = (val or "").strip()
    return bool(s) and bool(re.match(r"^\d{4}-\d{2}-\d{2}", s))


def _scheduled_at_from_row(row: LeadEntity) -> str | None:
    if row.call is not None:
        return _dt_iso(row.call)
    s = (row.agendo_en or "").strip()
    if _agendo_en_looks_like_iso_datetime(s):
        d = _parse_dt_in(s)
        return _dt_iso(d) if d else None
    return None


def _agendo_en_channel_for_api(row: LeadEntity) -> str | None:
    s = (row.agendo_en or "").strip()
    if _agendo_en_looks_like_iso_datetime(s):
        return "Chat"
    if s:
        return s
    if row.agendo is not None:
        return "Chat"
    return None


def _sync_dias_para_agendar(row: LeadEntity) -> None:
    row.dias_para_agendar = compute_dias_para_agendar(row.primer_contacto, row.agendo)


def _parse_dt_in(val: str | None) -> datetime | None:
    if val is None or not str(val).strip():
        return None
    s = str(val).strip()
    try:
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            return datetime.fromisoformat(s[:10] + "T00:00:00")
        cleaned = s.replace("Z", "").split("+")[0]
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt
    except ValueError:
        return None


def _to_lead_out(row: LeadEntity, norm_prices: dict[str, float] | None = None) -> LeadOut:
    st = (row.status or row.estado or "").strip() or "Pendiente"
    created = row.created_at
    if created is not None and created.tzinfo is not None:
        created = created.replace(tzinfo=None)
    date_s = created.date().isoformat() if created else date.today().isoformat()
    month_s = _lead_month_string_ar(row)
    if month_s is None and created is not None:
        month_s = f"{created.year}-{created.month:02d}"
    ing = float(row.ingresos_lead or 0)
    kw = row.keyword
    price_catalog = program_price_usd_for_prog_raw(norm_prices or {}, row.programa_ofrecido)
    return LeadOut(
        id=str(row.id),
        lead_user_id=str(row.user_id),
        client_name=lead_display_nombre(row.nombre, row.ig),
        ig_handle=row.ig,
        phone=row.telefono,
        avatar_type=row.avatar,
        status=st,
        origin=row.origen,
        entry_channel=row.via,
        entry_funnel=kw,
        keyword=kw,
        agenda_point=row.punto_agenda,
        ctas_responded=int(row.ctas_respondidos or 0),
        first_contact_at=_dt_iso(row.primer_contacto),
        fecha_bot=_dt_iso(row.fecha_bot),
        scheduled_at=_scheduled_at_from_row(row),
        agendo=_dt_iso(row.agendo),
        agendo_en=_agendo_en_channel_for_api(row),
        call_at=None,
        call=_dt_iso(row.call),
        call_link=row.link_llamada,
        closer_report=(row.closer_report or "").strip() or None,
        program_offered=row.programa_ofrecido,
        programada_ofrecido_llamada=(row.programada_ofrecido_llamada or "").strip() or None,
        program_price_usd=price_catalog,
        revenue=ing,
        payment=float(row.pago or 0),
        owed=float(row.debe or 0),
        closer=(row.closer or "").strip() or None,
        setter=(row.setter or "").strip() or None,
        notes=row.notas,
        date=date_s,
        month=month_s,
        email=None,
        dolores_setting=row.dolores_setting,
        dolores_llamada=row.dolores_llamada,
        razon_compra=row.razon_compra,
        dias_agendamiento=compute_dias_para_agendar(row.primer_contacto, row.agendo),
        ingresos_mensuales=ing,
        compromiso=None,
        urgencia=None,
        disposicion_invertir=None,
        calendly_event_uri=None,
        calendly_invitee_uri=None,
        source_type=(
            "manual"
            if (row.origen or "").strip().casefold() == "manual"
            else "manychat"
            if (row.manychat_contact_id or "").strip()
            else "neon"
        ),
        content_url=row.content_url,
        manychat_contact_id=row.manychat_contact_id,
        respondio_auto=row.respondio_auto,
    )


@router.get("", response_model=LeadsListResponse)
def list_leads(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(
        default=None,
        description="YYYY-MM; filtra por fecha_bot o created_at (mes AR); primer contacto no afecta el mes",
    ),
) -> LeadsListResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    month_key: tuple[int, int] | None = None
    if month and str(month).strip():
        month_key = _parse_month_query(month)
        if month_key is None:
            raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).")

    with db_session:
        norm_prices = build_program_norm_price_map(uid)
        rows = [
            r
            for r in list(LeadEntity.select())
            if int(r.user_id) == uid and r.agendo is not None
        ]
        if month_key is not None:
            year_m, month_m = month_key
            rows = [
                r
                for r in rows
                if (mb := _lead_month_ar(r)) is not None and mb == (year_m, month_m)
            ]

        rows.sort(key=_lead_sort_ts, reverse=True)
        out = [_to_lead_out(r, norm_prices) for r in rows]

    return LeadsListResponse(leads=out)


def _operative_month_for_create(month_param: str | None) -> tuple[int, int]:
    """Mes operativo para anclar fecha_bot/agendo (AR si no se envía month)."""
    if month_param and str(month_param).strip():
        mk = _parse_month_query(month_param)
        if mk is None:
            raise HTTPException(status_code=400, detail="month inválido (usar YYYY-MM).")
        return mk
    now_ar = datetime.now(timezone.utc).astimezone(_AR)
    return (now_ar.year, now_ar.month)


def _anchor_datetime_for_operative_month(year: int, month: int) -> datetime:
    """Mitad de mes en UTC naive: consistente con filtro GET /leads ?month= (mes AR)."""
    return datetime(year, month, 15, 15, 0, 0)


@router.post("", response_model=LeadOut)
def create_lead(
    body: LeadCreateRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadOut:
    """Alta manual; el lead aparece en la grilla del mes elegido (como si hubiera agendado)."""
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    y, mn = _operative_month_for_create(body.month)
    anchor = _anchor_datetime_for_operative_month(y, mn)
    st = (body.status or "").strip() or "Pendiente"

    with db_session:
        via = _normalize_via_value(uid, (body.entry_channel or "").strip() or "Manual")
        row = LeadEntity(
            user_id=uid,
            nombre=(body.client_name or "").strip(),
            ig=(body.ig_handle or "").strip(),
            telefono=(body.phone or "").strip(),
            notas=(body.notes or "").strip(),
            origen="Manual",
            via=via,
            status=st,
            estado=st,
            fecha_bot=anchor,
            agendo=anchor,
            agendo_en="Manual",
        )
        _sync_dias_para_agendar(row)
        norm_prices = build_program_norm_price_map(uid)
        return _to_lead_out(row, norm_prices)


def _parse_month_query(month: str | None) -> tuple[int, int] | None:
    if not month or not str(month).strip():
        return None
    parts = str(month).strip().split("-", 1)
    if len(parts) != 2:
        return None
    try:
        y, m = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (1 <= m <= 12):
        return None
    return y, m


@router.get("/metrics", response_model=LeadsMetricsOut)
def leads_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(
        default=None,
        description="YYYY-MM; mismo filtro que GET /leads (mes AR por fecha_bot / created_at)",
    ),
) -> LeadsMetricsOut:
    """Métricas agregadas de todos los leads del mes (no filtro BIO)."""
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    month_key: tuple[int, int] | None = None
    if month and str(month).strip():
        month_key = _parse_month_query(month)
        if month_key is None:
            raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).")
    with db_session:
        rows = [r for r in list(LeadEntity.select()) if int(r.user_id) == uid]
        if month_key is not None:
            y, mn = month_key
            rows = [
                r
                for r in rows
                if (mb := _lead_month_ar(r)) is not None and mb == (y, mn)
            ]
        total = len(rows)
        agendaron = sum(1 for r in rows if r.agendo is not None)
        cash_total = sum(float(r.pago or 0) for r in rows)
    cash_por_chat = (cash_total / total) if total else 0.0
    return LeadsMetricsOut(
        total_leads=total,
        agendaron=agendaron,
        cash_total=cash_total,
        cash_por_chat=cash_por_chat,
    )


@router.patch("/{lead_id}", response_model=LeadOut)
def patch_lead(
    lead_id: str,
    body: LeadPatchRequest,
    background: BackgroundTasks,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadOut:
    try:
        lid = int(lead_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id o user_id inválido") from e

    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar.")

    fathom_to_analyze: str | None = None

    with db_session:
        try:
            row = LeadEntity[lid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Lead no encontrado.")

        if "client_name" in data:
            row.nombre = (data["client_name"] or "") or ""
        if "ig_handle" in data:
            row.ig = data["ig_handle"] or ""
        if "phone" in data:
            row.telefono = data["phone"] or ""
        if "avatar_type" in data:
            row.avatar = data["avatar_type"] or ""
        if "status" in data:
            st = (data["status"] or "").strip() or "Pendiente"
            row.status = st
            row.estado = st
        if "origen" in data:
            row.origen = (data["origen"] or "") or ""
        elif "origin" in data:
            row.origen = (data["origin"] or "") or ""
        if "via" in data:
            row.via = _normalize_via_value(uid, data.get("via"))
        elif "entry_channel" in data:
            row.via = _normalize_via_value(uid, data.get("entry_channel"))
        if "entry_funnel" in data:
            row.keyword = data["entry_funnel"] or ""
        if "keyword" in data:
            row.keyword = data["keyword"] or ""
        if "punto_agenda" in data:
            row.punto_agenda = _normalize_punto_agenda_value(uid, data.get("punto_agenda"))
        elif "agenda_point" in data:
            row.punto_agenda = _normalize_punto_agenda_value(uid, data.get("agenda_point"))
        if "ctas_responded" in data:
            row.ctas_respondidos = max(0, int(data["ctas_responded"] or 0))
        if "first_contact_at" in data:
            row.primer_contacto = _parse_dt_in(data["first_contact_at"])
        if "scheduled_at" in data:
            row.call = _parse_dt_in(data["scheduled_at"])
        elif "call" in data:
            v = data["call"]
            row.call = _parse_dt_in(v) if v is not None and str(v).strip() else None
        if "agendo" in data:
            v = data["agendo"]
            row.agendo = _parse_dt_in(v) if v is not None and str(v).strip() else None
        if "agendo_en" in data:
            v = data["agendo_en"]
            raw = (str(v).strip() if v is not None else "") or "Chat"
            if _agendo_en_looks_like_iso_datetime(raw):
                if "scheduled_at" not in data and "call" not in data:
                    row.call = _parse_dt_in(raw)
                row.agendo_en = "Chat"
            else:
                row.agendo_en = raw or "Chat"
        if "call_link" in data:
            prev_link = normalize_fathom_url(row.link_llamada or "")
            row.link_llamada = data["call_link"] or ""
            nuevo_link = normalize_fathom_url(row.link_llamada or "")
            if is_fathom_link(nuevo_link) and nuevo_link != prev_link:
                fathom_to_analyze = nuevo_link
        if "program_offered" in data:
            row.programa_ofrecido = data["program_offered"] or ""
        if "programada_ofrecido_llamada" in data:
            row.programada_ofrecido_llamada = data["programada_ofrecido_llamada"] or ""
        if "ingresos_mensuales" in data:
            row.ingresos_lead = float(data["ingresos_mensuales"] or 0)
        elif "revenue" in data:
            row.ingresos_lead = float(data["revenue"] or 0)
        if "payment" in data:
            row.pago = float(data["payment"] or 0)
        if "owed" in data:
            row.debe = float(data["owed"] or 0)
        if "notes" in data:
            row.notas = data["notes"] or ""
        if "dolores_setting" in data:
            row.dolores_setting = data["dolores_setting"] or ""
        if "dolores_llamada" in data:
            row.dolores_llamada = data["dolores_llamada"] or ""
        if "closer_report" in data:
            row.closer_report = data["closer_report"] or ""
        if "razon_compra" in data:
            row.razon_compra = data["razon_compra"] or ""
        if "setter" in data:
            row.setter = (str(data["setter"]).strip() if data["setter"] is not None else "") or ""
        if "closer" in data:
            row.closer = (str(data["closer"]).strip() if data["closer"] is not None else "") or ""

        _sync_dias_para_agendar(row)

        norm_prices = build_program_norm_price_map(uid)
        result = _to_lead_out(row, norm_prices)

    if fathom_to_analyze:
        report_id, created = get_or_create_report(lid, fathom_to_analyze, uid)
        if created:
            background.add_task(analyze_call_report, report_id)

    return result


@router.delete("/{lead_id}")
def delete_lead(
    lead_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    """Elimina un lead (cliente) si pertenece al usuario autenticado.

    Los CallReport asociados se conservan; se guarda un snapshot del nombre del lead.
    """
    try:
        lid = int(lead_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id o user_id inválido") from e

    with db_session:
        try:
            row = LeadEntity[lid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Lead no encontrado.")
        nombre_snap = lead_display_nombre(row.nombre, row.ig) or (row.nombre or "").strip() or "Sin nombre"
        for report in CallReportEntity.select(lambda r: r.lead_id == lid):
            if int(report.user_id) != uid:
                continue
            if not (report.lead_nombre or "").strip():
                report.lead_nombre = nombre_snap
        row.delete()

    return {"status": "ok", "id": str(lid)}
