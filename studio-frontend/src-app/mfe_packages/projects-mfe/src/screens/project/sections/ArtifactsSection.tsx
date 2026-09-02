import React from 'react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@gears-frontx/ui-kit';
import { useFormatters } from '@gears-frontx/react';
import { useOrganization, useWorkspace } from '@constructor-studio/mfe-shared';
import { Search } from 'lucide-react';
import { useProjectText } from '../../../i18n';
import type { ProjectSource } from '../../../api/types';
import { useArtifacts } from '../../../shared/useArtifacts';
import { useArtifactImport, useProjectImport } from '../../../shared/useArtifactImport';
import { useThemedRoot } from '../../../shared/useThemedRoot';
import { narrowArtifactRows, rowRepositories } from '../../../model/artifact';
import { artifactColumns } from './artifactColumns';
import { ArtifactsTable } from './ArtifactsTable';
import { notComeThrough, repoImportLine } from './repoImportText';
import styles from './ArtifactsSection.module.css';
import frame from '../ProjectScreen.module.css';

const ALL_REPOSITORIES = '__all__';

const SyncNow: React.FC<{
  projectId: string;
  orgId: string;
  workspaceId: string | null;
  sources: readonly ProjectSource[];
}> = ({ projectId, orgId, workspaceId, sources }) => {
  const t = useProjectText();
  const { canSync, start } = useArtifactImport({
    projectId,
    orgId,
    workspaceId,
    sources,
    artifactCount: 0,
    artifactsRead: true,
  });
  if (!canSync) return null;
  return (
    <Button variant="outline" size="sm" className={styles.retry} onClick={start}>
      {t('artifacts_sync_now')}
    </Button>
  );
};

SyncNow.displayName = 'SyncNow';

interface ArtifactsSectionProps {
  projectId: string;
}

export const ArtifactsSection: React.FC<ArtifactsSectionProps> = ({ projectId }) => {
  const t = useProjectText();
  const { formatRelative } = useFormatters();
  const { rows, sources, loading, failed, refetch } = useArtifacts(projectId);
  const importState = useProjectImport(projectId);
  const { org } = useOrganization();
  const { workspace } = useWorkspace();

  const [repository, setRepository] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [container, findThemedRoot] = useThemedRoot();

  const readInFlight = React.useRef(loading);
  React.useEffect(() => {
    if (!readInFlight.current) refetch();
  }, [refetch]);

  const repositories = React.useMemo(() => rowRepositories(rows), [rows]);

  const repositoryTotal = React.useMemo(
    () => (repository === null ? 0 : rows.filter((row) => row.repository === repository).length),
    [rows, repository]
  );
  const narrowed = React.useMemo(
    () => narrowArtifactRows(rows, repository, search),
    [rows, repository, search]
  );

  const columns = React.useMemo(
    () =>
      artifactColumns({
        formatRelative,
        container,
        labels: {
          actions: (name: string) => t('artifacts_row_actions', { name }),
          open: t('artifacts_row_open'),
          copyLink: t('artifacts_row_copy_link'),
          name: t('artifacts_col_name'),
          repository: t('artifacts_col_repository'),
          path: t('artifacts_col_path'),
          sync: t('artifacts_col_sync'),
          updated: t('artifacts_col_updated'),
          ingested: t('artifacts_sync_ingested'),
          provenance: {
            checkout: t('artifacts_from_checkout'),
            tree: t('artifacts_from_tree'),
            upload: t('artifacts_from_upload'),
            repository: t('artifacts_from_repository'),
          },
        },
      }),
    [t, formatRelative, container]
  );

  if (loading) {
    return (
      <div className={styles.section}>
        <Skeleton className={styles.stripSkeleton} />
        <Skeleton className={styles.tableSkeleton} />
      </div>
    );
  }

  if (failed) {
    return (
      <div className={`${styles.section} ${styles.stateBlock}`}>
        <p className={styles.error} role="alert">
          {t('artifacts_read_failed')}
        </p>
        <Button variant="outline" size="sm" className={styles.retry} onClick={refetch}>
          {t('artifacts_retry')}
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    const running = importState.phase === 'running';
    const failedImport = importState.phase === 'failed';
    const messageKey =
      sources.length === 0
        ? 'artifacts_no_sources'
        : running
          ? 'artifacts_importing'
          : failedImport
            ? 'artifacts_import_failed'
            : 'artifacts_not_synced';
    return (
      <div className={`${styles.section} ${styles.stateBlock}`}>
        <p className={failedImport ? styles.error : styles.empty}>{t(messageKey)}</p>
        {org && !running && (
          <SyncNow
            projectId={projectId}
            orgId={org.id}
            workspaceId={workspace?.id ?? null}
            sources={sources}
          />
        )}
        {importState.repos.filter(notComeThrough).map((repo) => (
          <p key={repo.repo} className={`${frame.repoFailure} ${styles.repoLine}`}>
            {repoImportLine(t, repo)}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div ref={findThemedRoot} className={styles.section}>
      <header className={styles.strip}>
        <p className={styles.totals}>
          {repository === null ? (
            <>
              {t(rows.length === 1 ? 'artifacts_count_one' : 'artifacts_count_many', {
                count: rows.length,
              })}
              <span className={styles.totalsDivider}>·</span>
              {t(
                repositories.length === 1
                  ? 'artifacts_repos_count_one'
                  : 'artifacts_repos_count_many',
                { count: repositories.length }
              )}
            </>
          ) : (
            t('artifacts_in_repository', {
              shown: narrowed.length,
              total: repositoryTotal,
              repo: repository,
            })
          )}
          {importState.phase === 'running' && (
            <>
              <span className={styles.totalsDivider}>·</span>
              <span className={styles.importing}>{t('artifacts_importing_short')}</span>
            </>
          )}
        </p>
        <div className={styles.controls}>
          {repositories.length > 1 && (
            <Select
              value={repository ?? ALL_REPOSITORIES}
              onValueChange={(next: string | null) =>
                setRepository(!next || next === ALL_REPOSITORIES ? null : next)
              }
            >
              <SelectTrigger
                size="sm"
                className={styles.repoFilter}
                aria-label={t('artifacts_col_repository')}
              >
                <SelectValue>
                  {(selected: unknown) => (
                    <span className={styles.truncate}>
                      {!selected || selected === ALL_REPOSITORIES
                        ? t('artifacts_all_repositories', { count: repositories.length })
                        : String(selected)}
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className={styles.repoOptions} container={container ?? undefined}>
                <SelectItem value={ALL_REPOSITORIES}>
                  <span className={styles.truncate}>
                    {t('artifacts_all_repositories', { count: repositories.length })}
                  </span>
                </SelectItem>
                {repositories.map((name: string) => (
                  <SelectItem key={name} value={name}>
                    <span className={styles.truncate} title={name}>
                      {name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            className={styles.search}
            type="search"
            value={search}
            icon={<Search size={16} strokeWidth={1.3} />}
            placeholder={t('artifacts_search')}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t('artifacts_search')}
          />
        </div>
      </header>
      <ArtifactsTable
        rows={narrowed}
        columns={columns}
        resetKey={`${repository ?? ''}|${search}`}
        labels={{
          table: t('section_artifacts'),
          emptyMessage: t('artifacts_no_matches'),
          previous: t('artifacts_prev_page'),
          next: t('artifacts_next_page'),
          range: (from: number, to: number, total: number) =>
            t('artifacts_range', { from, to, total }),
          page: (index: number) => t('artifacts_page', { index }),
        }}
      />
    </div>
  );
};

ArtifactsSection.displayName = 'ArtifactsSection';
