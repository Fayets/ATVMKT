import re
from datetime import datetime

from decouple import config
from pony.orm import *

db = Database()

db.bind(
    provider=config("DB_PROVIDER"),
    user=config("DB_USER"),
    password=config("DB_PASS"),
    host=config("DB_HOST"),
    database=config("DB_NAME"),
)


def _migrate_postgres_lead_call_to_timestamp() -> None:
    """Postgres: columna `call` pasa de boolean a TIMESTAMP (fecha Calendly).

    Copia datos desde fecha_cita si existía; elimina fecha_cita al final.
    """
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
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical

            cur.execute(
                """
                SELECT data_type FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s AND column_name = 'call'
                """,
                (physical,),
            )
            cr = cur.fetchone()
            if not cr:
                return
            dtype = (cr[0] or "").lower()

            if dtype == "boolean":
                for ddl in (
                    f"ALTER TABLE {sql_table} ADD COLUMN fecha_cita TIMESTAMP NULL",
                    f"ALTER TABLE {sql_table} ADD COLUMN _call_slot_ts TIMESTAMP NULL",
                ):
                    try:
                        cur.execute(ddl)
                    except Exception:
                        pass
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET _call_slot_ts = fecha_cita "
                        f"WHERE fecha_cita IS NOT NULL"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN call")
                except Exception:
                    return
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} RENAME COLUMN _call_slot_ts TO call"
                    )
                except Exception:
                    return
            elif "timestamp" in dtype:
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET call = fecha_cita "
                        f"WHERE call IS NULL AND fecha_cita IS NOT NULL"
                    )
                except Exception:
                    pass

            try:
                cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS fecha_cita")
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_lead_agendo_to_timestamp() -> None:
    """Postgres: columna `agendo` pasa de boolean a TIMESTAMP (momento del webhook / form completo)."""
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
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical

            cur.execute(
                """
                SELECT data_type FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s AND column_name = 'agendo'
                """,
                (physical,),
            )
            ar = cur.fetchone()
            if not ar:
                return
            dtype = (ar[0] or "").lower()

            if dtype == "boolean":
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} ADD COLUMN _agendo_ts TIMESTAMP NULL"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET _agendo_ts = call "
                        f"WHERE agendo IS TRUE AND call IS NOT NULL"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET _agendo_ts = created_at "
                        f"WHERE agendo IS TRUE AND _agendo_ts IS NULL"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET _agendo_ts = NOW() AT TIME ZONE 'utc' "
                        f"WHERE agendo IS TRUE AND _agendo_ts IS NULL"
                    )
                except Exception:
                    try:
                        cur.execute(
                            f"UPDATE {sql_table} SET _agendo_ts = NOW() "
                            f"WHERE agendo IS TRUE AND _agendo_ts IS NULL"
                        )
                    except Exception:
                        pass
                try:
                    cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN agendo")
                except Exception:
                    return
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} RENAME COLUMN _agendo_ts TO agendo"
                    )
                except Exception:
                    return
    finally:
        conn.close()


def _migrate_postgres_drop_pago_en_llamada() -> None:
    """Elimina `pago_en_llamada`; el importe queda unificado en `pago`."""
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
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s AND column_name = 'pago_en_llamada'
                """,
                (physical,),
            )
            if cur.fetchone():
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET pago = COALESCE(pago, 0) + COALESCE(pago_en_llamada, 0)"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS pago_en_llamada"
                    )
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_drop_canal_agendo() -> None:
    """Elimina columna legada `canal_agendo` (no mapeada en el modelo; canal = agendo_en)."""
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
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS canal_agendo")
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_storyslide_views_shares() -> None:
    """Añade `views` y `shares` a storyslide (Pony no altera tablas existentes en Postgres)."""
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
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'storyslide'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            for ddl in (
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS views INTEGER NULL",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS shares INTEGER NULL",
            ):
                try:
                    cur.execute(ddl)
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_agendo_en_iso_to_call() -> None:
    """ISO en agendo_en → call (fecha) y agendo_en=Chat (canal)."""
    iso_pat = re.compile(r"^\d{4}-\d{2}-\d{2}")
    try:
        import src.models  # noqa: F401
        from src.models import Lead
    except Exception:
        return

    def _parse(s: str) -> datetime | None:
        s = s.strip()
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            try:
                return datetime.fromisoformat(s[:10] + "T00:00:00")
            except ValueError:
                return None
        try:
            cleaned = s.replace("Z", "").split("+")[0]
            dt = datetime.fromisoformat(cleaned)
            if dt.tzinfo is not None:
                dt = dt.replace(tzinfo=None)
            return dt
        except ValueError:
            return None

    try:
        with db_session:
            for row in list(Lead.select()):
                s = (row.agendo_en or "").strip()
                if not s or not iso_pat.match(s):
                    continue
                if row.call is not None:
                    continue
                dt = _parse(s)
                if dt is None:
                    continue
                row.call = dt
                row.agendo_en = "Chat"
    except Exception:
        return


def _migrate_agendo_en_default_chat_when_agendado() -> None:
    """Historial: tiene fecha agendo y agendo_en NULL/vacío. Canal por defecto Chat en BD."""
    try:
        import src.models  # noqa: F401
        from src.models import Lead
    except Exception:
        return
    try:
        with db_session:
            for row in list(Lead.select()):
                if row.agendo is None:
                    continue
                if (row.agendo_en or "").strip():
                    continue
                row.agendo_en = "Chat"
    except Exception:
        return


def _backfill_dias_para_agendar() -> None:
    """Rellena dias_para_agendar = días entre primer_contacto y agendo."""
    try:
        from src.lead_display_utils import compute_dias_para_agendar
        from src.models import Lead
    except Exception:
        return
    try:
        with db_session:
            for row in list(Lead.select()):
                d = compute_dias_para_agendar(row.primer_contacto, row.agendo)
                if row.dias_para_agendar != d:
                    row.dias_para_agendar = d
    except Exception:
        return


def init_db() -> None:
    import src.models  # noqa: F401 — registrar entidades Pony antes del mapping

    _migrate_postgres_lead_call_to_timestamp()
    _migrate_postgres_lead_agendo_to_timestamp()
    _migrate_postgres_drop_pago_en_llamada()
    _migrate_postgres_drop_canal_agendo()
    _migrate_postgres_storyslide_views_shares()
    db.generate_mapping(create_tables=True)
    _migrate_agendo_en_iso_to_call()
    _migrate_agendo_en_default_chat_when_agendado()
    _backfill_dias_para_agendar()
