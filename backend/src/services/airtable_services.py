import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import certifi

_BASE_APP_RE = re.compile(r"(app[a-zA-Z0-9]+)", re.IGNORECASE)
_TBL_RE = re.compile(r"(tbl[a-zA-Z0-9]+)", re.IGNORECASE)
_VIEW_RE = re.compile(r"(viw[a-zA-Z0-9]+)", re.IGNORECASE)


def _normalize_base_id(raw: str) -> str:
    """Acepta solo el id (app…) o una URL completa de Airtable."""
    s = (raw or "").strip()
    if not s:
        return ""
    m = _BASE_APP_RE.search(s.replace(" ", ""))
    if m:
        return m.group(1)
    return s.split("/")[0].split("?")[0].strip()


def _normalize_view_id(raw: str) -> str:
    """ID de vista viw… (misma URL de Airtable). Opcional para alinear con la vista del tablero."""
    s = (raw or "").strip()
    if not s:
        return ""
    m = _VIEW_RE.search(s.replace(" ", ""))
    if m:
        return m.group(1)
    if s.lower().startswith("viw"):
        return s.split("/")[0].split("?")[0].strip()
    return ""


def _normalize_table_id(raw: str) -> str:
    """Acepta solo tbl… o una URL / pegado con espacios."""
    s = (raw or "").strip()
    if not s:
        return ""
    m = _TBL_RE.search(s.replace(" ", ""))
    if m:
        return m.group(1)
    if s.lower().startswith("tbl"):
        return s.split("/")[0].split("?")[0].strip()
    return ""


def _airtable_error_message(body: dict[str, Any]) -> str:
    err = body.get("error")
    if isinstance(err, dict):
        return str(err.get("message") or err.get("type") or err)[:500]
    if isinstance(err, str):
        return err[:500]
    return str(body)[:500]


from fastapi import HTTPException
from pony.orm import db_session

from src.models import ApiConnection
from src.schemas import AirtableLeadsListResponse, AirtableVerifyResponse


