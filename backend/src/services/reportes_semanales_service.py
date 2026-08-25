"""Contenido publicado en un rango de fechas, para el reporte semanal de ATV Clients.

A diferencia del resto de la app (que agrupa por mes YYYY-MM), acá el corte es
un rango libre, porque la semana comercial de ATV va de viernes a viernes y
por lo tanto cruza meses.

Criterio de atribución: el cash y las agendas de una pieza salen de los leads
cuyo `punto_agenda` apunta a esa pieza — el mismo criterio que ya usan los
dashboards de MKT, para que los números no se contradigan entre sistemas.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pony.orm import db_session

from src.db import db
from src.models import Lead, ReelContent, StorySequence, YoutubeContent
from src.services.reels_services import ReelsServices

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def _fecha_ar(dt: datetime | None) -> date | None:
    """Fecha en horario argentino. Naive desde BD se interpreta como UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(AR_TZ).date()


def _en_rango(f: date | None, desde: date, hasta: date) -> bool:
    """Rango semiabierto [desde, hasta): el viernes de cierre pertenece a la semana siguiente."""
    return f is not None and desde <= f < hasta


def _agendas_y_cash(user_id: int, token: str) -> tuple[int, float]:
    """Leads cuyo `punto_agenda` es esta pieza. SQL nativo, igual que reels_services."""
    tbl = Lead._table_ or "lead"
    sql = f"""count(*), coalesce(sum(coalesce(l.pago, 0)), 0) FROM {tbl} l
WHERE l.user_id = $user_id
AND trim(both from coalesce(l.punto_agenda, '')) = $token"""
    with db_session:
        rows = db.select(sql, globals(), {"user_id": user_id, "token": token})
    if not rows:
        return 0, 0.0
    agendas, cash = rows[0]
    return int(agendas or 0), float(cash or 0)


def _url_absoluta(base_url: str, path: str | None) -> str:
    if not path:
        return ""
    if path.startswith(("http://", "https://")):
        return path
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _bloque_reels(user_id: int, desde: date, hasta: date, base_url: str) -> list[dict[str, Any]]:
    with db_session:
        rows = [
            r for r in list(ReelContent.select())
            if int(r.user_id) == user_id and _en_rango(_fecha_ar(r.fecha_publicacion), desde, hasta)
        ]
        datos = [
            {
                "id": r.id,
                "titulo": (r.title or "").strip(),
                "thumbnail_url": r.thumbnail_url or "",
                "permalink": r.permalink or "",
                "fecha": _fecha_ar(r.fecha_publicacion).isoformat(),
                "plays": int(r.plays or 0),
                "reach": int(r.reach or 0),
                "likes": int(r.likes or 0),
                "comentarios": int(r.comentarios or 0),
                "shares": int(r.shares or 0),
                "guardados": int(r.guardados or 0),
                "keyword": r.keyword or "",
                "dolor": r.dolor or "",
                "angulo": r.angulos or "",
                "cta": r.cta or "",
            }
            for r in rows
        ]

    for d in datos:
        agendas, cash = _agendas_y_cash(user_id, str(d["id"]))
        d["agendas"] = agendas
        d["cash"] = round(cash, 2)
        # chats de un reel = leads cuya keyword matchea la del reel (criterio de MKT)
        d["chats"] = ReelsServices._count_leads_matching_reel_keyword(user_id, d["keyword"])
    datos.sort(key=lambda d: d["fecha"], reverse=True)
    return datos


