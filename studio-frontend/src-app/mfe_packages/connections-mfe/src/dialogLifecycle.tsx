/**
 * The second entry of this MFE: the Connect source form, mounted by the shell
 * into its overlay domain.
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-create-overlay:p1
import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { ThemeAwareReactLifecycle } from '@gears-frontx/react';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { anchorKitThemeOnShadowHost } from './shared/anchorKitThemeOnShadowHost';
import { ConnectSourceDialog } from './screens/connect-source/ConnectSourceDialog';

class ConnectSourceLifecycle extends ThemeAwareReactLifecycle {
  constructor() {
    super(mfeApp);
  }

  protected initializeStyles(container: Element | ShadowRoot): void {
    super.initializeStyles(container);
    if (container instanceof ShadowRoot) {
      const style = document.createElement('style');
      style.textContent = anchorKitThemeOnShadowHost(kitTheme);
      container.appendChild(style);
    }
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <ConnectSourceDialog bridge={bridge} />;
  }
}

export default new ConnectSourceLifecycle();
