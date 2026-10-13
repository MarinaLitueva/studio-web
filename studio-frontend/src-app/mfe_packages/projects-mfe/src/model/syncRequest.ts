/**
 * Which of a project's sources a sync can be asked for, and which ones the
 * graph is still missing.
 */

// @cpt-algo:cpt-studiofrontend-algo-project-artifacts-sync-request:p2
// @cpt-dod:cpt-studiofrontend-dod-project-artifacts-syncable-providers:p1
// @cpt-algo:cpt-studiofrontend-algo-project-sources-sync-missing:p2
import type { ConnectionDto, ProjectSource } from '@constructor-studio/mfe-shared';
import type { SyncRequest } from '../events/artifactEvents';
import type { RepoImportStatus } from './repoImport';

// TODO: take this from the gear once it says which drivers can sync.
/** GitLab and Bitbucket only list repositories; a sync for one fails five times. */
export const SYNCABLE_PROVIDERS: readonly string[] = ['github'];

export type SyncPlan = Pick<SyncRequest, 'repos' | 'unsyncable'>;

export function syncPlan(
  sources: readonly ProjectSource[],
  connections: ReadonlyMap<string, ConnectionDto>
): SyncPlan {
  const plan: SyncPlan = { repos: [], unsyncable: [] };
  // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-1
  for (const source of sources) {
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-2
    const connection = connections.get(source.connection_id);
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-2
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-3
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-4
    if (!connection) {
      plan.unsyncable.push({
        repo: source.full_path,
        reason: { kind: 'i18n', key: 'artifacts_reason_no_connection' },
      });
      continue;
    }
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-3
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-4
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-5
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-6
    if (!SYNCABLE_PROVIDERS.includes(connection.provider)) {
      plan.unsyncable.push({
        repo: source.full_path,
        reason: { kind: 'i18n', key: 'artifacts_reason_provider_cannot_sync' },
      });
      continue;
    }
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-5
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-6
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-7
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-8
    plan.repos.push({
      repo: source.full_path,
      provider: connection.provider,
      baseUrl: connection.base_url || undefined,
      secretRef: connection.secret_ref,
    });
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-7
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-8
  }
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-1
  // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-9
  return plan;
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-request:p2:inst-9
}

/** A provider's casing of a path need not match the one written in the config. */
function pathKey(path: string): string {
  return path.toLowerCase();
}

export function unsyncedSources(
  sources: readonly ProjectSource[],
  synced: readonly string[],
  lines: readonly { repo: string; status: RepoImportStatus }[],
  requested: readonly string[]
): ProjectSource[] {
  // @cpt-begin:cpt-studiofrontend-algo-project-sources-sync-missing:p2:inst-5
  const inGraph = new Set(synced.map(pathKey));
  // @cpt-end:cpt-studiofrontend-algo-project-sources-sync-missing:p2:inst-5
  // @cpt-begin:cpt-studiofrontend-algo-project-sources-sync-missing:p2:inst-6
  const inImport = lines.map((line) => line.repo);
  // @cpt-end:cpt-studiofrontend-algo-project-sources-sync-missing:p2:inst-6
  // @cpt-begin:cpt-studiofrontend-algo-project-sources-sync-missing:p2:inst-7
  const asked = new Set([...inImport, ...requested].map(pathKey));
  // @cpt-end:cpt-studiofrontend-algo-project-sources-sync-missing:p2:inst-7
  return sources.filter((source) => {
    const key = pathKey(source.full_path);
    return !inGraph.has(key) && !asked.has(key);
  });
}
