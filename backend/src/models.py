from datetime import datetime
from uuid import uuid4

from pony.orm import Json, Optional, PrimaryKey, Required, composite_key

from src.db import db


class HealthCheck(db.Entity):
    id = PrimaryKey(int, auto=True)


class ApiConnection(db.Entity):
    """Credenciales por usuario y plataforma (vista Conexiones)."""

    id = PrimaryKey(str, default=lambda: str(uuid4()))
    user_id = Required(str, index=True)
    platform = Required(str)
    credentials = Required(Json, default=lambda: {})
    last_sync_at = Optional(datetime)
    updated_at = Optional(datetime)


class ReelContent(db.Entity):
    """Reels sincronizados desde Apify para la vista Trackeo > Reels."""

    id = PrimaryKey(str, default=lambda: str(uuid4()))
    user_id = Required(str, index=True)
    external_id = Required(str)
    title = Optional(str)
    content_type = Required(str, default="reel")
    platform = Required(str, default="instagram")
    metrics = Required(Json, default=lambda: {})
    classification = Required(Json, default=lambda: {})
    cash = Required(float, default=0)
    chats = Required(int, default=0)
    published_at = Optional(datetime)
    url = Optional(str)
    notes = Optional(str)
    updated_at = Optional(datetime)

    composite_key(user_id, external_id)


class ManychatChat(db.Entity):
    """Chats automáticos capturados desde ManyChat para la vista BIO."""

    id = PrimaryKey(str, default=lambda: str(uuid4()))
    user_id = Required(str, index=True)
    keyword = Required(str)
    contact_name = Optional(str)
    contact_ig_username = Optional(str)
    manychat_contact_id = Optional(str)
    received_at = Required(datetime, default=lambda: datetime.utcnow())
    month = Optional(str)


class BioManualEntry(db.Entity):
    """Entradas manuales para seguimiento de BIO."""

    id = PrimaryKey(str, default=lambda: str(uuid4()))
    user_id = Required(str, index=True)
    month = Optional(str)
    name = Optional(str)
    date = Optional(datetime)
    chats = Required(int, default=0)
    cash = Required(float, default=0)
    notes = Optional(str)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
