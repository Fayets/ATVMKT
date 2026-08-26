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
# Conversión atribuible por Meta. Cuál es el evento correcto depende del objetivo:
# - Campañas de "Tráfico" hacia Follow Me Ads / DM (el modelo de ATV): no hay pixel ni
#   landing, el único evento real es la conversación de DM iniciada.
# - Campañas de Ventas / Clientes potenciales: el evento real es el lead del pixel.
# Nunca se suman: una campaña con pixel Y mensajería daría un número sin sentido.
_PIXEL_LEAD_ACTION_TYPES = frozenset({"lead", "offsite_conversion.fb_pixel_lead"})
_MESSAGING_ACTION_TYPES = frozenset({"onsite_conversion.messaging_conversation_started_7d"})
# Objetivos en los que el pixel es la fuente de verdad; el resto usa mensajería.
_CONVERSION_OBJECTIVES = frozenset(
    {
        "OUTCOME_SALES",
        "OUTCOME_LEADS",
        "CONVERSIONS",
        "LEAD_GENERATION",
        "PRODUCT_CATALOG_SALES",
    }
)
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


def _action_value_for(rows: Any, action_types: frozenset[str]) -> float:
    if not isinstance(rows, list):
        return 0.0
    total = 0.0
    for item in rows:
        if not isinstance(item, dict):
            continue
        action_type = str(item.get("action_type") or "").lower()
        if action_type in action_types:
            total += _metric_float(item.get("value"))
    return total


def _conversion_action_types(objective: str | None) -> frozenset[str]:
    """Evento que cuenta como conversión para este objetivo (pixel vs mensajería)."""
    if str(objective or "").strip().upper() in _CONVERSION_OBJECTIVES:
        return _PIXEL_LEAD_ACTION_TYPES
    return _MESSAGING_ACTION_TYPES


def _action_value_for_leads(rows: Any, objective: str | None = None) -> float:
    """Cae al otro tipo de evento si el preferido no entregó nada."""
    preferred = _conversion_action_types(objective)
    value = _action_value_for(rows, preferred)
    if value:
        return value
    fallback = (
        _MESSAGING_ACTION_TYPES
        if preferred is _PIXEL_LEAD_ACTION_TYPES
        else _PIXEL_LEAD_ACTION_TYPES
    )
    return _action_value_for(rows, fallback)


def _parse_conversions(insight: dict[str, Any], objective: str | None = None) -> int:
    return int(round(_action_value_for_leads(insight.get("actions"), objective)))


def _parse_cost_per_conversion(
    insight: dict[str, Any],
    spend: float,
    conversions: int,
    objective: str | None = None,
) -> float:
    lead_cpa = _action_value_for_leads(insight.get("cost_per_action_type"), objective)
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


def _is_ads_permission_error(detail: str) -> bool:
    low = (detail or "").casefold()
    return (
        "ads_read" in low
        or "ads_management" in low
        or "not grant" in low
        or "(#200)" in low
    )


def _graph_get(
    client: httpx.Client,
    url: str,
    params: dict[str, Any] | None,
    *,
    raise_http: bool = True,
) -> tuple[int, dict[str, Any]]:
    safe_params = {k: v for k, v in (params or {}).items() if k != "access_token"}
    logger.info("[meta-ads] URL: %s params=%s", url, safe_params)
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
        detail = _graph_error_detail(payload, f"Meta Ads API respondió {resp.status_code}.")
        print(f"[meta-ads] Graph error {resp.status_code}: {detail}")
        if raise_http:
            raise HTTPException(status_code=502, detail=detail)
    return resp.status_code, payload


def _list_accessible_ad_accounts(client: httpx.Client, token: str) -> list[dict[str, str]]:
    status, payload = _graph_get(
        client,
        f"{_GRAPH_BASE}/me/adaccounts",
        {
            "fields": "id,account_id,name,account_status",
            "limit": 50,
            "access_token": token,
        },
        raise_http=False,
    )
    if status >= 400:
        return []
    out: list[dict[str, str]] = []
    data = payload.get("data")
    if not isinstance(data, list):
        return out
    for item in data:
        if not isinstance(item, dict):
            continue
        aid = str(item.get("id") or "").strip()
        if not aid:
            continue
        out.append(
            {
                "id": aid,
                "account_id": str(item.get("account_id") or "").strip(),
                "name": str(item.get("name") or "").strip(),
                "account_status": str(item.get("account_status") or "").strip(),
            }
        )
    return out


