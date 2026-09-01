import { rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKSPACE_CONFIG_FILE = '.cf-workspace.toml';

/**
 * Materialize the canonical source manifest inside a managed IDE workspace.
 *
 * Kubernetes sessions use an emptyDir for /workspace, so the manifest that
 * studio-backend keeps on its own filesystem cannot be mounted into the Pod.
 * STUDIO_SOURCES is already the launch contract for cloning; reuse only its
 * non-secret identity fields and never persist source tokens.
 */
export async function materializeManagedWorkspace(workspaceRoot, rawSources) {
    const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_FILE);
    if (await exists(configPath)) {
        return { configPath, created: false };
    }

    const sources = parseSources(rawSources);
    const lines = ['version = "1.0"'];
    if (sources.length === 0) {
        lines.push('sources = {}');
    } else {
        for (const source of sources) {
            lines.push(
                '',
                `[sources.${JSON.stringify(source.name)}]`,
                'role = "codebase"'
            );
            if (source.url) {
                lines.push(`url = ${JSON.stringify(source.url)}`);
            }
            if (source.branch) {
                lines.push(`branch = ${JSON.stringify(source.branch)}`);
            }
            lines.push(`path = ${JSON.stringify(source.dir)}`);
        }
    }
    lines.push('');

    const temporaryPath = `${configPath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, configPath);
    return { configPath, created: true };
}

function parseSources(rawSources) {
    if (!rawSources?.trim()) {
        return [];
    }
    const parsed = JSON.parse(rawSources);
    if (!Array.isArray(parsed)) {
        throw new Error('STUDIO_SOURCES must be a JSON array');
    }
    return parsed.map((source, index) => {
        const name = String(source?.name ?? '').trim();
        const dir = String(source?.dir ?? name).trim();
        if (!/^[a-z0-9_-]+$/u.test(name)) {
            throw new Error(`STUDIO_SOURCES[${index}].name is invalid`);
        }
        if (!isSafeRelativePath(dir)) {
            throw new Error(`STUDIO_SOURCES[${index}].dir is invalid`);
        }
        const url = typeof source?.url === 'string' && source.url.trim() ? source.url.trim() : undefined;
        const branch = typeof source?.branch === 'string' && source.branch.trim() ? source.branch.trim() : undefined;
        if (branch && !url) {
            throw new Error(`STUDIO_SOURCES[${index}].branch requires url`);
        }
        return { name, dir, url, branch };
    });
}

function isSafeRelativePath(value) {
    return value.length > 0
        && !path.isAbsolute(value)
        && value.split(/[\\/]/u).every(segment => segment && segment !== '..');
}

async function exists(filePath) {
    try {
        await stat(filePath);
        return true;
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.env.STUDIO_MANAGED_WORKSPACE === '1') {
        const workspaceRoot = process.argv[2] || '/workspace';
        const result = await materializeManagedWorkspace(workspaceRoot, process.env.STUDIO_SOURCES);
        if (result.created) {
            console.log(`[entrypoint] materialized managed workspace sources at ${result.configPath}`);
        }
    }
}