class AirtableServices:
    def _http_json(self, url: str, headers: dict[str, str], method: str = "GET") -> dict[str, Any]:
        req = urllib.request.Request(url, headers=headers, method=method)
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        try:
            with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as e:
            try:
                err_raw = e.read().decode("utf-8")
                parsed = json.loads(err_raw) if err_raw else {}
            except Exception:
                parsed = {"error": err_raw[:400] if err_raw else str(e)}
            return {"_http_status": e.code, "_http_error": True, **parsed}
        except Exception as e:  # pragma: no cover
            return {"_http_error": True, "error": str(e)}

    def verify(self, user_id: str) -> AirtableVerifyResponse:
        with db_session:
            conn = next(
                (
                    c
                    for c in list(ApiConnection.select())
                    if c.user_id == user_id and c.platform == "airtable"
                ),
                None,
            )
            creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}

        pat = str(
            creds.get("personal_access_token") or creds.get("api_key") or creds.get("pat") or ""
        ).strip()
        base_id = _normalize_base_id(str(creds.get("base_id") or ""))
        table_id = _normalize_table_id(str(creds.get("table_id") or ""))
        table_name = str(creds.get("table_name") or "").strip()

        if not pat:
            raise HTTPException(
                status_code=400,
                detail="Falta el Personal Access Token. Guardalo en Conexiones → Airtable.",
            )

        headers = {
            "Authorization": f"Bearer {pat}",
            "Accept": "application/json",
        }

        whoami = self._http_json("https://api.airtable.com/v0/meta/whoami", headers=headers)
        if whoami.get("_http_error"):
            msg = _airtable_error_message(whoami)
            return AirtableVerifyResponse(
                ok=False,
                message=f"Airtable rechazó el token: {msg}",
            )

        whoami_id = str(whoami.get("id") or "") or None
        scopes_raw = whoami.get("scopes")
        scopes = [str(s) for s in scopes_raw] if isinstance(scopes_raw, list) else []

        if not base_id:
            return AirtableVerifyResponse(
                ok=True,
                message="Token válido. Completá Base ID y nombre de tabla (o Table ID tbl…) para validar el acceso a la base.",
                whoami_id=whoami_id,
                scopes=scopes,
            )

        meta_url = f"https://api.airtable.com/v0/meta/bases/{urllib.parse.quote(base_id, safe='')}/tables"
        meta = self._http_json(meta_url, headers=headers)
        if meta.get("_http_error"):
            msg = _airtable_error_message(meta)
            return AirtableVerifyResponse(
                ok=False,
                message=f"No se pudo leer el esquema de la base ({base_id}): {msg}",
                whoami_id=whoami_id,
                scopes=scopes,
                base_id=base_id,
            )

        tables_raw = meta.get("tables")
        tables_list = tables_raw if isinstance(tables_raw, list) else []
        table_names: list[str] = []
        for t in tables_list:
            if isinstance(t, dict) and t.get("name"):
                table_names.append(str(t["name"]))

        table_match: bool | None = None
        if table_id:
            table_match = any(
                isinstance(t, dict) and str(t.get("id") or "") == table_id for t in tables_list
            )
        elif table_name:
            table_match = table_name in table_names

        if table_id and table_match is False:
            preview = ", ".join(
                str(t.get("id")) for t in tables_list if isinstance(t, dict) and t.get("id")
            )[:200]
            return AirtableVerifyResponse(
                ok=False,
                message=f'No existe la tabla con id "{table_id}" en esta base. IDs visibles (meta): {preview or "—"}',
                whoami_id=whoami_id,
                scopes=scopes,
                base_id=base_id,
                table_names=table_names,
                table_match=False,
            )

        if table_name and table_match is False:
            preview = ", ".join(table_names[:8])
            more = "…" if len(table_names) > 8 else ""
            return AirtableVerifyResponse(
                ok=False,
                message=f'No hay una tabla llamada "{table_name}". Tablas en la base: {preview}{more}',
                whoami_id=whoami_id,
                scopes=scopes,
                base_id=base_id,
                table_names=table_names,
                table_match=False,
            )

        if table_match is True:
            msg = "Conexión OK: token válido y tabla encontrada."
        elif table_id:
            msg = "Token y base OK; Table ID reconocido."
        else:
            msg = "Token y base OK. Indicá nombre exacto de la pestaña o el Table ID (tbl…)."
        return AirtableVerifyResponse(
            ok=True,
            message=msg,
            whoami_id=whoami_id,
            scopes=scopes,
            base_id=base_id,
            table_names=table_names,
            table_match=table_match,
        )

    def list_leads_table_records(
        self,
        user_id: str,
        filter_by_formula: str | None = None,
    ) -> AirtableLeadsListResponse:
        with db_session:
            conn = next(
                (
                    c
                    for c in list(ApiConnection.select())
                    if c.user_id == user_id and c.platform == "airtable"
                ),
                None,
            )
            creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}

        pat = str(
            creds.get("personal_access_token") or creds.get("api_key") or creds.get("pat") or ""
        ).strip()
        base_id = _normalize_base_id(str(creds.get("base_id") or ""))
        table_id = _normalize_table_id(str(creds.get("table_id") or ""))
        view_id = _normalize_view_id(str(creds.get("view_id") or creds.get("airtable_view_id") or ""))
        table_name = str(creds.get("table_name") or "").strip() or "Leads Marzo"

        if not pat or not base_id:
            raise HTTPException(
                status_code=400,
                detail="Configura PAT y Base ID en Conexiones → Airtable para cargar la tabla de leads.",
            )

        headers = {
            "Authorization": f"Bearer {pat}",
            "Accept": "application/json",
        }

        base_path = urllib.parse.quote(base_id, safe="")
        if table_id:
            table_segment = urllib.parse.quote(table_id, safe="")
            resolved_table_name = table_name
        else:
            table_segment = urllib.parse.quote(table_name, safe="")
            resolved_table_name = table_name

        url_base = f"https://api.airtable.com/v0/{base_path}/{table_segment}"

        out: list[dict[str, Any]] = []
        offset: str | None = None
        for _ in range(500):
            qs = ["pageSize=100"]
            if view_id:
                qs.append("view=" + urllib.parse.quote(view_id, safe=""))
            if filter_by_formula:
                qs.append("filterByFormula=" + urllib.parse.quote(filter_by_formula, safe=""))
            if offset:
                qs.append("offset=" + urllib.parse.quote(offset, safe=""))
            url = url_base + "?" + "&".join(qs)
            body = self._http_json(url, headers=headers)
            if body.get("_http_error"):
                msg = _airtable_error_message(body)
                hint = ""
                low = msg.lower()
                if "permission" in low or "authorized" in low or "403" in str(body.get("_http_status", "")):
                    hint = " Revisá que el PAT en airtable.com/create/tokens tenga acceso a esta base y scope data.records:read."
                elif "not found" in low or "404" == str(body.get("_http_status", "")):
                    hint = " Verificá Base ID (app…), y usá Table ID tbl… de la URL si el nombre de la pestaña no coincide."
                raise HTTPException(
                    status_code=502,
                    detail=f"Airtable: {msg}.{hint}",
                )
            recs = body.get("records")
            if isinstance(recs, list):
                for r in recs:
                    if isinstance(r, dict):
                        out.append(r)
            offset = body.get("offset")
            if not offset:
                break

        return AirtableLeadsListResponse(
            base_id=base_id,
            table_name=resolved_table_name,
            table_id=table_id or None,
            view_id=view_id or None,
            records=out,
        )
