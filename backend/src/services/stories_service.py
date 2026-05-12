import asyncio
import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import certifi
import httpx
from fastapi import HTTPException
from pony.orm import ObjectNotFound, db_session, flush

from src.db import db
from src.models import ApiConnection, Lead, StorySequence, StorySlide
from src.schemas import StorySequenceIn
from src.story_sync_scheduler_ref import next_auto_sync_stories_run_time

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
# Debe coincidir con el job `auto_sync_stories` en main.py (IntervalTrigger).
STORIES_SYNC_INTERVAL_MINUTES = 5
_sync_lock = asyncio.Lock()


def _month_range(month: str) -> tuple[date, date]:
    try:
        year, mon = month.split("-")
        y = int(year)
        m = int(mon)
        if m < 1 or m > 12:
            raise ValueError
        start = date(y, m, 1)
        if m == 12:
            end = date(y + 1, 1, 1)
        else:
            end = date(y, m + 1, 1)
        return start, end
    except Exception as e:
        raise HTTPException(status_code=400, detail="El parámetro month debe tener formato YYYY-MM.") from e


def _iso_dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


def _serialize_slide(slide: StorySlide) -> dict[str, Any]:
    return {
        "id": slide.id,
        "order_index": slide.order_index,
        "image_url": slide.image_url,
        "dolor": None,
        "angulo": None,
        "cta_text": None,
        "instagram_media_id": slide.instagram_media_id,
        "views": slide.views,
        "reach": slide.reach,
        "shares": slide.shares,
        "like_count": None,
        "replies": slide.replies,
        "navigation": slide.navigation,
        "profile_visits": slide.profile_visits,
        "synced_at": _iso_dt(slide.synced_at),
    }


def _count_agendas_for_sequence(user_id: int, sequence_db_id: int) -> int:
    """Leads con punto_agenda = story:<id de secuencia> (mismo criterio que reels)."""
    tid = f"story:{sequence_db_id}"
    tbl = Lead._table_ or "lead"
    sql = f"""COUNT(*) FROM {tbl} l
WHERE l.user_id = $user_id
AND trim(both from coalesce(l.punto_agenda, '')) = $tid"""
    with db_session:
        rows = db.select(sql, globals(), {"user_id": user_id, "tid": tid})
    return int(rows[0]) if rows else 0


def _sum_pago_agenda_for_sequence(user_id: int, sequence_db_id: int) -> float:
    tid = f"story:{sequence_db_id}"
    tbl = Lead._table_ or "lead"
    sql = f"""coalesce(sum(coalesce(l.pago, 0)), 0) FROM {tbl} l
WHERE l.user_id = $user_id
AND trim(both from coalesce(l.punto_agenda, '')) = $tid"""
    with db_session:
        rows = db.select(sql, globals(), {"user_id": user_id, "tid": tid})
    if not rows:
        return 0.0
    v = rows[0]
    return float(v) if v is not None else 0.0


def _dedupe_slides_for_response(slides: list[StorySlide]) -> list[StorySlide]:
    """Evita mostrar la misma historia IG dos veces (sync duplicado o manual+sync). Mantiene orden."""
    ordered = sorted(slides, key=lambda s: (s.order_index, s.id))
    seen_mid: set[str] = set()
    out: list[StorySlide] = []
    for s in ordered:
        mid = str(s.instagram_media_id or "").strip()
        if mid:
            if mid in seen_mid:
                continue
            seen_mid.add(mid)
        out.append(s)
    return out


def _serialize_sequence(sequence: StorySequence, user_id: str) -> dict[str, Any]:
    slides_raw = sorted(list(sequence.slides), key=lambda s: (s.order_index, s.id))
    slides = _dedupe_slides_for_response(slides_raw)
    uid = int(user_id)
    sid = int(sequence.id)
    agendas_n = _count_agendas_for_sequence(uid, sid)
    cash_leads_f = _sum_pago_agenda_for_sequence(uid, sid)
    cash_manual_f = float(sequence.cash or 0)
    cash_total_f = cash_manual_f + cash_leads_f
    cash_manual_i = int(round(cash_manual_f))
    cash_leads_i = int(round(cash_leads_f))
    cash_generado_i = int(round(cash_total_f))
    return {
        "id": sequence.id,
        "sequence_date": sequence.sequence_date.isoformat(),
        "title": sequence.title,
        "dolor": sequence.dolor,
        "angulo": sequence.angulo,
        "cta_text": sequence.cta,
        "cash_generado": cash_generado_i,
        "cash_manual": cash_manual_i,
        "cash_leads": cash_leads_i,
        "agendas": agendas_n,
        "has_cta": bool(sequence.has_cta),
        "chats": int(sequence.chats or 0),
        "slides": [_serialize_slide(s) for s in slides],
        "created_at": sequence.created_at.isoformat(),
    }


