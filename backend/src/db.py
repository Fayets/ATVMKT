from urllib.parse import parse_qs, unquote, urlparse

from decouple import config
from pony.orm import Database, db_session

db = Database()


def _bind_from_database_url(url: str) -> None:
    parsed = urlparse(url.strip())
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("postgres", "postgresql"):
        raise ValueError(
            "DATABASE_URL debe usar el esquema postgres:// o postgresql://."
        )
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    host = parsed.hostname or ""
    if not host:
        raise ValueError("DATABASE_URL no incluye host.")
    port = parsed.port or 5432
    path = (parsed.path or "").lstrip("/")
    database = path.split("/")[0] if path else ""
    if not database:
        raise ValueError("DATABASE_URL no incluye el nombre de la base.")

    qs = parse_qs(parsed.query)
    sslmode = (qs.get("sslmode") or [None])[0] or "require"

    db.bind(
        provider="postgres",
        user=user,
        password=password,
        host=host,
        port=port,
        database=database,
        sslmode=sslmode,
    )


def _bind_from_discrete_env() -> None:
    host = config("DB_HOST", default="").strip()
    database = config("DB_NAME", default="").strip()
    user = config("DB_USER", default="").strip()
    password = (config("DB_PASS", default="") or config("DB_PASSWORD", default="")).strip()
    if not (host and database and user and password):
        raise RuntimeError(
            "Falta configuración de base de datos. Definí DATABASE_URL (Neon) "
            "o las variables DB_HOST, DB_NAME, DB_USER y DB_PASS en backend/.env."
        )
    db.bind(
        provider=config("DB_PROVIDER", default="postgres"),
        host=host,
        user=user,
        password=password,
        database=database,
        port=config("DB_PORT", default=5432, cast=int),
        sslmode=config("DB_SSLMODE", default="require"),
    )


def init_db() -> None:
    database_url = config("DATABASE_URL", default="").strip()
    if database_url:
        _bind_from_database_url(database_url)
    else:
        _bind_from_discrete_env()

    # Importa entidades para que Pony las registre antes del mapping.
    import src.models  # noqa: F401

    # Avoid startup crash when model changes add new columns that are not
    # present yet; we run idempotent ALTERs right after.
    db.generate_mapping(create_tables=True, check_tables=False)

    # Idempotent schema migration for reels keyword linkage.
    with db_session:
        db.execute("ALTER TABLE reelcontent ADD COLUMN IF NOT EXISTS keyword text")
        db.execute("ALTER TABLE reelcontent ADD COLUMN IF NOT EXISTS chats_count integer DEFAULT 0")
        db.execute("ALTER TABLE reelcontent ADD COLUMN IF NOT EXISTS manual_cash double precision")
        db.execute("ALTER TABLE reelcontent ADD COLUMN IF NOT EXISTS manual_chats integer")
        db.execute("ALTER TABLE reelcontent ADD COLUMN IF NOT EXISTS content_url text")
        db.execute(
            """
            UPDATE reelcontent
            SET content_url = url
            WHERE (content_url IS NULL OR btrim(content_url) = '')
              AND url IS NOT NULL
              AND btrim(url) <> ''
            """
        )
        db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_reelcontent_user_keyword_nonempty
            ON reelcontent (user_id, lower(btrim(keyword)))
            WHERE keyword IS NOT NULL AND btrim(keyword) <> ''
            """
        )
