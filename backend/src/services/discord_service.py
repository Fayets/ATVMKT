from __future__ import annotations

import json
from typing import Any

import httpx
from decouple import config


class DiscordServices:
    """Integraciones con webhooks de Discord (sin Pony)."""

    def is_setter_webhook_configured(self) -> bool:
        return bool((config("DISCORD_SETTER_WEBHOOK_URL", default="") or "").strip())

    def send_setter_report_to_discord(self, member_name: str, body: dict[str, Any]) -> bool:
        webhook_url = (config("DISCORD_SETTER_WEBHOOK_URL", default="") or "").strip()
        if not webhook_url:
            return False

        avatar_raw = body.get("avatar_tipo_agendas") or ""
        try:
            avatar_dict = json.loads(avatar_raw) if avatar_raw else {}
            avatar_lines = "\n".join([f"· {k}: {v}" for k, v in avatar_dict.items() if v > 0])
        except Exception:
            avatar_lines = str(avatar_raw).strip()

        embed = {
            "title": f"REPORTE SETTER · {member_name.upper()} · {str(body.get('fecha'))}",
            "color": 0x2B2D31,
            "fields": [
                {
                    "name": "MÉTRICAS",
                    "value": (
                        f"Conversaciones: **{body.get('conversaciones', 0)}**\n"
                        f"Agendas: **{body.get('agendas', 0)}**\n"
                        f"Calendlys enviados: **{body.get('links_enviados', 0)}**"
                    ),
                    "inline": False,
                },
                {
                    "name": "ACTIVIDAD",
                    "value": (
                        f"Leads nuevos: **{body.get('leads_nuevos', 0)}**\n"
                        f"Seguimientos: **{body.get('seguimientos', 0)}**\n"
                        f"Outbounds: **{body.get('outbounds', 0)}**"
                    ),
                    "inline": False,
                },
                {
                    "name": "AVATARES AGENDADOS",
                    "value": avatar_lines if avatar_lines else "—",
                    "inline": False,
                },
                {
                    "name": "TIPO DE TRÁFICO",
                    "value": body.get("sentimiento_trafico") or "—",
                    "inline": False,
                },
                {
                    "name": "DÍA BUENO O MALO",
                    "value": body.get("dia_bueno_malo") or "—",
                    "inline": False,
                },
                {
                    "name": "FEEDBACK A MKT",
                    "value": body.get("insights_marketing") or "—",
                    "inline": False,
                },
            ],
        }

        try:
            resp = httpx.post(webhook_url, json={"embeds": [embed]}, timeout=5.0)
            return resp.is_success
        except Exception:
            return False

    def is_closer_ventas_webhook_configured(self) -> bool:
        return bool((config("DISCORD_CLOSER_VENTAS_WEBHOOK_URL", default="") or "").strip())

    def send_closer_ventas_to_discord(self, member_name: str, body: dict[str, Any]) -> bool:
        webhook_url = (config("DISCORD_CLOSER_VENTAS_WEBHOOK_URL", default="") or "").strip()
        if not webhook_url:
            return False

        embed = {
            "title": f"REPORTE CLOSER · VENTAS · {member_name.upper()} · {str(body.get('fecha'))}",
            "color": 0xE74C3C,
            "fields": [
                {
                    "name": "MÉTRICAS",
                    "value": (
                        f"Llamadas agendadas: **{body.get('llamadas_agendadas', 0)}**\n"
                        f"Shows: **{body.get('shows', 0)}**\n"
                        f"Cierres: **{body.get('cierres', 0)}**\n"
                        f"Calificados: **{body.get('calificados', 0)}**\n"
                        f"Descalificados: **{body.get('descalificados', 0)}**\n"
                        f"Ingreso: **${body.get('ingreso', 0)}**"
                    ),
                    "inline": False,
                },
                {
                    "name": "NOTAS",
                    "value": body.get("notas") or "—",
                    "inline": False,
                },
            ],
        }

        try:
            resp = httpx.post(webhook_url, json={"embeds": [embed]}, timeout=5.0)
            return resp.is_success
        except Exception:
            return False

    def is_closer_marketing_webhook_configured(self) -> bool:
        return bool((config("DISCORD_CLOSER_MARKETING_WEBHOOK_URL", default="") or "").strip())

    def send_closer_marketing_to_discord(self, member_name: str, body: dict[str, Any]) -> bool:
        webhook_url = (config("DISCORD_CLOSER_MARKETING_WEBHOOK_URL", default="") or "").strip()
        if not webhook_url:
            return False

        embed = {
            "title": f"REPORTE CLOSER · MARKETING · {member_name.upper()} · {str(body.get('fecha'))}",
            "color": 0x5865F2,
            "fields": [
                {
                    "name": "LEAD",
                    "value": (
                        f"Nombre: **{body.get('nombre_lead') or '—'}**\n"
                        f"Estado final: **{body.get('estado_final_llamada') or '—'}**\n"
                        f"Perfil: **{body.get('perfil_lead') or '—'}**"
                    ),
                    "inline": False,
                },
                {
                    "name": "CUALITATIVO",
                    "value": (
                        f"Objeción/Miedo: {body.get('objecion_miedo') or '—'}\n"
                        f"Dolores en llamada: {body.get('dolores_llamada') or '—'}\n"
                        f"Razón de compra: {body.get('razon_compra_final') or '—'}"
                    ),
                    "inline": False,
                },
                {
                    "name": "INSIGHTS MARKETING",
                    "value": body.get("insights_marketing_llamada") or "—",
                    "inline": False,
                },
            ],
        }

        try:
            resp = httpx.post(webhook_url, json={"embeds": [embed]}, timeout=5.0)
            return resp.is_success
        except Exception:
            return False