def _bloque_historias(user_id: int, desde: date, hasta: date, base_url: str) -> list[dict[str, Any]]:
    with db_session:
        rows = [
            s for s in list(StorySequence.select())
            if int(s.user_id) == user_id and _en_rango(s.sequence_date, desde, hasta)
        ]
        datos = []
        for s in rows:
            slides = sorted(s.slides, key=lambda sl: sl.order_index)
            # mismo criterio que la vista de historias de MKT (totalReach / avgViews),
            # para que los números del reporte no difieran de los que ya se ven ahí
            alcance = sum(int(sl.reach or 0) for sl in slides)
            vistas_prom = (
                round(sum(int(sl.views or 0) for sl in slides) / len(slides))
                if slides else 0
            )
            replies = sum(int(sl.replies or 0) for sl in slides)
            datos.append({
                "id": s.id,
                "fecha": s.sequence_date.isoformat(),
                "titulo": (s.title or "").strip(),
                "dolor": s.dolor or "",
                "angulo": s.angulo or "",
                "cta": s.cta or "",
                "chats": int(s.chats or 0),
                "cash_manual": round(float(s.cash or 0), 2),
                "slides_count": len(slides),
                "alcance": alcance,
                "vistas_prom": vistas_prom,
                "replies": replies,
                "slides": [
                    {
                        "orden": sl.order_index,
                        "image_url": _url_absoluta(base_url, sl.image_url),
                        "views": int(sl.views or 0),
                        "reach": int(sl.reach or 0),
                        "replies": int(sl.replies or 0),
                        "shares": int(sl.shares or 0),
                        "navigation": int(sl.navigation or 0),
                        "profile_visits": int(sl.profile_visits or 0),
                    }
                    for sl in slides
                ],
            })

    for d in datos:
        agendas, cash = _agendas_y_cash(user_id, f"story:{d['id']}")
        d["agendas"] = agendas
        d["cash"] = round(cash, 2)
    datos.sort(key=lambda d: d["fecha"], reverse=True)
    return datos


def _bloque_youtube(user_id: int, desde: date, hasta: date, base_url: str) -> list[dict[str, Any]]:
    with db_session:
        rows = [
            v for v in list(YoutubeContent.select())
            if int(v.user_id) == user_id and _en_rango(_fecha_ar(v.published_at), desde, hasta)
        ]
        datos = [
            {
                "id": v.id,
                "external_id": v.external_id,
                "titulo": (v.title or "").strip(),
                "thumbnail_url": v.thumbnail_url or "",
                "url": v.url or "",
                "fecha": _fecha_ar(v.published_at).isoformat(),
                "views": int(v.views or 0),
                "likes": int(v.likes or 0),
                "comentarios": int(v.comments_count or 0),
                "duracion_segundos": int(v.duration_seconds or 0),
                "chats": int(v.chats or 0),
                "clasificacion": v.classification or {},
            }
            for v in rows
        ]

    for d in datos:
        agendas, cash = _agendas_y_cash(user_id, f"youtube:{d['id']}")
        d["agendas"] = agendas
        d["cash"] = round(cash, 2)
    datos.sort(key=lambda d: d["fecha"], reverse=True)
    return datos


def build_contenido_rango(
    user_id: int,
    desde: date,
    hasta: date,
    base_url: str = "",
) -> dict[str, Any]:
    """Todo el contenido publicado en [desde, hasta), con su cash y agendas."""
    reels = _bloque_reels(user_id, desde, hasta, base_url)
    historias = _bloque_historias(user_id, desde, hasta, base_url)
    youtube = _bloque_youtube(user_id, desde, hasta, base_url)
    piezas = reels + historias + youtube

    # En historias el chat es el `reply` del slide; el campo `chats` de la
    # secuencia es una carga manual aparte. Se cuenta replies para que el total
    # coincida con lo que muestra cada card.
    chats_total = (
        sum(int(p.get("chats") or 0) for p in reels + youtube)
        + sum(int(p.get("replies") or 0) for p in historias)
    )

    return {
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "reels": reels,
        "historias": historias,
        "youtube": youtube,
        "totales": {
            "piezas": len(piezas),
            "chats": chats_total,
            "agendas": sum(int(p.get("agendas") or 0) for p in piezas),
            "cash": round(sum(float(p.get("cash") or 0) for p in piezas), 2),
        },
    }
