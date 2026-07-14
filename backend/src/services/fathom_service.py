"""Obtener transcripción y metadatos de Fathom."""

from __future__ import annotations

import os
from typing import Any

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


def _participants_from_meeting(meeting: dict[str, Any], transcript_text: str) -> str:
    names: list[str] = []
    seen: set[str] = set()

    invitees = meeting.get("calendar_invitees") or meeting.get("invitees") or []
    if isinstance(invitees, list):
        for inv in invitees:
            if not isinstance(inv, dict):
                continue
            name = str(inv.get("name") or inv.get("email") or "").strip()
            key = name.lower()
            if name and key not in seen:
                seen.add(key)
                names.append(name)

    if not names:
        for line in (transcript_text or "").splitlines():
            if ":" not in line:
                continue
            speaker = line.split(":", 1)[0].strip()
            key = speaker.lower()
            if speaker and key not in seen and speaker.lower() != "speaker":
                seen.add(key)
                names.append(speaker)

    return ", ".join(names)


def _motivo_from_meeting(meeting: dict[str, Any]) -> str:
    for key in ("meeting_title", "title", "destination", "summary"):
        val = meeting.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _meeting_payload(meeting: dict[str, Any]) -> dict[str, str]:
    transcript = _format_transcript_segments(meeting.get("transcript") or [])
    return {
        "transcript": transcript,
        "participantes": _participants_from_meeting(meeting, transcript),
        "motivo_reunion": _motivo_from_meeting(meeting),
    }


def _find_meeting_with_transcript(share_url: str, headers: dict) -> dict:
    """GET /meetings?include_transcript=true y match url/share_url."""
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


def fetch_fathom_meeting(share_url: str, user_id: int) -> dict[str, str]:
    """Devuelve transcript + participantes + motivo_reunion."""
    headers = {"X-Api-Key": _get_fathom_api_key(user_id)}
    meetings_err: Exception | None = None
    try:
        meeting = _find_meeting_with_transcript(share_url, headers)
        payload = _meeting_payload(meeting)
        if payload["transcript"].strip():
            return payload
        raise ValueError(f"Meeting encontrado pero sin transcript: {share_url}")
    except (httpx.HTTPError, ValueError) as exc:
        meetings_err = exc

    try:
        recording_id = _find_recording_id(share_url, headers)
        transcript = _fetch_transcript_via_recording(recording_id, headers)
        return {
            "transcript": transcript,
            "participantes": _participants_from_meeting({}, transcript),
            "motivo_reunion": "",
        }
    except httpx.HTTPStatusError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            raise ValueError(
                "La API key de Fathom es válida pero no tiene acceso a esa reunión. "
                "Generá la key en la misma cuenta de Fathom que grabó (o tiene compartida) la llamada. "
                f"Detalle: {meetings_err}"
            ) from exc
        raise
    except ValueError as exc:
        raise ValueError(
            "No se encontró la reunión en Fathom con esta API key. "
            "Usá la key de la cuenta que grabó el video. "
            f"Detalle: {meetings_err or exc}"
        ) from exc


def fetch_fathom_transcript(share_url: str, user_id: int) -> str:
    return fetch_fathom_meeting(share_url, user_id)["transcript"]
