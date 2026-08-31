/**
 * The third entry of this MFE: the New workspace form, mounted by the shell
 * into its overlay domain.
 */

// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-overlay:p1
import React from 'react';
import { anchorKitThemeOnShadowHost, ThemeAwareReactLifecycle } from '@gears-frontx/react';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { NewWorkspaceForm } from './screens/workspace-create/NewWorkspaceForm';

/** Same re-anchored kit theme as the screenset entry; see `lifecycle.tsx`. */
const KIT_THEME_ON_HOST = anchorKitThemeOnShadowHost(kitTheme);

class WorkspaceCreateLifecycle extends ThemeAwareReactLifecycle {
  constructor() {
    super(mfeApp, { additionalStyles: [KIT_THEME_ON_HOST] });
  }

  protected renderContent(): React.ReactNode {
    return <NewWorkspaceForm />;
  }
}

export default new WorkspaceCreateLifecycle();