def _token_granted_permissions(client: httpx.Client, token: str) -> list[str]:
    status, payload = _graph_get(
        client,
        f"{_GRAPH_BASE}/me/permissions",
        {"access_token": token},
        raise_http=False,
    )
    if status >= 400:
        return []
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    granted: list[str] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        if str(item.get("status") or "").lower() != "granted":
            continue
        perm = str(item.get("permission") or "").strip()
        if perm:
            granted.append(perm)
    return granted


def _permission_help_detail(
    client: httpx.Client,
    token: str,
    ad_account_id: str,
    base_detail: str,
) -> str:
    granted = _token_granted_permissions(client, token)
    accounts = _list_accessible_ad_accounts(client, token)
    account_ids = {a["id"] for a in accounts}
    lines = [base_detail.strip()]
    if granted:
        ads_ok = "ads_read" in granted or "ads_management" in granted
        lines.append(
            "Permisos del token: "
            + (", ".join(granted) if granted else "(ninguno)")
            + ("." if ads_ok else ". Falta ads_read o ads_management.")
        )
    else:
        lines.append(
            "No se pudieron leer los permisos del token. Generá uno nuevo en Meta for Developers "
            "con ads_read (o ads_management) y asegurate de que el usuario sea admin de la cuenta publicitaria."
        )
    if accounts:
        if ad_account_id in account_ids:
            lines.append(
                f"La cuenta {ad_account_id} aparece en /me/adaccounts, pero Graph rechazó leer campañas. "
                "Revisá que la app tenga Marketing API y acceso avanzado a ads_read si no estás en modo desarrollo."
            )
        else:
            listed = ", ".join(
                f'{a["id"]}' + (f' ({a["name"]})' if a.get("name") else "") for a in accounts[:8]
            )
            lines.append(
                f"La cuenta configurada ({ad_account_id}) no está entre las accesibles con este token. "
                f"Cuentas disponibles: {listed}."
            )
    else:
        lines.append(
            "Este token no lista ninguna ad account. Suele pasar si pegaste un token de Instagram "
            "o uno sin permiso de ads. Usá un User/System token con ads_read sobre esa cuenta."
        )
    return " ".join(lines)


def _list_campaigns(client: httpx.Client, ad_account_id: str, token: str) -> list[dict[str, Any]]:
    def _paginate(with_status_filter: bool) -> list[dict[str, Any]]:
        url: str | None = f"{_GRAPH_BASE}/{ad_account_id}/campaigns"
        params: dict[str, Any] | None = {
            "fields": "id,name,status,effective_status,objective",
            "access_token": token,
            "limit": _PAGE_LIMIT,
        }
        if with_status_filter:
            params["effective_status"] = _CAMPAIGN_EFFECTIVE_STATUSES
        out: list[dict[str, Any]] = []
        pages = 0
        while url and pages < _MAX_PAGES:
            pages += 1
            _status, payload = _graph_get(client, url, params)
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

    try:
        return _paginate(with_status_filter=True)
    except HTTPException as exc:
        detail = str(exc.detail or "")
        if _is_ads_permission_error(detail):
            raise HTTPException(
                status_code=502,
                detail=_permission_help_detail(client, token, ad_account_id, detail),
            ) from exc
        # Algunos tokens fallan el filtro effective_status: reintentar sin filtro.
        try:
            return _paginate(with_status_filter=False)
        except HTTPException as exc2:
            detail2 = str(exc2.detail or "")
            if _is_ads_permission_error(detail2):
                raise HTTPException(
                    status_code=502,
                    detail=_permission_help_detail(client, token, ad_account_id, detail2),
                ) from exc2
            raise


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
        _status, payload = _graph_get(client, url, _insights_params(token, period_start, period_end))
    except HTTPException as exc:
        print(f"[meta-ads] insights skip campaign={campaign_id}: {exc.detail}")
        return {}
    data = payload.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return {}


