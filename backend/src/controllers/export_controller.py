"""Export JSON de tablas críticas por usuario autenticado."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pony.orm import db_session

from src.controllers.auth_controller import get_current_user_id
from src.models import (
    CloserReport,
    Lead,
    MasterList,
    OfferedProgram,
    ReelContent,
    SeguimientoReport,
    SetterReport,
    StorySequence,
    StorySlide,
    TeamMember,
)

router = APIRouter(prefix="/api/export", tags=["export"], redirect_slashes=False)


def _serialize_value(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, date):
        return val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")
    return val


def _relation_column_name(attr: Any) -> str:
    col = attr.columns[0] if getattr(attr, "columns", None) else getattr(attr, "column", None)
    if isinstance(col, str):
        return col
    if col is not None and hasattr(col, "name"):
        return str(col.name)
    fk = getattr(attr, "column", None)
    if isinstance(fk, str):
        return fk
    return f"{attr.name}_id"


def _entity_to_dict(entity: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for attr in entity._attrs_:
        if attr.is_collection:
            continue
        if attr.is_relation:
            col_name = _relation_column_name(attr)
            val = getattr(entity, col_name, None)
            if val is None:
                related = getattr(entity, attr.name, None)
                if related is not None and hasattr(related, "id"):
                    val = related.id
            result[col_name] = _serialize_value(val)
            continue
        result[attr.name] = _serialize_value(getattr(entity, attr.name))
    return result


def _rows_for_user(model: type, user_id: int) -> list[Any]:
    return [row for row in list(model.select()) if int(row.user_id) == user_id]


@db_session
def build_full_export_payload(user_id: int) -> dict[str, Any]:
    sequences = _rows_for_user(StorySequence, user_id)
    sequence_ids = {int(seq.id) for seq in sequences}
    slides = [
        slide
        for slide in list(StorySlide.select())
        if int(slide.sequence.id) in sequence_ids
    ]

    return {
        "exported_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds"),
        "user_id": user_id,
        "leads": [_entity_to_dict(row) for row in _rows_for_user(Lead, user_id)],
        "setter_reports": [_entity_to_dict(row) for row in _rows_for_user(SetterReport, user_id)],
        "closer_reports": [_entity_to_dict(row) for row in _rows_for_user(CloserReport, user_id)],
        "teammembers": [_entity_to_dict(row) for row in _rows_for_user(TeamMember, user_id)],
        "seguimiento_reports": [_entity_to_dict(row) for row in _rows_for_user(SeguimientoReport, user_id)],
        "offered_programs": [_entity_to_dict(row) for row in _rows_for_user(OfferedProgram, user_id)],
        "story_sequences": [_entity_to_dict(row) for row in sequences],
        "story_slides": [_entity_to_dict(row) for row in slides],
        "reel_content": [_entity_to_dict(row) for row in _rows_for_user(ReelContent, user_id)],
        "master_lists": [_entity_to_dict(row) for row in _rows_for_user(MasterList, user_id)],
    }


@router.get("/full")
def export_full(user_id: Annotated[int, Depends(get_current_user_id)]) -> Response:
    payload = build_full_export_payload(user_id)
    stamp = date.today().isoformat()
    filename = f"atv-backup-{stamp}.json"
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
