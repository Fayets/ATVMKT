from datetime import date, datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import ObjectNotFound, db_session

from src.lead_display_utils import lead_display_nombre
from src.models import Lead as LeadEntity
from src.schemas import LeadOut, LeadPatchRequest, LeadsListResponse, LeadsMetricsOut

router = APIRouter(prefix="/api/leads", tags=["leads"], redirect_slashes=False)

_AR = ZoneInfo("America/Argentina/Buenos_Aires")


def _lead_effective_dt(row: LeadEntity) -> datetime | None:
    """Fecha operativa del lead: conversación / bot, luego primer contacto, luego alta."""
    return row.fecha_bot or row.primer_contacto or row.created_at


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


def _to_lead_out(row: LeadEntity) -> LeadOut:
    st = (row.status or row.estado or "").strip() or "Pendiente"
    created = row.created_at
    if created is not None and created.tzinfo is not None:
        created = created.replace(tzinfo=None)
    date_s = created.date().isoformat() if created else date.today().isoformat()
    month_s = f"{created.year}-{created.month:02d}" if created else None
    ing = float(row.ingresos_lead or 0)
    kw = row.keyword
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
        agendo=row.agendo,
        agendo_en=(row.agendo_en or "").strip() or None,
        call_at=None,
        call=row.call,
        call_link=row.link_llamada,
        closer_report=None,
        program_offered=row.programa_ofrecido,
        program_purchased=None,
        revenue=ing,
        payment=float(row.pago or 0),
        owed=float(row.debe or 0),
        closer=None,
        setter=None,
        notes=row.notas,
        date=date_s,
        month=month_s,
        email=None,
        dolores_setting=row.dolores_setting,
        dolores_setting_detail=None,
        dolores_llamada=row.dolores_llamada,
        razon_compra=row.razon_compra,
        pago_en_llamada=float(row.pago_en_llamada or 0),
        dias_agendamiento=row.dias_para_agendar,
        ingresos_mensuales=ing,
        compromiso=None,
        urgencia=None,
        disposicion_invertir=None,
        calendly_event_uri=None,
        calendly_invitee_uri=None,
        source_type="manychat" if (row.manychat_contact_id or "").strip() else "neon",
        content_url=row.content_url,
        manychat_contact_id=row.manychat_contact_id,
        respondio_auto=row.respondio_auto,
    )


@router.get("", response_model=LeadsListResponse)
def list_leads(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(
        default=None,
        description="YYYY-MM; filtra por fecha_bot o primer_contacto o created_at (mes AR)",
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
        rows = [
            r
            for r in list(LeadEntity.select())
            if int(r.user_id) == uid and r.agendo is True
        ]
        if month_key is not None:
            year_m, month_m = month_key
            rows = [
                r
                for r in rows
                if (mb := _lead_month_ar(r)) is not None and mb == (year_m, month_m)
            ]

        rows.sort(key=_lead_sort_ts, reverse=True)
        out = [_to_lead_out(r) for r in rows]

    return LeadsListResponse(leads=out)


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
        description="YYYY-MM; mismo filtro que GET /leads (mes AR por fecha_bot / primer_contacto / created_at)",
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
        agendaron = sum(1 for r in rows if r.agendo is True)
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
            row.via = (data["via"] or "") or ""
        elif "entry_channel" in data:
            row.via = data["entry_channel"] or ""
        if "entry_funnel" in data:
            row.keyword = data["entry_funnel"] or ""
        if "keyword" in data:
            row.keyword = data["keyword"] or ""
        if "agenda_point" in data:
            row.punto_agenda = data["agenda_point"] or ""
        if "ctas_responded" in data:
            row.ctas_respondidos = max(0, int(data["ctas_responded"] or 0))
        if "first_contact_at" in data:
            row.primer_contacto = _parse_dt_in(data["first_contact_at"])
        if "agendo_en" in data:
            v = data["agendo_en"]
            row.agendo_en = (str(v).strip() if v is not None else "") or "Chat"
        if "call" in data:
            v = data["call"]
            row.call = bool(v) if v is not None else False
        if "call_link" in data:
            row.link_llamada = data["call_link"] or ""
        if "program_offered" in data:
            row.programa_ofrecido = data["program_offered"] or ""
        if "ingresos_mensuales" in data:
            row.ingresos_lead = float(data["ingresos_mensuales"] or 0)
        elif "revenue" in data:
            row.ingresos_lead = float(data["revenue"] or 0)
        if "payment" in data:
            row.pago = float(data["payment"] or 0)
        if "owed" in data:
            row.debe = float(data["owed"] or 0)
        if "pago_en_llamada" in data:
            row.pago_en_llamada = float(data["pago_en_llamada"] or 0)
        if "dias_agendamiento" in data:
            v = data["dias_agendamiento"]
            row.dias_para_agendar = int(v) if v is not None else None
        if "notes" in data:
            row.notas = data["notes"] or ""
        if "dolores_setting" in data:
            row.dolores_setting = data["dolores_setting"] or ""
        if "dolores_llamada" in data:
            row.dolores_llamada = data["dolores_llamada"] or ""
        if "razon_compra" in data:
            row.razon_compra = data["razon_compra"] or ""

        return _to_lead_out(row)


@router.delete("/{lead_id}")
def delete_lead(
    lead_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    """Elimina un lead (cliente) si pertenece al usuario autenticado."""
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
        row.delete()

    return {"status": "ok", "id": str(lid)}
