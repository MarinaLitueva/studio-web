import React from 'react';
import { Plug } from 'lucide-react';
import { useMfeBridge } from '@gears-frontx/react';
import {
  Button,
  DataGrid,
  DataGridEmptyStatePlugin,
  DataGridPaginationPlugin,
  DataGridTextSearchPlugin,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  useDataGrid,
  type DataGridTextSearchPluginApi,
} from '@gears-frontx/ui-kit';
import { useSourcesText } from '../../../../i18n';
import { openSourcesConnect } from '../../../../actions/sourcesConnectActions';
import { activityScale, type SourceRow } from '../../../../model/sourceRows';
import { useSourcesLoad } from '../../../../shared/useSourcesLoad';
import { useSourceRowActions } from '../../../../shared/useSourceRowActions';
import { useThemedRoot } from '../../../../shared/useThemedRoot';
import { sourceColumns } from './sourceColumns';
import { SourcesFooter } from './SourcesFooter';
import styles from './SourcesSection.module.css';

export const SourcesSkeleton: React.FC = () => (
  <div className={styles.section}>
    <Skeleton className={styles.stripSkeleton} />
    <Skeleton className={styles.tableSkeleton} />
  </div>
);

const SourcesEmpty: React.FC = () => {
  const t = useSourcesText();
  const bridge = useMfeBridge();
  const grid = useDataGrid<SourceRow>();
  const filtered = grid.useStore((state) => state.hasActiveFilters);

  if (filtered) {
    return (
      <Empty className={styles.empty}>
        <EmptyHeader>
          <EmptyDescription>{t('no_match')}</EmptyDescription>
        </EmptyHeader>
        <EmptyActions>
          <Button
            variant="link"
            onClick={() => grid.getPlugin<DataGridTextSearchPluginApi>('textSearch')?.setSearch('')}
          >
            {t('clear_search')}
          </Button>
        </EmptyActions>
      </Empty>
    );
  }
  return (
    <Empty className={styles.empty}>
      <EmptyHeader>
        <EmptyMedia variant="icon" className={styles.emptyMedia}>
          <Plug strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle className={styles.emptyTitle}>{t('empty_title')}</EmptyTitle>
      </EmptyHeader>
      <EmptyActions>
        <Button size="sm" icon={<Plug />} onClick={() => openSourcesConnect(bridge)}>
          {t('connect_source')}
        </Button>
      </EmptyActions>
    </Empty>
  );
};

SourcesEmpty.displayName = 'SourcesEmpty';

interface SourcesTableProps {
  projectId: string;
  orgId: string;
  workspaceId: string;
}

export const SourcesTable: React.FC<SourcesTableProps> = ({ projectId, orgId, workspaceId }) => {
  const t = useSourcesText();
  const sources = useSourcesLoad(projectId, workspaceId, orgId);
  const actions = useSourceRowActions(projectId, workspaceId, orgId);
  const [container, findThemedRoot] = useThemedRoot();

  const scale = React.useMemo(() => activityScale(sources.rows), [sources.rows]);
  const columns = React.useMemo(
    () => sourceColumns({ t, windowDays: sources.windowDays, actions, scale, container }),
    [t, sources.windowDays, actions, scale, container]
  );

  if (!sources.ready) return <SourcesSkeleton />;

  if (sources.failed) {
    return (
      <div className={`${styles.section} ${styles.stateBlock}`}>
        <p className={styles.error} role="alert">
          {t('read_failed')}
        </p>
        <Button variant="outline" size="sm" className={styles.retry} onClick={sources.retry}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div ref={findThemedRoot} className={styles.section}>
      <div className={styles.grid}>
        <DataGrid<SourceRow>
          key={projectId}
          name="project-sources"
          persistent="memory"
          load={sources.load}
          columns={columns}
        >
          <DataGridTextSearchPlugin placeholder={t('search')} />
          <DataGridPaginationPlugin autoHide />
          <DataGridEmptyStatePlugin component={SourcesEmpty} />
          {sources.rowsBridge}
        </DataGrid>
      </div>
      <SourcesFooter footer={sources.footer} />
    </div>
  );
};

SourcesTable.displayName = 'SourcesTable';
