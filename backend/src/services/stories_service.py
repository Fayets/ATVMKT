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
from pony.orm import db_session, flush

from src.models import ApiConnection, StorySequence, StorySlide, User, db
from src.schemas import StorySequenceIn

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
_last_sync_times: dict[str, datetime] = {}
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


def _serialize_slide(slide: StorySlide) -> dict[str, Any]:
    return {
        "id": slide.id,
        "order_index": slide.order_index,
        "image_url": slide.image_url,
        "dolor": slide.dolor,
        "angulo": slide.angulo,
        "cta_text": slide.cta_text,
        "instagram_media_id": slide.instagram_media_id,
        "reach": slide.reach,
        "like_count": slide.like_count,
        "replies": slide.replies,
        "navigation": slide.navigation,
        "profile_visits": slide.profile_visits,
        "synced_at": _iso_dt(slide.synced_at),
    }


def _serialize_sequence(sequence: StorySequence) -> dict[str, Any]:
    slides = sorted(list(sequence.slides), key=lambda s: (s.order_index, s.id))
    return {
        "id": sequence.id,
        "sequence_date": sequence.sequence_date.isoformat(),
        "title": sequence.title,
        "dolor": sequence.dolor,
        "angulo": sequence.angulo,
        "cta_text": sequence.cta_text,
        "cash_generado": int(sequence.cash_generado or 0),
        "has_cta": bool(sequence.has_cta),
        "chats": int(sequence.chats or 0),
        "slides": [_serialize_slide(s) for s in slides],
        "created_at": sequence.created_at.isoformat(),
    }


def _has_cta(sequence: StorySequence) -> bool:
    normalized = str(sequence.cta_text or "").strip().lower()
    if not normalized:
        return bool(sequence.has_cta)
    return normalized not in {"no", "sin cta", "ninguno", "none", "false", "0", "n/a"}


