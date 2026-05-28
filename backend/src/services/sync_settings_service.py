"""Intervalos de sync automático (historias / reels), persistidos en BD."""

from __future__ import annotations

from datetime import datetime

from pony.orm import db_session

from src.models import AppSyncSettings

DEFAULT_STORIES_INTERVAL_MINUTES = 5
DEFAULT_REELS_INTERVAL_MINUTES = 1440  # ~24 h (antes: cron diario 07:00 AR)
MIN_SYNC_INTERVAL_MINUTES = 1
MAX_SYNC_INTERVAL_MINUTES = 10080  # 7 días


def _clamp_interval(minutes: int) -> int:
    return max(MIN_SYNC_INTERVAL_MINUTES, min(MAX_SYNC_INTERVAL_MINUTES, int(minutes)))


def _ensure_row() -> AppSyncSettings:
    row = AppSyncSettings.get(id=1)
    if row is None:
        row = AppSyncSettings(
            id=1,
            stories_interval_minutes=DEFAULT_STORIES_INTERVAL_MINUTES,
            reels_interval_minutes=DEFAULT_REELS_INTERVAL_MINUTES,
            updated_at=datetime.utcnow(),
        )
    return row


@db_session
def get_stories_interval_minutes() -> int:
    return _clamp_interval(_ensure_row().stories_interval_minutes)


@db_session
def get_reels_interval_minutes() -> int:
    return _clamp_interval(_ensure_row().reels_interval_minutes)


@db_session
def get_sync_settings_dict() -> dict[str, int]:
    row = _ensure_row()
    return {
        "stories_interval_minutes": _clamp_interval(row.stories_interval_minutes),
        "reels_interval_minutes": _clamp_interval(row.reels_interval_minutes),
    }


@db_session
def update_sync_settings(
    *,
    stories_interval_minutes: int | None = None,
    reels_interval_minutes: int | None = None,
) -> dict[str, int]:
    row = _ensure_row()
    if stories_interval_minutes is not None:
        row.stories_interval_minutes = _clamp_interval(stories_interval_minutes)
    if reels_interval_minutes is not None:
        row.reels_interval_minutes = _clamp_interval(reels_interval_minutes)
    row.updated_at = datetime.utcnow()
    return {
        "stories_interval_minutes": _clamp_interval(row.stories_interval_minutes),
        "reels_interval_minutes": _clamp_interval(row.reels_interval_minutes),
    }
