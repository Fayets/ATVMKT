import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import certifi
from fastapi import HTTPException
from pony.orm import db_session

from src.models import ApiConnection
from src.services.airtable_services import _normalize_base_id, _normalize_table_id

_REEL_METRICS_TTL_SEC = 300
_reel_metrics_cache: dict[str, tuple[float, dict[str, float | int]]] = {}


class AirtableService:
    def _extract_handle(self, raw: str | None) -> str:
        value = str(raw or "").strip().lower()
        if not value:
            return ""
        value = value.replace("https://", "").replace("http://", "").strip()
        if "instagram.com/" in value:
            value = value.split("instagram.com/", 1)[1]
        value = value.split("?", 1)[0].split("/", 1)[0]
        value = value.lstrip("@").strip()
        return re.sub(r"[^a-zA-Z0-9._]", "", value)

    def _load_conn(self, user_id: str) -> tuple[str, str, str]:
        with db_session:
            conn = next(
                (c for c in list(ApiConnection.select()) if c.user_id == user_id and c.platform == "airtable"),
                None,
            )
            creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}
        api_key = str(creds.get("personal_access_token") or creds.get("api_key") or creds.get("pat") or "").strip()
        base_id = _normalize_base_id(str(creds.get("base_id") or ""))
        table_id = _normalize_table_id(str(creds.get("table_id") or ""))
        table_name = str(creds.get("table_name") or "").strip() or "Leads Marzo"
        table = table_id or table_name
        if not api_key or not base_id:
            raise HTTPException(status_code=400, detail="Airtable no configurado para este usuario.")
        return api_key, base_id, table

    def _headers(self, api_key: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _normalize_tokens(self, keyword_value: str | None) -> list[str]:
        if not keyword_value:
            return []
        raw_tokens = [t.strip().lower() for t in str(keyword_value).split(",")]
        return [t for t in raw_tokens if t]

    def _to_float(self, value: Any) -> float:
        if value is None:
            return 0.0
        if isinstance(value, (int, float)):
            return float(value)
        clean = re.sub(r"[^0-9,.\-]", "", str(value)).replace(",", ".").strip()
        if not clean:
            return 0.0
        try:
            return float(clean)
        except ValueError:
            return 0.0

    def _request(self, api_key: str, url: str, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, headers=self._headers(api_key), method=method, data=data)
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        try:
            with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as e:
            try:
                err_raw = e.read().decode("utf-8")
            except Exception:
                err_raw = ""
            raise HTTPException(status_code=502, detail=f"Airtable error ({e.code}): {err_raw[:220]}") from e
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"No se pudo consultar Airtable: {e}") from e

    def _records(self, user_id: str, filter_formula: str | None = None) -> list[dict[str, Any]]:
        api_key, base_id, table_name = self._load_conn(user_id)
        base = urllib.parse.quote(base_id, safe="")
        table = urllib.parse.quote(table_name, safe="")
        url_base = f"https://api.airtable.com/v0/{base}/{table}"
        out: list[dict[str, Any]] = []
        offset: str | None = None
        for _ in range(200):
            qs = ["pageSize=100"]
            if filter_formula:
                qs.append("filterByFormula=" + urllib.parse.quote(filter_formula, safe=""))
            if offset:
                qs.append("offset=" + urllib.parse.quote(offset, safe=""))
            payload = self._request(api_key, url_base + "?" + "&".join(qs))
            rows = payload.get("records")
            if isinstance(rows, list):
                out.extend([r for r in rows if isinstance(r, dict)])
            offset = str(payload.get("offset") or "").strip() or None
            if not offset:
                break
        return out

    def _reel_metrics_cache_key(self, user_id: str, keyword: str, content_url: str | None) -> str:
        """Clave de caché: por usuario + keyword o por content_url (filtro principal)."""
        target = str(keyword or "").strip().lower()
        target_url = str(content_url or "").strip().lower()
        if target_url:
            return f"metrics_{user_id}_url_{target_url}"
        return f"metrics_{user_id}_{target}"

    def _reel_metrics_cache_get(self, key: str) -> dict[str, float | int] | None:
        entry = _reel_metrics_cache.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            _reel_metrics_cache.pop(key, None)
            return None
        return value

    def _reel_metrics_cache_set(self, key: str, value: dict[str, float | int]) -> None:
        _reel_metrics_cache[key] = (time.monotonic() + _REEL_METRICS_TTL_SEC, value)

    def clear_reel_metrics_cache(self, user_id: str, keyword: str, content_url: str | None = None) -> None:
        key = self._reel_metrics_cache_key(user_id, keyword, content_url)
        _reel_metrics_cache.pop(key, None)

    def get_reel_metrics(self, user_id: str, keyword: str, content_url: str | None = None) -> dict[str, float | int]:
        target = str(keyword or "").strip().lower()
        target_url = str(content_url or "").strip().lower()
        if not target and not target_url:
            return {"chats_count": 0, "cash_total": 0.0, "cpc": 0.0}

        cache_key = self._reel_metrics_cache_key(user_id, keyword, content_url)
        cached = self._reel_metrics_cache_get(cache_key)
        if cached is not None:
            return cached

        chats_count = 0
        cash_total = 0.0
        for rec in self._records(user_id):
            fields = rec.get("fields")
            if not isinstance(fields, dict):
                continue
            if target_url:
                record_content_url = str(
                    fields.get("content_url")
                    or fields.get("Content URL")
                    or fields.get("Content Url")
                    or ""
                ).strip().lower()
                if record_content_url != target_url:
                    continue
            else:
                tokens = self._normalize_tokens(str(fields.get("Keyword") or ""))
                if target not in tokens:
                    continue
            chats_count += 1
            cash_total += self._to_float(fields.get("Pagó"))

        cpc = (cash_total / chats_count) if chats_count > 0 else 0.0
        result = {"chats_count": chats_count, "cash_total": round(cash_total, 2), "cpc": round(cpc, 2)}
        self._reel_metrics_cache_set(cache_key, result)
        return result

    def upsert_lead_keyword(
        self,
        user_id: str,
        contact_ig_username: str,
        keyword: str,
        content_url: str | None = None,
    ) -> None:
        api_key, base_id, table_name = self._load_conn(user_id)
        handle = self._extract_handle(contact_ig_username)
        normalized_kw = str(keyword or "").strip().lower()
        normalized_content_url = str(content_url or "").strip()
        if not handle or not normalized_kw:
            return

        records = self._records(user_id)
        existing_record: dict[str, Any] | None = None
        for rec in records:
            fields = rec.get("fields") if isinstance(rec.get("fields"), dict) else {}
            rec_handle = self._extract_handle(str(fields.get("IG") or fields.get("Instagram") or ""))
            if rec_handle and rec_handle == handle:
                existing_record = rec
                break

        if existing_record:
            rec = existing_record
            rec_id = str(rec.get("id") or "").strip()
            fields = rec.get("fields") if isinstance(rec.get("fields"), dict) else {}
            existing_tokens = self._normalize_tokens(str(fields.get("Keyword") or ""))
            if normalized_kw not in existing_tokens:
                existing_tokens.append(normalized_kw)
            merged = ", ".join(existing_tokens)
            if rec_id:
                base = urllib.parse.quote(base_id, safe="")
                table = urllib.parse.quote(table_name, safe="")
                rec_path = urllib.parse.quote(rec_id, safe="")
                update_fields: dict[str, Any] = {"Keyword": merged}
                if normalized_content_url:
                    update_fields["content_url"] = normalized_content_url
                self._request(
                    api_key,
                    f"https://api.airtable.com/v0/{base}/{table}/{rec_path}",
                    method="PATCH",
                    body={"fields": update_fields},
                )
            return

        base = urllib.parse.quote(base_id, safe="")
        table = urllib.parse.quote(table_name, safe="")
        self._request(
            api_key,
            f"https://api.airtable.com/v0/{base}/{table}",
            method="POST",
            body={
                "fields": {
                    "IG": f"https://www.instagram.com/{handle}/",
                    "Keyword": normalized_kw,
                    "content_url": normalized_content_url,
                }
            },
        )
