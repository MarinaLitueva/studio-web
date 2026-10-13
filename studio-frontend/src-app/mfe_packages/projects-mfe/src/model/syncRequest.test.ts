import { describe, expect, it } from 'vitest';
import type { ConnectionDto, ProjectSource } from '@constructor-studio/mfe-shared';
import { syncPlan, unsyncedSources } from './syncRequest';

const source = (full_path: string, connection_id = 'c-github'): ProjectSource => ({
  connection_id,
  full_path,
  clone_url: `https://example.test/${full_path}.git`,
});

const connection = (id: string, provider: string): ConnectionDto =>
  ({ id, provider, label: id, base_url: '', secret_ref: `ref-${id}` }) as ConnectionDto;

const connections = new Map([
  ['c-github', connection('c-github', 'github')],
  ['c-gitlab', connection('c-gitlab', 'gitlab')],
  ['c-bitbucket', connection('c-bitbucket', 'bitbucket')],
]);

describe('which sources a sync is asked for', () => {
  it('asks for a GitHub repository with what the gear needs to pull it', () => {
    expect(syncPlan([source('acme/api')], connections)).toEqual({
      repos: [{ repo: 'acme/api', provider: 'github', baseUrl: undefined, secretRef: 'ref-c-github' }],
      unsyncable: [],
    });
  });

  it('records GitLab and Bitbucket repositories as unsyncable, saying why', () => {
    const plan = syncPlan(
      [source('acme/lab', 'c-gitlab'), source('acme/bucket', 'c-bitbucket')],
      connections
    );

    expect(plan.repos).toEqual([]);
    expect(plan.unsyncable).toEqual([
      { repo: 'acme/lab', reason: { kind: 'i18n', key: 'artifacts_reason_provider_cannot_sync' } },
      { repo: 'acme/bucket', reason: { kind: 'i18n', key: 'artifacts_reason_provider_cannot_sync' } },
    ]);
  });

  it('records a source whose connection is gone as unsyncable', () => {
    expect(syncPlan([source('acme/api', 'c-gone')], connections).unsyncable).toEqual([
      { repo: 'acme/api', reason: { kind: 'i18n', key: 'artifacts_reason_no_connection' } },
    ]);
  });
});

describe('the sources nothing has pulled in', () => {
  const sources = [source('acme/api'), source('acme/web'), source('acme/docs')];

  it('takes the sources the graph has no repository node for', () => {
    expect(unsyncedSources(sources, ['acme/api'], [], []).map((s) => s.full_path)).toEqual([
      'acme/web',
      'acme/docs',
    ]);
  });

  it('matches a node whatever the provider did to the path case', () => {
    expect(unsyncedSources([source('Acme/API')], ['acme/api'], [], [])).toEqual([]);
  });

  it('leaves out a repository whose sync is queued or running', () => {
    const lines = [
      { repo: 'acme/web', status: 'queued' as const },
      { repo: 'acme/docs', status: 'running' as const },
    ];
    expect(unsyncedSources(sources, [], lines, []).map((s) => s.full_path)).toEqual(['acme/api']);
  });

  it('leaves out a repository this tab already asked for, even one whose sync failed', () => {
    expect(unsyncedSources(sources, [], [], ['acme/web']).map((s) => s.full_path)).toEqual([
      'acme/api',
      'acme/docs',
    ]);
    expect(
      unsyncedSources(sources, [], [{ repo: 'acme/docs', status: 'failed' }], []).map((s) => s.full_path)
    ).toEqual(['acme/api', 'acme/web']);
  });
});
