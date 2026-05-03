from datetime import date, datetime
from pony.orm import Json, Optional, PrimaryKey, Required, Set, composite_key
from src.db import db


class AuthUser(db.Entity):
    id = PrimaryKey(int, auto=True)
    username = Required(str, unique=True)
    password_hash = Required(str)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


class ApiConnection(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    platform = Required(str)
    credentials = Required(Json, default=lambda: {})
    last_sync_at = Optional(datetime)
    updated_at = Optional(datetime)

    composite_key(user_id, platform)


class StorySequence(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    sequence_date = Required(date)
    title = Optional(str)
    dolor = Optional(str)
    angulo = Optional(str)
    cta = Optional(str)
    cash = Required(float, default=0)
    chats = Required(int, default=0)
    has_cta = Required(bool, default=False)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)
    slides = Set("StorySlide")


class StorySlide(db.Entity):
    id = PrimaryKey(int, auto=True)
    sequence = Required(StorySequence, column="sequence_id")
    order_index = Required(int)
    instagram_media_id = Optional(str)
    image_url = Optional(str)
    reach = Optional(int)
    replies = Optional(int)
    navigation = Optional(int)
    profile_visits = Optional(int)
    synced_at = Optional(datetime)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class ReelContent(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    instagram_id = Required(str, unique=True)
    title = Optional(str)
    thumbnail_url = Optional(str)
    permalink = Optional(str)
    fecha_publicacion = Optional(datetime)
    # Métricas Instagram
    plays = Required(int, default=0)
    reach = Required(int, default=0)
    likes = Required(int, default=0)
    comentarios = Required(int, default=0)
    shares = Required(int, default=0)
    guardados = Required(int, default=0)
    # Campos negocio
    keyword = Optional(str)
    cash = Required(float, default=0)
    chats_manuales = Required(int, default=0)
    dolor = Optional(str)
    angulos = Optional(str)
    cta = Optional(str)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


class MasterList(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    category = Required(str)
    items = Required(Json, default=lambda: [])
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)

    composite_key(user_id, category)


class Lead(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    # Identificación (Optional(str) con default="" para evitar None al instanciar en Pony)
    nombre = Optional(str, default="")
    ig = Optional(str, default="")
    telefono = Optional(str, default="")
    avatar = Optional(str, default="")
    origen = Optional(str, default="")
    keyword = Optional(str, default="")
    content_url = Optional(str, default="")
    fecha_bot = Optional(datetime)
    respondio_auto = Optional(bool, default=False)
    manychat_contact_id = Optional(str, default="")
    # Calificación
    status = Optional(str, default="")
    via = Optional(str, default="")
    punto_agenda = Optional(str, default="")
    ctas_respondidos = Optional(int, default=0)
    primer_contacto = Optional(datetime)
    # Agenda (agendo = cuándo completó el formulario / webhook Calendly; call = slot elegido; agendo_en = canal)
    agendo = Optional(datetime)
    agendo_en = Optional(str)
    dias_para_agendar = Optional(int)
    call = Optional(datetime)
    link_llamada = Optional(str, default="")
    # Negocio
    dolores_setting = Optional(str, default="")
    ingresos_lead = Optional(float, default=0)
    dolores_llamada = Optional(str, default="")
    razon_compra = Optional(str, default="")
    programa_ofrecido = Optional(str, default="")
    # Ventas
    pago = Optional(float, default=0)
    debe = Optional(float, default=0)
    estado = Optional(str, default="")
    notas = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())
