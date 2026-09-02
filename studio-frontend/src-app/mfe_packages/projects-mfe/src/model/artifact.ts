import {
  ARTIFACT_NODE_TYPES,
  type ArtifactKind,
  type ArtifactNodeDto,
  type ArtifactNodeValue,
} from '../api/artifactTypes';

export type ArtifactProvenance = 'checkout' | 'tree' | 'upload' | 'repository';

export interface ArtifactRow {
  id: string;
  kind: ArtifactKind;
  name: string;
  repository: string;
  path: string;
  url: string | null;
  sync: 'ingested';
  updatedAt: number | null;
  provenance: ArtifactProvenance | null;
}

const KIND_BY_TYPE_ID = new Map<string, ArtifactKind>(
  Object.entries(ARTIFACT_NODE_TYPES).map(([kind, typeId]) => [typeId, kind as ArtifactKind])
);

function kindOf(node: ArtifactNodeDto): ArtifactKind | null {
  return KIND_BY_TYPE_ID.get(node.type_id) ?? null;
}

function instant(value: ArtifactNodeValue): number | null {
  const raw = value.updated_at ?? value.created_at;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function fileProvenance(value: ArtifactNodeValue): ArtifactProvenance {
  if (value.origin) return 'upload';
  if (value.has_text === true) return 'checkout';
  return 'tree';
}

function pathFromUrl(raw: string | undefined, repository: string): string {
  if (!raw) return '';
  let path: string;
  try {
    const { pathname, search } = new URL(raw);
    path = `${pathname}${search}`;
  } catch {
    path = raw;
  }
  path = path.replace(/^\//, '');
  if (repository && path.startsWith(`${repository}/`)) {
    return path.slice(repository.length + 1);
  }
  return path;
}

function pathOf(kind: ArtifactKind, value: ArtifactNodeValue, repository: string): string {
  if (kind === 'repo') return '';
  if (kind === 'file') return value.path ?? '';
  return pathFromUrl(value.url, repository);
}

function nameOf(kind: ArtifactKind, value: ArtifactNodeValue): string {
  if (kind === 'repo') return value.full_path ?? '';
  if (kind === 'file') return value.path?.split('/').pop() ?? value.path ?? '';
  const title = value.title ?? '';
  return value.number != null ? `#${value.number} ${title}`.trim() : title;
}

export function buildArtifactRows(nodes: readonly ArtifactNodeDto[]): ArtifactRow[] {
  const repoNames = new Map<string, string>();
  for (const node of nodes) {
    if (kindOf(node) === 'repo') {
      repoNames.set(node.instance_id, node.value.full_path ?? '');
    }
  }

  const rows: ArtifactRow[] = [];
  for (const node of nodes) {
    const kind = kindOf(node);
    if (kind === null) continue;
    if (kind === 'file' && node.value.is_dir === true) continue;

    const value = node.value;
    const updatedAt = instant(value);
    const repository =
      kind === 'repo' ? (value.full_path ?? '') : (repoNames.get(value.repo ?? '') ?? '');
    rows.push({
      id: node.instance_id,
      kind,
      name: nameOf(kind, value),
      repository,
      path: pathOf(kind, value, repository),
      url: value.url ?? null,
      sync: 'ingested',
      updatedAt,
      provenance:
        updatedAt !== null
          ? null
          : kind === 'file'
            ? fileProvenance(value)
            : 'repository',
    });
  }

  return rows;
}

export function rowRepositories(rows: readonly ArtifactRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    if (row.repository) names.add(row.repository);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export type UpdatedSort = 'newest' | 'oldest';

export function sortByUpdated(
  rows: readonly ArtifactRow[],
  direction: UpdatedSort
): ArtifactRow[] {
  const sign = direction === 'newest' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.updatedAt === null && b.updatedAt === null) return 0;
    if (a.updatedAt === null) return 1;
    if (b.updatedAt === null) return -1;
    return (a.updatedAt - b.updatedAt) * sign;
  });
}

export function missingRepositories(
  rows: readonly ArtifactRow[],
  sources: readonly { full_path: string }[]
): string[] {
  const present = new Set(rows.map((row) => row.repository).filter(Boolean));
  return sources.map((source) => source.full_path).filter((path) => !present.has(path));
}

export function narrowArtifactRows(
  rows: readonly ArtifactRow[],
  repository: string | null,
  search: string
): ArtifactRow[] {
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (repository !== null && row.repository !== repository) return false;
    if (!needle) return true;
    return (
      row.name.toLocaleLowerCase().includes(needle) ||
      row.path.toLocaleLowerCase().includes(needle)
    );
  });
}
