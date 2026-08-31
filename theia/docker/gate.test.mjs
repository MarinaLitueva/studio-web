import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const entrypoint = await readFile(new URL('./entrypoint.sh', import.meta.url), 'utf8');
const match = entrypoint.match(/cat > \/tmp\/gate\.js <<'GATE'\r?\n([\s\S]*?)\r?\nGATE/);
assert.ok(match, 'entrypoint must contain the generated session gate');

const directory = await mkdtemp(path.join(os.tmpdir(), 'studio-gate-test-'));
const gatePath = path.join(directory, 'gate.cjs');
await writeFile(gatePath, match[1], 'utf8');

const token = 'integration-test-token';
const child = spawn(process.execPath, [gatePath], {
  env: { ...process.env, STUDIO_SESSION_TOKEN: token, STUDIO_GATEWAY_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const request = () =>
  new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:3003/?token=${encodeURIComponent(token)}`,
      (response) => {
        response.resume();
        response.on('end', () => resolve(response));
      },
    );
    req.on('error', reject);
  });

try {
  let response;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      response = await request();
      break;
    } catch (error) {
      if (attempt === 39) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, './');
  assert.match(String(response.headers['set-cookie']), /studio_session_token=/);
  console.log('session gate redirect stays inside the browser-facing mount');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await rm(directory, { recursive: true, force: true });
}
