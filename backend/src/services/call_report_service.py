"""Orquestación de reportes de llamadas Fathom."""

from __future__ import annotations

from datetime import datetime

from pony.orm import db_session

from src.models import CallReport
from src.services.claude_cli import run_claude_analysis
from src.services.fathom_service import fetch_fathom_transcript


def normalize_fathom_url(url: str) -> str:
    return (url or "").strip().rstrip("/")


def is_fathom_link(url: str | None) -> bool:
    return bool(url) and "fathom.video" in str(url).lower()


def get_or_create_report(lead_id: int, fathom_url: str, user_id: int) -> tuple[int, bool]:
    """Devuelve (report_id, created). Si ya existía el link, created=False."""
    normalized = normalize_fathom_url(fathom_url)
    with db_session:
        existing = CallReport.get(fathom_url=normalized)
        if existing:
            return int(existing.id), False
        row = CallReport(
            lead_id=lead_id,
            fathom_url=normalized,
            user_id=user_id,
            estado="pendiente",
        )
        return int(row.id), True


def analyze_call_report(report_id: int) -> None:
    with db_session:
        row = CallReport.get(id=report_id)
        if not row:
            return
        if row.estado in ("procesando", "listo"):
            return
        row.estado = "procesando"
        row.error_msg = ""
        fathom_url = row.fathom_url
        user_id = int(row.user_id)

    try:
        transcript = fetch_fathom_transcript(fathom_url, user_id)
        analysis = run_claude_analysis(transcript)
        with db_session:
            row = CallReport.get(id=report_id)
            if not row:
                return
            row.closer_report = analysis.get("closer_report") or ""
            row.dolores_llamada = analysis.get("dolores_llamada") or ""
            row.razon_compra = analysis.get("razon_compra") or ""
            row.program_offered = analysis.get("program_offered") or ""
            row.status_llamada = analysis.get("status") or ""
            row.estado = "listo"
            row.updated_at = datetime.utcnow()
    except Exception as exc:
        with db_session:
            row = CallReport.get(id=report_id)
            if not row:
                return
            row.estado = "error"
            row.error_msg = str(exc)[:2000]
            row.updated_at = datetime.utcnow()
