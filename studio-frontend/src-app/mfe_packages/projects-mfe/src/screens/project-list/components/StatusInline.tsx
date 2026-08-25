import React from 'react';
import { Badge, Skeleton } from '@gears-frontx/ui-kit';
import { projectStatus, statusTone } from '../../../model/project';
import { useProjectConfig } from '../../../shared/useProjectConfig';
import { useProjectListText } from '../../../i18n';
import type { TenantDto } from '../../../api/types';
import styles from '../ProjectListScreen.module.css';

/**
 * The tenant's own lifecycle: `active` / `suspended` / `deleted`. All a
 * container row can show — a workspace carries no project-config metadata.
 */
export const StatusInline: React.FC<{ tenant: TenantDto }> = ({ tenant }) => {
  const t = useProjectListText();

  return (
    <Badge variant={statusTone(tenant.status)} shape="plain" dot>
      {t(`status_${tenant.status}`)}
    </Badge>
  );
};

StatusInline.displayName = 'StatusInline';

export const ProjectStatusInline: React.FC<{ tenant: TenantDto }> = ({ tenant }) => {
  const t = useProjectListText();
  const { config, loading, unset } = useProjectConfig(tenant.id);

  if (loading) return <Skeleton className={styles.cellSkeleton} />;
  if (unset) {
    return (
      <Badge variant="muted" shape="plain" dot>
        {t('status_unset')}
      </Badge>
    );
  }

  const status = projectStatus(tenant, config);

  return (
    <Badge variant={statusTone(status)} shape="plain" dot>
      {t(`status_${status}`)}
    </Badge>
  );
};

ProjectStatusInline.displayName = 'ProjectStatusInline';
