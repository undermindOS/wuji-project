import os
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.config import Settings
from app.database import migrate
from app.local_db import ensure_local_database
from app.main import create_app


@pytest.fixture(scope='session')
def database_url():
    if os.environ.get('DATABASE_URL'):
        pytest.fail('Tests require the isolated local cluster; unset DATABASE_URL first.')
    settings = Settings.from_env()
    ensure_local_database(settings)
    database = 'wuji_test_' + uuid4().hex
    assert database.startswith('wuji_test_')
    admin = create_engine(make_url(settings.database_url).set(database='postgres'), isolation_level='AUTOCOMMIT')
    with admin.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{database}"')
    url = make_url(settings.database_url).set(database=database).render_as_string(hide_password=False)
    migrate(url)
    yield url
    with admin.connect() as connection:
        connection.exec_driver_sql(f'DROP DATABASE "{database}" WITH (FORCE)')
    admin.dispose()


@pytest.fixture
def settings(database_url, tmp_path):
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text('TRUNCATE import_drafts, task_specs, source_versions, projects CASCADE'))
    engine.dispose()
    return Settings(database_url, tmp_path)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as value:
        yield value


@pytest.fixture
def files():
    base = Path(__file__).resolve().parents[2] / 'docs' / 'examples' / 'absence'
    return {
        'schedule': ('week.csv', (base / 'team_week_02-08_nov.csv').read_bytes(), 'text/csv'),
        'employees': ('employees.csv', (base / 'employees.csv').read_bytes(), 'text/csv'),
        'availability': ('availability.csv', (base / 'availability.csv').read_bytes(), 'text/csv'),
    }
