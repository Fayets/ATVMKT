"""Servidor de desarrollo con SOLO el router de reportes de ATV MKT.

Deliberadamente NO usa main.py: ese arranca APScheduler con sync automático de
historias, reels, Calendly y Google Calendar. Como el .env apunta a la base de
producción, levantarlo entero pondría una segunda instancia sincronizando
contra la misma base que el VPS.

Acá: mapping sin create_tables (no toca el schema) y un único endpoint de lectura.
"""

import os
import sys

BACKEND = "/Users/francoayet/Desktop/ATV/atv-mkt/backend"
os.chdir(BACKEND)
sys.path.insert(0, BACKEND)

from fastapi import FastAPI                      # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from src.db import db                            # noqa: E402
import src.models                                # noqa: E402,F401

db.generate_mapping(create_tables=False)

from src.controllers.reportes_controller import router as reportes_router  # noqa: E402

app = FastAPI(title="ATV MKT — reportes (dev, solo lectura)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(reportes_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "modo": "solo-lectura", "schedulers": "desactivados"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="warning")
