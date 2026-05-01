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


def init_db() -> None:
    import src.models  # noqa: F401 — registrar entidades Pony antes del mapping

    db.generate_mapping(create_tables=True)