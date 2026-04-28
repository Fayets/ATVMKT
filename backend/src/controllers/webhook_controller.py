from typing import Any

from fastapi import APIRouter, HTTPException, Request

from src.services.bio_service import BioService

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"], redirect_slashes=False)
service = BioService()


@router.post("/manychat")
async def manychat_webhook(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc

    try:
        return service.process_manychat_webhook(body if isinstance(body, dict) else {})
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al procesar webhook de ManyChat.")


@router.get("/manychat")
def manychat_webhook_verify() -> dict[str, str]:
    return {"status": "ok", "service": "manychat-webhook"}
