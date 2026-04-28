import json
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pony.orm import db_session

from src.db import db
from src.models import ReelContent, StorySequence
from src.schemas import MasterListsResponse, MasterListUpsertRequest

router = APIRouter(prefix="/api/master-lists", tags=["master-lists"], redirect_slashes=False)
VALID_CATEGORIES = {"dolores", "angulos", "ctas"}


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _sanitize_items(items: list[str]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in items:
        value = str(raw or "").strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(value)
    return cleaned


def _normalize_items(value: object) -> list[str]:
    if isinstance(value, list):
        return _sanitize_items([str(x) for x in value])
    if isinstance(value, tuple):
        return _sanitize_items([str(x) for x in value])
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        if raw.startswith("[") and raw.endswith("]"):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return _sanitize_items([str(x) for x in parsed])
            except Exception:
                pass
        return _sanitize_items([raw])
    return []


def _infer_from_existing_content(user_id: str) -> dict[str, list[str]]:
    dolores: list[str] = []
    angulos: list[str] = []
    ctas: list[str] = []

    def push_unique(target: list[str], value: str | None) -> None:
        v = (value or "").strip()
        if not v:
            return
        if v.lower() in {x.lower() for x in target}:
            return
        target.append(v)

    # Historias (secuencia + slides)
    for seq in StorySequence.select(lambda s: s.user.id == user_id):
        push_unique(dolores, seq.dolor)
        push_unique(angulos, seq.angulo)
        push_unique(ctas, seq.cta_text)
        for slide in seq.slides:
            push_unique(dolores, slide.dolor)
            push_unique(angulos, slide.angulo)
            push_unique(ctas, slide.cta_text)

    # Reels (classification JSON)
    for reel in ReelContent.select(lambda r: r.user_id == user_id):
        cls = reel.classification or {}
        push_unique(dolores, str(cls.get("dolor") or ""))
        push_unique(ctas, str(cls.get("cta") or ""))
        reel_angulos = cls.get("angulos")
        if isinstance(reel_angulos, list):
            for a in reel_angulos:
                push_unique(angulos, str(a))

    return {
        "dolores": dolores,
        "angulos": angulos,
        "ctas": ctas,
    }


def _read_masterlist_sql(user_id: str) -> dict[str, list[str]]:
    result = {"dolores": [], "angulos": [], "ctas": []}
    raw_conn = db.get_connection()
    cur = raw_conn.cursor()
    cur.execute(
        'SELECT category, items FROM "masterlist" WHERE user_id = %s',
        [user_id],
    )
    for category, items in cur.fetchall():
        key = str(category or "").strip()
        if key in result:
            result[key] = _normalize_items(items)
    cur.close()
    return result


def _upsert_masterlist_sql(user_id: str, category: str, items: list[str]) -> None:
    raw_conn = db.get_connection()
    cur = raw_conn.cursor()
    if not items:
        cur.execute(
            'DELETE FROM "masterlist" WHERE user_id = %s AND category = %s',
            [user_id, category],
        )
        cur.close()
        return

    payload = json.dumps(items)
    cur.execute(
        '''
        INSERT INTO "masterlist" (id, user_id, category, items, created_at, updated_at)
        VALUES (gen_random_uuid()::text, %s, %s, %s::jsonb, NOW(), NOW())
        ON CONFLICT (user_id, category)
        DO UPDATE SET items = EXCLUDED.items, updated_at = NOW()
        ''',
        [user_id, category, payload],
    )
    cur.close()


@router.get("", response_model=MasterListsResponse)
def list_master_lists(user_id: Annotated[str, Depends(require_user_id)]) -> MasterListsResponse:
    with db_session:
        result = _read_masterlist_sql(user_id)

        # Si el usuario todavía no cargó listas maestras, inicializamos desde
        # contenido existente (historias/reels) para que la vista muestre lo ya cargado.
        if not any(result.values()):
            inferred = _infer_from_existing_content(user_id)
            result = inferred
            for category, items in inferred.items():
                if not items:
                    continue
                _upsert_masterlist_sql(user_id, category, items)
        return MasterListsResponse(**result)


@router.put("/{category}", response_model=MasterListsResponse)
def upsert_master_list(
    category: str,
    body: MasterListUpsertRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> MasterListsResponse:
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoria invalida. Usa: dolores, angulos o ctas.")

    cleaned_items = _sanitize_items(body.items)

    with db_session:
        _upsert_masterlist_sql(user_id, category, cleaned_items)

    return list_master_lists(user_id)
