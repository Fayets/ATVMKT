from decouple import config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.controllers.airtable_controller import router as airtable_router
from src.controllers.bio_controller import router as bio_router
from src.controllers.conexiones_controller import router as conexiones_router
from src.controllers.health_controller import router as health_router
from src.controllers.reels_controller import router as reels_router
from src.db import init_db

app = FastAPI(title="ATVMkt Backend", version="0.1.0")

_origins = config("CORS_ORIGINS", default="http://localhost:3000,http://127.0.0.1:3000")
_allow_origins = [o.strip() for o in _origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(airtable_router)
app.include_router(conexiones_router)
app.include_router(reels_router)
app.include_router(bio_router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()

