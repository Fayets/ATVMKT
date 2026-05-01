from datetime import datetime
from typing import Any

from decouple import config
from fastapi import APIRouter, HTTPException, Request
from pony.orm import db_session

from src.models import ApiConnection, Lead, ReelContent

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"], redirect_slashes=False)

MANYCHAT_WEBHOOK_SECRET = config(
    "MANYCHAT_WEBHOOK_TOKEN",
    default="3720ab6c857a4d6992c457b5a2299190",
)


def _norm_kw(s: str) -> str:
    return (s or "").strip().casefold()


def _resolve_user_id_by_keyword(keyword: str) -> int | None:
    """Dueño del keyword: reel con ese keyword o credenciales ManyChat que lo listan."""
    kw = _norm_kw(keyword)
    if not kw:
        return None

    with db_session:
        reel_uid: int | None = None
        for reel in list(ReelContent.select()):
            if _norm_kw(reel.keyword or "") != kw:
                continue
            uid = int(reel.user_id)
            if reel_uid is None:
                reel_uid = uid
            elif reel_uid != uid:
                raise HTTPException(
                    status_code=409,
                    detail="Hay más de un usuario con el mismo keyword en reels. Corregí keywords duplicados.",
                )
        if reel_uid is not None:
            return reel_uid

        for conn in list(ApiConnection.select()):
            if str(conn.platform).strip().lower() != "manychat":
                continue
            creds = conn.credentials if isinstance(conn.credentials, dict) else {}
            single = _norm_kw(str(creds.get("keyword") or ""))
            if single and single == kw:
                return int(conn.user_id)
            raw_list = creds.get("keywords") or creds.get("tracked_keywords")
            if isinstance(raw_list, list):
                for item in raw_list:
                    if _norm_kw(str(item)) == kw:
                        return int(conn.user_id)
            if isinstance(raw_list, str) and raw_list.strip():
                for part in raw_list.split(","):
                    if _norm_kw(part) == kw:
                        return int(conn.user_id)

    return None


@router.post("/manychat")
async def manychat_webhook(request: Request) -> dict[str, str]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc

    payload = body if isinstance(body, dict) else {}
    query_token = str(request.query_params.get("token") or "").strip()
    header_token = str(request.headers.get("X-Webhook-Token") or "").strip()

    resolved_token = query_token or header_token or str(payload.get("webhook_token") or "").strip()
    if resolved_token:
        payload["webhook_token"] = resolved_token

    event = str(payload.get("event") or "").strip().lower()
    webhook_token = str(payload.get("webhook_token") or "").strip()
    keyword = str(payload.get("keyword") or "").strip()
    if not keyword and event == "respondio_auto":
        keyword = "respondio_auto"

    if str(webhook_token) != str(MANYCHAT_WEBHOOK_SECRET).strip():
        raise HTTPException(status_code=401, detail="Invalid webhook token")
    if not keyword:
        raise HTTPException(status_code=400, detail="Missing keyword")

    user_id = _resolve_user_id_by_keyword(keyword)
    if user_id is None:
        raise HTTPException(
            status_code=404,
            detail="No se encontró un usuario para esta keyword (revisa reels o conexión ManyChat).",
        )

    contact_name = str(payload.get("contact_name") or "").strip()
    contact_lastname = str(payload.get("contact_lastname") or "").strip()
    nombre = " ".join(x for x in (contact_name, contact_lastname) if x).strip() or None
    ig = str(payload.get("contact_ig_username") or "").strip() or None
    content_url = str(payload.get("content_url") or "").strip() or None
    manychat_contact_id = str(payload.get("manychat_contact_id") or "").strip() or None

    now = datetime.utcnow()
    with db_session:
        Lead(
            user_id=user_id,
            nombre=nombre,
            ig=ig,
            keyword=keyword or None,
            content_url=content_url,
            manychat_contact_id=manychat_contact_id,
            fecha_bot=now,
            respondio_auto=True,
        )

    return {"status": "ok"}


@router.get("/manychat")
def manychat_webhook_verify() -> dict[str, str]:
    return {"status": "ok", "service": "manychat-webhook"}
