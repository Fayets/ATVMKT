import asyncio
import json
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import certifi
from fastapi import HTTPException
from pony.orm import ObjectNotFound, db_session, rollback

from src.models import ApiConnection, ReelContent, db
from src.schemas import ReelKeywordPatchRequest, ReelPatchRequest, ReelResponse, ReelsListResponse

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
_sync_lock = threading.Lock()
_sync_states: dict[str, dict[str, int | str]] = {}
_sync_tasks: dict[str, asyncio.Task] = {}
SYNC_REELS_SINCE = datetime(2024, 12, 1, tzinfo=AR_TZ)


class ReelsServices:
    def _is_user_sync_running(self, user_id: str) -> bool:
        task = _sync_tasks.get(user_id)
        return task is not None and not task.done()

    def trigger_sync(self, user_id: str) -> None:
        if self._is_user_sync_running(user_id):
            raise HTTPException(status_code=409, detail="Ya hay una sincronizacion de reels en curso.")

        async def _runner() -> None:
            await self.sync_instagram(user_id)

        task = asyncio.create_task(_runner())
        task.add_done_callback(lambda _: _sync_tasks.pop(user_id, None))
        _sync_tasks[user_id] = task

    def _set_sync_state(
        self,
        user_id: str,
        *,
        total: int,
        processed: int,
        status: str,
        phase: str = "idle",
        discovered: int = 0,
    ) -> None:
        _sync_states[user_id] = {
            "total": max(0, int(total)),
            "processed": max(0, int(processed)),
            "status": status,
            "phase": phase,
            "discovered": max(0, int(discovered)),
        }

    def _to_response(self, row: ReelContent) -> ReelResponse:
        return ReelResponse(
            id=row.id,
            title=row.title,
            content_type=row.content_type,
            platform=row.platform,
            metrics=row.metrics if isinstance(row.metrics, dict) else {},
            classification=row.classification if isinstance(row.classification, dict) else {},
            cash=row.cash,
            chats=row.chats,
            published_at=row.published_at,
            url=row.url,
            notes=row.notes,
            external_id=row.external_id,
            keyword=row.keyword,
            chats_count=row.chats_count,
        )

    @db_session
    def _upsert_reel_content(
        self,
        *,
        user_id: str,
        external_id: str,
        title: str,
        metrics_json: str,
        published_at: datetime,
        permalink: str | None,
        caption: str,
    ) -> bool:
        now = datetime.now(AR_TZ)
        result = db.execute(
            """
            SELECT id FROM reelcontent
            WHERE user_id = $user_id AND external_id = $external_id
            """
        )
        existing = result.fetchone()
        if existing:
            reel_id = existing[0]
            db.execute(
                """
                UPDATE reelcontent
                SET title = $title,
                    metrics = CAST($metrics_json AS jsonb),
                    published_at = $published_at,
                    url = $permalink,
                    notes = $caption,
                    updated_at = $now
                WHERE id = $reel_id
                """
            )
            return False

        reel_id = str(uuid.uuid4())
        db.execute(
            """
            INSERT INTO reelcontent
            (id, user_id, external_id, title, content_type, platform, metrics, classification, cash, chats, chats_count, keyword, published_at, url, notes, updated_at)
            VALUES (
                $reel_id,
                $user_id,
                $external_id,
                $title,
                'reel',
                'instagram',
                CAST($metrics_json AS jsonb),
                '{}'::jsonb,
                0,
                0,
                0,
                NULL,
                $published_at,
                $permalink,
                $caption,
                $now
            )
            """
        )
        return True

    def list_reels(self, user_id: str, month: str | None, page: int, page_size: int) -> ReelsListResponse:
        with db_session:
            rows = [r for r in list(ReelContent.select()) if r.user_id == user_id]
            available_months = sorted(
                {r.published_at.strftime("%Y-%m") for r in rows if r.published_at},
                reverse=True,
            )
            if month:
                rows = [r for r in rows if r.published_at and r.published_at.strftime("%Y-%m") == month]
            rows.sort(key=lambda r: r.published_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
            total = len(rows)
            total_cash = sum(float(r.cash or 0) for r in rows)
            total_chats = sum(int(r.chats or 0) for r in rows)
            page_size = max(1, min(page_size, 50))
            page = max(1, page)
            total_pages = (total + page_size - 1) // page_size if total else 0
            start = (page - 1) * page_size
            end = start + page_size
            page_rows = rows[start:end]
            return ReelsListResponse(
                reels=[self._to_response(r) for r in page_rows],
                total=total,
                page=page,
                page_size=page_size,
                total_pages=total_pages,
                available_months=available_months,
                total_cash=total_cash,
                total_chats=total_chats,
            )

    def patch_reel(self, user_id: str, reel_id: str, body: ReelPatchRequest) -> ReelResponse:
        if body.cash is None and body.chats is None:
            raise HTTPException(status_code=400, detail="Envía al menos cash o chats para actualizar.")
        now = datetime.now(timezone.utc)
        with db_session:
            try:
                row = ReelContent.get(id=reel_id, user_id=user_id)
            except ObjectNotFound as e:
                raise HTTPException(status_code=404, detail="Reel no encontrado.") from e
            if body.cash is not None:
                row.cash = float(body.cash)
            if body.chats is not None:
                row.chats = int(body.chats)
            row.updated_at = now
            return self._to_response(row)

    def patch_reel_keyword(self, user_id: str, reel_id: str, body: ReelKeywordPatchRequest) -> ReelResponse:
        normalized_keyword = (body.keyword or "").strip()
        now = datetime.now(timezone.utc)
        with db_session:
            try:
                row = ReelContent.get(id=reel_id, user_id=user_id)
            except ObjectNotFound as e:
                raise HTTPException(status_code=404, detail="Reel no encontrado.") from e

            if normalized_keyword:
                duplicated = next(
                    (
                        r
                        for r in list(ReelContent.select())
                        if r.user_id == user_id
                        and r.id != reel_id
                        and (r.keyword or "").strip().lower() == normalized_keyword.lower()
                    ),
                    None,
                )
                if duplicated is not None:
                    raise HTTPException(status_code=409, detail="Ya existe otro reel con ese keyword.")

            row.keyword = normalized_keyword or None
            row.updated_at = now
            return self._to_response(row)

    def increment_chats_count_by_keyword(self, user_id: str, keyword: str) -> bool:
        normalized_keyword = (keyword or "").strip().lower()
        if not normalized_keyword:
            return False
        with db_session:
            row = next(
                (
                    r
                    for r in list(ReelContent.select())
                    if r.user_id == user_id and (r.keyword or "").strip().lower() == normalized_keyword
                ),
                None,
            )
            if row is None:
                return False
            row.chats_count = int(row.chats_count or 0) + 1
            row.updated_at = datetime.now(timezone.utc)
            return True

    def _resolve_instagram_conn(self, user_id: str) -> tuple[str, str]:
        with db_session:
            conn = next(
                (
                    c
                    for c in list(ApiConnection.select())
                    if c.user_id == user_id and c.platform == "instagram"
                ),
                None,
            )
            if conn is None:
                raise HTTPException(
                    status_code=400,
                    detail="No hay conexión de Instagram configurada. Configúrala en Conexiones API.",
                )
            creds = conn.credentials if isinstance(conn.credentials, dict) else {}
            token = str(creds.get("access_token") or "").strip()
            ig_user_id = str(creds.get("instagram_user_id") or "").strip()
            if not token or not ig_user_id:
                raise HTTPException(
                    status_code=400,
                    detail="Faltan access_token o instagram_user_id en la conexión de Instagram.",
                )
            return token, ig_user_id

    def _http_json(
        self,
        url: str,
        method: str = "GET",
        body: dict | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict:
        data = None
        req_headers = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=req_headers)
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        try:
            with urllib.request.urlopen(req, timeout=60, context=ssl_ctx) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as e:
            try:
                err_raw = e.read().decode("utf-8")
            except Exception:
                err_raw = ""
            raise HTTPException(
                status_code=502,
                detail=f"Error HTTP en proveedor externo ({e.code}): {err_raw[:220]}",
            ) from e
        except Exception as e:  # pragma: no cover
            raise HTTPException(status_code=502, detail=f"Error al llamar proveedor externo: {str(e)}") from e

    def get_sync_status(self, user_id: str) -> dict[str, int | str]:
        state = _sync_states.get(user_id)
        if state is not None:
            return state
        return {"total": 0, "processed": 0, "status": "idle", "phase": "idle", "discovered": 0}

    @db_session
    def get_metrics(self, user_id: str, month: str | None) -> dict[str, int]:
        rows = [r for r in list(ReelContent.select()) if r.user_id == user_id]

        if month:
            try:
                year, month_num = map(int, month.split("-"))
            except Exception as e:
                raise HTTPException(status_code=400, detail="El parámetro month debe tener formato YYYY-MM.") from e

            rows = [
                r
                for r in rows
                if r.published_at is not None
                and r.published_at.astimezone(AR_TZ).year == year
                and r.published_at.astimezone(AR_TZ).month == month_num
            ]

        chats_del_mes = sum(int(r.chats or 0) for r in rows)
        piezas_publicadas = len(rows)
        sin_clasificar = 0
        for row in rows:
            classification = row.classification if isinstance(row.classification, dict) else {}
            dolor = classification.get("dolor")
            if dolor is None or str(dolor).strip() == "":
                sin_clasificar += 1

        return {
            "chats_del_mes": chats_del_mes,
            "piezas_publicadas": piezas_publicadas,
            "sin_clasificar": sin_clasificar,
        }

    def _sync_instagram_blocking(self, user_id: str) -> dict[str, int]:
        self._set_sync_state(user_id, total=0, processed=0, status="running", phase="collecting", discovered=0)
        try:
            access_token, ig_user_id = self._resolve_instagram_conn(user_id)
            headers = {"Accept": "application/json"}
            media_url = (
                f"https://graph.facebook.com/v19.0/{urllib.parse.quote(ig_user_id)}/media"
                "?fields=id,media_type,thumbnail_url,permalink,timestamp,caption,like_count,comments_count"
                f"&access_token={urllib.parse.quote(access_token)}"
            )
            media_items: list[dict] = []
            pages_fetched = 0
            max_pages = 100
            next_url = media_url
            stop_pagination = False
            while next_url and pages_fetched < max_pages and not stop_pagination:
                payload = self._http_json(next_url, headers=headers)
                rows = payload.get("data")
                if isinstance(rows, list):
                    for item in rows:
                        if not isinstance(item, dict):
                            continue
                        media_type = str(item.get("media_type") or "").upper()
                        if media_type in ("REELS", "VIDEO"):
                            timestamp_raw = str(item.get("timestamp") or "").strip()
                            if timestamp_raw:
                                try:
                                    published_at = datetime.fromisoformat(timestamp_raw.replace("Z", "+00:00")).astimezone(AR_TZ)
                                    if published_at < SYNC_REELS_SINCE:
                                        stop_pagination = True
                                        break
                                except Exception:
                                    pass
                        media_items.append(item)
                paging = payload.get("paging") if isinstance(payload, dict) else None
                next_from_api = paging.get("next") if isinstance(paging, dict) else None
                next_url = str(next_from_api).strip() if next_from_api else ""
                pages_fetched += 1
                discovered_reels = sum(
                    1
                    for media in media_items
                    if isinstance(media, dict) and str(media.get("media_type") or "").upper() in ("REELS", "VIDEO")
                )
                self._set_sync_state(user_id, total=discovered_reels, processed=0, status="running", phase="collecting", discovered=discovered_reels)

            reels = [item for item in media_items if isinstance(item, dict) and str(item.get("media_type") or "").upper() in ("REELS", "VIDEO")]
            synced = 0
            created = 0
            errors = 0
            processed = 0
            total = len(reels)
            self._set_sync_state(user_id, total=total, processed=0, status="running", phase="processing", discovered=total)

            for item in reels:
                try:
                    media_id = str(item.get("id") or "").strip()
                    if not media_id:
                        continue
                    caption = str(item.get("caption") or "").strip()
                    title = caption[:100]
                    permalink = str(item.get("permalink") or "").strip() or None
                    thumbnail_url = str(item.get("thumbnail_url") or "").strip() or None
                    likes = int(item.get("like_count") or 0)
                    comments = int(item.get("comments_count") or 0)
                    timestamp = str(item.get("timestamp") or "").strip()
                    published_at = datetime.now(AR_TZ)
                    if timestamp:
                        try:
                            published_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(AR_TZ)
                        except Exception:
                            pass
                    if published_at < SYNC_REELS_SINCE:
                        continue

                    insights = {"ig_reels_avg_watch_time": 0, "reach": 0, "saved": 0, "shares": 0, "likes": 0, "comments": 0, "total_interactions": 0}
                    plays_result = 0
                    for plays_metric in ["video_views", "views"]:
                        plays_url = (
                            f"https://graph.facebook.com/v19.0/{urllib.parse.quote(media_id)}/insights"
                            f"?metric={urllib.parse.quote(plays_metric)}"
                            f"&access_token={urllib.parse.quote(access_token)}"
                        )
                        try:
                            plays_payload = self._http_json(plays_url, headers=headers)
                            plays_data = plays_payload.get("data")
                            metrics_rows = plays_data if isinstance(plays_data, list) else []
                            for m in metrics_rows:
                                if not isinstance(m, dict):
                                    continue
                                values = m.get("values")
                                if isinstance(values, list) and values and isinstance(values[0], dict):
                                    plays_result = int(values[0].get("value") or 0)
                                    break
                            break
                        except Exception:
                            continue

                    for metric_name in ["ig_reels_avg_watch_time", "reach", "saved", "shares", "likes", "comments", "total_interactions"]:
                        insights_url = (
                            f"https://graph.facebook.com/v19.0/{urllib.parse.quote(media_id)}/insights"
                            f"?metric={urllib.parse.quote(metric_name)}"
                            f"&access_token={urllib.parse.quote(access_token)}"
                        )
                        try:
                            insights_payload = self._http_json(insights_url, headers=headers)
                            metrics_rows = insights_payload.get("data") if isinstance(insights_payload.get("data"), list) else []
                            for m in metrics_rows:
                                if not isinstance(m, dict):
                                    continue
                                name = str(m.get("name") or "").strip()
                                values = m.get("values")
                                value = 0
                                if isinstance(values, list) and values and isinstance(values[0], dict):
                                    value = int(values[0].get("value") or 0)
                                if name in insights:
                                    insights[name] = value
                        except Exception:
                            continue

                    metrics_json = json.dumps(
                        {
                            "plays": int(plays_result),
                            "avg_watch_time": int(insights.get("ig_reels_avg_watch_time", 0)),
                            "likes": likes,
                            "comments": comments,
                            "comments_count": comments,
                            "saved": int(insights.get("saved", 0)),
                            "shares": int(insights.get("shares", 0)),
                            "reach": int(insights.get("reach", 0)),
                            "thumbnail": thumbnail_url or "",
                        }
                    )
                    created_this_reel = self._upsert_reel_content(
                        user_id=user_id,
                        external_id=media_id,
                        title=title,
                        metrics_json=metrics_json,
                        published_at=published_at,
                        permalink=permalink,
                        caption=caption,
                    )
                    if created_this_reel:
                        created += 1
                    synced += 1
                except Exception as e:
                    try:
                        rollback()
                    except Exception:
                        pass
                    errors += 1
                    print(f"[reels sync] ERROR en media {item.get('id')}: {e}")
                finally:
                    processed += 1
                    self._set_sync_state(user_id, total=total, processed=processed, status="running", phase="processing", discovered=total)

            self._set_sync_state(user_id, total=total, processed=processed, status="done", phase="done", discovered=total)
            return {"synced": synced, "created": created, "errors": errors}
        except Exception:
            current = _sync_states.get(user_id, {"total": 0, "processed": 0, "discovered": 0})
            self._set_sync_state(
                user_id,
                total=int(current.get("total", 0)),
                processed=int(current.get("processed", 0)),
                status="error",
                phase="error",
                discovered=int(current.get("discovered", 0)),
            )
            raise

    async def sync_instagram(self, user_id: str) -> dict[str, int]:
        acquired = _sync_lock.acquire(blocking=False)
        if not acquired:
            raise HTTPException(status_code=409, detail="Ya hay una sincronizacion de reels en curso.")
        try:
            return await asyncio.to_thread(self._sync_instagram_blocking, user_id)
        finally:
            _sync_lock.release()
