import re
from datetime import datetime
from decouple import config
from fastapi import APIRouter, HTTPException, Request
from pony.orm import db_session

from src.models import ApiConnection, Lead, ReelContent

router = APIRouter(prefix="/webhooks", tags=["webhooks"], redirect_slashes=False)

MANYCHAT_WEBHOOK_SECRET = config(
    "MANYCHAT_WEBHOOK_TOKEN",
    default="3720ab6c857a4d6992c457b5a2299190",
)


def _norm_kw(s: str) -> str:
    return (s or "").strip().casefold()


def _norm_ig(s: str) -> str:
    return (s or "").strip().lstrip("@").casefold()


def _sanitize_webhook_display_name(raw: str) -> str:
    """Quita etiquetas ManyChat sin sustituir ({{first_name}}, etc.) que a veces llegan como texto."""
    s = (raw or "").strip()
    if not s:
        return ""
    cleaned = re.sub(r"\{\{[^}]*\}\}", "", s)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _keyword_tokens_csv(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    return [p.strip() for p in str(raw).split(",") if p.strip()]


def _merge_keyword_csv(existing: str | None, new_token: str) -> str:
    """Una sola fila por contacto: varias keywords en el mismo campo, coma-separadas (igual que en reels/leads)."""
    t = (new_token or "").strip()
    parts = _keyword_tokens_csv(existing)
    seen = {p.casefold() for p in parts}
    if t and t.casefold() not in seen:
        parts.append(t)
    return ", ".join(parts)


def _find_lead_same_contact(user_id: int, ig_display: str) -> Lead | None:
    """Mismo dueño + mismo IG → un solo lead; se agregan keywords."""
    ig_key = _norm_ig(ig_display)
    if not ig_key:
        return None
    matches = [
        r
        for r in list(Lead.select())
        if int(r.user_id) == user_id and _norm_ig(r.ig or "") == ig_key
    ]
    if not matches:
        return None
    matches.sort(key=lambda r: (r.created_at.timestamp() if r.created_at else 0.0), reverse=True)
    return matches[0]


def _resolve_user_id_by_keyword(keyword: str) -> int | None:
    """Dueño del keyword: reel con ese keyword; si no hay reel, primer ApiConnection manychat (keyword de bio genérico)."""
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

        manychat_conns = [
            c
            for c in list(ApiConnection.select())
            if str(c.platform).strip().lower() == "manychat"
        ]
        manychat_conns.sort(key=lambda c: int(c.id))
        if manychat_conns:
            return int(manychat_conns[0].user_id)

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

    if str(webhook_token) != str(MANYCHAT_WEBHOOK_SECRET).strip():
        raise HTTPException(status_code=401, detail="Invalid webhook token")

    if event == "respondio_auto":
        ig_key = _norm_ig(str(payload.get("contact_ig_username") or "").strip())
        if not ig_key:
            return {"status": "ok"}
        with db_session:
            matches = [
                r for r in list(Lead.select()) if _norm_ig(r.ig or "") == ig_key
            ]
            if not matches:
                return {"status": "ok"}
            matches.sort(
                key=lambda r: (r.created_at.timestamp() if r.created_at else 0.0),
                reverse=True,
            )
            matches[0].respondio_auto = True
        return {"status": "ok"}

    keyword = str(payload.get("keyword") or "").strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="Missing keyword")

    user_id = _resolve_user_id_by_keyword(keyword)
    if user_id is None:
        raise HTTPException(
            status_code=404,
            detail="No se encontró un usuario para esta keyword (revisa reels o conexión ManyChat).",
        )

    contact_name = _sanitize_webhook_display_name(str(payload.get("contact_name") or ""))
    contact_lastname = _sanitize_webhook_display_name(str(payload.get("contact_lastname") or ""))
    nombre = " ".join(x for x in (contact_name, contact_lastname) if x).strip()
    # Mismo criterio: si en ManyChat el body tiene "{{ig_username}}" entre comillas, llega literal.
    ig = _sanitize_webhook_display_name(str(payload.get("contact_ig_username") or "")).lstrip("@")
    content_url = str(payload.get("content_url") or "").strip()
    manychat_contact_id = _sanitize_webhook_display_name(str(payload.get("manychat_contact_id") or ""))

    now = datetime.utcnow()
    with db_session:
        existing = _find_lead_same_contact(user_id, ig)
        if existing is not None:
            existing.keyword = _merge_keyword_csv(existing.keyword, keyword)
            if nombre and not (existing.nombre or "").strip():
                existing.nombre = nombre
            if ig:
                existing.ig = ig
            if content_url:
                existing.content_url = content_url
            if manychat_contact_id and not (existing.manychat_contact_id or "").strip():
                existing.manychat_contact_id = manychat_contact_id
            existing.fecha_bot = now
        else:
            Lead(
                user_id=user_id,
                nombre=nombre,
                ig=ig,
                keyword=keyword,
                content_url=content_url,
                manychat_contact_id=manychat_contact_id,
                fecha_bot=now,
                respondio_auto=False,
            )

    return {"status": "ok"}


@router.get("/manychat")
def manychat_webhook_verify() -> dict[str, str]:
    return {"status": "ok", "service": "manychat-webhook"}
