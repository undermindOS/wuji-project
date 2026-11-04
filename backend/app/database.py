from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def session_factory(url: str):
    engine = create_engine(url, pool_pre_ping=True, connect_args={'connect_timeout': 5})
    return engine, sessionmaker(engine, expire_on_commit=False)


def migrate(url: str):
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    config.attributes['database_url'] = url
    command.upgrade(config, 'head')
