"""Reporte diario de caja (Caja 1) para el agente externo."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pony.orm import db_session

from src.models import CallReport, CloserReport, Lead, SetterReport, StorySequence, TeamMember
from src.services.call_report_service import is_fathom_link
from src.services.closer_report_auto_service import (
    closer_names_with_calls_on_date,
    find_closer_member,
    leads_for_closer_on_date,
)
from src.services.programs_services import build_program_norm_price_map, program_price_usd_for_prog_raw

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

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


def _members_by_id(user_id: int, rol: str) -> dict[int, TeamMember]:
    return {
        int(m.id): m
        for m in list(TeamMember.select())
        if int(m.user_id) == user_id and m.rol == rol
    }


def _closer_report_member_ids(user_id: int, fecha: date) -> set[int]:
    return {
        int(r.member_id)
        for r in list(CloserReport.select())
        if int(r.user_id) == user_id and r.fecha == fecha
    }


def _setter_report_rows(user_id: int, fecha: date) -> list[SetterReport]:
    return [
        r
        for r in list(SetterReport.select())
        if int(r.user_id) == user_id and r.fecha == fecha
    ]


def _setter_conversaciones(user_id: int, member_id: int, fecha: date) -> int:
    total = 0
    for report in list(SetterReport.select()):
        if int(report.user_id) != user_id or int(report.member_id) != member_id:
            continue
        if report.fecha == fecha:
            total += int(report.conversaciones or 0)
    return total


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
    return member_id in _closer_report_member_ids(user_id, fecha)


def _closers_sin_reporte(user_id: int, fecha: date) -> list[str]:
    """Closers con llamadas ese día que no tienen fila en closer_report."""
    faltantes: list[str] = []
    for closer_name in sorted(closer_names_with_calls_on_date(user_id, fecha)):
        member = find_closer_member(user_id, closer_name)
        if member is None:
            faltantes.append(closer_name)
            continue
        if not _closer_report_exists(user_id, int(member.id), fecha):
            faltantes.append(member.nombre)
    return faltantes


def _build_reportes_closer(user_id: int, fecha: date) -> dict[str, Any]:
    members = _members_by_id(user_id, "closer")
    reported_ids = _closer_report_member_ids(user_id, fecha)
    cargados: list[dict[str, Any]] = []
    for member_id in sorted(reported_ids):
        member = members.get(member_id)
        nombre = member.nombre if member else f"(member #{member_id})"
        leads = leads_for_closer_on_date(user_id, fecha, nombre) if member else []
        actualizadas = sum(
            1 for lead in leads if not _is_pendiente(_lead_status_raw(lead))
        )
        cargados.append(
            {
                "nombre": nombre,
                "llamadas": len(leads),
                "actualizadas": actualizadas,
            }
        )
    cargados.sort(key=lambda x: str(x["nombre"]).casefold())
    return {"cargados": cargados, "cantidad": len(cargados)}


def _build_reportes_setter(user_id: int, fecha: date) -> dict[str, Any]:
    members = _members_by_id(user_id, "setter")
    chats_hoy = _count_chats_dia(user_id, fecha)
    cargados: list[dict[str, Any]] = []
    for report in sorted(_setter_report_rows(user_id, fecha), key=lambda r: int(r.member_id)):
        member = members.get(int(report.member_id))
        nombre = member.nombre if member else f"(member #{report.member_id})"
        cargados.append(
            {
                "nombre": nombre,
                "conversaciones": int(report.conversaciones or 0),
                "chats": chats_hoy,
            }
        )
    cargados.sort(key=lambda x: str(x["nombre"]).casefold())
    return {"cargados": cargados, "cantidad": len(cargados)}


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


def _build_auditoria_closer(
    user_id: int,
    fecha: date,
    llamadas_rows: list[Lead],
    reportes_closer: dict[str, Any],
) -> dict[str, Any]:
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

    closers_sin_reporte = _closers_sin_reporte(user_id, fecha)
    reporte_cargado = int(reportes_closer.get("cantidad") or 0) > 0

    if pagos_sin_cambio:
        estado = "datos_incoherentes"
        detalle = (
            f"{len(pagos_sin_cambio)} llamada(s) con pago cargado pero estado pendiente: "
            f"{', '.join(pagos_sin_cambio[:3])}"
            + ("…" if len(pagos_sin_cambio) > 3 else "")
        )
    elif closers_sin_reporte:
        estado = "sin_reporte"
        nombres = ", ".join(closers_sin_reporte[:5]) + ("…" if len(closers_sin_reporte) > 5 else "")
        detalle = (
            f"Sin reporte closer para {fecha.isoformat()} de: {nombres}."
            if nombres
            else f"Ningún closer cargó reporte para {fecha.isoformat()}."
        )
    elif reporte_cargado:
        estado = "ok"
        nombres_ok = ", ".join(
            str(item.get("nombre") or "") for item in reportes_closer.get("cargados") or []
        )
        if llamadas_rows:
            detalle = (
                f"Reportes closer cargados ({nombres_ok}); {llamadas_con_status} llamada(s) "
                f"con status actualizado y {llamadas_pendientes} pendiente(s)."
            )
        else:
            detalle = f"Reportes closer cargados ({nombres_ok}); sin llamadas agendadas."
    else:
        estado = "sin_reporte"
        detalle = f"Ningún closer cargó reporte para {fecha.isoformat()}."

    return {
        "estado": estado,
        "reporte_cargado": reporte_cargado,
        "llamadas_con_status_actualizado": llamadas_con_status,
        "llamadas_pendientes": llamadas_pendientes,
        "pagos_sin_cambio_estado": pagos_sin_cambio,
        "detalle": detalle,
    }


def _build_auditoria_setter(
    user_id: int,
    fecha: date,
    reportes_setter: dict[str, Any],
) -> dict[str, Any]:
    ayer = fecha.fromordinal(fecha.toordinal() - 1)
    chats_hoy = _count_chats_dia(user_id, fecha)
    chats_ayer = _count_chats_dia(user_id, ayer)
    delta_chats = chats_hoy - chats_ayer

    members = _members_by_id(user_id, "setter")
    member_id_by_name = {m.nombre.casefold(): int(m.id) for m in members.values()}

    conversaciones_hoy = 0
    conversaciones_ayer = 0
    sospechosos: list[str] = []
    for item in reportes_setter.get("cargados") or []:
        nombre = str(item.get("nombre") or "")
        conv_hoy = int(item.get("conversaciones") or 0)
        conversaciones_hoy += conv_hoy
        member_id = member_id_by_name.get(nombre.casefold())
        conv_ayer = (
            _setter_conversaciones(user_id, member_id, ayer) if member_id is not None else 0
        )
        conversaciones_ayer += conv_ayer
        if delta_chats > 0 and (conv_hoy - conv_ayer) <= 0:
            sospechosos.append(nombre)

    delta_conversaciones = conversaciones_hoy - conversaciones_ayer
    reporte_cargado = int(reportes_setter.get("cantidad") or 0) > 0

    if not reporte_cargado:
        estado = "sin_reporte"
        detalle = (
            f"Ningún setter cargó reporte para {fecha.isoformat()}. "
            f"Chats auto: {chats_hoy} (Δ {delta_chats:+d} vs ayer)."
        )
    elif sospechosos:
        estado = "sospecha_no_carga"
        nombres = ", ".join(sospechosos[:5]) + ("…" if len(sospechosos) > 5 else "")
        detalle = (
            f"Chats subieron +{delta_chats} ({chats_ayer}→{chats_hoy}) pero conversaciones "
            f"no acompañaron para: {nombres}."
        )
    else:
        estado = "ok"
        nombres_ok = ", ".join(
            str(item.get("nombre") or "") for item in reportes_setter.get("cargados") or []
        )
        detalle = (
            f"Reportes setter cargados ({nombres_ok}): {conversaciones_hoy} conversaciones "
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
    reportes_closer = _build_reportes_closer(user_id, target)
    reportes_setter = _build_reportes_setter(user_id, target)
    return {
        "fecha": target.isoformat(),
        "llamadas": _build_llamadas_block(user_id, target, llamadas_rows),
        "reportes_closer": reportes_closer,
        "reportes_setter": reportes_setter,
        "auditoria_closer": _build_auditoria_closer(
            user_id, target, llamadas_rows, reportes_closer
        ),
        "auditoria_setter": _build_auditoria_setter(user_id, target, reportes_setter),
    }