def _has_cta(sequence: StorySequence) -> bool:
    normalized = str(sequence.cta or "").strip().lower()
    if not normalized:
        return bool(sequence.has_cta)
    return normalized not in {"no", "sin cta", "ninguno", "none", "false", "0", "n/a"}


def _http_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    req = urllib.request.Request(url, headers=headers, method="GET")
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(req, timeout=45, context=ssl_ctx) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload) if payload else {}


def _parse_insights_data(payload: dict[str, Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    rows = payload.get("data")
    if not isinstance(rows, list):
        return out
    for item in rows:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        values = item.get("values")
        value = None
        if isinstance(values, list) and values:
            first = values[0]
            if isinstance(first, dict):
                value = first.get("value")
        try:
            out[name] = int(value) if value is not None else 0
        except (TypeError, ValueError):
            out[name] = 0
    return out


def _fetch_story_insights(story_id: str, headers: dict[str, str]) -> dict[str, int | None]:
    """Métricas de story por Graph API. Puede fallar un subconjunto de métricas según versión de media.

    `views` ≈ reproducciones; `reach` = cuentas únicas; `shares` = compartidos (p. ej. vía DM).
    Los totales suelen ser estimados y no coinciden 1:1 con la app (latencia, agregación, ventana 24h).
    """
    base = f"https://graph.facebook.com/v25.0/{urllib.parse.quote(story_id)}/insights"
    # Intentar el set completo (v22+); si el media no soporta alguna métrica, reintentar mínimo.
    for metric in (
        "views,reach,replies,shares,navigation,profile_visits",
        "reach,replies,navigation,profile_visits",
    ):
        url = f"{base}?metric={metric}"
        try:
            payload = _http_json(url, headers=headers)
            row = _parse_insights_data(payload)
            return {
                "views": row.get("views"),
                "reach": row.get("reach"),
                "replies": row.get("replies"),
                "shares": row.get("shares"),
                "navigation": row.get("navigation"),
                "profile_visits": row.get("profile_visits"),
            }
        except urllib.error.HTTPError:
            continue
        except Exception:
            continue
    return {
        "views": None,
        "reach": None,
        "replies": None,
        "shares": None,
        "navigation": None,
        "profile_visits": None,
    }


async def download_story_image(url: str, user_id: str, story_id: str) -> str | None:
    try:
        folder = f"media/stories/{user_id}"
        os.makedirs(folder, exist_ok=True)
        filepath = f"{folder}/{story_id}.jpg"
        async with httpx.AsyncClient() as client:
            response = await client.get(url, follow_redirects=True, timeout=10)
            if response.status_code == 200:
                with open(filepath, "wb") as f:
                    f.write(response.content)
                return f"/media/stories/{user_id}/{story_id}.jpg"
    except Exception as e:
        print(f"[stories] Error descargando imagen {story_id}: {e}")
    return None


class StoriesService:
    @db_session
    def get_sequences(self, user_id: str, month: str) -> list[dict[str, Any]]:
        print("[stories] get_sequences llamado con user_id:", user_id, "month:", month)
        try:
            year, month_num = map(int, month.split("-"))
            rows = [
                s
                for s in list(StorySequence.select())
                if s.user_id == int(user_id)
                and s.sequence_date.year == year
                and s.sequence_date.month == month_num
            ]
            for row in rows:
                slides = sorted(list(row.slides), key=lambda s: (s.order_index, s.id))
                for slide in slides:
                    print(f"[stories] slide {slide.id}: reach={slide.reach}, replies={slide.replies}")
            rows.sort(key=lambda s: (s.sequence_date, s.id), reverse=True)
            return [_serialize_sequence(row, user_id) for row in rows]
        except Exception as e:
            print("[stories] ERROR:", str(e))
            import traceback
            traceback.print_exc()
            raise

    @db_session
    def get_all_sequences(self, user_id: str) -> list[dict[str, Any]]:
        rows = [s for s in list(StorySequence.select()) if s.user_id == int(user_id)]
        rows.sort(key=lambda s: (s.sequence_date, s.id), reverse=True)
        return [_serialize_sequence(row, user_id) for row in rows]

    @db_session
    def create_sequence(self, user_id: str, data: StorySequenceIn) -> dict[str, Any]:
        uid = int(user_id)
        sequence = StorySequence(
            user_id=uid,
            sequence_date=data.sequence_date,
            title=(data.title or "").strip(),
            dolor=(data.dolor or "").strip(),
            angulo=(data.angulo or "").strip(),
            cta=(data.cta_text or "").strip(),
            cash=float(max(0, int(data.cash_generado or 0))),
            has_cta=bool(data.has_cta),
            chats=max(0, int(data.chats or 0)),
        )
        for slide in data.slides:
            StorySlide(
                sequence=sequence,
                order_index=int(slide.order_index),
                image_url=slide.image_url,
            )
        flush()
        return _serialize_sequence(sequence, user_id)

    @db_session
    def update_sequence(self, sequence_id: int, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        sequence = StorySequence.get(id=sequence_id)
        if sequence is None or sequence.user_id != int(user_id):
            raise HTTPException(status_code=404, detail="Secuencia no encontrada.")

        if "sequence_date" in data and data["sequence_date"] is not None:
            sequence.sequence_date = data["sequence_date"]
        if "title" in data:
            sequence.title = str(data.get("title") or "").strip()
        if "dolor" in data:
            sequence.dolor = str(data.get("dolor") or "").strip()
        if "angulo" in data:
            sequence.angulo = str(data.get("angulo") or "").strip()
        if "cta_text" in data:
            sequence.cta = str(data.get("cta_text") or "").strip()
        if "cash_generado" in data and data["cash_generado"] is not None:
            sequence.cash = float(max(0, int(data["cash_generado"])))
        if "has_cta" in data and data["has_cta"] is not None:
            sequence.has_cta = bool(data["has_cta"])
        if "chats" in data and data["chats"] is not None:
            sequence.chats = max(0, int(data["chats"]))

        if "slides" in data and data["slides"] is not None:
            for existing in list(sequence.slides):
                existing.delete()
            for raw in data["slides"]:
                StorySlide(
                    sequence=sequence,
                    order_index=int(raw.get("order_index", 0)),
                    image_url=raw.get("image_url"),
                )

        sequence.updated_at = datetime.utcnow()
        flush()
        return _serialize_sequence(sequence, user_id)

    @db_session
    def delete_sequence(self, sequence_id: int, user_id: str) -> bool:
        sequence = StorySequence.get(id=sequence_id)
        if sequence is None or sequence.user_id != int(user_id):
            raise HTTPException(status_code=404, detail="Secuencia no encontrada.")
        slides = list(sequence.slides)
        for slide in slides:
            if slide.image_url:
                BASE_DIR = os.path.dirname(os.path.abspath(__file__))
                filepath = os.path.join(BASE_DIR, "..", "..", slide.image_url.lstrip("/"))
                filepath = os.path.normpath(filepath)
                if os.path.exists(filepath):
                    try:
                        os.remove(filepath)
                        print(f"[stories] Imagen eliminada: {filepath}")
                    except Exception as e:
                        print(f"[stories] Error eliminando imagen: {e}")
            try:
                slide.delete()
            except Exception as e:
                import traceback

                print(f"[stories] Constraint/Error eliminando slide {slide.id}: {e}")
                print(traceback.format_exc())
                raise
        try:
            sequence.delete()
        except Exception as e:
            import traceback

            print(f"[stories] Constraint/Error eliminando secuencia {sequence_id}: {e}")
            print(traceback.format_exc())
            raise
        return True

    @db_session
    def delete_slide(self, slide_id: int, user_id: str) -> bool:
        """Elimina un slide (historia) de una secuencia; borra archivo local si existe."""
        try:
            slide = StorySlide[slide_id]
        except ObjectNotFound:
            raise HTTPException(status_code=404, detail="Historia no encontrada.")
        if int(slide.sequence.user_id) != int(user_id):
            raise HTTPException(status_code=404, detail="Historia no encontrada.")
        if slide.image_url:
            BASE_DIR = os.path.dirname(os.path.abspath(__file__))
            filepath = os.path.join(BASE_DIR, "..", "..", slide.image_url.lstrip("/"))
            filepath = os.path.normpath(filepath)
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception as e:
                    print(f"[stories] Error eliminando imagen de slide {slide_id}: {e}")
        slide.delete()
        return True

    @db_session
    def get_metrics(self, user_id: str, month: str) -> dict[str, int]:
        print("[stories] get_metrics llamado con user_id:", user_id, "month:", month)
        try:
            year, month_num = map(int, month.split("-"))
            rows = [
                s
                for s in list(StorySequence.select())
                if s.user_id == int(user_id)
                and s.sequence_date.year == year
                and s.sequence_date.month == month_num
            ]
            chats_del_mes = sum(int(seq.chats or 0) for seq in rows)
            secuencias_con_cta = sum(1 for seq in rows if _has_cta(seq))
            secuencias_sin_cta = sum(1 for seq in rows if not _has_cta(seq))
            stories_sincronizadas = sum(
                1
                for seq in rows
                for slide in seq.slides
                if slide.instagram_media_id is not None and str(slide.instagram_media_id).strip() != ""
            )
            return {
                "chats_del_mes": chats_del_mes,
                "secuencias_con_cta": secuencias_con_cta,
                "secuencias_sin_cta": secuencias_sin_cta,
                "stories_sincronizadas": stories_sincronizadas,
            }
        except Exception as e:
            print("[stories] ERROR:", str(e))
            import traceback
            traceback.print_exc()
            raise

    @db_session
    def _resolve_instagram_conn(self, user_id: str) -> tuple[str, str]:
        conn = next(
            (c for c in list(ApiConnection.select()) if c.user_id == int(user_id) and c.platform == "instagram"),
            None,
        )
        creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}
        access_token = str(creds.get("access_token") or "").strip()
        ig_user_id = str(creds.get("instagram_user_id") or "").strip()
        if not access_token or not ig_user_id:
            raise HTTPException(
                status_code=400,
                detail="Configurá la conexión de Instagram con access_token e instagram_user_id.",
            )
        return access_token, ig_user_id

    @db_session
    def _find_slide_for_story(self, user_id: str, story_id: str, story_day: date) -> StorySlide | None:
        by_media_id = next(
            (
                slide
                for slide in list(StorySlide.select())
                if slide.instagram_media_id == story_id and slide.sequence.user_id == int(user_id)
            ),
            None,
        )
        if by_media_id is not None:
            return by_media_id

        same_day = [
            slide
            for slide in list(StorySlide.select())
            if slide.sequence.user_id == int(user_id) and slide.sequence.sequence_date == story_day
        ]
        same_day.sort(key=lambda s: (s.order_index, s.id))
        return same_day[0] if same_day else None

    @db_session
    def _get_or_create_sequence_id(self, user_id: str, story_day: date) -> tuple[int, bool]:
        uid = int(user_id)
        for s in list(StorySequence.select()):
            if s.user_id == uid and s.sequence_date == story_day:
                return s.id, False
        seq = StorySequence(
            user_id=uid,
            sequence_date=story_day,
            has_cta=False,
            chats=0,
            cash=0.0,
        )
        flush()
        return seq.id, True

    @db_session
    def _get_slide_ids_to_update(self, user_id: str, story_id: str) -> list[int]:
        uid = int(user_id)
        return [
            s.id
            for s in list(StorySlide.select())
            if (s.instagram_media_id or "") == story_id and s.sequence.user_id == uid
        ]

    @db_session
    def _collapse_duplicate_slide_ids(self, slide_ids: list[int]) -> list[int]:
        """Si el mismo `instagram_media_id` quedó duplicado en BD, deja un solo slide."""
        if len(slide_ids) <= 1:
            return slide_ids
        primary = min(slide_ids)
        for sid in slide_ids:
            if sid != primary:
                StorySlide[sid].delete()
        return [primary]

    @db_session
    def _first_placeholder_slide_id(self, sequence_id: int) -> int | None:
        """Primer slide de la secuencia sin `instagram_media_id` (p. ej. carga manual antes del sync)."""
        seq = StorySequence.get(id=sequence_id)
        if seq is None:
            return None
        blanks = [s for s in list(seq.slides) if not str(s.instagram_media_id or "").strip()]
        if not blanks:
            return None
        blanks.sort(key=lambda s: (s.order_index, s.id))
        return blanks[0].id

    @db_session
    def _hydrate_slide_from_instagram(
        self,
        slide_id: int,
        story_id: str,
        image_url: str | None,
        metrics: dict[str, int | None],
        order_index: int,
    ) -> None:
        slide = StorySlide[slide_id]
        slide.instagram_media_id = story_id
        slide.order_index = order_index
        if image_url:
            slide.image_url = image_url
        slide.views = metrics.get("views") if metrics.get("views") is not None else slide.views
        slide.reach = metrics.get("reach") if metrics.get("reach") is not None else slide.reach
        slide.shares = metrics.get("shares") if metrics.get("shares") is not None else slide.shares
        slide.replies = metrics.get("replies") if metrics.get("replies") is not None else slide.replies
        slide.navigation = metrics.get("navigation") if metrics.get("navigation") is not None else slide.navigation
        slide.profile_visits = (
            metrics.get("profile_visits") if metrics.get("profile_visits") is not None else slide.profile_visits
        )
        slide.synced_at = datetime.now(AR_TZ)

    @db_session
    def _create_slide(
        self,
        sequence_id: int,
        order_index: int,
        image_url: str | None,
        story_id: str,
        metrics: dict[str, int | None],
    ) -> None:
        sequence = StorySequence[sequence_id]
        StorySlide(
            sequence=sequence,
            order_index=order_index,
            instagram_media_id=story_id,
            image_url=image_url,
            views=metrics.get("views") if metrics.get("views") is not None else None,
            reach=metrics.get("reach") if metrics.get("reach") is not None else None,
            shares=metrics.get("shares") if metrics.get("shares") is not None else None,
            replies=metrics.get("replies") if metrics.get("replies") is not None else None,
            navigation=metrics.get("navigation") if metrics.get("navigation") is not None else None,
            profile_visits=metrics.get("profile_visits") if metrics.get("profile_visits") is not None else None,
            synced_at=datetime.now(AR_TZ),
        )

    @db_session
    def _update_slide(self, slide_id: int, image_url: str | None, metrics: dict[str, int | None]) -> None:
        slide = StorySlide[slide_id]
        if not slide.image_url and image_url:
            slide.image_url = image_url
        slide.views = metrics.get("views") if metrics.get("views") is not None else slide.views
        slide.reach = metrics.get("reach") if metrics.get("reach") is not None else slide.reach
        slide.shares = metrics.get("shares") if metrics.get("shares") is not None else slide.shares
        slide.replies = metrics.get("replies") if metrics.get("replies") is not None else slide.replies
        slide.navigation = metrics.get("navigation") if metrics.get("navigation") is not None else slide.navigation
        slide.profile_visits = (
            metrics.get("profile_visits") if metrics.get("profile_visits") is not None else slide.profile_visits
        )
        slide.synced_at = datetime.now(AR_TZ)

    @db_session
    def _touch_last_sync(self, user_id: str) -> None:
        conn = ApiConnection.get(user_id=int(user_id), platform="instagram")
        if conn is not None:
            conn.last_sync_at = datetime.now(AR_TZ)

    @db_session
    def get_sync_status(self, user_id: str) -> dict[str, str | None]:
        conn = ApiConnection.get(user_id=int(user_id), platform="instagram")
        last = conn.last_sync_at if conn else None
        # Contador: usar la próxima corrida real del job (evita mostrar 5 min si el proceso
        # sigue con job de 30 min, o desvíos last+intervalo vs APScheduler).
        sched_next = next_auto_sync_stories_run_time()
        if sched_next is not None:
            next_sync = sched_next
        else:
            next_sync = last + timedelta(minutes=STORIES_SYNC_INTERVAL_MINUTES) if last else None

        token_saved_at: datetime | None = None
        token_expires_at: datetime | None = None
        creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}
        token_saved_at = _parse_dt(creds.get("token_saved_at")) or (conn.updated_at if conn else None)
        token_expires_at = _parse_dt(creds.get("token_expires_at"))
        if token_expires_at is None:
            if token_saved_at is not None:
                token_expires_at = token_saved_at + timedelta(days=60)
            else:
                # Fallback solicitado: 59 días por defecto cuando no hay fecha guardada.
                token_expires_at = datetime.now(AR_TZ) + timedelta(days=59)

        return {
            "last_sync": _iso_dt(last),
            "next_sync": _iso_dt(next_sync),
            "token_saved_at": _iso_dt(token_saved_at),
            "token_expires_at": _iso_dt(token_expires_at),
        }

    async def sync_instagram(self, user_id: str) -> dict[str, int]:
        async with _sync_lock:
            try:
                access_token, ig_user_id = self._resolve_instagram_conn(user_id)
                stories_url = (
                    f"https://graph.facebook.com/v25.0/{urllib.parse.quote(ig_user_id)}/stories"
                    "?fields=id,timestamp,media_type,media_url,thumbnail_url"
                )
                headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
                stories_payload = _http_json(stories_url, headers=headers)
                stories = stories_payload.get("data")
                story_rows = stories if isinstance(stories, list) else []
                tz = AR_TZ
                grouped: dict[date, list[dict[str, Any]]] = {}

                for raw in story_rows:
                    if not isinstance(raw, dict):
                        continue
                    timestamp = str(raw.get("timestamp") or "").strip()
                    if not timestamp:
                        continue
                    try:
                        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(tz)
                    except Exception:
                        continue
                    d = dt.date()
                    if d not in grouped:
                        grouped[d] = []
                    grouped[d].append(raw)

                synced = 0
                created = 0
                sequences_created = 0
                not_matched = 0
                errors = 0

                for story_day, day_stories in grouped.items():
                    day_stories.sort(key=lambda s: str(s.get("timestamp") or ""))
                    sequence_id, sequence_created = self._get_or_create_sequence_id(user_id, story_day)
                    if sequence_created:
                        sequences_created += 1

                    for idx, raw in enumerate(day_stories):
                        instagram_media_id = "unknown"
                        try:
                            story_id = str(raw.get("id") or "").strip()
                            instagram_media_id = story_id or "unknown"
                            if not story_id:
                                not_matched += 1
                                continue

                            media_type = str(raw.get("media_type") or "").upper()
                            media_url = str(raw.get("media_url") or "").strip()
                            thumb_url = str(raw.get("thumbnail_url") or "").strip()
                            source_url = thumb_url if media_type == "VIDEO" and thumb_url else media_url or thumb_url
                            image_url = await download_story_image(source_url, user_id, story_id) if source_url else None

                            metrics = _fetch_story_insights(story_id, headers)
                            print(f"[sync] insights para story {story_id}:", metrics)

                            slide_ids = self._get_slide_ids_to_update(user_id, story_id)
                            slide_ids = self._collapse_duplicate_slide_ids(slide_ids)
                            if not slide_ids:
                                ph_id = self._first_placeholder_slide_id(sequence_id)
                                if ph_id is not None:
                                    self._hydrate_slide_from_instagram(
                                        ph_id, story_id, image_url, metrics, idx + 1
                                    )
                                else:
                                    self._create_slide(
                                        sequence_id=sequence_id,
                                        order_index=idx + 1,
                                        image_url=image_url,
                                        story_id=story_id,
                                        metrics=metrics,
                                    )
                                    created += 1
                            else:
                                for slide_id in slide_ids:
                                    self._update_slide(slide_id=slide_id, image_url=image_url, metrics=metrics)
                            synced += 1
                        except Exception as e:
                            import traceback
                            print(f"[sync] ERROR en slide {instagram_media_id}: {e}")
                            print(traceback.format_exc())
                            errors += 1
                            continue

                self._touch_last_sync(user_id)
                return {
                    "synced": synced,
                    "created": created,
                    "sequences_created": sequences_created,
                    "not_matched": not_matched,
                    "errors": errors,
                }
            except HTTPException:
                raise
            except urllib.error.HTTPError as e:
                raise HTTPException(
                    status_code=502,
                    detail=f"Instagram API devolvió HTTP {e.code}. Verificá credenciales y permisos.",
                ) from e
            except Exception as e:
                import traceback
                print(f"[sync] ERROR GENERAL: {e}")
                print(traceback.format_exc())
                raise
