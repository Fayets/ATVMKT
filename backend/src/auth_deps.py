"""Autenticación de la API.

La identidad del request sale SIEMPRE del JWT firmado por el backend.
Nunca de un header que manda el cliente: `X-User-Id` era suplantable
(cualquiera mandaba `X-User-Id: 1` y leía/escribía datos de otro usuario).
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated

from decouple import config
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pony.orm import db_session

from src.models import AuthUser

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = config("JWT_EXPIRE_MINUTES", cast=int, default=60 * 24)

# auto_error=False para devolver nuestro propio 401 en vez del genérico de FastAPI.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


def jwt_secret() -> str:
    """Sin JWT_SECRET en el .env el backend no autentica a nadie (falla cerrado)."""
    secret = str(config("JWT_SECRET", default="") or "").strip()
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT_SECRET no configurado en el servidor.",
        )
    return secret


def create_access_token(username: str, user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": username, "user_id": int(user_id), "exp": expire}
    return jwt.encode(payload, jwt_secret(), algorithm=JWT_ALGORITHM)


def get_current_username(token: Annotated[str | None, Depends(oauth2_scheme)] = None) -> str:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión requerida.",
            headers=_UNAUTHORIZED,
        )
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión inválida o expirada.",
            headers=_UNAUTHORIZED,
        ) from exc

    username = payload.get("sub")
    if not isinstance(username, str) or not username.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión inválida o expirada.",
            headers=_UNAUTHORIZED,
        )
    return username.strip()


def get_current_user_id(username: Annotated[str, Depends(get_current_username)]) -> int:
    """El id se resuelve contra la BD, no se confía en lo que venga en el token."""
    with db_session:
        user = AuthUser.get(username=username)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sesión inválida o expirada.",
                headers=_UNAUTHORIZED,
            )
        return user.id


def require_user_id(user_id: Annotated[int, Depends(get_current_user_id)]) -> str:
    """Los controllers esperan el id como str (antes lo leían del header X-User-Id)."""
    return str(user_id)


# Alias histórico usado por stories_controller.
get_current_user = require_user_id