def _resolve_ad_account_id(client: httpx.Client, token: str, configured: str) -> str:
    """Resuelve la ad account accesible más cercana a la configurada."""
    accounts = _list_accessible_ad_accounts(client, token)
    if not accounts:
        return configured
    ids = {a["id"] for a in accounts}
    if configured in ids:
        return configured

    bare = configured.replace("act_", "").strip()
    for a in accounts:
        if a["id"].replace("act_", "") == bare or a.get("account_id") == bare:
            return a["id"]

    # Typo frecuente: ID truncado / dígito de más — si hay un único match por prefijo, usarlo.
    prefix_hits = [
        a
        for a in accounts
        if a["id"].startswith(configured)
        or a.get("account_id", "").startswith(bare)
        or (bare and configured.startswith(a["id"]))
        or (bare and bare.startswith(a.get("account_id") or ""))
    ]
    # Preferir cuentas cuyo id empieza con lo configurado (ID incompleto).
    starts_with = [a for a in accounts if a["id"].startswith(configured) or a.get("account_id", "").startswith(bare)]
    if len(starts_with) == 1:
        only = starts_with[0]["id"]
        print(f"[meta-ads] ad_account_id {configured} → {only} (match por prefijo)")
        return only
    if len(prefix_hits) == 1:
        only = prefix_hits[0]["id"]
        print(f"[meta-ads] ad_account_id {configured} → {only} (match aproximado)")
        return only

    if len(accounts) == 1:
        only = accounts[0]["id"]
        print(f"[meta-ads] ad_account_id {configured} inaccesible; usando {only}")
        return only
    return configured


def _creative_thumbnail(creative: Any) -> str:
    if not isinstance(creative, dict):
        return ""
    for key in ("thumbnail_url", "image_url"):
        raw = str(creative.get(key) or "").strip()
        if raw.startswith(("http://", "https://")):
            return raw
    return ""


def _fetch_campaign_thumbnails(
    client: httpx.Client,
    ad_account_id: str,
    token: str,
) -> dict[str, str]:
    """Primera miniatura de creative por campaign_id (vía /ads de la cuenta)."""
    url: str | None = f"{_GRAPH_BASE}/{ad_account_id}/ads"
    params: dict[str, Any] | None = {
        "fields": "campaign_id,creative{thumbnail_url,image_url}",
        "limit": _PAGE_LIMIT,
        "access_token": token,
    }
    thumbs: dict[str, str] = {}
    pages = 0
    while url and pages < _MAX_PAGES:
        pages += 1
        status, payload = _graph_get(client, url, params, raise_http=False)
        if status >= 400:
            detail = _graph_error_detail(payload, f"Meta Ads ads list {status}")
            print(f"[meta-ads] thumbs skip: {detail}")
            break
        data = payload.get("data")
        if isinstance(data, list):
            for ad in data:
                if not isinstance(ad, dict):
                    continue
                cid = str(ad.get("campaign_id") or "").strip()
                if not cid or cid in thumbs:
                    continue
                thumb = _creative_thumbnail(ad.get("creative"))
                if thumb:
                    thumbs[cid] = thumb
        paging = payload.get("paging")
        next_url = None
        if isinstance(paging, dict):
            next_url = str(paging.get("next") or "").strip() or None
        url = next_url
        params = None
    return thumbs


