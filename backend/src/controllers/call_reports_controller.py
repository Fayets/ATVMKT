from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pony.orm import ObjectNotFound, db_session

from src.lead_display_utils import lead_display_nombre
from src.models import CallReport as CallReportEntity
from src.models import Lead as LeadEntity
from src.schemas import (
    CallReportAnalyzeRequest,
    CallReportAnalyzeResponse,
    CallReportOut,
    CallReportsListResponse,
)
from src.services.call_report_service import (
    analyze_call_report,
    get_or_create_report,
    is_fathom_link,
    normalize_fathom_url,
)

router = APIRouter(prefix="/api/call-reports", tags=["call-reports"], redirect_slashes=False)


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _dt_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


def _sort_ts(row: CallReportEntity) -> float:
    dt = row.created_at
    if dt is None:
        return 0.0
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return float(dt.replace(tzinfo=timezone.utc).timestamp())


def _lead_nombre_map(uid: int, lead_ids: set[int]) -> dict[int, str]:
    if not lead_ids:
        return {}
    with db_session:
        out: dict[int, str] = {}
        for lid in lead_ids:
            try:
                lead = LeadEntity[lid]
            except ObjectNotFound:
                continue
            if int(lead.user_id) != uid:
                continue
            out[lid] = lead_display_nombre(lead) or (lead.nombre or "").strip() or "Sin nombre"
        return out


def _to_out(row: CallReportEntity, lead_names: dict[int, str]) -> CallReportOut:
    lid = int(row.lead_id)
    return CallReportOut(
        id=str(row.id),
        lead_id=str(lid),
        lead_nombre=lead_names.get(lid, ""),
        fathom_url=row.fathom_url or "",
        estado=(row.estado or "pendiente").strip(),
        error_msg=(row.error_msg or "").strip() or None,
        closer_report=(row.closer_report or "").strip() or None,
        dolores_llamada=(row.dolores_llamada or "").strip() or None,
        razon_compra=(row.razon_compra or "").strip() or None,
        program_offered=(row.program_offered or "").strip() or None,
        status_llamada=(row.status_llamada or "").strip() or None,
        created_at=_dt_iso(row.created_at) or "",
        updated_at=_dt_iso(row.updated_at),
    )


@router.get("", response_model=CallReportsListResponse)
def list_call_reports(
    user_id: Annotated[str, Depends(require_user_id)],
) -> CallReportsListResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    with db_session:
        rows = [r for r in list(CallReportEntity.select()) if int(r.user_id) == uid]
        rows.sort(key=_sort_ts, reverse=True)
        lead_ids = {int(r.lead_id) for r in rows}
        names = _lead_nombre_map(uid, lead_ids)
        out = [_to_out(r, names) for r in rows]

    return CallReportsListResponse(call_reports=out)


@router.get("/{report_id}", response_model=CallReportOut)
def get_call_report(
    report_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CallReportOut:
    try:
        rid = int(report_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="report_id o user_id inválido") from e

    with db_session:
        try:
            row = CallReportEntity[rid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Reporte no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Reporte no encontrado.")
        names = _lead_nombre_map(uid, {int(row.lead_id)})
        return _to_out(row, names)


@router.post("/analyze", response_model=CallReportAnalyzeResponse)
def analyze_call_report_endpoint(
    body: CallReportAnalyzeRequest,
    background: BackgroundTasks,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CallReportAnalyzeResponse:
    try:
        uid = int(user_id)
        lead_id = int(body.lead_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id o user_id inválido") from e

    fathom_url = normalize_fathom_url(body.fathom_url)
    if not is_fathom_link(fathom_url):
        raise HTTPException(status_code=400, detail="fathom_url inválido.")

    with db_session:
        try:
            lead = LeadEntity[lead_id]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
        if int(lead.user_id) != uid:
            raise HTTPException(status_code=404, detail="Lead no encontrado.")

    report_id, created = get_or_create_report(lead_id, fathom_url, uid)
    if created:
        background.add_task(analyze_call_report, report_id)
    else:
        with db_session:
            row = CallReportEntity.get(id=report_id)
            estado = (row.estado or "pendiente") if row else "pendiente"
        return CallReportAnalyzeResponse(report_id=report_id, estado=estado)

    return CallReportAnalyzeResponse(report_id=report_id, estado="pendiente")
