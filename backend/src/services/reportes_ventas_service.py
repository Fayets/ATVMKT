"""Leads con llamada en un rango de fechas, para el reporte semanal de ATV Clients.

Se listan los leads cuya **llamada** cayó en la semana (`call`), no todos los
leads creados: la tabla `lead` incluye miles de chats del bot que nunca
agendaron, y el reporte de ventas es sobre llamadas.

El funnel se calcula sobre esos mismos leads —y no sobre SetterReport /
CloserReport, que es de donde lo saca el resto de MKT— para que los totales
cierren con las filas que se muestran abajo. Son fuentes distintas: los
reportes diarios los carga el equipo a mano y pueden no coincidir con la tabla.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any
from urllib.parse import urlparse

from pony.orm import db_session

from src.models import Lead, ReelContent, StorySequence, YoutubeContent
from src.services.reportes_semanales_service import _fecha_ar

# Estados finales de una llamada (el campo `estado` manda; `status` es el alias legacy)
_NO_SHOW = {"no show", "no-show"}
_CANCELADA = {"cancelada", "cancelado"}
_CIERRE = {"cerrado", "seña", "sena"}

_MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _estado(row: Lead) -> str:
    return ((row.estado or "").strip() or (row.status or "").strip())


def _ig_handle(raw: str | None) -> str:
    """El campo `ig` llega como handle, como @handle o como URL completa con query."""
    s = (raw or "").strip()
    if not s:
        return ""
    if "instagram.com" in s.lower():
        path = urlparse(s if "//" in s else f"https://{s}").path
        s = path.strip("/").split("/")[0]
    s = s.lstrip("@").strip()
    return re.sub(r"[?&].*$", "", s)


def _fecha_corta(d: date | None) -> str:
    return f"{d.day} {_MESES[d.month - 1]}" if d else ""


def _resolver_pieza(token: str, base_url: str, cache: dict[str, Any]) -> dict[str, Any] | None:
    """Token canónico de `via` / `punto_agenda` → pieza con label y miniatura.

    Formatos: '' | 'bio' | 'ads' | '<id>' (reel) | 'story:<id>' | 'youtube:<id>' | texto libre.
    """
    t = (token or "").strip()
    if not t:
        return None
    if t in cache:
        return cache[t]

    from src.services.reportes_semanales_service import _url_absoluta

    pieza: dict[str, Any]
    low = t.casefold()

    if low == "bio":
        pieza = {"tipo": "bio", "label": "BIO", "thumb": "", "fecha": ""}
    elif low == "ads":
        pieza = {"tipo": "ads", "label": "ADS", "thumb": "", "fecha": ""}
    elif low.startswith("story:"):
        sid = t.split(":", 1)[1].strip()
        seq = StorySequence.get(id=int(sid)) if sid.isdigit() else None
        if seq is None:
            pieza = {"tipo": "desconocido", "label": t, "thumb": "", "fecha": ""}
        else:
            slides = sorted(seq.slides, key=lambda s: s.order_index)
            pieza = {
                "tipo": "historia",
                "label": (seq.title or "").strip() or f"Historias del {_fecha_corta(seq.sequence_date)}",
                "thumb": _url_absoluta(base_url, slides[0].image_url) if slides else "",
                "fecha": seq.sequence_date.isoformat(),
            }
    elif low.startswith("youtube:"):
        yid = t.split(":", 1)[1].strip()
        row = YoutubeContent.get(id=int(yid)) if yid.isdigit() else None
        pieza = (
            {"tipo": "desconocido", "label": t, "thumb": "", "fecha": ""}
            if row is None
            else {
                "tipo": "youtube",
                "label": (row.title or "").strip() or "(video sin título)",
                "thumb": row.thumbnail_url or "",
                "fecha": (_fecha_ar(row.published_at).isoformat() if row.published_at else ""),
            }
        )
    elif t.isdigit():
        row = ReelContent.get(id=int(t))
        pieza = (
            {"tipo": "desconocido", "label": t, "thumb": "", "fecha": ""}
            if row is None
            else {
                "tipo": "reel",
                "label": (row.title or "").strip() or "(reel sin título)",
                "thumb": row.thumbnail_url or "",
                "fecha": (_fecha_ar(row.fecha_publicacion).isoformat() if row.fecha_publicacion else ""),
            }
        )
    else:
        # texto libre cargado a mano: se muestra tal cual
        pieza = {"tipo": "texto", "label": t, "thumb": "", "fecha": ""}

    cache[t] = pieza
    return pieza


def build_ventas_rango(
    user_id: int,
    desde: date,
    hasta: date,
    base_url: str = "",
) -> dict[str, Any]:
    """Llamadas de la semana con su atribución, estado y pago."""
    cache: dict[str, Any] = {}

    with db_session:
        rows = [
            l for l in list(Lead.select())
            if int(l.user_id) == user_id
            and l.call is not None
            and desde <= _fecha_ar(l.call) < hasta
        ]

        leads = []
        for l in rows:
            est = _estado(l)
            leads.append({
                "id": l.id,
                "nombre": (l.nombre or "").strip() or _ig_handle(l.ig) or "(sin nombre)",
                "ig": _ig_handle(l.ig),
                "fecha_call": _fecha_ar(l.call).isoformat(),
                "fecha_agendo": _fecha_ar(l.agendo).isoformat() if l.agendo else "",
                "punto_base": _resolver_pieza(l.via, base_url, cache),
                "punto_final": _resolver_pieza(l.punto_agenda, base_url, cache),
                "vino_de_ads": bool(l.vino_de_ads) if l.vino_de_ads is not None else None,
                "estado": est,
                "pago": round(float(l.pago or 0), 2),
                "debe": round(float(l.debe or 0), 2),
                "closer": (l.closer or "").strip(),
                "setter": (l.setter or "").strip(),
                "programa": (l.programa_ofrecido or "").strip(),
                "razon_compra": (l.razon_compra or "").strip(),
            })

    leads.sort(key=lambda d: (d["fecha_call"], d["nombre"]))

    agendas = len(leads)
    no_shows = sum(1 for d in leads if d["estado"].casefold() in _NO_SHOW)
    canceladas = sum(1 for d in leads if d["estado"].casefold() in _CANCELADA)
    cierres = sum(1 for d in leads if d["estado"].casefold() in _CIERRE)
    shows = max(0, agendas - no_shows - canceladas)

    # Punto final por tasa de cierre: mide qué pieza convierte, sin asignarle cash
    por_final: dict[str, dict[str, Any]] = {}
    for d in leads:
        pf = d["punto_final"]
        label = pf["label"] if pf else "Sin registrar"
        item = por_final.setdefault(label, {"label": label, "tipo": pf["tipo"] if pf else "desconocido", "llamadas": 0, "cierres": 0})
        item["llamadas"] += 1
        if d["estado"].casefold() in _CIERRE:
            item["cierres"] += 1
    ranking_final = sorted(por_final.values(), key=lambda x: (-x["llamadas"], x["label"]))

    return {
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "funnel": {
            "agendas": agendas,
            "shows": shows,
            "no_shows": no_shows,
            "canceladas": canceladas,
            "cierres": cierres,
            "cash": round(sum(d["pago"] for d in leads), 2),
            "por_cobrar": round(sum(d["debe"] for d in leads), 2),
        },
        "leads": leads,
        "punto_final": ranking_final,
    }
