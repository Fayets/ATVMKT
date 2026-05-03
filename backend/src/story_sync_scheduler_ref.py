"""Referencia al scheduler para exponer la próxima corrida real de `auto_sync_stories`."""

from __future__ import annotations

from datetime import datetime
from typing import Any

_scheduler: Any | None = None


def bind_stories_scheduler(scheduler: Any) -> None:
    global _scheduler
    _scheduler = scheduler


def next_auto_sync_stories_run_time() -> datetime | None:
    if _scheduler is None:
        return None
    job = _scheduler.get_job("auto_sync_stories")
    if job is None:
        return None
    t = job.next_run_time
    return t
