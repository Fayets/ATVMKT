from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import db_session

from src.models import Lead as LeadEntity
from src.schemas import LeadOut, LeadsListResponse

router = APIRouter(prefix="/api/leads", tags=["leads"], redirect_slashes=False)


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
        client_name=row.nombre or "",
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
        scheduled_at=_dt_iso(row.agendo_en),
        agendo=row.agendo,
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
    month: str | None = Query(default=None, description="Filtrar por YYYY-MM (created_at)"),
) -> LeadsListResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    year_m: int | None = None
    month_m: int | None = None
    if month and str(month).strip():
        parts = str(month).strip().split("-", 1)
        if len(parts) == 2:
            try:
                year_m, month_m = int(parts[0]), int(parts[1])
            except ValueError:
                year_m, month_m = None, None
        if year_m is None or month_m is None or not (1 <= month_m <= 12):
            raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).")

    with db_session:
        rows = [r for r in list(LeadEntity.select()) if int(r.user_id) == uid]
        if year_m is not None and month_m is not None:
            rows = [
                r
                for r in rows
                if r.created_at is not None
                and r.created_at.year == year_m
                and r.created_at.month == month_m
            ]
        def _sort_ts(r: LeadEntity) -> float:
            c = r.created_at
            return float(c.timestamp()) if c is not None else 0.0

        rows.sort(key=_sort_ts, reverse=True)
        out = [_to_lead_out(r) for r in rows]

    return LeadsListResponse(leads=out)
