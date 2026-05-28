import os
import glob
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from decouple import config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pony.orm import db_session

from src.controllers.auth_controller import router as auth_router
from src.controllers.bio_controller import router as bio_router
from src.controllers.conexiones_controller import router as conexiones_router
# from src.controllers.health_controller import router as health_router
from src.controllers.master_lists_controller import router as master_lists_router
from src.controllers.programs_controller import router as programs_router
from src.controllers.keywords_controller import router as keywords_router
from src.controllers.leads_controller import router as leads_router
from src.controllers.reels_controller import router as reels_router
from src.controllers.stories_controller import router as stories_router
from src.controllers.sync_settings_controller import router as sync_settings_router
from src.controllers.team_controller import router as team_router
from src.controllers.youtube_controller import router as youtube_router
from src.controllers.webhook_controller import router as webhook_router
from src.db import db, init_db
from src.models import ApiConnection
from src.services.reels_services import ReelsServices
from src.services.sync_scheduler_service import (
    REELS_JOB_ID,
    STORIES_JOB_ID,
    apply_sync_schedules,
    bind_sync_scheduler,
)
from src.services.sync_settings_service import (
    DEFAULT_REELS_INTERVAL_MINUTES,
    DEFAULT_STORIES_INTERVAL_MINUTES,
    get_reels_interval_minutes,
    get_stories_interval_minutes,
)
from src.services.stories_service import StoriesService

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
scheduler = AsyncIOScheduler()


async def auto_sync_stories() -> None:
    """Sincroniza Instagram para todos los usuarios que tengan ApiConnection de instagram"""
    try:
        with db_session:
            _ = db
            connections = list(ApiConnection.select().filter(lambda c: c.platform == "instagram"))
            user_ids = [c.user_id for c in connections]

        service = StoriesService()
        for user_id in user_ids:
            try:
                result = await service.sync_instagram(str(user_id))
                print(f"[scheduler] Sync automático OK para {user_id}: {result}")
            except Exception as e:
                print(f"[scheduler] Sync automático FAILED para {user_id}: {e}")
    except Exception as e:
        print(f"[scheduler] Error general en auto_sync_stories: {e}")


async def auto_refresh_reels_metrics() -> None:
    """Actualiza métricas en BD de reels ya existentes (Graph API por instagram_id)."""
    try:
        with db_session:
            _ = db
            connections = list(ApiConnection.select().filter(lambda c: c.platform == "instagram"))
            user_ids = [c.user_id for c in connections]

        service = ReelsServices()
        for user_id in user_ids:
            try:
                result = await service.refresh_metrics(str(user_id))
                print(f"[scheduler] Reels refresh-metrics OK para {user_id}: {result}")
            except Exception as e:
                print(f"[scheduler] Reels refresh-metrics FAILED para {user_id}: {e}")
    except Exception as e:
        print(f"[scheduler] Error general en auto_refresh_reels_metrics: {e}")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    archivos = glob.glob(os.path.join(media_dir, "**/*.jpg"), recursive=True)
    print(f"[media] Archivos encontrados: {len(archivos)}")
    print(f"[media] Directorio: {media_dir}")
    scheduler.add_job(
        auto_sync_stories,
        trigger=IntervalTrigger(minutes=DEFAULT_STORIES_INTERVAL_MINUTES),
        id=STORIES_JOB_ID,
        replace_existing=True,
        next_run_time=datetime.now(AR_TZ),
    )
    scheduler.add_job(
        auto_refresh_reels_metrics,
        trigger=IntervalTrigger(minutes=DEFAULT_REELS_INTERVAL_MINUTES),
        id=REELS_JOB_ID,
        replace_existing=True,
    )
    bind_sync_scheduler(scheduler)
    apply_sync_schedules()
    scheduler.start()
    print(
        f"[scheduler] Auto-sync historias cada {get_stories_interval_minutes()} min "
        f"(próximo job según APScheduler)"
    )
    print(
        f"[scheduler] Auto refresh-metrics reels cada {get_reels_interval_minutes()} min"
    )
    yield
    scheduler.shutdown()


app = FastAPI(title="ATVMkt Backend", version="0.1.0", lifespan=lifespan)
# Ruta absoluta desde la ubicación de main.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
media_dir = os.path.join(BASE_DIR, "media")
os.makedirs(media_dir, exist_ok=True)
app.mount("/media", StaticFiles(directory=media_dir), name="media")

_origins = config("CORS_ORIGINS", default="http://localhost:3000,http://127.0.0.1:3000")
_allow_origins = [o.strip() for o in _origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# app.include_router(health_router)
app.include_router(auth_router)
app.include_router(conexiones_router)
app.include_router(master_lists_router)
app.include_router(programs_router)
app.include_router(leads_router)
app.include_router(keywords_router)
app.include_router(reels_router)
app.include_router(bio_router)
app.include_router(stories_router)
app.include_router(sync_settings_router)
app.include_router(team_router)
app.include_router(youtube_router)
app.include_router(webhook_router)
