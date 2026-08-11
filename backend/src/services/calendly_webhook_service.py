"""Auto-registro de la suscripción de webhook de Calendly al conectar una cuenta."""
from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

_CALENDLY_API = "https://api.calendly.com"
_TIMEOUT = 10.0


def ensure_calendly_webhook_subscription(api_key: str, public_site_url: str) -> dict:
    """
    Crea (si no existe) la suscripción de webhook invitee.created apuntando a
    {public_site_url}/api/webhooks/calendly.

    Devuelve un dict para mergear en las credenciales guardadas:
      {"webhook_subscription_uri": "...", "signing_key": "..."}
    o {} si algo falló (no debe romper el flujo de guardado de la conexión).
    """
    if not api_key or not public_site_url:
        return {}

    target_url = f"{public_site_url.rstrip('/')}/api/webhooks/calendly"
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            me = client.get(f"{_CALENDLY_API}/users/me", headers=headers)
            me.raise_for_status()
            resource = me.json()["resource"]
            user_uri = resource["uri"]
            org_uri = resource["current_organization"]

            existing = client.get(
                f"{_CALENDLY_API}/webhook_subscriptions",
                headers=headers,
                params={"organization": org_uri, "scope": "user", "user": user_uri},
            )
            existing.raise_for_status()
            for sub in existing.json().get("collection", []):
                if sub.get("callback_url") == target_url and sub.get("state") == "active":
                    return {"webhook_subscription_uri": sub["uri"]}

            created = client.post(
                f"{_CALENDLY_API}/webhook_subscriptions",
                headers=headers,
                json={
                    "url": target_url,
                    "events": ["invitee.created"],
                    "organization": org_uri,
                    "user": user_uri,
                    "scope": "user",
                },
            )
            created.raise_for_status()
            payload = created.json()["resource"]
            result = {"webhook_subscription_uri": payload["uri"]}
            if payload.get("signing_key"):
                result["signing_key"] = payload["signing_key"]
            return result
    except Exception:
        logger.warning("No se pudo auto-registrar el webhook de Calendly", exc_info=True)
        return {}
