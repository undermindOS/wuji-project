import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app

output = Path(__file__).resolve().parents[1] / 'openapi.json'
content = json.dumps(app.openapi(), ensure_ascii=False, indent=2) + '\n'
if '--check' in sys.argv:
    if not output.exists() or output.read_text() != content:
        raise SystemExit('OpenAPI schema is stale. Run npm run api:types.')
    print('OpenAPI schema is current.')
else:
    output.write_text(content)
    print('Exported backend/openapi.json')
