/**
 * Layout Component
 *
 * Main layout orchestrator for the application.
 *
 * The top bar is the only chrome in the flow: it takes a 56px row and the
 * mounted MFE gets everything below it, full width. Navigation is no longer a
 * column beside the content — `Menu` renders as an overlay drawer outside the
 * flow, so nothing reserves space for it while it is closed.
 */

import React, { useEffect } from 'react';
import { fetchCurrentUser, fetchAppContext } from '@/app/actions/bootstrapActions';
import { Header } from './Header';
import { Menu } from './Menu';
import { Sidebar } from './Sidebar';
import { Screen } from './Screen';
import { Popup } from './Popup';
import { Overlay } from './Overlay';
import { SearchDialog } from './SearchDialog';

export interface LayoutProps {
  children?: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  useEffect(() => {
    // Bootstrap application on mount — the signed-in user, and the organizations
    // the top bar's context slot switches between.
    fetchCurrentUser();
    fetchAppContext();
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Global top bar: navigation control, product name, context, session */}
      <Header />

      {/* Content row: the screen takes the width, the contextual panel (when an
          MFE asks for it) sits at its right edge. */}
      <div className="flex flex-1 overflow-hidden">
        <Screen>{children}</Screen>
        <Sidebar />
      </div>

      {/* Out of the flow, over everything: drawer, dialogs, overlays. */}
      <Menu />
      <SearchDialog />
      <Popup />
      <Overlay />
    </div>
  );
};

Layout.displayName = 'Layout';
