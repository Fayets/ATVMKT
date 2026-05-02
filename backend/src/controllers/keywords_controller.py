"""Vista Keyword: leads con nombre, IG, reel vinculado por keyword y la keyword."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pony.orm import db_session

from src.lead_display_utils import lead_display_nombre
from src.models import Lead as LeadEntity
from src.models import ReelContent
from src.schemas import KeywordClientRow, KeywordsListResponse

router = APIRouter(prefix="/api/keywords", tags=["keywords"], redirect_slashes=False)


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _norm_key(s: str) -> str:
    return s.strip().lower()


def _lead_tokens(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    return [t.strip() for t in str(raw).split(",") if t.strip()]


def _reel_published_date_iso(matched: ReelContent | None) -> str | None:
    if matched is None or matched.fecha_publicacion is None:
        return None
    d = matched.fecha_publicacion
    if d.tzinfo is not None:
        d = d.replace(tzinfo=None)
    return d.date().isoformat()


def _lead_sort_ts(lead: LeadEntity) -> float:
    c = lead.created_at
    if c is None:
        return 0.0
    if c.tzinfo is not None:
        c = c.replace(tzinfo=None)
    return float(c.timestamp())


@router.get("", response_model=KeywordsListResponse)
def list_keywords(user_id: Annotated[str, Depends(require_user_id)]) -> KeywordsListResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    with db_session:
        reels = [r for r in list(ReelContent.select()) if int(r.user_id) == uid]
        leads = [r for r in list(LeadEntity.select()) if int(r.user_id) == uid]

    reel_by_kw: dict[str, ReelContent] = {}
    for reel in reels:
        kw = (reel.keyword or "").strip()
        if not kw:
            continue
        k = _norm_key(kw)
        if k not in reel_by_kw:
            reel_by_kw[k] = reel

    staged: list[tuple[float, int, str, KeywordClientRow]] = []
    for lead in leads:
        tokens = _lead_tokens(lead.keyword)
        if not tokens:
            continue
        ts = _lead_sort_ts(lead)
        lid = int(lead.id)
        for tok in tokens:
            k = _norm_key(tok)
            matched = reel_by_kw.get(k)
            permalink = None
            pub_iso: str | None = None
            if matched is not None:
                p = (matched.permalink or "").strip()
                permalink = p or None
                pub_iso = _reel_published_date_iso(matched)
            staged.append(
                (
                    -ts,
                    lid,
                    tok.lower(),
                    KeywordClientRow(
                        lead_id=str(lead.id),
                        nombre=lead_display_nombre(lead.nombre, lead.ig),
                        instagram=(lead.ig or "").strip(),
                        reel_permalink=permalink,
                        reel_published_at=pub_iso,
                        keyword=tok,
                    ),
                )
            )

    staged.sort(key=lambda x: (x[0], x[1], x[2]))
    rows = [s[3] for s in staged]
    return KeywordsListResponse(rows=rows, total=len(rows))
