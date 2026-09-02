import React, { useEffect, useMemo } from 'react';
import { apiRegistry, useApiQuery, useAppDispatch, useAppSelector } from '@gears-frontx/react';
import { Button, Skeleton } from '@gears-frontx/ui-kit';
import { useOrganization, useWorkspace } from '@constructor-studio/mfe-shared';
import { useProjectScreenTranslations, useProjectText } from '../../i18n';
import { AccountsApiService } from '../../api/AccountsApiService';
import type { ProjectSource } from '../../api/types';
import { useProjectConfig } from '../../shared/useProjectConfig';
import { useArtifacts } from '../../shared/useArtifacts';
import { useArtifactImport, useProjectImport } from '../../shared/useArtifactImport';
import { missingRepositories, type ArtifactRow } from '../../model/artifact';
import { NAV_SLICE_KEY, landOnFirstImport } from '../../slices/navSlice';
import { SettingsSection } from './sections/SettingsSection';
import { PlaceholderSection } from './sections/PlaceholderSection';
import { ArtifactsSection } from './sections/ArtifactsSection';
import { repoImportLine } from './sections/repoImportText';
import { ProjectRail } from './ProjectRail';
import styles from './ProjectScreen.module.css';

interface ImportWatchProps {
  projectId: string;
  orgId: string;
  workspaceId: string | null;
  rows: readonly ArtifactRow[];
  sources: readonly ProjectSource[];
  artifactsRead: boolean;
  showShortfall: boolean;
}

const ImportWatch: React.FC<ImportWatchProps> = ({
  projectId,
  orgId,
  workspaceId,
  rows,
  sources,
  artifactsRead,
  showShortfall,
}) => {
  const t = useProjectText();
  const dispatch = useAppDispatch();
  const importState = useProjectImport(projectId);
  const { isFirstImport, canSync, start } = useArtifactImport({
    projectId,
    workspaceId,
    orgId,
    sources,
    artifactCount: rows.length,
    artifactsRead,
  });

  useEffect(() => {
    if (!isFirstImport) return;
    dispatch(landOnFirstImport());
    start();
  }, [isFirstImport, dispatch, start]);

  const missing = useMemo(() => missingRepositories(rows, sources), [rows, sources]);
  if (!showShortfall || rows.length === 0 || importState.phase === 'running') return null;
  if (missing.length === 0) return null;

  return (
    <div className={styles.shortfall} role="status">
      <div className={styles.shortfallReasons}>
        {missing.map((repo) => {
          const entry = importState.repos.find((r) => r.repo === repo);
          return (
            <p key={repo} className={styles.repoFailure}>
              {entry?.reason ? repoImportLine(t, entry) : t('artifacts_repo_absent', { repo })}
            </p>
          );
        })}
      </div>
      {canSync && (
        <Button variant="outline" size="sm" onClick={start}>
          {t('artifacts_sync_now')}
        </Button>
      )}
    </div>
  );
};

ImportWatch.displayName = 'ImportWatch';

interface ProjectScreenProps {
  projectId: string;
}

export const ProjectScreen: React.FC<ProjectScreenProps> = ({ projectId }) => {
  const { isLoaded, error: translationsFailed } = useProjectScreenTranslations();
  const t = useProjectText();
  const accounts = apiRegistry.getService(AccountsApiService);
  const {
    data: project,
    isLoading,
    isError,
  } = useApiQuery(accounts.tenant({ tenantId: projectId }));
  const { config } = useProjectConfig(projectId);
  const section = useAppSelector((state) => state[NAV_SLICE_KEY].section);

  const { org } = useOrganization();
  const { workspace } = useWorkspace();
  const { rows, sources, loading: artifactsLoading, failed: artifactsFailed } =
    useArtifacts(projectId);
  const artifactsRead = !artifactsLoading && !artifactsFailed;

  const busy = (!isLoaded && !translationsFailed) || isLoading;

  const body = () => {
    if (busy) {
      return (
        <div className={styles.sectionBody}>
          <Skeleton className={styles.blockSkeleton} />
          <Skeleton className={styles.blockSkeleton} />
        </div>
      );
    }
    if (isError || !project) {
      return <PlaceholderSection title={t('error_title')} note={t('error_hint')} />;
    }

    switch (section) {
      case 'artifacts':
        return <ArtifactsSection projectId={projectId} />;
      case 'settings':
        return <SettingsSection project={project} config={config} />;
      default:
        return <PlaceholderSection title={t(`section_${section}`)} note={t('no_source_yet')} />;
    }
  };

  return (
    <div className={styles.frame}>
      <ProjectRail section={section} />
      <div className={styles.content}>
        {org && (
          <ImportWatch
            projectId={projectId}
            orgId={org.id}
            workspaceId={workspace?.id ?? null}
            rows={rows}
            sources={sources}
            artifactsRead={artifactsRead}
            showShortfall={section === 'artifacts' && artifactsRead}
          />
        )}
        <header className={styles.header}>
          <h1 className={styles.title}>
            {busy ? <Skeleton className={styles.titleSkeleton} /> : t(`section_${section}`)}
          </h1>
        </header>
        <div className={styles.body} data-section={section}>
          {body()}
        </div>
      </div>
    </div>
  );
};

ProjectScreen.displayName = 'ProjectScreen';
