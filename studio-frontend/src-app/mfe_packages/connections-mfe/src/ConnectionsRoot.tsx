import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { BridgeProvider } from './shared/bridge';
import { OrganizationProvider } from './shared/organization';
import { useHostChrome } from './shared/useHostChrome';
import { ConnectionListScreen } from './screens/connection-list/ConnectionListScreen';
import styles from './ConnectionsRoot.module.css';

export const ConnectionsRoot: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => {
  const { containerRef, dataTheme } = useHostChrome(bridge);

  return (
    <div ref={containerRef} className={styles.root} data-theme={dataTheme}>
      <BridgeProvider bridge={bridge}>
        <OrganizationProvider bridge={bridge}>
          <ConnectionListScreen />
        </OrganizationProvider>
      </BridgeProvider>
    </div>
  );
};

ConnectionsRoot.displayName = 'ConnectionsRoot';
