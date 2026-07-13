"""Análisis de transcripciones vía Claude CLI (subprocess)."""

from __future__ import annotations

import json
import os
import subprocess

# Port del prompt en fathom-transcript-analyzer.ts (instrucciones; transcript por stdin).
ANALYSIS_INSTRUCTIONS = """Sos un analista de ventas experto. Vas a recibir por stdin la transcripción completa de una llamada de ventas entre un closer y un lead (formato "Hablante: texto").

Los programas que se ofrecen son: "Boost", "Advantage", "Mentoria".
Los estados posibles del lead son: "Cerrado", "Seña", "Seguimiento", "No show", "Descalificado", "Pendiente".
Si el lead cerró, agregá el monto entre paréntesis. Ej: "Cerrado (1600usd)"

Extraé la siguiente información en español y generá la FICHA DE ANÁLISIS DE LLAMADA (NO devuelvas la transcripción):

1. **REPORTE DEL CLOSER** (closer_report): Generá la ficha con EXACTAMENTE estas secciones, separadas por saltos de línea:

📋 FICHA DE ANÁLISIS DE LLAMADA\\n\\nFecha: [fecha de la llamada o "No mencionado"]\\nNombre del lead: [nombre completo]\\nEstado: [status con monto si cerró]\\n\\n¿Qué lo motivó a estar dentro de la llamada?:\\n[Contexto completo]\\n\\n¿Cuál fue su mayor objeción o miedo? ¿Cómo la expresó?:\\n[Objeción con citas textuales]\\n\\n¿Qué tipo de perfil tiene el lead?:\\n[Perfil profesional]\\n\\nIngresos netos estimados del lead:\\n[Monto USD]\\n\\n¿Este lead representa al avatar ideal?:\\n[Sí/No]\\n\\n¿Qué puedo aportar para marketing desde la llamada?:\\n[Insights]\\n\\n¿Qué situación puntual está viviendo y qué le gustaría vivir en los próximos 3 meses?:\\nSituación actual: [...]\\nDeseo: [...]\\n\\n¿Cuáles fueron sus principales dolores?:\\n[Lista]\\n\\nDinero generado en la llamada:\\n[Monto o "No se generó dinero"]\\n\\nPrograma ofrecido al lead:\\n[Nombre, duración, precio]

2. **DOLORES DE LA LLAMADA** (dolores_llamada): cada dolor con "• " al inicio y en línea separada.

3. **RAZÓN DE COMPRA** (razon_compra): Si cerró, por qué. Si no, "No cerró" y motivo.

4. **PROGRAMA OFRECIDO** (program_offered): "Boost", "Advantage", "Mentoria", o "".

5. **STATUS** (status): "Cerrado", "Seña", "Seguimiento", "Descalificado", "Pendiente", o "No show".

Respondé EXACTAMENTE en este formato JSON (sin markdown, sin backticks):
{"closer_report": "...", "dolores_llamada": "...", "razon_compra": "...", "program_offered": "...", "status": "..."}

IMPORTANTE: En closer_report usá \\n entre secciones. En dolores_llamada usá "• " y \\n. Incluí citas del lead cuando sea posible.
"""


def _parse_json_lenient(raw: str) -> dict:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        start = raw.find("{")
        if start >= 0:
            raw = raw[start:]
    s, e = raw.find("{"), raw.rfind("}")
    if s < 0 or e < 0:
        raise ValueError("Claude no devolvió JSON válido.")
    return json.loads(raw[s : e + 1])


def _truncate_transcript(text: str, max_chars: int = 80000) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n[...transcripción truncada por longitud]"


def run_claude_analysis(transcript_text: str) -> dict:
    payload = _truncate_transcript(transcript_text)
    proc = subprocess.run(
        [
            "claude",
            "-p",
            ANALYSIS_INSTRUCTIONS,
            "--output-format",
            "json",
            "--model",
            "sonnet",
        ],
        input=payload,
        capture_output=True,
        text=True,
        timeout=300,
        env={**os.environ},
    )
    if proc.returncode != 0:
        stderr = (proc.stderr or "")[:800]
        raise RuntimeError(f"claude returncode={proc.returncode}: {stderr}")
    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"claude stdout no es JSON: {(proc.stdout or '')[:800]}") from exc
    if envelope.get("subtype") != "success":
        raise RuntimeError(f"claude subtype={envelope.get('subtype')}: {(proc.stdout or '')[:800]}")
    result_text = envelope.get("result") or ""
    parsed = _parse_json_lenient(str(result_text))
    return {
        "closer_report": str(parsed.get("closer_report") or ""),
        "dolores_llamada": str(parsed.get("dolores_llamada") or ""),
        "razon_compra": str(parsed.get("razon_compra") or ""),
        "program_offered": str(parsed.get("program_offered") or ""),
        "status": str(parsed.get("status") or "Pendiente"),
    }
