"""Análisis de transcripciones vía Claude CLI (subprocess)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


def _resolve_claude_bin() -> str:
    """En Windows los wrappers npm (.cmd/.ps1) rompen stdin/stdout; usar el .exe."""
    configured = (os.getenv("CLAUDE_CLI_PATH") or "").strip()
    if configured and Path(configured).exists():
        return configured
    npm_claude = (
        Path(os.environ.get("APPDATA", ""))
        / "npm"
        / "node_modules"
        / "@anthropic-ai"
        / "claude-code"
        / "bin"
        / "claude.exe"
    )
    if npm_claude.exists():
        return str(npm_claude)
    which = shutil.which("claude")
    if which and not which.lower().endswith((".ps1", ".cmd", ".bat")):
        return which
    if which:
        return which
    return "claude"


ANALYSIS_INSTRUCTIONS = """Sos un analista de ventas experto. Vas a recibir por stdin la transcripción completa de una reunión/llamada (formato "Hablante: texto").

Extraé SOLO la siguiente información en español. NO devolvas la transcripción completa.

1. **resumen**: resumen detallado de lo que se habló en la reunión (2-6 párrafos si hay material suficiente; claro y concreto).
2. **hubo_objeciones**: ¿Hubo objeciones en la llamada? Respondé Sí/No y explicá brevemente cuáles (con citas si hay).
3. **tipo_perfil**: ¿Qué tipo de perfil tiene el lead? (rol, negocio, experiencia, avatar).
4. **ingresos_estimados**: ingresos estimados del lead (monto USD o "No mencionado").
5. **situacion_y_deseo**: ¿Qué situación puntual está viviendo y qué le gustaría vivir en los próximos 3 meses?
   Formato: "Situación actual: ...\\nDeseo: ..."

Respondé EXACTAMENTE en este formato JSON (sin markdown, sin backticks):
{"resumen":"...","hubo_objeciones":"...","tipo_perfil":"...","ingresos_estimados":"...","situacion_y_deseo":"..."}

SIEMPRE devolvés ese JSON aunque la grabación sea una prueba, vacía o no sea una call de ventas (indicá "No aplica" / "No mencionado" donde corresponda). Nunca respondas en prosa fuera del JSON.
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


def _extract_result_text(stdout: str) -> str:
    raw = (stdout or "").strip()
    if not raw:
        raise RuntimeError("claude stdout vacío")
    for line in reversed(raw.splitlines()):
        line = line.strip()
        if line.startswith("{") and '"type"' in line:
            try:
                envelope = json.loads(line)
            except json.JSONDecodeError:
                continue
            if envelope.get("type") == "result":
                if envelope.get("subtype") != "success":
                    raise RuntimeError(
                        f"claude subtype={envelope.get('subtype')}: {line[:800]}"
                    )
                return str(envelope.get("result") or "")
    try:
        envelope = json.loads(raw)
        if isinstance(envelope, dict) and envelope.get("type") == "result":
            if envelope.get("subtype") != "success":
                raise RuntimeError(
                    f"claude subtype={envelope.get('subtype')}: {raw[:800]}"
                )
            return str(envelope.get("result") or "")
    except json.JSONDecodeError:
        pass
    return raw


def run_claude_analysis(transcript_text: str) -> dict:
    payload = (
        ANALYSIS_INSTRUCTIONS
        + "\n\n--- TRANSCRIPCIÓN ---\n\n"
        + _truncate_transcript(transcript_text)
    )
    claude_bin = _resolve_claude_bin()
    prompt = (
        "Analizá la transcripción del stdin según las instrucciones del inicio. "
        "Respondé solo el JSON pedido (sin markdown)."
    )
    try:
        proc = subprocess.run(
            [
                claude_bin,
                "-p",
                prompt,
                "--output-format",
                "json",
                "--model",
                "sonnet",
            ],
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            env={**os.environ},
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "Claude CLI no está instalado o no está en el PATH. "
            "Instalá con: npm install -g @anthropic-ai/claude-code "
            "y luego ejecutá: claude auth login"
        ) from exc
    if proc.returncode != 0:
        stderr = (proc.stderr or "")[:800]
        raise RuntimeError(f"claude returncode={proc.returncode}: {stderr}")
    result_text = _extract_result_text(proc.stdout or "")
    try:
        parsed = _parse_json_lenient(str(result_text))
    except (ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(
            f"Claude no devolvió la ficha JSON: {str(result_text)[:800]}"
        ) from exc
    return {
        "resumen": str(parsed.get("resumen") or ""),
        "hubo_objeciones": str(parsed.get("hubo_objeciones") or ""),
        "tipo_perfil": str(parsed.get("tipo_perfil") or ""),
        "ingresos_estimados": str(parsed.get("ingresos_estimados") or ""),
        "situacion_y_deseo": str(parsed.get("situacion_y_deseo") or ""),
    }
