import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { materializeManagedWorkspace } from './materialize-workspace.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'studio-workspace-manifest-'));
try {
    const secret = 'must-not-be-persisted';
    const result = await materializeManagedWorkspace(directory, JSON.stringify([{
        name: 'studio-web',
        dir: 'studio-web',
        url: 'https://github.com/constructorfabric/studio-web.git',
        branch: 'main',
        token: secret
    }]));
    const manifest = await readFile(result.configPath, 'utf8');
    assert.equal(result.created, true);
    assert.match(manifest, /\[sources\."studio-web"\]/u);
    assert.match(manifest, /path = "studio-web"/u);
    assert.match(manifest, /url = "https:\/\/github\.com\/constructorfabric\/studio-web\.git"/u);
    assert.match(manifest, /branch = "main"/u);
    assert.doesNotMatch(manifest, new RegExp(secret, 'u'));
    assert.doesNotMatch(manifest, /token/u);

    await writeFile(result.configPath, '# workspace-owned\n', 'utf8');
    const existing = await materializeManagedWorkspace(directory, '[]');
    assert.equal(existing.created, false);
    assert.equal(await readFile(result.configPath, 'utf8'), '# workspace-owned\n');

    console.log('managed workspace manifest is canonical, token-free, and non-destructive');
} finally {
    await rm(directory, { recursive: true, force: true });
}
