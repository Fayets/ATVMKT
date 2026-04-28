from datetime import date, datetime
from uuid import uuid4

from pony.orm import Json, Optional, PrimaryKey, Required, Set, composite_key

from src.db import db


class HealthCheck(db.Entity):
    id = PrimaryKey(int, auto=True)


class User(db.Entity):
    id = PrimaryKey(str)
    story_sequences = Set("StorySequence")


class AuthUser(db.Entity):
    id = PrimaryKey(str, default=lambda: str(uuid4()))
    username = Required(str, unique=True)
    password_hash = Required(str)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


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


class StorySequence(db.Entity):
    id = PrimaryKey(int, auto=True)
    user = Required(User)
    sequence_date = Required(date)
    title = Optional(str)
    dolor = Optional(str)
    angulo = Optional(str)
    cta_text = Optional(str)
    cash_generado = Required(int, default=0)
    has_cta = Required(bool, default=False)
    chats = Required(int, default=0)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    slides = Set("StorySlide")


class StorySlide(db.Entity):
    id = PrimaryKey(int, auto=True)
    sequence = Required(StorySequence)
    order_index = Required(int)
    image_url = Optional(str)
    dolor = Optional(str)
    angulo = Optional(str)
    cta_text = Optional(str)
    instagram_media_id = Optional(str)
    reach = Optional(int)
    like_count = Optional(int)
    replies = Optional(int)
    navigation = Optional(int)
    profile_visits = Optional(int)
    synced_at = Optional(datetime)
