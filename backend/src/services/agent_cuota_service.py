"""Cuotas del agente externo: búsqueda y cambio acotado de estado de pago."""

from __future__ import annotations

from datetime import date
from typing import Any

from pony.orm import db_session

from src.models import Cuota
from src.services.agent_caja_service import today_ar

_ESTADO_PAGADO = "pagado"
_ESTADO_PENDIENTE = "pendiente"


def _normalize_estado(raw: str | None) -> str:
    val = (raw or "").strip().lower()
    if val in (_ESTADO_PAGADO, "paid"):
        return _ESTADO_PAGADO
    return _ESTADO_PENDIENTE


def _is_pagada(row: Cuota) -> bool:
    return _normalize_estado(row.estado) == _ESTADO_PAGADO


def _date_iso(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def _append_nota(row: Cuota, line: str) -> None:
    prev = (row.notas or "").strip()
    row.notas = f"{prev}\n{line}".strip() if prev else line


def _cuota_out(row: Cuota, *, mensaje: str | None = None) -> dict[str, Any]:
    return {
        "cuota_id": int(row.id),
        "cliente_nombre": (row.cliente_nombre or "").strip(),
        "monto_usd": round(float(row.monto_usd or 0), 2),
        "estado": _normalize_estado(row.estado),
        "fecha_pago": _date_iso(row.fecha_pago),
        "mensaje": mensaje,
    }


def _cuota_buscar_item(row: Cuota) -> dict[str, Any]:
    return {
        "cuota_id": int(row.id),
        "cliente_nombre": (row.cliente_nombre or "").strip(),
        "monto_usd": round(float(row.monto_usd or 0), 2),
        "fecha_vence": _date_iso(row.fecha_vence),
        "estado": _normalize_estado(row.estado),
        "tipo": (row.tipo or "").strip(),
    }


@db_session
def buscar_cuotas(user_id: int, cliente: str) -> dict[str, Any]:
    needle = (cliente or "").strip().casefold()
    if not needle:
        return {"cuotas": []}

    rows = [
        r
        for r in list(Cuota.select())
        if int(r.user_id) == user_id and needle in (r.cliente_nombre or "").strip().casefold()
    ]
    rows.sort(key=lambda r: (r.fecha_vence or date.max, int(r.id)))
    return {"cuotas": [_cuota_buscar_item(r) for r in rows]}


@db_session
def marcar_cuota_pagada(user_id: int, cuota_id: int) -> dict[str, Any] | None:
    row = Cuota.get(id=cuota_id)
    if row is None or int(row.user_id) != user_id:
        return None

    if _is_pagada(row):
        return _cuota_out(row, mensaje="La cuota ya estaba pagada.")

    hoy = today_ar()
    row.estado = _ESTADO_PAGADO
    row.fecha_pago = hoy
    _append_nota(row, f"marcada pagada vía agente el {hoy.isoformat()}")
    return _cuota_out(row)


@db_session
def revertir_cuota_pago(user_id: int, cuota_id: int) -> dict[str, Any] | None:
    row = Cuota.get(id=cuota_id)
    if row is None or int(row.user_id) != user_id:
        return None

    if not _is_pagada(row):
        return _cuota_out(row, mensaje="La cuota ya estaba pendiente.")

    hoy = today_ar()
    row.estado = _ESTADO_PENDIENTE
    row.fecha_pago = None
    _append_nota(row, f"revertida a pendiente vía agente el {hoy.isoformat()}")
    return _cuota_out(row)
