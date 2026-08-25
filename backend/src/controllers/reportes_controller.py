"""Endpoints M2M del reporte semanal, consumidos por ATV Clients.

Auth por `X-Agent-Key` (misma que el resto de /api/agent), no por sesión de
usuario: quien consume es otro servicio, no una persona.
"""

from datetime import date, datetime
from typing import Annotated, Any

from decouple import config
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from src.agent_auth import get_agent_auth, get_agent_user_id
from src.services.reportes_semanales_service import build_contenido_rango
from src.services.reportes_ventas_service import build_ventas_rango

router = APIRouter(prefix="/api/reportes", tags=["reportes"], redirect_slashes=False)

_MAX_DIAS = 120

# Base pública para las imágenes de historias (se sirven en /media).
# En un dev local que no tiene los archivos, apuntar al host que sí los tiene.
_PUBLIC_BASE_URL = config("PUBLIC_BASE_URL", default="").strip()


def _parse_fecha(valor: str, campo: str) -> date:
    try:
        return datetime.strptime(valor.strip(), "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Parámetro {campo} inválido (usar YYYY-MM-DD).",
        ) from None


def _rango(desde: str, hasta: str) -> tuple[date, date]:
    d = _parse_fecha(desde, "desde")
    h = _parse_fecha(hasta, "hasta")
    if h <= d:
        raise HTTPException(status_code=400, detail="`hasta` debe ser posterior a `desde`.")
    if (h - d).days > _MAX_DIAS:
        raise HTTPException(status_code=400, detail=f"Rango demasiado amplio (máx. {_MAX_DIAS} días).")
    return d, h


@router.get("/contenido")
def contenido_por_rango(
    _: Annotated[None, Depends(get_agent_auth)],
    request: Request,
    desde: str = Query(description="YYYY-MM-DD, inclusive"),
    hasta: str = Query(description="YYYY-MM-DD, exclusive"),
) -> dict[str, Any]:
    """Contenido publicado en [desde, hasta) con su cash y agendas.

    El rango es semiabierto a propósito: la semana comercial va de viernes a
    viernes, y si ambos extremos fueran inclusive el viernes de cierre contaría
    en dos semanas.
    """
    d, h = _rango(desde, hasta)
    uid = get_agent_user_id()
    base = _PUBLIC_BASE_URL or str(request.base_url)
    return build_contenido_rango(uid, d, h, base_url=base)


@router.get("/ventas")
def ventas_por_rango(
    _: Annotated[None, Depends(get_agent_auth)],
    request: Request,
    desde: str = Query(description="YYYY-MM-DD, inclusive"),
    hasta: str = Query(description="YYYY-MM-DD, exclusive"),
) -> dict[str, Any]:
    """Llamadas de la semana con atribución, estado y pago, más el funnel."""
    d, h = _rango(desde, hasta)
    uid = get_agent_user_id()
    base = _PUBLIC_BASE_URL or str(request.base_url)
    return build_ventas_rango(uid, d, h, base_url=base)
