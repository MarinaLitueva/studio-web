/**
 * MFE Bootstrap — executed once when any entry first loads.
 * Creates the minimal FrontX app, registers slices, effects, and API services.
 * Cache/runtime note:
 * - The host app owns the shared runtime via queryCache().
 * - Child apps join that shared QueryClient via queryCacheShared().
 * - Do not add queryCache(), createFrontXApp(), or QueryClientProvider here.
 *
 * `authShared()` is what makes requests from here authenticated at all: the MFE
 * runs in its own module realm, so the host's auth REST plugin is invisible to
 * this app's `apiRegistry` — the shared plugin reads the host session through the
 * `globalThis` handoff instead. Without it every call is a 401 MISSING_BEARER.
 *
 * The framework's `mock()` plugin is deliberately absent: its toggle is driven
 * from the host's dev panel over the host's eventBus, which does not cross the
 * realm boundary. There is no mock mode: this MFE talks to the real gear.
 *
 * `i18n()` is what makes both halves of translation work: `useFormatters()`
 * (dates, numbers) resolves `app.i18nRegistry`, and without the plugin that is
 * undefined — the first formatted cell throws and the whole screen renders
 * blank. Screen dictionaries are NOT registered here: the framework's
 * `useScreenTranslations` registers each screen's loader itself, on mount, so
 * the screens stay lazy (see `src/i18n.ts`). The registry is this realm's own;
 * ProjectsRoot feeds it the language it gets from the bridge.
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
import { initProjectsEffects } from './effects/projectsEffects';
import { AccountsApiService } from './api/AccountsApiService';

// Register API services BEFORE build so plugin sync finds them.
// One service: projects are account-management tenants since the studio-project
// gear was retired.
apiRegistry.register(AccountsApiService);
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

export { mfeApp };
