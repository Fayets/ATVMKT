import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from src.agent_auth import get_agent_auth, get_agent_user_id
from src.schemas import AgentContenidoOut, AgentResumenOut
from src.services.agent_analytics_service import build_miembro, build_resumen, current_month_ar
from src.services.agent_content_service import build_contenido

router = APIRouter(prefix="/api/agent", tags=["agent"], redirect_slashes=False)


def _parse_month_param(month: str | None) -> str:
    ym = (month or "").strip() or current_month_ar()
    if not re.match(r"^\d{4}-\d{2}$", ym):
        raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).")
    try:
        y, m = ym.split("-")
        mi = int(m)
        if mi < 1 or mi > 12:
            raise ValueError
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).") from exc
    return ym


@router.get("/resumen", response_model=AgentResumenOut)
def agent_resumen(
    _: Annotated[None, Depends(get_agent_auth)],
    month: str | None = Query(default=None, description="YYYY-MM; default mes actual (Argentina)"),
) -> AgentResumenOut:
    uid = get_agent_user_id()
    ym = _parse_month_param(month)
    try:
        payload = build_resumen(uid, ym)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AgentResumenOut(**payload)


@router.get("/contenido", response_model=AgentContenidoOut)
def agent_contenido(
    _: Annotated[None, Depends(get_agent_auth)],
    month: str | None = Query(default=None, description="YYYY-MM; default mes actual (Argentina)"),
) -> AgentContenidoOut:
    uid = get_agent_user_id()
    ym = _parse_month_param(month)
    try:
        payload = build_contenido(uid, ym)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AgentContenidoOut(**payload)


@router.get("/miembro")
def agent_miembro(
    _: Annotated[None, Depends(get_agent_auth)],
    nombre: str = Query(..., min_length=1, description="Nombre o fragmento (case-insensitive)"),
    month: str | None = Query(default=None, description="YYYY-MM; default mes actual (Argentina)"),
) -> Any:
    uid = get_agent_user_id()
    ym = _parse_month_param(month)
    q = (nombre or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="El parámetro nombre es obligatorio.")

    try:
        result = build_miembro(uid, q, ym)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if result is None:
        raise HTTPException(status_code=404, detail="No se encontró el miembro.")

    if isinstance(result, list):
        return JSONResponse(content=result)

    return JSONResponse(content=result)
