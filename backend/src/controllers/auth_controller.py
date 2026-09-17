from datetime import datetime
from typing import Annotated

import secrets

import bcrypt
from decouple import config
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pony.orm import db_session

from src.auth_deps import (
    create_access_token,
    get_current_user_id,
    get_current_username,
)
from src.models import AuthUser
from src.schemas import (
    AuthChangePasswordRequest,
    AuthChangePasswordResponse,
    AuthLoginRequest,
    AuthMeResponse,
    AuthRegisterRequest,
    AuthTokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Re-export para los controllers que ya lo importaban desde acá.
__all__ = ["router", "get_current_user_id", "get_current_username"]


def require_register_key(
    x_register_key: Annotated[str | None, Header(alias="X-Register-Key")] = None,
) -> None:
    """Alta de usuarios: solo con la llave del servidor. Sin llave configurada, nadie se registra."""
    expected = str(config("REGISTER_ADMIN_KEY", default="") or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="REGISTER_ADMIN_KEY no configurado en el servidor.",
        )
    provided = str(x_register_key or "").strip()
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado.")


@router.post("/register", response_model=AuthTokenResponse)
def register_user(
    body: AuthRegisterRequest,
    _: Annotated[None, Depends(require_register_key)],
):
    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username and password are required")

    with db_session:
        existing = AuthUser.get(username=username)
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")

        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user = AuthUser(username=username, password_hash=password_hash, updated_at=datetime.utcnow())
        uid = user.id

    return AuthTokenResponse(access_token=create_access_token(username, uid), user_id=uid)


@router.post("/login", response_model=AuthTokenResponse)
def login_user(body: AuthLoginRequest):
    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username and password are required")

    with db_session:
        user = AuthUser.get(username=username)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        valid_password = bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))
        if not valid_password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        uid = user.id

    return AuthTokenResponse(access_token=create_access_token(username, uid), user_id=uid)


@router.get("/me", response_model=AuthMeResponse)
def me(
    username: Annotated[str, Depends(get_current_username)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    return AuthMeResponse(username=username, user_id=user_id)


@router.post("/change-password", response_model=AuthChangePasswordResponse)
def change_password(
    body: AuthChangePasswordRequest,
    username: str = Depends(get_current_username),
):
    current_password = body.current_password
    new_password = body.new_password
    if not current_password or not new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="current_password and new_password are required",
        )
    if len(new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe tener al menos 6 caracteres",
        )

    with db_session:
        user = AuthUser.get(username=username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

        valid_password = bcrypt.checkpw(
            current_password.encode("utf-8"),
            user.password_hash.encode("utf-8"),
        )
        if not valid_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Contraseña actual incorrecta",
            )

        if bcrypt.checkpw(new_password.encode("utf-8"), user.password_hash.encode("utf-8")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La nueva contraseña debe ser distinta a la actual",
            )

        user.password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user.updated_at = datetime.utcnow()

    return AuthChangePasswordResponse()
