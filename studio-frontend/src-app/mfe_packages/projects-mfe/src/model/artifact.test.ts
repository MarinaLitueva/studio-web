import { describe, expect, it } from 'vitest';
import { ARTIFACT_NODE_TYPES } from '../api/artifactTypes';
import { buildArtifactRows, opensInEditor } from './artifact';

const REPOS = new Map([['repo-1', 'group/repo']]);

function row(type: keyof typeof ARTIFACT_NODE_TYPES, value: Record<string, unknown>) {
  const [built] = buildArtifactRows(
    [{ type_id: ARTIFACT_NODE_TYPES[type], instance_id: 'n-1', value }],
    REPOS
  );
  return built;
}

describe('rows of the kinds outside the default listing', () => {
  it('names a commit by its short sha and subject, and dates it', () => {
    const commit = row('commit', {
      repo: 'repo-1',
      short_sha: 'a1b2c3d',
      title: 'Fix the build',
      url: 'https://forge.example/group/repo/-/commit/a1b2c3d',
      created_at: '2026-09-20T10:00:00Z',
    });
    expect(commit.kind).toBe('commit');
    expect(commit.name).toBe('a1b2c3d Fix the build');
    expect(commit.repository).toBe('group/repo');
    expect(commit.path).toBe('-/commit/a1b2c3d');
    expect(commit.updatedAt).toBe(Date.parse('2026-09-20T10:00:00Z'));
  });

  it('names a comment by its snippet', () => {
    const comment = row('comment', {
      repo: 'repo-1',
      title: 'Looks good to me',
      url: 'https://forge.example/group/repo/-/issues/4#note_9',
      created_at: '2026-09-20T10:00:00Z',
    });
    expect(comment.kind).toBe('comment');
    expect(comment.name).toBe('Looks good to me');
  });

  it('names a user by login, with no repository and no path', () => {
    const user = row('user', { provider: 'gitlab', login: 'ada', title: 'ada' });
    expect(user.kind).toBe('user');
    expect(user.name).toBe('ada');
    expect(user.repository).toBe('');
    expect(user.path).toBe('');
  });

  it('opens none of them in the editor — only a file with a path does', () => {
    expect(opensInEditor(row('commit', { repo: 'repo-1', short_sha: 'a', title: 't' }))).toBe(false);
    expect(opensInEditor(row('comment', { repo: 'repo-1', title: 't' }))).toBe(false);
    expect(opensInEditor(row('user', { login: 'ada' }))).toBe(false);
    expect(opensInEditor(row('file', { repo: 'repo-1', path: 'docs/a.md' }))).toBe(true);
    expect(opensInEditor(row('file', { repo: 'repo-1' }))).toBe(false);
  });
});
