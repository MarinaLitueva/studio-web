import React from 'react';
import { Badge, Skeleton } from '@gears-frontx/ui-kit';
import { projectStatus, statusTone } from '../../../model/project';
import type { ProjectConfigState } from '../../../shared/useProjectConfig';
import { useProjectListText } from '../../../i18n';
import type { TenantDto } from '../../../api/types';
import { LoadFailed } from './LoadFailed';
import styles from '../ProjectListScreen.module.css';

/**
 * Everything the column can say, in one badge.
 */
type CellStatus = ReturnType<typeof projectStatus> | 'unset';

const StatusBadge: React.FC<{ status: CellStatus }> = ({ status }) => {
  const t = useProjectListText();

  return (
    <Badge
      className={styles.statusBadge}
      variant={status === 'unset' ? 'muted' : statusTone(status)}
      shape="plain"
      dot
    >
      {t(`status_${status}`)}
    </Badge>
  );
};

StatusBadge.displayName = 'StatusBadge';

/**
 * The tenant's own lifecycle: `active` / `suspended` / `deleted`.
 */
export const StatusInline: React.FC<{ tenant: TenantDto }> = ({ tenant }) => (
  <StatusBadge status={tenant.status} />
);

StatusInline.displayName = 'StatusInline';

export const ProjectStatusInline: React.FC<{ tenant: TenantDto; state: ProjectConfigState }> = ({
  tenant,
  state,
}) => {
  const t = useProjectListText();
  const { config, loading, unset, failed } = state;

  if (loading) return <Skeleton className={styles.cellSkeleton} />;
  if (failed) return <LoadFailed label={t('load_failed')} />;

  const status = projectStatus(tenant, config);
  if (status === 'suspended' || status === 'deleted') return <StatusBadge status={status} />;

  return <StatusBadge status={unset ? 'unset' : status} />;
};

ProjectStatusInline.displayName = 'ProjectStatusInline';
