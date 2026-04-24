from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str


class ApiConnectionResponse(BaseModel):
    id: str
    user_id: str
    platform: str
    credentials: dict[str, Any] = Field(default_factory=dict)
    last_sync_at: datetime | None = None
    updated_at: datetime | None = None


class ApiConnectionUpsertRequest(BaseModel):
    credentials: dict[str, Any] = Field(default_factory=dict)


class AirtableVerifyResponse(BaseModel):
    ok: bool
    message: str
    whoami_id: str | None = None
    scopes: list[str] = Field(default_factory=list)
    base_id: str | None = None
    table_names: list[str] = Field(default_factory=list)
    table_match: bool | None = None


class AirtableLeadsListResponse(BaseModel):
    """Registros crudos de la tabla configurada (id, createdTime, fields) para la vista Leads."""

    base_id: str | None = None
    table_name: str | None = None
    """Si se usó Table ID (tbl...) en la URL de la API."""
    table_id: str | None = None
    """Vista Airtable (viw…) si está configurada; filtra/ordena como en el tablero."""
    view_id: str | None = None
    records: list[dict[str, Any]] = Field(default_factory=list)


class ReelResponse(BaseModel):
    id: str
    title: str | None = None
    content_type: str
    platform: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    classification: dict[str, Any] = Field(default_factory=dict)
    cash: float = 0
    chats: int = 0
    published_at: datetime | None = None
    url: str | None = None
    notes: str | None = None
    external_id: str


class ReelsListResponse(BaseModel):
    reels: list[ReelResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 10
    total_pages: int = 0
    available_months: list[str] = Field(default_factory=list)
    total_cash: float = 0
    total_chats: int = 0


class ReelPatchRequest(BaseModel):
    cash: float | None = None
    chats: int | None = None


class ReelsSyncRequest(BaseModel):
    limit: int | None = None


class ReelsSyncResponse(BaseModel):
    success: bool
    total: int = 0
    new: int = 0
    updated: int = 0
    detail: str | None = None


class ManychatChatResponse(BaseModel):
    id: str
    keyword: str
    contact_name: str | None = None
    contact_ig_username: str | None = None
    received_at: datetime
    """ID suscriptor ManyChat (si viene de la API live)."""
    manychat_subscriber_id: str | None = None
    """Último texto que envió el contacto (API ManyChat), suele ser la keyword."""
    manychat_last_input: str | None = None
    """Resumen de custom fields del suscriptor (para contexto / bio)."""
    manychat_custom_fields_preview: str | None = None
    # Enlace con Airtable (mismo IG que columna IG / Instagram en leads)
    lead_airtable_record_id: str | None = None
    lead_status: str | None = None
    lead_client_name: str | None = None
    lead_program_purchased: str | None = None
    lead_program_offered: str | None = None
    lead_payment: float | None = None
    lead_revenue: float | None = None
    lead_ig_bio_snapshot: str | None = None
    lead_automation_reply_snapshot: str | None = None


class BioManualEntryResponse(BaseModel):
    id: str
    name: str | None = None
    date: datetime | None = None
    chats: int = 0
    cash: float = 0
    notes: str | None = None


class BioDataResponse(BaseModel):
    auto_chats: list[ManychatChatResponse] = Field(default_factory=list)
    manual_entries: list[BioManualEntryResponse] = Field(default_factory=list)
    is_connected: bool = False
    available_months: list[str] = Field(default_factory=list)
    manychat_automation_name: str | None = None
    manychat_bio_tag_id: int | None = None
    manychat_bio_tag_reply_id: int | None = None


class ManychatLiveSummaryResponse(BaseModel):
    page_name: str | None = None
    category: str | None = None
    timezone: str | None = None
    tags_count: int = 0
    growth_tools_count: int = 0
    custom_fields_count: int = 0
    bot_fields_count: int = 0
    sample_tags: list[str] = Field(default_factory=list)
    sample_growth_tools: list[str] = Field(default_factory=list)


class ManychatAutomationStatsResponse(BaseModel):
    """
    Métricas aproximadas para la automatización BIO.
    ManyChat no documenta un endpoint público equivalente al panel (envíos, % abierto por nodo);
    usamos getFlows + conteo de contactos por tags configurados.
    """

    info_note: str | None = None
    flow_found: bool = False
    flow_name: str | None = None
    flow_ns: str | None = None
    """Objeto del flow devuelto por getFlows (puede incluir campos extra según versión de API)."""
    flow_raw: dict[str, Any] = Field(default_factory=dict)
    getflows_error: str | None = None

    entry_tag_id: int | None = None
    entry_tag_name: str | None = None
    entry_contacts_count: int = 0
    entry_tag_error: str | None = None

    reply_tag_id: int | None = None
    reply_tag_name: str | None = None
    reply_contacts_count: int = 0
    reply_tag_error: str | None = None

    reply_rate_percent: float | None = None


class BioManualEntryCreateRequest(BaseModel):
    month: str | None = None
    name: str | None = None
    date: datetime | None = None
    chats: int = 0
    cash: float = 0
    notes: str | None = None


class BioAutomationConfigRequest(BaseModel):
    manychat_automation_name: str | None = None
    manychat_bio_tag_id: int | None = None
    """Tag ManyChat de quienes completan el embudo (ej. 'responde la auto de la bio')."""
    manychat_bio_tag_reply_id: int | None = None


class BioLeadResponse(BaseModel):
    id: str
    handle: str
    nombre: str | None = None
    avatar_url: str | None = None
    subscribed_at: str | None = None
    keyword: str | None = None
    """Valor del single select / texto \"Vía\" en Airtable (Perfil, Automático - ManyChat, etc.)."""
    via: str | None = None
    airtable_found: bool = False
    airtable_record_id: str | None = None
    status: str | None = None
    setter: str | None = None
    programa: str | None = None
    pago: float | None = None
    fecha_agendo: str | None = None
    llamada_url: str | None = None
    dolores: str | None = None
    razon_compra: str | None = None
    notas: str | None = None
    manychat_chat_url: str | None = None
    respondio_auto: bool = False


class BioLeadsListResponse(BaseModel):
    leads: list[BioLeadResponse] = Field(default_factory=list)
    manychat_active: bool = True
    connected_to_airtable: bool = True


class BioLeadStatusPatchRequest(BaseModel):
    status: str


class BioLeadDescriptionPatchRequest(BaseModel):
    bio_descripcion: str | None = None


class BioMetricsResponse(BaseModel):
    total_leads: int = 0
    agendaron: int = 0
    cerrados: int = 0
    cash_total: float = 0
    cash_por_lead: float = 0
    tasa_conversion: float = 0
    cash_por_chat: float = 0
    tasa_respuesta_auto: float | None = None


class BioManychatStatusResponse(BaseModel):
    connected: bool = False
    tag: str = ""
    total_subscribers: int = 0


class BioViaOptionsResponse(BaseModel):
    """Valores únicos del campo Vía en la tabla de leads (Airtable)."""

    options: list[str] = Field(default_factory=list)
