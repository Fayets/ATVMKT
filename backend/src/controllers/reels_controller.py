from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from src.schemas import ReelPatchRequest, ReelResponse, ReelsListResponse, ReelsMetricsOut
from src.services.reels_services import ReelsServices

router = APIRouter(prefix="/api/reels", tags=["reels"], redirect_slashes=False)
service = ReelsServices()


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


@router.get("", response_model=ReelsListResponse)
def list_reels(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(default=None, description="Formato YYYY-MM"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
) -> ReelsListResponse:
    try:
        return service.list_reels(user_id, month, page, page_size)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al listar reels.")


@router.patch("/{reel_id}", response_model=ReelResponse)
def patch_reel(
    reel_id: str,
    body: ReelPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> ReelResponse:
    try:
        return service.patch_reel(user_id, reel_id, body)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al actualizar el reel.")


@router.post("/sync")
async def sync_instagram(
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, int]:
    try:
        return await service.sync_instagram(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al sincronizar reels con Instagram.")


@router.get("/sync-status")
def get_sync_status(
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str | None]:
    try:
        return service.get_sync_status(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener estado de sync de reels.")


@router.get("/metrics", response_model=ReelsMetricsOut)
def get_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(default=None, description="Formato YYYY-MM"),
) -> ReelsMetricsOut:
    try:
        return service.get_metrics(user_id, month)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener métricas de reels.")