def _http_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    req = urllib.request.Request(url, headers=headers, method="GET")
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(req, timeout=45, context=ssl_ctx) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload) if payload else {}


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
                if s.user.id == user_id
                and s.sequence_date.year == year
                and s.sequence_date.month == month_num
            ]
            for row in rows:
                slides = sorted(list(row.slides), key=lambda s: (s.order_index, s.id))
                for slide in slides:
                    print(f"[stories] slide {slide.id}: reach={slide.reach}, replies={slide.replies}")
            rows.sort(key=lambda s: (s.sequence_date, s.id), reverse=True)
            return [_serialize_sequence(row) for row in rows]
        except Exception as e:
            print("[stories] ERROR:", str(e))
            import traceback
            traceback.print_exc()
            raise

    @db_session
    def create_sequence(self, user_id: str, data: StorySequenceIn) -> dict[str, Any]:
        user = User.get(id=user_id)
        if user is None:
            user = User(id=user_id)

        sequence = StorySequence(
            user=user,
            sequence_date=data.sequence_date,
            title=(data.title or "").strip(),
            dolor=(data.dolor or "").strip(),
            angulo=(data.angulo or "").strip(),
            cta_text=(data.cta_text or "").strip(),
            cash_generado=max(0, int(data.cash_generado or 0)),
            has_cta=bool(data.has_cta),
            chats=max(0, int(data.chats or 0)),
        )
        for slide in data.slides:
            StorySlide(
                sequence=sequence,
                order_index=int(slide.order_index),
                image_url=slide.image_url,
                dolor=(slide.dolor or "").strip(),
                angulo=(slide.angulo or "").strip(),
                cta_text=(slide.cta_text or "").strip(),
            )
        flush()
        return _serialize_sequence(sequence)

    @db_session
    def update_sequence(self, sequence_id: int, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        sequence = StorySequence.get(id=sequence_id)
        if sequence is None or sequence.user.id != user_id:
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
            sequence.cta_text = str(data.get("cta_text") or "").strip()
        if "cash_generado" in data and data["cash_generado"] is not None:
            sequence.cash_generado = max(0, int(data["cash_generado"]))
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
                    dolor=str(raw.get("dolor") or "").strip(),
                    angulo=str(raw.get("angulo") or "").strip(),
                    cta_text=str(raw.get("cta_text") or "").strip(),
                )

        flush()
        return _serialize_sequence(sequence)

    @db_session
    def delete_sequence(self, sequence_id: int, user_id: str) -> bool:
        sequence = StorySequence.get(id=sequence_id)
        if sequence is None or sequence.user.id != user_id:
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
    def get_metrics(self, user_id: str, month: str) -> dict[str, int]:
        print("[stories] get_metrics llamado con user_id:", user_id, "month:", month)
        try:
            year, month_num = map(int, month.split("-"))
            rows = [
                s
                for s in list(StorySequence.select())
                if s.user.id == user_id
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
            (c for c in list(ApiConnection.select()) if c.user_id == user_id and c.platform == "instagram"),
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
                if slide.instagram_media_id == story_id and slide.sequence.user.id == user_id
            ),
            None,
        )
        if by_media_id is not None:
            return by_media_id

        same_day = [
            slide
            for slide in list(StorySlide.select())
            if slide.sequence.user.id == user_id and slide.sequence.sequence_date == story_day
        ]
        same_day.sort(key=lambda s: (s.order_index, s.id))
        return same_day[0] if same_day else None

    @db_session
    def _get_or_create_sequence_id(self, user_id: str, story_day: date) -> tuple[int, bool]:
        result = db.execute(
            """
            SELECT id FROM storysequence
            WHERE "user" = $user_id
            AND sequence_date = $story_day
            LIMIT 1
            """
        )
        row = result.fetchone()
        if row:
            return row[0], False
        result2 = db.execute(
            """
            INSERT INTO storysequence
            ("user", sequence_date, has_cta, chats, cash_generado, created_at)
            VALUES ($user_id, $story_day, false, 0, 0, NOW())
            RETURNING id
            """
        )
        return result2.fetchone()[0], True

    @db_session
    def _get_slide_ids_to_update(self, user_id: str, story_id: str) -> list[int]:
        result = db.execute(
            """
            SELECT ss.id FROM storyslide ss
            JOIN storysequence seq ON ss.sequence = seq.id
            WHERE ss.instagram_media_id = $story_id
            AND seq."user" = $user_id
            """
        )
        return [row[0] for row in result.fetchall()]

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
            image_url=image_url,
            instagram_media_id=story_id,
            reach=metrics.get("reach", 0),
            like_count=None,
            replies=metrics.get("replies", 0),
            navigation=metrics.get("navigation", 0),
            profile_visits=metrics.get("profile_visits", 0),
            synced_at=datetime.now(AR_TZ),
        )

    @db_session
    def _update_slide(self, slide_id: int, image_url: str | None, metrics: dict[str, int | None]) -> None:
        slide = StorySlide[slide_id]
        if not slide.image_url and image_url:
            slide.image_url = image_url
        slide.reach = metrics.get("reach", 0)
        slide.like_count = None
        slide.replies = metrics.get("replies", 0)
        slide.navigation = metrics.get("navigation", 0)
        slide.profile_visits = metrics.get("profile_visits", 0)
        slide.synced_at = datetime.now(AR_TZ)

    def get_sync_status(self, user_id: str) -> dict[str, str | None]:
        last = _last_sync_times.get(user_id)
        if last is None:
            return {"last_sync": None, "next_sync": None}
        next_sync = last + timedelta(minutes=30)
        return {
            "last_sync": last.isoformat(),
            "next_sync": next_sync.isoformat(),
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

                            metrics: dict[str, int | None] = {
                                "reach": None,
                                "replies": None,
                                "navigation": None,
                                "profile_visits": None,
                            }
                            insights_url = (
                                f"https://graph.facebook.com/v25.0/{urllib.parse.quote(story_id)}/insights"
                                "?metric=reach,replies,navigation,profile_visits"
                            )
                            try:
                                insights_payload = _http_json(insights_url, headers=headers)
                                insights_data = insights_payload.get("data")
                                print(f"[sync] insights para story {story_id}:", insights_data)
                                metrics_rows = insights_data if isinstance(insights_data, list) else []
                                insights: dict[str, int] = {}
                                for item in metrics_rows:
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
                                        insights[name] = int(value) if value is not None else 0
                                    except Exception:
                                        insights[name] = 0
                                metrics["reach"] = insights.get("reach", 0)
                                metrics["replies"] = insights.get("replies", 0)
                                metrics["navigation"] = insights.get("navigation", 0)
                                metrics["profile_visits"] = insights.get("profile_visits", 0)
                            except Exception:
                                pass

                            slide_ids = self._get_slide_ids_to_update(user_id, story_id)
                            if not slide_ids:
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

                _last_sync_times[user_id] = datetime.now(AR_TZ)
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
