from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pony.orm import db_session

from src.models import ApiConnection
from src.schemas import ApiConnectionResponse, ApiConnectionUpsertRequest


class ConexionesServices:
    @staticmethod
    def _iso_utc(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).isoformat()

    def _to_response(self, row: ApiConnection) -> ApiConnectionResponse:
        creds = row.credentials if isinstance(row.credentials, dict) else {}
        return ApiConnectionResponse(
            id=str(row.id),
            user_id=str(row.user_id),
            platform=row.platform,
            credentials=creds,
            last_sync_at=row.last_sync_at,
            updated_at=row.updated_at,
        )

    def list_by_user(self, user_id: int) -> list[ApiConnectionResponse]:
        with db_session:
            rows = [c for c in list(ApiConnection.select()) if c.user_id == user_id]
            rows.sort(key=lambda r: r.platform)
            return [self._to_response(r) for r in rows]

    def upsert(self, user_id: int, platform: str, body: ApiConnectionUpsertRequest) -> ApiConnectionResponse:
        if not platform.strip():
            raise HTTPException(status_code=400, detail="La plataforma no puede estar vacía.")
        platform = platform.strip()
        now = datetime.now(timezone.utc)
        with db_session:
            user_rows = [c for c in list(ApiConnection.select()) if c.user_id == user_id]
            matches = [c for c in user_rows if c.platform == platform]
            matches.sort(key=lambda c: c.id)
            existing = matches[0] if matches else None
            incoming_credentials = dict(body.credentials or {})
            if existing:
                previous_credentials = existing.credentials if isinstance(existing.credentials, dict) else {}
                if platform.lower() == "instagram":
                    previous_token = str(previous_credentials.get("access_token") or "").strip()
                    incoming_token = str(incoming_credentials.get("access_token") or "").strip()
                    if incoming_token and incoming_token != previous_token:
                        incoming_credentials["token_saved_at"] = self._iso_utc(now)
                        incoming_credentials["token_expires_at"] = self._iso_utc(now + timedelta(days=60))
                existing.credentials = incoming_credentials
                existing.updated_at = now
                return self._to_response(existing)
            row = ApiConnection(
                user_id=user_id,
                platform=platform,
                credentials=(
                    {
                        **incoming_credentials,
                        **(
                            {
                                "token_saved_at": self._iso_utc(now),
                                "token_expires_at": self._iso_utc(now + timedelta(days=60)),
                            }
                            if platform.lower() == "instagram" and str(incoming_credentials.get("access_token") or "").strip()
                            else {}
                        ),
                    }
                ),
                updated_at=now,
            )
            return self._to_response(row)
