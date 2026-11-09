import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'backend'

if '--ready' not in sys.argv:
    subprocess.run(['uv', 'sync', '--project', str(BACKEND), '--python', '3.12', '--locked'], check=True)
    os.execv(str(BACKEND / '.venv' / 'bin' / 'python'), [str(BACKEND / '.venv' / 'bin' / 'python'), __file__, '--ready', *sys.argv[1:]])

sys.path.insert(0, str(BACKEND))
from app.config import Settings
from app.database import migrate
from app.local_db import ensure_local_database, stop_local_database

settings = Settings.from_env()
if '--stop-database' in sys.argv:
    stop_local_database(settings)
    raise SystemExit(0)
started = ensure_local_database(settings)
migrate(settings.database_url)
if '--database-only' in sys.argv:
    print('WUJI local database is ready (private Unix socket, no TCP listener).')
    raise SystemExit(0)
worker = None
try:
    if '--no-worker' not in sys.argv:
        worker = subprocess.Popen([sys.executable, '-m', 'app.worker'], cwd=str(BACKEND))
    subprocess.run([sys.executable, '-m', 'uvicorn', 'app.main:app', '--app-dir', str(BACKEND), '--host', '127.0.0.1', '--port', '8000'], check=True)
except KeyboardInterrupt:
    pass
finally:
    if worker is not None:
        worker.terminate()
        try:
            worker.wait(timeout=8)
        except subprocess.TimeoutExpired:
            worker.kill()
            worker.wait()
    if started:
        stop_local_database(settings)
