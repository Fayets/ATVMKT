"""Valores mostrados en UI cuando ManyChat envía solo placeholders y `nombre` queda vacío."""

from datetime import datetime


def compute_dias_para_agendar(
    primer_contacto: datetime | None,
    agendo: datetime | None,
) -> int | None:
    """Días calendario desde 1er contacto hasta que completó el formulario Calendly (`agendo`)."""
    if primer_contacto is None or agendo is None:
        return None
    p = primer_contacto.replace(tzinfo=None) if primer_contacto.tzinfo else primer_contacto
    a = agendo.replace(tzinfo=None) if agendo.tzinfo else agendo
    return max(0, (a.date() - p.date()).days)


def lead_display_nombre(nombre: str | None, ig: str | None) -> str:
    n = (nombre or "").strip()
    if n:
        return n
    return (ig or "").strip()
