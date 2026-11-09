"""An isolated, socket-only development cluster; never touches system services."""
import os
import shlex
import shutil
import subprocess

import psycopg

from .config import Settings


def ensure_local_database(settings: Settings):
    if os.environ.get('DATABASE_URL'):
        return False
    for binary in ['initdb', 'pg_ctl']:
        if not shutil.which(binary):
            raise RuntimeError('Install PostgreSQL 16+ or provide DATABASE_URL; see backend/README.md.')
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    cluster = settings.data_dir / 'postgres'
    socket = settings.data_dir / 'run'
    socket.mkdir(exist_ok=True, mode=0o700)
    # postmaster aborts if CoreFoundation made the process multithreaded before fork; on macOS an
    # empty LANG inside an app bundle is enough. The cluster is created --no-locale, so pin LC_ALL=C.
    environment = {**os.environ, 'LC_ALL': 'C'}
    if not (cluster / 'PG_VERSION').exists():
        subprocess.run(['initdb', '-D', str(cluster), '-U', 'wuji', '--encoding=UTF8', '--no-locale',
            '--auth-local=trust', '--auth-host=scram-sha-256'], check=True, stdout=subprocess.DEVNULL, env=environment)
    running = subprocess.run(['pg_ctl', '-D', str(cluster), 'status'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not running:
        subprocess.run(['pg_ctl', '-D', str(cluster), '-l', str(settings.data_dir / 'postgres.log'),
            '-o', shlex.join(['-h', '', '-k', str(socket), '-p', '55432']), '-w', 'start'], check=True, env=environment)
    with psycopg.connect(host=str(socket), port=55432, user='wuji', dbname='postgres', autocommit=True) as connection:
        if not connection.execute("SELECT 1 FROM pg_database WHERE datname = 'wuji'").fetchone():
            connection.execute('CREATE DATABASE wuji')
    return not running


def stop_local_database(settings: Settings):
    if os.environ.get('DATABASE_URL'):
        return
    subprocess.run(['pg_ctl', '-D', str(settings.data_dir / 'postgres'), '-m', 'fast', '-w', 'stop'], check=True)