def _fetch_campaigns(
    token: str,
    ad_account_id: str,
    period_start: date,
    period_end: date,
) -> tuple[list[dict[str, Any]], str]:
    with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
        resolved = _resolve_ad_account_id(client, token, ad_account_id)
        campaigns = _list_campaigns(client, resolved, token)
        thumbs = _fetch_campaign_thumbnails(client, resolved, token)
        for campaign in campaigns:
            campaign_id = str(campaign.get("id") or "").strip()
            if not campaign_id:
                continue
            insight = _fetch_campaign_insights(
                client, campaign_id, token, period_start, period_end
            )
            campaign["insights"] = {"data": [insight] if insight else []}
            if campaign_id in thumbs:
                campaign["thumbnail_url"] = thumbs[campaign_id]
        return campaigns, resolved


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
            reach = _metric_int(insight.get("reach"))
            nombre = str(campaign.get("name") or "").strip()
            estado = str(
                campaign.get("effective_status") or campaign.get("status") or ""
            ).strip()
            objective = str(campaign.get("objective") or "").strip()
            conversions = _parse_conversions(insight, objective)
            cost_per_conversion = _parse_cost_per_conversion(
                insight, spend, conversions, objective
            )
            thumbnail_url = str(campaign.get("thumbnail_url") or "").strip()

            row = AdsCampaign.get(
                user_id=uid, campaign_id=campaign_id, period_start=period_start
            )
            if row is None:
                AdsCampaign(
                    user_id=uid,
                    campaign_id=campaign_id,
                    nombre=nombre,
                    estado=estado,
                    objective=objective,
                    thumbnail_url=thumbnail_url,
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
                row.objective = objective
                if thumbnail_url:
                    row.thumbnail_url = thumbnail_url
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
    campaigns, resolved_account = _fetch_campaigns(
        token, ad_account_id, period_start, period_end
    )
    if resolved_account != ad_account_id:
        with db_session:
            conn = ApiConnection.get(user_id=uid, platform="meta_ads")
            if conn is not None:
                creds = dict(conn.credentials) if isinstance(conn.credentials, dict) else {}
                creds["ad_account_id"] = resolved_account
                conn.credentials = creds
                conn.updated_at = datetime.utcnow()
    stats = _upsert_campaigns(uid, campaigns, period_start, period_end)
    return {
        "month": f"{year:04d}-{month_n:02d}",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "ad_account_id": resolved_account,
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


@router.get("/verify")
def verify_meta_ads_connection(
    user_id: Annotated[str, Depends(require_user_id)],
):
    """Prueba token + ad account sin persistir campañas."""
    uid = _uid_int(user_id)
    token, ad_account_id = _load_creds(uid)
    steps: list[dict[str, Any]] = []
    with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
        status, me = _graph_get(
            client,
            f"{_GRAPH_BASE}/me",
            {"fields": "id,name", "access_token": token},
            raise_http=False,
        )
        if status >= 400:
            detail = _graph_error_detail(me, "Token inválido o expirado.")
            steps.append({"step": "token", "ok": False, "detail": detail})
            return {"ok": False, "ad_account_id": ad_account_id, "steps": steps}
        steps.append(
            {
                "step": "token",
                "ok": True,
                "detail": f"OK — {me.get('name') or me.get('id') or 'usuario'}",
            }
        )

        granted = _token_granted_permissions(client, token)
        ads_ok = "ads_read" in granted or "ads_management" in granted
        steps.append(
            {
                "step": "permisos",
                "ok": ads_ok,
                "detail": (
                    ", ".join(granted)
                    if granted
                    else "Sin permisos legibles"
                )
                + ("" if ads_ok else " — falta ads_read o ads_management"),
            }
        )

        accounts = _list_accessible_ad_accounts(client, token)
        resolved = _resolve_ad_account_id(client, token, ad_account_id)
        in_list = any(a["id"] == resolved for a in accounts)
        steps.append(
            {
                "step": "ad_accounts",
                "ok": bool(accounts),
                "detail": (
                    f"{len(accounts)} cuenta(s); configurada={ad_account_id}"
                    + (f"; usando={resolved}" if resolved != ad_account_id else "")
                    + ("" if in_list or not accounts else " (no está en la lista del token)")
                ),
                "accounts": accounts[:10],
            }
        )

        camp_status, camp_payload = _graph_get(
            client,
            f"{_GRAPH_BASE}/{resolved}/campaigns",
            {
                "fields": "id,name,effective_status,status",
                "effective_status": '["ACTIVE"]',
                "limit": 5,
                "access_token": token,
            },
            raise_http=False,
        )
        if camp_status >= 400:
            detail = _graph_error_detail(camp_payload, "No se pudieron listar campañas.")
            if _is_ads_permission_error(detail):
                detail = _permission_help_detail(client, token, resolved, detail)
            steps.append({"step": "campaigns", "ok": False, "detail": detail})
            return {
                "ok": False,
                "ad_account_id": resolved,
                "steps": steps,
            }
        data = camp_payload.get("data") if isinstance(camp_payload.get("data"), list) else []
        active_n = len(data)
        sample = [
            {
                "id": str(c.get("id") or ""),
                "name": str(c.get("name") or ""),
                "status": str(c.get("effective_status") or c.get("status") or ""),
            }
            for c in data[:3]
            if isinstance(c, dict)
        ]
        steps.append(
            {
                "step": "campaigns",
                "ok": True,
                "detail": f"{active_n} campaña(s) ACTIVE visibles (muestra)",
                "sample": sample,
            }
        )
        return {
            "ok": all(bool(s.get("ok")) for s in steps),
            "ad_account_id": resolved,
            "steps": steps,
        }


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
                    "objective": getattr(r, "objective", None) or "",
                    "thumbnail_url": getattr(r, "thumbnail_url", None) or "",
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
