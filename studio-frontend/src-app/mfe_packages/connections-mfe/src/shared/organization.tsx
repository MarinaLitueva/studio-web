/**
 * Which organization this MFE is working in — told by the shell, not derived.
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-create-scope:p1
import React, { createContext, useContext, type ReactNode } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION } from './hostProperties';
import { useBridgeProperty } from './useBridgeProperty';

/** All the shell publishes, and all any screen here reads. */
export interface OrganizationRef {
  id: string;
  name: string;
}

export interface OrganizationState {
  org: OrganizationRef | null;
  loading: boolean;
  failed: boolean;
}

const EMPTY: OrganizationState = { org: null, loading: false, failed: false };

const OrganizationContext = createContext<OrganizationState>(EMPTY);

export function useOrganization(): OrganizationState {
  return useContext(OrganizationContext);
}

function isOrganizationRef(value: unknown): value is OrganizationRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Partial<OrganizationRef>;
  return typeof ref.id === 'string' && !!ref.id && typeof ref.name === 'string';
}

export const OrganizationProvider: React.FC<{
  bridge: ChildMfeBridge | null;
  children: ReactNode;
}> = ({ bridge, children }) => {
  const published = useBridgeProperty<unknown>(
    bridge,
    STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION
  );

  const value: OrganizationState =
    published === undefined
      ? { org: null, loading: true, failed: false }
      : { org: isOrganizationRef(published) ? published : null, loading: false, failed: false };

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
};

OrganizationProvider.displayName = 'OrganizationProvider';
