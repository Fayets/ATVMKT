import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import certifi
from fastapi import HTTPException
from pony.orm import ObjectNotFound, db_session

from src.models import ApiConnection, ReelContent
from src.schemas import ReelPatchRequest, ReelResponse, ReelsListResponse, ReelsSyncResponse


class ReelsServices:
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
        )

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

    def _get_apify_credentials(self, user_id: str) -> tuple[str, str, int]:
        with db_session:
            conn = next(
                (
                    c
                    for c in list(ApiConnection.select())
                    if c.user_id == user_id and c.platform == "apify"
                ),
                None,
            )
            if conn is None:
                raise HTTPException(
                    status_code=400,
                    detail="No hay conexión de Apify configurada. Configúrala en Conexiones API.",
                )
            creds = conn.credentials if isinstance(conn.credentials, dict) else {}
            token = str(creds.get("api_token") or "").strip()
            handle = str(creds.get("ig_handle") or "").strip().replace("@", "")
            limit_raw = str(creds.get("limit") or "20").strip()
            try:
                limit = max(1, min(int(limit_raw), 100))
            except ValueError:
                limit = 20
            if not token or not handle:
                raise HTTPException(
                    status_code=400,
                    detail="Faltan api_token o ig_handle en la conexión de Apify.",
                )
            return token, handle, limit

    def _http_json(self, url: str, method: str = "GET", body: dict | None = None) -> dict:
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
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
            err_lower = err_raw.lower()
            if "monthly usage hard limit exceeded" in err_lower or "platform-feature-disabled" in err_lower:
                raise HTTPException(
                    status_code=402,
                    detail=(
                        "Apify bloqueó la ejecución por límite mensual alcanzado. "
                        "Subí el plan o aumentá el límite mensual en Apify Console > Billing, "
                        "y luego reintentá la sincronización."
                    ),
                ) from e
            raise HTTPException(
                status_code=502,
                detail=f"Error HTTP en proveedor externo ({e.code}): {err_raw[:220]}",
            ) from e
        except Exception as e:  # pragma: no cover
            raise HTTPException(status_code=502, detail=f"Error al llamar proveedor externo: {str(e)}") from e

    def sync_apify(self, user_id: str, limit_override: int | None = None) -> ReelsSyncResponse:
        token, handle, limit = self._get_apify_credentials(user_id)
        if limit_override is not None:
            limit = max(1, min(int(limit_override), 100))

        actor_url = (
            "https://api.apify.com/v2/acts/apify~instagram-reel-scraper/runs?token="
            + urllib.parse.quote(token)
        )
        ig_url = f"https://www.instagram.com/{handle}/"

        start_data = self._http_json(
            actor_url,
            method="POST",
            body={
                "username": [ig_url],
                "resultsLimit": limit,
                "includeTranscript": True,
                "skipPinnedPosts": False,
            },
        )

        run_id = ((start_data.get("data") or {}).get("id")) if isinstance(start_data, dict) else None
        dataset_id = ((start_data.get("data") or {}).get("defaultDatasetId")) if isinstance(start_data, dict) else None
        if not run_id or not dataset_id:
            raise HTTPException(status_code=502, detail="Apify no devolvió run_id/dataset_id.")

        max_wait_s = 300
        poll_every_s = 5
        elapsed = 0
        run_status = "RUNNING"

        while run_status in ("RUNNING", "READY"):
            if elapsed >= max_wait_s:
                raise HTTPException(status_code=504, detail="Apify tardó más de 5 minutos.")
            time.sleep(poll_every_s)
            elapsed += poll_every_s
            poll_url = (
                "https://api.apify.com/v2/actor-runs/"
                + urllib.parse.quote(run_id)
                + "?token="
                + urllib.parse.quote(token)
            )
            poll = self._http_json(poll_url)
            run_status = str(((poll.get("data") or {}).get("status")) or "FAILED")

        if run_status != "SUCCEEDED":
            raise HTTPException(status_code=502, detail=f"Apify finalizó con estado: {run_status}")

        ds_url = (
            "https://api.apify.com/v2/datasets/"
            + urllib.parse.quote(dataset_id)
            + "/items?token="
            + urllib.parse.quote(token)
            + "&limit="
            + urllib.parse.quote(str(limit))
        )
        items = self._http_json(ds_url)
        posts = items if isinstance(items, list) else []
        if not posts:
            return ReelsSyncResponse(success=True, total=0, new=0, updated=0, detail=f"Sin resultados para @{handle}.")

        new_count = 0
        upd_count = 0
        now = datetime.now(timezone.utc)

        with db_session:
            for post in posts:
                if not isinstance(post, dict):
                    continue
                short_code = str(post.get("shortCode") or post.get("id") or "").strip()
                if not short_code:
                    continue
                external_id = f"apify_{short_code}"
                caption = str(post.get("caption") or post.get("alt") or "")
                title = caption[:200] if caption else f"Reel {short_code}"
                published_raw = str(post.get("timestamp") or "")
                published_at = None
                if published_raw:
                    try:
                        published_at = datetime.fromisoformat(published_raw.replace("Z", "+00:00"))
                    except ValueError:
                        published_at = now
                else:
                    published_at = now

                permalink = str(post.get("url") or f"https://www.instagram.com/reel/{short_code}/")
                thumb = str(post.get("displayUrl") or "")
                metrics = {
                    "views": int(post.get("videoPlayCount") or post.get("videoViewCount") or post.get("viewCount") or 0),
                    "likes": int(post.get("likesCount") or 0),
                    "comments": int(post.get("commentsCount") or 0),
                    "saves": int(post.get("savesCount") or 0),
                    "shares": int(post.get("sharesCount") or 0),
                    "reach": 0,
                    "thumbnail": thumb,
                }
                transcript = str(post.get("transcript") or "")
                chats = round((int(post.get("commentsCount") or 0)) / 2)

                existing = next(
                    (
                        r
                        for r in list(ReelContent.select())
                        if r.user_id == user_id and r.external_id == external_id
                    ),
                    None,
                )
                if existing:
                    existing.title = title
                    existing.metrics = metrics
                    existing.classification = {"transcript": transcript}
                    existing.published_at = published_at
                    existing.url = permalink
                    existing.notes = caption
                    existing.updated_at = now
                    if existing.chats <= 0:
                        existing.chats = chats
                    upd_count += 1
                else:
                    ReelContent(
                        user_id=user_id,
                        external_id=external_id,
                        title=title,
                        metrics=metrics,
                        classification={"transcript": transcript},
                        chats=chats,
                        published_at=published_at,
                        url=permalink,
                        notes=caption,
                        updated_at=now,
                    )
                    new_count += 1

        return ReelsSyncResponse(success=True, total=len(posts), new=new_count, updated=upd_count)
