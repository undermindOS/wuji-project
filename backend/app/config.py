import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    database_url: str
    data_dir: Path

    @classmethod
    def from_env(cls):
        data = Path(os.environ.get('WUJI_DATA_DIR', ROOT / '.wuji-data')).resolve()
        url = os.environ.get('DATABASE_URL', f'postgresql+psycopg://wuji@/wuji?host={data / "run"}&port=55432')
        if not url.startswith('postgresql+psycopg://'):
            raise ValueError('DATABASE_URL must use postgresql+psycopg://')
        return cls(url, data)
