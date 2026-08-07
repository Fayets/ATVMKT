"""Reporte diario de caja (Caja 1) para el agente externo."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pony.orm import db_session

from src.models import CallReport, CloserReport, Lead, SetterReport, StorySequence, TeamMember
from src.services.agent_analytics_service import _match_members
from src.services.call_report_service import is_fathom_link
from src.services.programs_services import build_program_norm_price_map, program_price_usd_for_prog_raw

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

CLOSER_AUDIT_NAME = "Nick"
SETTER_AUDIT_NAME = "Andrés"

_PENDIENTE_KEYS = frozenset({"", "pendiente", "pending", "agendado"})
_NO_SHOW_KEYS = frozenset({"no show", "noshow", "no asistio", "no asistió", "no-asistio"})


def today_ar() -> date:
    return datetime.now(AR_TZ).date()


def _parse_fecha(fecha: date | None) -> date:
    return fecha or today_ar()


def _day_bounds(fecha: date) -> tuple[datetime, datetime]:
    inicio = datetime.combine(fecha, time.min)
    fin = datetime.combine(fecha, time.max)
    return inicio, fin


def _dt_to_ar_date(dt: datetime | None) -> date | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(AR_TZ).date()


def _lead_status_raw(lead: Lead) -> str:
    return (lead.status or lead.estado or "Pendiente").strip() or "Pendiente"


def _status_bucket(raw: str) -> str:
    key = (raw or "").strip().casefold()
    if key in _PENDIENTE_KEYS:
        return "pendiente"
    if key in _NO_SHOW_KEYS:
        return "no_show"
    return "asistio"


def _status_display(raw: str) -> str:
    return _status_bucket(raw)


def _is_pendiente(raw: str) -> bool:
    return _status_bucket(raw) == "pendiente"


def _resolve_member(user_id: int, nombre_fragment: str, rol: str) -> TeamMember | None:
    matches = [m for m in _match_members(user_id, nombre_fragment) if m.rol == rol and m.activo]
    if not matches:
        matches = [m for m in _match_members(user_id, nombre_fragment) if m.rol == rol]
    if not matches:
        return None
    matches.sort(key=lambda m: int(m.id))
    return matches[0]


def _leads_with_call_on_date(user_id: int, fecha: date) -> list[Lead]:
    inicio, fin = _day_bounds(fecha)
    rows = [
        l
        for l in list(Lead.select())
        if int(l.user_id) == user_id and l.call is not None and inicio <= l.call <= fin
    ]
    rows.sort(key=lambda l: l.call or datetime.min)
    return rows


def _fathom_lead_ids(user_id: int, lead_ids: list[int]) -> set[int]:
    if not lead_ids:
        return set()
    ids = set(lead_ids)
    found: set[int] = set()
    for report in list(CallReport.select()):
        if int(report.user_id) != user_id:
            continue
        lid = int(report.lead_id)
        if lid in ids:
            found.add(lid)
    return found


def _closer_report_exists(user_id: int, member_id: int, fecha: date) -> bool:
    for report in list(CloserReport.select()):
        if (
            int(report.user_id) == user_id
            and int(report.member_id) == member_id
            and report.fecha == fecha
        ):
            return True
    return False


def _setter_conversaciones(user_id: int, member_id: int, fecha: date) -> int:
    total = 0
    for report in list(SetterReport.select()):
        if int(report.user_id) != user_id or int(report.member_id) != member_id:
            continue
        if report.fecha == fecha:
            total += int(report.conversaciones or 0)
    return total


def _setter_report_exists(user_id: int, member_id: int, fecha: date) -> bool:
    for report in list(SetterReport.select()):
        if (
            int(report.user_id) == user_id
            and int(report.member_id) == member_id
            and report.fecha == fecha
        ):
            return True
    return False


def _count_chats_dia(user_id: int, fecha: date) -> int:
    """Chats automáticos del día: leads nuevos (fecha_bot/created_at AR) + replies IG en historias."""
    leads_count = 0
    for lead in list(Lead.select()):
        if int(lead.user_id) != user_id:
            continue
        chat_day = _dt_to_ar_date(lead.fecha_bot or lead.created_at)
        if chat_day == fecha:
            leads_count += 1

    story_replies = 0
    for seq in list(StorySequence.select()):
        if int(seq.user_id) != user_id or seq.sequence_date != fecha:
            continue
        for slide in seq.slides:
            story_replies += int(slide.replies or 0)

    return leads_count + story_replies


def _facturacion_lead_usd(lead: Lead, *, catalog_defined: bool, norm_prices: dict[str, float]) -> float:
    prog = (lead.programa_ofrecido or "").strip()
    if not prog:
        if not catalog_defined:
            return float(lead.pago or 0) or float(lead.ingresos_lead or 0)
        return 0.0
    api_price = program_price_usd_for_prog_raw(norm_prices, prog)
    if api_price is not None:
        return float(api_price)
    return float(lead.ingresos_lead or 0)


def _build_llamadas_block(user_id: int, fecha: date, rows: list[Lead] | None = None) -> dict[str, Any]:
    if rows is None:
        rows = _leads_with_call_on_date(user_id, fecha)
    lead_ids = [int(l.id) for l in rows]
    fathom_ids = _fathom_lead_ids(user_id, lead_ids)

    norm_prices = build_program_norm_price_map(user_id)
    catalog_defined = len(norm_prices) > 0

    por_status = {"pendiente": 0, "asistio": 0, "no_show": 0}
    detalle: list[dict[str, Any]] = []
    cash_del_dia = 0.0
    facturacion_del_dia = 0.0
    con_venta = 0

    for lead in rows:
        raw_status = _lead_status_raw(lead)
        bucket = _status_bucket(raw_status)
        por_status[bucket] = por_status.get(bucket, 0) + 1

        pago = float(lead.pago or 0)
        cash_del_dia += pago
        prog = (lead.programa_ofrecido or "").strip() or None
        facturacion = _facturacion_lead_usd(lead, catalog_defined=catalog_defined, norm_prices=norm_prices)
        if facturacion > 0:
            facturacion_del_dia += facturacion

        is_cierre = bucket == "asistio" and raw_status.casefold() in {"cerrado", "closed", "won"}
        if pago > 0 or is_cierre:
            con_venta += 1

        link = (lead.link_llamada or "").strip()
        tiene_fathom = is_fathom_link(link) or int(lead.id) in fathom_ids

        hora = lead.call.strftime("%H:%M") if lead.call else ""
        detalle.append(
            {
                "hora": hora,
                "lead": (lead.nombre or "").strip(),
                "closer": (lead.closer or "").strip(),
                "status": _status_display(raw_status),
                "programa_comprado": prog,
                "pago_usd": round(pago, 2),
                "tiene_fathom": tiene_fathom,
            }
        )

    return {
        "total": len(rows),
        "detalle": detalle,
        "por_status": por_status,
        "con_venta": con_venta,
        "cash_del_dia_usd": round(cash_del_dia, 2),
        "facturacion_del_dia_usd": round(facturacion_del_dia, 2),
    }


def _build_auditoria_closer(user_id: int, fecha: date, llamadas_rows: list[Lead]) -> dict[str, Any]:
    member = _resolve_member(user_id, CLOSER_AUDIT_NAME, "closer")
    reporte_cargado = False
    if member is not None:
        reporte_cargado = _closer_report_exists(user_id, int(member.id), fecha)

    llamadas_con_status = 0
    llamadas_pendientes = 0
    pagos_sin_cambio: list[str] = []

    for lead in llamadas_rows:
        raw = _lead_status_raw(lead)
        if _is_pendiente(raw):
            llamadas_pendientes += 1
        else:
            llamadas_con_status += 1

        pago = float(lead.pago or 0)
        if pago > 0 and _is_pendiente(raw):
            name = (lead.nombre or "").strip() or f"Lead #{lead.id}"
            pagos_sin_cambio.append(name)

    closer_label = member.nombre if member else CLOSER_AUDIT_NAME

    if pagos_sin_cambio:
        estado = "datos_incoherentes"
        detalle = (
            f"{len(pagos_sin_cambio)} llamada(s) con pago cargado pero estado pendiente: "
            f"{', '.join(pagos_sin_cambio[:3])}"
            + ("…" if len(pagos_sin_cambio) > 3 else "")
        )
    elif not reporte_cargado:
        estado = "sin_reporte"
        if llamadas_rows:
            detalle = (
                f"Reporte del closer ({closer_label}) no cargado para {fecha.isoformat()}. "
                f"{len(llamadas_rows)} llamada(s) agendadas."
            )
        else:
            detalle = f"Reporte del closer ({closer_label}) no cargado para {fecha.isoformat()}."
    else:
        estado = "ok"
        if llamadas_rows:
            detalle = (
                f"Reporte closer cargado; {llamadas_con_status} llamada(s) con status actualizado "
                f"y {llamadas_pendientes} pendiente(s)."
            )
        else:
            detalle = f"Reporte closer cargado; sin llamadas agendadas para {fecha.isoformat()}."

    return {
        "estado": estado,
        "reporte_cargado": reporte_cargado,
        "llamadas_con_status_actualizado": llamadas_con_status,
        "llamadas_pendientes": llamadas_pendientes,
        "pagos_sin_cambio_estado": pagos_sin_cambio,
        "detalle": detalle,
    }


def _build_auditoria_setter(user_id: int, fecha: date) -> dict[str, Any]:
    ayer = fecha.fromordinal(fecha.toordinal() - 1)
    member = _resolve_member(user_id, SETTER_AUDIT_NAME, "setter")

    chats_hoy = _count_chats_dia(user_id, fecha)
    chats_ayer = _count_chats_dia(user_id, ayer)
    delta_chats = chats_hoy - chats_ayer

    conversaciones_hoy = 0
    conversaciones_ayer = 0
    reporte_cargado = False
    if member is not None:
        mid = int(member.id)
        conversaciones_hoy = _setter_conversaciones(user_id, mid, fecha)
        conversaciones_ayer = _setter_conversaciones(user_id, mid, ayer)
        reporte_cargado = _setter_report_exists(user_id, mid, fecha)

    delta_conversaciones = conversaciones_hoy - conversaciones_ayer
    setter_label = member.nombre if member else SETTER_AUDIT_NAME

    if not reporte_cargado:
        estado = "sin_reporte"
        detalle = (
            f"Reporte del setter ({setter_label}) no cargado para {fecha.isoformat()}. "
            f"Chats auto: {chats_hoy} (Δ {delta_chats:+d} vs ayer)."
        )
    elif delta_chats > 0 and delta_conversaciones <= 0:
        estado = "sospecha_no_carga"
        detalle = (
            f"Chats subieron +{delta_chats} ({chats_ayer}→{chats_hoy}) pero conversaciones "
            f"no acompañaron ({conversaciones_ayer}→{conversaciones_hoy})."
        )
    else:
        estado = "ok"
        detalle = (
            f"Reporte setter cargado: {conversaciones_hoy} conversaciones "
            f"(Δ {delta_conversaciones:+d} vs ayer). Chats auto: {chats_hoy} (Δ {delta_chats:+d})."
        )

    return {
        "estado": estado,
        "chats_hoy": chats_hoy,
        "chats_ayer": chats_ayer,
        "delta_chats": delta_chats,
        "conversaciones_hoy": conversaciones_hoy,
        "conversaciones_ayer": conversaciones_ayer,
        "delta_conversaciones": delta_conversaciones,
        "reporte_cargado": reporte_cargado,
        "detalle": detalle,
    }


@db_session
def build_caja_dia(user_id: int, fecha: date | None = None) -> dict[str, Any]:
    target = _parse_fecha(fecha)
    llamadas_rows = _leads_with_call_on_date(user_id, target)
    return {
        "fecha": target.isoformat(),
        "llamadas": _build_llamadas_block(user_id, target, llamadas_rows),
        "auditoria_closer": _build_auditoria_closer(user_id, target, llamadas_rows),
        "auditoria_setter": _build_auditoria_setter(user_id, target),
    }
