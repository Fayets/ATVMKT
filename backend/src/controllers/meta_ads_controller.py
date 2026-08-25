"""Meta Ads: sync de campañas vía Marketing API (credenciales en ApiConnection)."""

from __future__ import annotations

import calendar
import logging
import re
from datetime import date, datetime, timezone
from typing import Annotated, Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import db_session

from src.controllers.leads_controller import _lead_month_ar
from src.models import AdsCampaign, ApiConnection, Lead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meta-ads", tags=["meta-ads"], redirect_slashes=False)

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
META_ADS_JOB_ID = "auto_sync_meta_ads"
META_ADS_AUTO_INTERVAL_MINUTES = 60
_GRAPH_VERSION = "v19.0"
_GRAPH_BASE = f"https://graph.facebook.com/{_GRAPH_VERSION}"
_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
_CAMPAIGN_EFFECTIVE_STATUSES = '["ACTIVE","PAUSED","ARCHIVED"]'
_INSIGHT_FIELDS = "spend,impressions,clicks,actions,cost_per_action_type,reach"
_LEAD_ACTION_TYPES = frozenset({"lead", "offsite_conversion.fb_pixel_lead"})
_PAGE_LIMIT = 100
_MAX_PAGES = 50
_HTTP_TIMEOUT = 60.0


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _uid_int(user_id: str) -> int:
    try:
        return int(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.")


def _parse_month(month: str | None) -> tuple[int, int]:
    now_ar = datetime.now(timezone.utc).astimezone(AR_TZ)
    if not month or not str(month).strip():
        return now_ar.year, now_ar.month
    raw = str(month).strip()
    m = _MONTH_RE.fullmatch(raw)
    if not m:
        raise HTTPException(status_code=400, detail="month debe ser YYYY-MM.")
    year, month_n = int(m.group(1)), int(m.group(2))
    if month_n < 1 or month_n > 12:
        raise HTTPException(status_code=400, detail="month debe ser YYYY-MM.")
    return year, month_n


def _month_bounds(year: int, month_n: int) -> tuple[date, date]:
    last_day = calendar.monthrange(year, month_n)[1]
    return date(year, month_n, 1), date(year, month_n, last_day)


def _normalize_ad_account_id(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return s
    if s.lower().startswith("act_"):
        return s
    return f"act_{s}"


def _load_creds(uid: int) -> tuple[str, str]:
    with db_session:
        conn = ApiConnection.get(user_id=uid, platform="meta_ads")
        if conn is None:
            raise HTTPException(
                status_code=400,
                detail='No hay conexión Meta Ads. Configurá la plataforma "meta_ads" en Conexiones API.',
            )
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        token = str(creds.get("access_token") or "").strip()
        ad_account_id = _normalize_ad_account_id(str(creds.get("ad_account_id") or ""))
        if not token or not ad_account_id:
            raise HTTPException(
                status_code=400,
                detail="Faltan access_token o ad_account_id en la conexión Meta Ads.",
            )
        return token, ad_account_id


def _metric_float(val: Any) -> float:
    if val is None or val == "":
        return 0.0
    if isinstance(val, bool):
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val.replace(",", ".").strip())
        except ValueError:
            return 0.0
    if isinstance(val, list):
        total = 0.0
        for item in val:
            if isinstance(item, dict):
                total += _metric_float(item.get("value"))
            else:
                total += _metric_float(item)
        return total
    if isinstance(val, dict):
        return _metric_float(val.get("value"))
    return 0.0


def _metric_int(val: Any) -> int:
    return int(round(_metric_float(val)))


def _insight_row(campaign: dict[str, Any]) -> dict[str, Any]:
    insights = campaign.get("insights")
    if isinstance(insights, dict):
        data = insights.get("data")
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return data[0]
        if any(k in insights for k in ("spend", "impressions", "clicks", "reach")):
            return insights
    return {}


def _action_value_for_leads(rows: Any) -> float:
    if not isinstance(rows, list):
        return 0.0
    total = 0.0
    for item in rows:
        if not isinstance(item, dict):
            continue
        action_type = str(item.get("action_type") or "").lower()
        if action_type in _LEAD_ACTION_TYPES:
            total += _metric_float(item.get("value"))
    return total


def _parse_conversions(insight: dict[str, Any]) -> int:
    return int(round(_action_value_for_leads(insight.get("actions"))))


def _parse_cost_per_conversion(insight: dict[str, Any], spend: float, conversions: int) -> float:
    lead_cpa = _action_value_for_leads(insight.get("cost_per_action_type"))
    if lead_cpa:
        return lead_cpa
    if conversions > 0 and spend > 0:
        return spend / conversions
    return 0.0


def _graph_error_detail(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            msg = str(err.get("message") or "").strip()
            if msg:
                return msg
        if payload.get("detail"):
            return str(payload["detail"])
    return fallback


def _graph_get(client: httpx.Client, url: str, params: dict[str, Any] | None) -> dict[str, Any]:
    safe_params = {k: v for k, v in (params or {}).items() if k != "access_token"}
    logger.error("[meta-ads] URL: %s", url)
    logger.error("[meta-ads] Params: %s", safe_params)
    try:
        resp = client.get(url, params=params)
    except httpx.HTTPError as exc:
        logger.error("[meta-ads] Request failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo contactar Meta Ads API: {exc}",
        ) from exc
    payload = resp.json() if resp.content else {}
    if not isinstance(payload, dict):
        payload = {}
    if resp.status_code >= 400:
        logger.error("[meta-ads] Response status: %s", resp.status_code)
        logger.error("[meta-ads] Response body: %s", resp.text)
        detail = _graph_error_detail(payload, f"Meta Ads API respondió {resp.status_code}.")
        print(f"[meta-ads] Graph error {resp.status_code}: {detail}")
        raise HTTPException(status_code=502, detail=detail)
    return payload


def _list_campaigns(client: httpx.Client, ad_account_id: str, token: str) -> list[dict[str, Any]]:
    url: str | None = f"{_GRAPH_BASE}/{ad_account_id}/campaigns"
    params: dict[str, Any] | None = {
        "fields": "id,name,status,effective_status",
        "effective_status": _CAMPAIGN_EFFECTIVE_STATUSES,
        "access_token": token,
        "limit": _PAGE_LIMIT,
    }
    out: list[dict[str, Any]] = []
    pages = 0
    while url and pages < _MAX_PAGES:
        pages += 1
        payload = _graph_get(client, url, params)
        data = payload.get("data")
        if isinstance(data, list):
            out.extend(item for item in data if isinstance(item, dict))
        paging = payload.get("paging")
        next_url = None
        if isinstance(paging, dict):
            next_url = str(paging.get("next") or "").strip() or None
        url = next_url
        params = None
    return out


def _insights_params(token: str, period_start: date, period_end: date) -> dict[str, Any]:
    now_ar = datetime.now(timezone.utc).astimezone(AR_TZ)
    is_current_month = period_start.year == now_ar.year and period_start.month == now_ar.month
    params: dict[str, Any] = {
        "fields": _INSIGHT_FIELDS,
        "access_token": token,
    }
    if is_current_month:
        params["date_preset"] = "this_month"
    else:
        params["time_range"] = (
            f'{{"since":"{period_start.isoformat()}","until":"{period_end.isoformat()}"}}'
        )
    return params


def _fetch_campaign_insights(
    client: httpx.Client,
    campaign_id: str,
    token: str,
    period_start: date,
    period_end: date,
) -> dict[str, Any]:
    url = f"{_GRAPH_BASE}/{campaign_id}/insights"
    try:
        payload = _graph_get(client, url, _insights_params(token, period_start, period_end))
    except HTTPException as exc:
        print(f"[meta-ads] insights skip campaign={campaign_id}: {exc.detail}")
        return {}
    data = payload.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return {}


def _fetch_campaigns(
    token: str,
    ad_account_id: str,
    period_start: date,
    period_end: date,
) -> list[dict[str, Any]]:
    with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
        campaigns = _list_campaigns(client, ad_account_id, token)
        for campaign in campaigns:
            campaign_id = str(campaign.get("id") or "").strip()
            if not campaign_id:
                continue
            insight = _fetch_campaign_insights(
                client, campaign_id, token, period_start, period_end
            )
            campaign["insights"] = {"data": [insight] if insight else []}
        return campaigns


def _upsert_campaigns(
    uid: int,
    campaigns: list[dict[str, Any]],
    period_start: date,
    period_end: date,
) -> dict[str, int]:
    now = datetime.utcnow()
    created = 0
    updated = 0
    with db_session:
        for campaign in campaigns:
            campaign_id = str(campaign.get("id") or "").strip()
            if not campaign_id:
                continue
            insight = _insight_row(campaign)
            spend = _metric_float(insight.get("spend"))
            impressions = _metric_int(insight.get("impressions"))
            clicks = _metric_int(insight.get("clicks"))
            conversions = _parse_conversions(insight)
            cost_per_conversion = _parse_cost_per_conversion(insight, spend, conversions)
            reach = _metric_int(insight.get("reach"))
            nombre = str(campaign.get("name") or "").strip()
            estado = str(
                campaign.get("effective_status") or campaign.get("status") or ""
            ).strip()

            row = AdsCampaign.get(
                user_id=uid, campaign_id=campaign_id, period_start=period_start
            )
            if row is None:
                AdsCampaign(
                    user_id=uid,
                    campaign_id=campaign_id,
                    nombre=nombre,
                    estado=estado,
                    spend=spend,
                    impressions=impressions,
                    clicks=clicks,
                    conversions=conversions,
                    cost_per_conversion=cost_per_conversion,
                    reach=reach,
                    period_start=period_start,
                    period_end=period_end,
                    fecha_sync=now,
                )
                created += 1
            else:
                row.nombre = nombre
                row.estado = estado
                row.spend = spend
                row.impressions = impressions
                row.clicks = clicks
                row.conversions = conversions
                row.cost_per_conversion = cost_per_conversion
                row.reach = reach
                row.period_end = period_end
                row.fecha_sync = now
                updated += 1

        conn = ApiConnection.get(user_id=uid, platform="meta_ads")
        if conn is not None:
            conn.last_sync_at = now
            conn.updated_at = now
    return {"created": created, "updated": updated, "campaigns": len(campaigns)}


def _run_meta_ads_sync(uid: int, month: str | None = None) -> dict[str, Any]:
    year, month_n = _parse_month(month)
    period_start, period_end = _month_bounds(year, month_n)
    token, ad_account_id = _load_creds(uid)
    campaigns = _fetch_campaigns(token, ad_account_id, period_start, period_end)
    stats = _upsert_campaigns(uid, campaigns, period_start, period_end)
    return {
        "month": f"{year:04d}-{month_n:02d}",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        **stats,
    }


def run_meta_ads_auto_sync_for_user(uid: int) -> dict[str, Any]:
    try:
        result = _run_meta_ads_sync(uid)
    except HTTPException as exc:
        return {"user_id": uid, "skipped": True, "reason": str(exc.detail)}
    return {"user_id": uid, "skipped": False, "sync": result}


def list_meta_ads_user_ids_with_creds() -> list[int]:
    with db_session:
        rows = list(
            ApiConnection.select_by_sql(
                "SELECT * FROM apiconnection WHERE platform = $platform",
                {"platform": "meta_ads"},
            )
        )
        out: list[int] = []
        for row in rows:
            creds = row.credentials if isinstance(row.credentials, dict) else {}
            token = str(creds.get("access_token") or "").strip()
            ad_account_id = str(creds.get("ad_account_id") or "").strip()
            if token and ad_account_id:
                out.append(int(row.user_id))
        return out


def _ads_revenue_for_month(uid: int, year: int, month_n: int) -> float:
    total = 0.0
    leads = [r for r in list(Lead.select()) if int(r.user_id) == uid]
    for row in leads:
        if not bool(getattr(row, "vino_de_ads", False)):
            continue
        mb = _lead_month_ar(row)
        if mb != (year, month_n):
            continue
        total += float(row.pago or 0)
    return total


@router.get("/sync-status")
def meta_ads_sync_status(
    user_id: Annotated[str, Depends(require_user_id)],
):
    uid = _uid_int(user_id)
    with db_session:
        conn = ApiConnection.get(user_id=uid, platform="meta_ads")
        if conn is None:
            raise HTTPException(
                status_code=400,
                detail='No hay conexión Meta Ads. Configurá la plataforma "meta_ads" en Conexiones API.',
            )
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        last_sync = conn.last_sync_at
        token = str(creds.get("access_token") or "").strip()
        ad_account_id = str(creds.get("ad_account_id") or "").strip()
        enabled = bool(token and ad_account_id)

    next_run: str | None = None
    try:
        from src.services.sync_scheduler_service import next_job_run_time

        nxt = next_job_run_time(META_ADS_JOB_ID)
        if nxt is not None:
            next_run = nxt.isoformat()
    except Exception:
        next_run = None

    return {
        "enabled": enabled,
        "interval_minutes": META_ADS_AUTO_INTERVAL_MINUTES,
        "last_sync_at": last_sync.isoformat() + "Z" if last_sync else None,
        "next_run_at": next_run,
    }


@router.post("/sync")
def sync_meta_ads(
    user_id: Annotated[str, Depends(require_user_id)],
    month: Annotated[str | None, Query()] = None,
):
    uid = _uid_int(user_id)
    return _run_meta_ads_sync(uid, month)


@router.get("/campaigns")
def list_meta_ads_campaigns(
    user_id: Annotated[str, Depends(require_user_id)],
    month: Annotated[str | None, Query()] = None,
):
    uid = _uid_int(user_id)
    year, month_n = _parse_month(month)
    period_start, period_end = _month_bounds(year, month_n)
    with db_session:
        conn = ApiConnection.get(user_id=uid, platform="meta_ads")
        last_sync = conn.last_sync_at if conn is not None else None
        ads_revenue = _ads_revenue_for_month(uid, year, month_n)
        rows = [
            r
            for r in list(AdsCampaign.select())
            if int(r.user_id) == uid and r.period_start == period_start
        ]
        rows.sort(key=lambda r: (-float(r.spend or 0), (r.nombre or "").lower()))
        campaigns = []
        for r in rows:
            spend = float(r.spend or 0)
            roas = (ads_revenue / spend) if spend > 0 else None
            campaigns.append(
                {
                    "id": r.id,
                    "campaign_id": r.campaign_id,
                    "nombre": r.nombre or "",
                    "estado": r.estado or "",
                    "spend": spend,
                    "impressions": int(r.impressions or 0),
                    "clicks": int(r.clicks or 0),
                    "conversions": int(r.conversions or 0),
                    "cost_per_conversion": float(r.cost_per_conversion or 0),
                    "reach": int(r.reach or 0),
                    "period_start": r.period_start.isoformat() if r.period_start else None,
                    "period_end": r.period_end.isoformat() if r.period_end else None,
                    "fecha_sync": r.fecha_sync.isoformat() + "Z" if r.fecha_sync else None,
                    "roas": roas,
                }
            )

    total_spend = sum(c["spend"] for c in campaigns)
    return {
        "month": f"{year:04d}-{month_n:02d}",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "ads_revenue": ads_revenue,
        "total_spend": total_spend,
        "roas": (ads_revenue / total_spend) if total_spend > 0 else None,
        "last_sync_at": last_sync.isoformat() + "Z" if last_sync else None,
        "campaigns": campaigns,
    }
