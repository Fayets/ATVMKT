from pony.orm import *
from decouple import config

db = Database()

db.bind(
    provider=config("DB_PROVIDER"),
    user=config("DB_USER"),
    password=config("DB_PASS"),
    host=config("DB_HOST"),
    database=config("DB_NAME"),
)


def _ensure_lead_canal_agendo_column() -> None:
    """Pony no hace ALTER en tablas ya creadas; esta columna debe existir antes de check_tables."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    ddl = "ADD COLUMN IF NOT EXISTS canal_agendo VARCHAR(64) DEFAULT ''"
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            for table in ('lead', '"Lead"'):
                try:
                    cur.execute(f"ALTER TABLE {table} {ddl}")
                    break
                except Exception:
                    continue
    finally:
        conn.close()


def init_db() -> None:
    import src.models  # noqa: F401 — registrar entidades Pony antes del mapping

    _ensure_lead_canal_agendo_column()
    db.generate_mapping(create_tables=True)