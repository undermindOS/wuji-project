import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('uv', ['run', '--project', 'backend', 'python', 'backend/scripts/export_openapi.py', ...(check ? ['--check'] : [])]);
const temporary = await mkdtemp(join(tmpdir(), 'wuji-api-types-'));
try {
  const target = check ? join(temporary, 'schema.d.ts') : join(root, 'src/features/workspace/api/schema.d.ts');
  run(join(root, 'node_modules/.bin/openapi-typescript'), ['backend/openapi.json', '-o', target]);
  if (check && await readFile(target, 'utf8') !== await readFile(join(root, 'src/features/workspace/api/schema.d.ts'), 'utf8')) {
    throw new Error('API types are stale. Run npm run api:types.');
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
