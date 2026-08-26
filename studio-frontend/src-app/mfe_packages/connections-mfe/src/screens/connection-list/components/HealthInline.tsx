import React from 'react';
import { Badge, Skeleton } from '@gears-frontx/ui-kit';
import { healthTone } from '../../../model/connection';
import { useConnectionHealth } from '../../../shared/useConnectionHealth';
import { useConnectionListText } from '../../../i18n';
import { LoadFailed } from './LoadFailed';
import { NoData } from './NoData';
import styles from '../ConnectionListScreen.module.css';

export const HealthInline: React.FC<{ connectionId: string; tenantId: string }> = ({
  connectionId,
  tenantId,
}) => {
  const t = useConnectionListText();
  const { health, reason, loading, failed } = useConnectionHealth(connectionId, tenantId);

  if (loading) return <Skeleton className={styles.cellSkeleton} />;
  if (failed) return <LoadFailed label={t('load_failed')} />;
  if (!health) return <NoData label={t('no_data')} />;

  return (
    <Badge variant={healthTone(health)} shape="plain" dot title={reason ?? undefined}>
      {t(`health_${health}`)}
    </Badge>
  );
};

HealthInline.displayName = 'HealthInline';
