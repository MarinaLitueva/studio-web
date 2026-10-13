import React, { useState } from 'react';
import { Folder } from 'lucide-react';
import {
  Button,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from '@gears-frontx/ui-kit';
import { useProjectListScreenTranslations, useProjectListText } from '../../i18n';
import { WorkspaceProjectsProvider } from '../../shared/workspaceProjects';
import { useProjectList } from '../../shared/useProjectList';
import { DEFAULT_SORT_OPTION, type ProjectSortOption } from '../../model/project';
import { ProjectsToolbar } from './components/ProjectsToolbar';
import { ProjectsTable } from './components/ProjectsTable';
import styles from './ProjectListScreen.module.css';


const ProjectList: React.FC = () => {
  const { isLoaded, error: translationsFailed } = useProjectListScreenTranslations();
  const t = useProjectListText();
  const [query, setQuery] = useState('');

  const sort: ProjectSortOption = DEFAULT_SORT_OPTION;

  const { loading, failed, org, workspace, rows, total } = useProjectList(query, sort);
  const busy = (!isLoaded && !translationsFailed) || loading;

  return (
    <div className={styles.screen}>
      <ProjectsToolbar
        query={query}
        onQueryChange={setQuery}
        busy={busy}
        hasWorkspace={!!workspace}
      />

      <section className={styles.card}>
        {busy ? (
          <div className={styles.rowsSkeleton}>
            <Skeleton className={styles.rowSkeleton} />
            <Skeleton className={styles.rowSkeleton} />
            <Skeleton className={styles.rowSkeleton} />
          </div>
        ) : failed || translationsFailed ? (
          <p className={styles.state}>
            {translationsFailed ? 'Could not load this screen.' : t('error_title')}
          </p>
        ) : (
          <ProjectsTable
            rows={rows}
            empty={
              total > 0 ? (
                <Empty className={styles.empty}>
                  <EmptyHeader>
                    <EmptyDescription>{t('empty_no_match')}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyActions>
                    <Button variant="link" onClick={() => setQuery('')}>
                      {t('clear_search')}
                    </Button>
                  </EmptyActions>
                </Empty>
              ) : (
                <Empty className={styles.empty}>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Folder />
                    </EmptyMedia>
                    <EmptyTitle>{t('empty_title')}</EmptyTitle>
                    <EmptyDescription>
                      {!org
                        ? t('empty_no_org')
                        : !workspace
                          ? t('empty_no_workspace')
                          : t('empty_hint')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )
            }
          />
        )}

        {!busy && !failed && !translationsFailed && rows.length > 0 ? (
          <footer className={styles.footer}>
            {workspace ? `${t('in_workspace')} ${workspace.name}` : ''}
          </footer>
        ) : null}
      </section>
    </div>
  );
};

export const ProjectListScreen: React.FC = () => (
  <WorkspaceProjectsProvider>
    <ProjectList />
  </WorkspaceProjectsProvider>
);

ProjectListScreen.displayName = 'ProjectListScreen';
