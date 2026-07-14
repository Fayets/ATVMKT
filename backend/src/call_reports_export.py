"""Export TXT/PDF de reportes de llamadas."""

from __future__ import annotations

import unicodedata
from datetime import datetime
from typing import Any


def _pdf_safe(s: str, max_len: int = 8000) -> str:
    if not s:
        return ""
    t = s.strip()
    if len(t) > max_len:
        t = t[: max_len - 3] + "..."
    nfkd = unicodedata.normalize("NFKD", t)
    return "".join(c for c in nfkd if ord(c) < 128 or c in "\n\t ")


def format_report_fecha(iso: str | None) -> str:
    s = (iso or "").strip()
    if not s:
        return "—"
    # YYYY-MM-DD or ISO datetime
    date_part = s[:10]
    parts = date_part.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts) and len(parts[0]) == 4:
        y, mo, d = parts
        return f"{d}-{mo}-{y}"
    return s


def safe_lead_filename(name: str) -> str:
    """Nombre de lead apto para archivo: reporte_(nombre).pdf"""
    raw = (name or "").strip() or "Sin nombre"
    for ch in '<>:"/\\|?*':
        raw = raw.replace(ch, "")
    raw = " ".join(raw.split())
    return (raw[:80] or "Sin nombre")


def download_filename_for_reports(reports: list[dict[str, str]], fmt: str) -> str:
    """Formato: reporte_(nombre del lead).ext — si hay varios, usa el primero + y_N."""
    ext = (fmt or "txt").strip().lower()
    if not reports:
        return f"reporte_(Sin nombre).{ext}"
    first = safe_lead_filename(reports[0].get("lead") or "")
    if len(reports) == 1:
        return f"reporte_({first}).{ext}"
    return f"reporte_({first})_y_{len(reports)}.{ext}"


def report_as_dict(row: Any, created_at_iso: str) -> dict[str, str]:
    return {
        "fecha": format_report_fecha(created_at_iso),
        "lead": (getattr(row, "lead_nombre", None) or "").strip() or "Sin nombre",
        "link": (getattr(row, "fathom_url", None) or "").strip(),
        "participantes": (getattr(row, "participantes", None) or "").strip() or "—",
        "motivo": (getattr(row, "motivo_reunion", None) or "").strip() or "—",
        "resumen": (getattr(row, "resumen", None) or "").strip()
        or (getattr(row, "closer_report", None) or "").strip()
        or "—",
        "hubo_objeciones": (getattr(row, "hubo_objeciones", None) or "").strip() or "—",
        "tipo_perfil": (getattr(row, "tipo_perfil", None) or "").strip() or "—",
        "ingresos_estimados": (getattr(row, "ingresos_estimados", None) or "").strip() or "—",
        "situacion_y_deseo": (getattr(row, "situacion_y_deseo", None) or "").strip() or "—",
    }


def build_call_reports_txt(reports: list[dict[str, str]]) -> str:
    blocks: list[str] = []
    for i, r in enumerate(reports, start=1):
        blocks.append(
            "\n".join(
                [
                    f"=== REPORTE DE LLAMADA #{i} ===",
                    f"Fecha: {r['fecha']}",
                    f"Lead: {r['lead']}",
                    f"Link de la grabación: {r['link']}",
                    f"Participantes: {r['participantes']}",
                    f"Motivo de la reunión: {r['motivo']}",
                    "",
                    "Resumen de la reunión:",
                    r["resumen"],
                    "",
                    f"¿Hubo objeciones en la llamada?: {r['hubo_objeciones']}",
                    f"¿Qué tipo de perfil tiene el lead?: {r['tipo_perfil']}",
                    f"Ingresos estimados del lead: {r['ingresos_estimados']}",
                    "¿Qué situación puntual está viviendo y qué le gustaría vivir en los próximos 3 meses?:",
                    r["situacion_y_deseo"],
                ]
            )
        )
    return "\n\n------------------------------\n\n".join(blocks) + "\n"


def build_call_reports_pdf(reports: list[dict[str, str]]) -> bytes:
    from fpdf import FPDF

    class _PDF(FPDF):
        def __init__(self) -> None:
            super().__init__(orientation="P", unit="mm", format="A4")
            self.set_auto_page_break(auto=True, margin=14)
            self.set_margins(14, 14, 14)

    pdf = _PDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, _pdf_safe("Reportes de llamadas"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(
        0,
        5,
        _pdf_safe(f"Generado: {datetime.utcnow().strftime('%d-%m-%Y %H:%M')} UTC  |  Total: {len(reports)}"),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    def _emit(label: str, value: str, bold_label: bool = True) -> None:
        pdf.set_x(pdf.l_margin)
        if bold_label:
            pdf.set_font("Helvetica", "B", 9)
            pdf.multi_cell(0, 5, _pdf_safe(label))
            pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", "", 9)
        pdf.multi_cell(0, 5, _pdf_safe(value))
        pdf.set_x(pdf.l_margin)
        pdf.ln(1)

    for i, r in enumerate(reports, start=1):
        if pdf.get_y() > 250:
            pdf.add_page()
        pdf.set_font("Helvetica", "B", 11)
        pdf.multi_cell(0, 6, _pdf_safe(f"Reporte #{i}"))
        pdf.set_x(pdf.l_margin)
        pdf.ln(1)
        _emit("Fecha", r["fecha"])
        _emit("Lead", r["lead"])
        _emit("Link de la grabacion", r["link"])
        _emit("Participantes", r["participantes"])
        _emit("Motivo de la reunion", r["motivo"])
        _emit("Resumen de la reunion", r["resumen"])
        _emit("Hubo objeciones en la llamada?", r["hubo_objeciones"])
        _emit("Que tipo de perfil tiene el lead?", r["tipo_perfil"])
        _emit("Ingresos estimados del lead", r["ingresos_estimados"])
        _emit(
            "Situacion actual y deseo a 3 meses",
            r["situacion_y_deseo"],
        )
        pdf.ln(3)

    out = pdf.output()
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    return str(out).encode("latin-1", errors="replace")
