from datetime import datetime, timezone

from fastapi import HTTPException
from pony.orm import db_session

from src.models import ApiConnection
from src.schemas import ApiConnectionResponse, ApiConnectionUpsertRequest


class ConexionesServices:
    def _to_response(self, row: ApiConnection) -> ApiConnectionResponse:
        creds = row.credentials if isinstance(row.credentials, dict) else {}
        return ApiConnectionResponse(
            id=row.id,
            user_id=row.user_id,
            platform=row.platform,
            credentials=creds,
            last_sync_at=row.last_sync_at,
            updated_at=row.updated_at,
        )

    def list_by_user(self, user_id: str) -> list[ApiConnectionResponse]:
        with db_session:
            rows = [c for c in list(ApiConnection.select()) if c.user_id == user_id]
            rows.sort(key=lambda r: r.platform)
            return [self._to_response(r) for r in rows]

    def upsert(self, user_id: str, platform: str, body: ApiConnectionUpsertRequest) -> ApiConnectionResponse:
        if not platform.strip():
            raise HTTPException(status_code=400, detail="La plataforma no puede estar vacía.")
        platform = platform.strip()
        now = datetime.now(timezone.utc)
        with db_session:
            user_rows = [c for c in list(ApiConnection.select()) if c.user_id == user_id]
            matches = [c for c in user_rows if c.platform == platform]
            matches.sort(key=lambda c: c.id)
            existing = matches[0] if matches else None
            if existing:
                existing.credentials = dict(body.credentials or {})
                existing.updated_at = now
                return self._to_response(existing)
            row = ApiConnection(
                user_id=user_id,
                platform=platform,
                credentials=dict(body.credentials or {}),
                updated_at=now,
            )
            return self._to_response(row)
