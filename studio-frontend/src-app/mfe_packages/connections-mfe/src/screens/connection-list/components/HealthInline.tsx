import React from 'react';
import { Badge } from '@gears-frontx/ui-kit';
import { healthTone } from '../../../model/connection';
import { useConnectionHealth } from '../../../shared/useConnectionHealth';
import { useConnectionListText } from '../../../i18n';


export const HealthInline: React.FC<{ connectionId: string; tenantId: string }> = ({
  connectionId,
  tenantId,
}) => {
  const t = useConnectionListText();
  const { health, reason } = useConnectionHealth(connectionId, tenantId);

  return (
    <Badge
      variant={healthTone(health)}
      shape="plain"
      dot
      title={reason ?? (health === 'checking' ? t('health_checking_hint') : undefined)}
    >
      {t(`health_${health}`)}
    </Badge>
  );
};

HealthInline.displayName = 'HealthInline';
