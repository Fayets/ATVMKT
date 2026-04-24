"""
Empareja contactos ManyChat (IG) con filas de la tabla de leads en Airtable.
Clave: mismo handle de Instagram normalizado (sin @, minúsculas).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any


def norm_ig(raw: str | None) -> str:
    if not raw:
        return ""
    s = str(raw).strip().lower().removeprefix("@")
    return re.sub(r"[^a-z0-9._]", "", s)


def _nk(s: str) -> str:
    t = "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", "", t.lower().replace("_", ""))


def _scalar(val: Any) -> str | None:
    if val is None:
        return None
    if isinstance(val, bool):
        return "Sí" if val else "No"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        t = val.strip()
        return t or None
    if isinstance(val, list):
        if not val:
            return None
        parts: list[str] = []
        for x in val:
            if isinstance(x, dict):
                parts.append(str(x.get("name") or x.get("url") or x.get("email") or ""))
            else:
                parts.append(str(x))
        return ", ".join(p for p in parts if p) or None
    return str(val)


def _pick_field(fields: dict[str, Any], aliases: list[str]) -> Any:
    if not fields:
        return None
    alias_norms = {_nk(a) for a in aliases}
    for k, v in fields.items():
        if _nk(k) in alias_norms:
            return v
    return None


def _to_float(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d.,\-]", "", str(v).replace(",", "."))
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _lead_row_score(row: dict[str, Any]) -> float:
    pay = float(row.get("lead_payment") or 0)
    rev = float(row.get("lead_revenue") or 0)
    st = str(row.get("lead_status") or "").lower()
    score = pay * 50 + rev * 10
    if "cerr" in st or "seña" in st or "sena" in st:
        score += 500
    return score


def build_ig_lead_map_from_airtable(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """
    Devuelve mapa ig_normalizado -> campos planos para fusionar en ManychatChatResponse.
    Si hay varias filas con el mismo IG, se queda la de mayor score (cierre / pago).
    """
    out: dict[str, dict[str, Any]] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        rid = str(rec.get("id") or "")
        fields = rec.get("fields")
        if not isinstance(fields, dict):
            continue
        ig_raw = _pick_field(
            fields,
            ["IG", "Instagram", "Ig", "IG handle", "Usuario Instagram", "ig_username", "Instagram handle"],
        )
        ig = norm_ig(_scalar(ig_raw) or "")
        if not ig:
            continue
        status = _scalar(_pick_field(fields, ["Estado", "Status", "Etapa", "Stage", "Estado lead", "Pipeline"]))
        name = _scalar(_pick_field(fields, ["Nombre", "Name", "Cliente", "Lead", "Contacto", "Full name"]))
        prog_b = _scalar(_pick_field(fields, ["Prog. comprado", "Programa comprado", "Program purchased", "Compró", "Producto comprado"]))
        prog_o = _scalar(_pick_field(fields, ["Prog. ofrecido", "Programa ofrecido", "Program offered", "Oferta", "Producto ofrecido"]))
        pay = _to_float(_pick_field(fields, ["Pagó", "Pago", "Payment", "Paid", "Monto pagado", "Pagado", "Paid amount"]))
        rev = _to_float(
            _pick_field(
                fields,
                ["Facturación", "Revenue", "Ingresos", "Total", "Monto total", "Ticket", "CC", "Cash collected"],
            )
        )
        bio_snap = _scalar(
            _pick_field(
                fields,
                [
                    "Bio IG",
                    "Bio Instagram",
                    "Descripción IG",
                    "Descripcion IG",
                    "Texto bio",
                    "Copy bio",
                    "IG bio",
                ],
            )
        )
        auto_snap = _scalar(
            _pick_field(
                fields,
                [
                    "Respuesta auto",
                    "Respuesta automatización",
                    "Mensaje auto",
                    "Primera respuesta",
                    "Auto DM",
                ],
            )
        )
        row = {
            "lead_airtable_record_id": rid or None,
            "lead_status": status,
            "lead_client_name": name,
            "lead_program_purchased": prog_b,
            "lead_program_offered": prog_o,
            "lead_payment": pay,
            "lead_revenue": rev,
            "lead_ig_bio_snapshot": bio_snap,
            "lead_automation_reply_snapshot": auto_snap,
        }
        prev = out.get(ig)
        if prev is None or _lead_row_score(row) > _lead_row_score(prev):
            out[ig] = row
    return out
