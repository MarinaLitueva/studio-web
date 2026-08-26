import React, { createContext, useContext, type ReactNode } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';

/**
 * The bridge, made reachable from anywhere in the screen tree.
 */
const BridgeContext = createContext<ChildMfeBridge | null>(null);

export const BridgeProvider: React.FC<{ bridge: ChildMfeBridge; children: ReactNode }> = ({
  bridge,
  children,
}) => <BridgeContext.Provider value={bridge}>{children}</BridgeContext.Provider>;

export function useBridge(): ChildMfeBridge | null {
  return useContext(BridgeContext);
}
