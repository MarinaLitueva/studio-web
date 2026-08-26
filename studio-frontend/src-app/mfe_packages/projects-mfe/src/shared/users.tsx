import { apiRegistry, useApiQuery } from '@gears-frontx/react';
import { AccountsApiService } from '../api/AccountsApiService';
import type { User } from '../api/types';

export interface UserLookup {
  user: User | null;
  loading: boolean;
  failed: boolean;
}

export function useUserById(tenantId: string, userId: string): UserLookup {
  const accounts = apiRegistry.getService(AccountsApiService);
  const { data, isLoading, isError } = useApiQuery(accounts.tenantUser({ tenantId, userId }));

  return { user: data?.items?.[0] ?? null, loading: isLoading, failed: isError };
}
