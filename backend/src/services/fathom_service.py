"""Obtener transcripción de Fathom (port de frontend fathom-service.ts)."""

from __future__ import annotations

import os

import httpx
from decouple import config
from pony.orm import db_session

from src.models import ApiConnection

FATHOM_BASE = "https://api.fathom.ai/external/v1"


def _norm_url(url: str) -> str:
    return (url or "").strip().rstrip("/")


def _get_fathom_api_key(user_id: int) -> str:
    with db_session:
        rows = [
            c
            for c in list(ApiConnection.select())
            if int(c.user_id) == user_id and str(c.platform).strip().lower() == "fathom"
        ]
        rows.sort(key=lambda c: int(c.id))
        if rows:
            creds = rows[0].credentials if isinstance(rows[0].credentials, dict) else {}
            key = str(creds.get("api_key") or "").strip()
            if key:
                return key
    key = (config("FATHOM_API_KEY", default="") or os.environ.get("FATHOM_API_KEY", "") or "").strip()
    if not key:
        raise ValueError("Falta API key de Fathom (Conexiones o FATHOM_API_KEY).")
    return key


def _format_transcript_segments(segments: list) -> str:
    lines: list[str] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        speaker = seg.get("speaker_name")
        if speaker is None and isinstance(seg.get("speaker"), dict):
            speaker = seg["speaker"].get("display_name") or seg["speaker"].get("name")
        text = seg.get("text") or ""
        name = str(speaker or "Speaker").strip()
        lines.append(f"{name}: {text}")
    return "\n".join(lines)


def _find_meeting_with_transcript(share_url: str, headers: dict) -> dict:
    """Espeja fathom-service.ts: GET /meetings?include_transcript=true y match url/share_url."""
    target = _norm_url(share_url)
    cursor: str | None = None
    with httpx.Client(base_url=FATHOM_BASE, headers=headers, timeout=90) as client:
        while True:
            params: dict[str, str | int] = {"include_transcript": "true", "limit": 50}
            if cursor:
                params["cursor"] = cursor
            res = client.get("/meetings", params=params)
            res.raise_for_status()
            data = res.json()
            items = data.get("items") or []
            for meeting in items:
                if not isinstance(meeting, dict):
                    continue
                urls = (
                    _norm_url(str(meeting.get("url") or "")),
                    _norm_url(str(meeting.get("share_url") or "")),
                )
                if target in urls and meeting.get("transcript"):
                    return meeting
            cursor = data.get("next_cursor")
            if not cursor:
                break
    raise ValueError(f"No encontré meeting con transcript para {share_url}")


def _find_recording_id(share_url: str, headers: dict) -> int:
    """Fallback: API recordings + transcript por id."""
    target = _norm_url(share_url)
    cursor: str | None = None
    with httpx.Client(base_url=FATHOM_BASE, headers=headers, timeout=90) as client:
        while True:
            params: dict[str, str] = {}
            if cursor:
                params["cursor"] = cursor
            res = client.get("/recordings", params=params)
            res.raise_for_status()
            data = res.json()
            items = data.get("items") or data.get("recordings") or []
            for rec in items:
                if not isinstance(rec, dict):
                    continue
                urls = (
                    _norm_url(str(rec.get("share_url") or "")),
                    _norm_url(str(rec.get("url") or "")),
                )
                if target in urls:
                    rid = rec.get("id")
                    if rid is not None:
                        return int(rid)
            cursor = data.get("next_cursor")
            if not cursor:
                break
    raise ValueError(f"No encontré recording para {share_url}")


def _fetch_transcript_via_recording(recording_id: int, headers: dict) -> str:
    with httpx.Client(base_url=FATHOM_BASE, headers=headers, timeout=90) as client:
        res = client.get(f"/recordings/{recording_id}/transcript")
        res.raise_for_status()
        payload = res.json()
    segments = payload.get("transcript") if isinstance(payload, dict) else None
    if not segments:
        raise ValueError("Transcript vacío en Fathom recordings API.")
    return _format_transcript_segments(segments)


def fetch_fathom_transcript(share_url: str, user_id: int) -> str:
    headers = {"X-Api-Key": _get_fathom_api_key(user_id)}
    try:
        meeting = _find_meeting_with_transcript(share_url, headers)
        text = _format_transcript_segments(meeting.get("transcript") or [])
        if text.strip():
            return text
    except (httpx.HTTPError, ValueError):
        pass
    recording_id = _find_recording_id(share_url, headers)
    return _fetch_transcript_via_recording(recording_id, headers)
