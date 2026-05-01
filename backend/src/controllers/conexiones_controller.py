from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.controllers.auth_controller import get_current_user_id
from src.schemas import ApiConnectionResponse, ApiConnectionUpsertRequest
from src.services.conexiones_services import ConexionesServices

router = APIRouter(prefix="/conexiones", tags=["conexiones"])
service = ConexionesServices()


@router.get("", response_model=list[ApiConnectionResponse])
def list_conexiones(user_id: Annotated[int, Depends(get_current_user_id)]) -> list[ApiConnectionResponse]:
    try:
        return service.list_by_user(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Error inesperado al listar las conexiones.",
        )


@router.put("/{platform}", response_model=ApiConnectionResponse)
def upsert_conexion(
    platform: str,
    body: ApiConnectionUpsertRequest,
    user_id: Annotated[int, Depends(get_current_user_id)],
) -> ApiConnectionResponse:
    try:
        return service.upsert(user_id, platform, body)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Error inesperado al guardar la conexión.",
        )
