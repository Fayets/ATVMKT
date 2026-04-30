from typing import Any

from fastapi import APIRouter, HTTPException, Request
import traceback

from src.services.bio_service import BioService

router = APIRouter(prefix="/webhooks", tags=["webhooks"], redirect_slashes=False)
service = BioService()


@router.post("/manychat")
async def manychat_webhook(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc

    print("=== WEBHOOK MANYCHAT RAW PAYLOAD ===")
    print(body)
    print("=====================================")

    payload = body if isinstance(body, dict) else {}
    query_token = str(request.query_params.get("token") or "").strip()
    header_token = str(request.headers.get("X-Webhook-Token") or "").strip()

    # Prioridad: query param -> header -> body.
    resolved_token = query_token or header_token or str(payload.get("webhook_token") or "").strip()
    if resolved_token:
        payload["webhook_token"] = resolved_token

    try:
        return service.process_manychat_webhook(payload)
    except HTTPException as e:
        raise e
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Error inesperado al procesar webhook de ManyChat.")


@router.get("/manychat")
def manychat_webhook_verify() -> dict[str, str]:
    return {"status": "ok", "service": "manychat-webhook"}
