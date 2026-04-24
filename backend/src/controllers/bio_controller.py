from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from src.schemas import (
    BioManychatStatusResponse,
    BioLeadResponse,
    BioLeadsListResponse,
    BioLeadStatusPatchRequest,
    BioMetricsResponse,
    BioViaOptionsResponse,
)
from src.services.bio_service import BioService

router = APIRouter(prefix="/api/bio", tags=["bio"], redirect_slashes=False)
service = BioService()


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


@router.get("/leads", response_model=BioLeadsListResponse)
def list_bio_leads(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(default=None, description="Formato YYYY-MM"),
) -> BioLeadsListResponse:
    try:
        effective_month = month or datetime.utcnow().strftime("%Y-%m")
        return service.list_leads(user_id, effective_month)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al cargar leads de BIO.")


@router.patch("/leads/{record_id}/status", response_model=BioLeadResponse)
def patch_bio_lead_status(
    record_id: str,
    body: BioLeadStatusPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> BioLeadResponse:
    try:
        return service.patch_status(user_id, record_id, body.status)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al actualizar status de BIO.")


@router.get("/metrics", response_model=BioMetricsResponse)
def get_bio_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(default=None, description="Formato YYYY-MM"),
) -> BioMetricsResponse:
    try:
        effective_month = month or datetime.utcnow().strftime("%Y-%m")
        return service.metrics(user_id, effective_month)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener métricas de BIO.")


@router.get("/manychat-status", response_model=BioManychatStatusResponse)
def get_manychat_status(
    user_id: Annotated[str, Depends(require_user_id)],
) -> BioManychatStatusResponse:
    try:
        return service.manychat_status(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener estado de ManyChat.")


@router.get("/via-options", response_model=BioViaOptionsResponse)
def get_bio_via_options(
    user_id: Annotated[str, Depends(require_user_id)],
) -> BioViaOptionsResponse:
    try:
        return service.via_options(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener opciones de Vía.")
