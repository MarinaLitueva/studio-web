/**
 * The second entry of this MFE: the Connect source form, mounted by the shell
 * into its overlay domain.
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-create-overlay:p1
import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { anchorKitThemeOnShadowHost, ThemeAwareReactLifecycle } from '@gears-frontx/react';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { ConnectSourceDialog } from './screens/connect-source/ConnectSourceDialog';

/** Same re-anchored kit theme as the screenset entry; see `lifecycle.tsx`. */
const KIT_THEME_ON_HOST = anchorKitThemeOnShadowHost(kitTheme);

class ConnectSourceLifecycle extends ThemeAwareReactLifecycle {
  constructor() {
    super(mfeApp, { additionalStyles: [KIT_THEME_ON_HOST] });
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <ConnectSourceDialog bridge={bridge} />;
  }
}

export default new ConnectSourceLifecycle();
