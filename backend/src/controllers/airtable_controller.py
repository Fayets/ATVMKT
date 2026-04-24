from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from src.schemas import AirtableLeadsListResponse, AirtableVerifyResponse
from src.services.airtable_services import AirtableServices

router = APIRouter(prefix="/airtable", tags=["airtable"])
service = AirtableServices()


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


@router.get("/verify", response_model=AirtableVerifyResponse)
def verify_airtable(user_id: Annotated[str, Depends(require_user_id)]) -> AirtableVerifyResponse:
    try:
        return service.verify(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al verificar Airtable.")


@router.get("/leads", response_model=AirtableLeadsListResponse)
def list_airtable_leads(user_id: Annotated[str, Depends(require_user_id)]) -> AirtableLeadsListResponse:
    try:
        return service.list_leads_table_records(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al leer leads desde Airtable.")
