/**
 * MFE Bootstrap — executed once per loaded entry, NOT once per MFE.
 */
// @cpt-dod:cpt-frontx-dod-mfe-isolation-internal-dataflow:p1
// @cpt-flow:cpt-frontx-flow-mfe-isolation-mfe-bootstrap:p1

import {
  createFrontX,
  registerSlice,
  apiRegistry,
  authShared,
  effects,
  i18n,
  queryCacheShared,
} from '@gears-frontx/react';
import { navSlice } from './slices/navSlice';
import { createWizardSlice } from './slices/createSlice';
import { workspaceCreateSlice } from './slices/workspaceSlice';
import { initProjectsEffects } from './effects/projectsEffects';
import { initWizardEffects } from './effects/wizardEffects';
import { initWorkspaceEffects } from './effects/workspaceEffects';
import { AccountsApiService } from './api/AccountsApiService';
import { ConnectorsApiService } from '@constructor-studio/mfe-shared';

// Register API services BEFORE build so plugin sync finds them.
// Two gears: account-management holds the projects themselves (tenants, since
// the studio-project gear was retired), studio-connector the source hosts the
// New project wizard imports from.
apiRegistry.register(AccountsApiService);
apiRegistry.register(ConnectorsApiService);
apiRegistry.initialize();

// Create only the local MFE app shell.
// queryCacheShared() joins the host-owned QueryClient without reconfiguring it.
const mfeApp = createFrontX()
  .use(effects())
  .use(i18n())
  .use(queryCacheShared())
  .use(authShared())
  .build();

// Register slices with effects (needs store from build())
registerSlice(navSlice, initProjectsEffects);
registerSlice(createWizardSlice, initWizardEffects);
registerSlice(workspaceCreateSlice, initWorkspaceEffects);

export { mfeApp };
