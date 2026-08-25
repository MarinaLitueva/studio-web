import React from 'react';
import { Skeleton } from '@gears-frontx/ui-kit';
import { ownerName } from '../../../model/project';
import { useProjectConfig } from '../../../shared/useProjectConfig';
import { useUsers } from '../../../shared/users';
import { useProjectListText } from '../../../i18n';
import type { TenantDto } from '../../../api/types';
import { NoData } from './NoData';
import styles from '../ProjectListScreen.module.css';

/**
 * The project's owner: `owner_id` from its own metadata, named from the
 * organization's user page — one request for the whole screen, mounted by
 * `UsersProvider` in `ProjectListScreen`.
 *
 * Name only for now. The kit has no Avatar yet, and the wizard's `UserRow`
 * holds the same placeholder; when it lands, one goes beside the name here.
 */
export const OwnerInline: React.FC<{ tenant: TenantDto }> = ({ tenant }) => {
  const t = useProjectListText();
  const users = useUsers();
  const { config, loading } = useProjectConfig(tenant.id);

  if (loading) return <Skeleton className={styles.cellSkeleton} />;

  const name = ownerName(config?.owner_id, users);
  if (!name) return <NoData label={t('no_owner')} />;

  return <span className={styles.ownerName}>{name}</span>;
};

OwnerInline.displayName = 'OwnerInline';
