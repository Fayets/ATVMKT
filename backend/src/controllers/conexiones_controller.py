from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from src.schemas import ApiConnectionResponse, ApiConnectionUpsertRequest
from src.services.conexiones_services import ConexionesServices

router = APIRouter(prefix="/conexiones", tags=["conexiones"])
service = ConexionesServices()


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


@router.get("", response_model=list[ApiConnectionResponse])
def list_conexiones(user_id: Annotated[str, Depends(require_user_id)]) -> list[ApiConnectionResponse]:
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
    user_id: Annotated[str, Depends(require_user_id)],
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
