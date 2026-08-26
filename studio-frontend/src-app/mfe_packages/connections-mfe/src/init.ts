/**
 * MFE Bootstrap — executed once per loaded entry, NOT once per MFE.
 *
 * This MFE exposes two entries (`./lifecycle` and `./dialogLifecycle`), and
 * `MfeHandlerMF.loadExposedModuleIsolated` gives each one its own blob-URL
 * module graph. So this module is evaluated twice and there are TWO of
 * everything it creates: two apps, two stores, two event buses, two api
 * registries. What crosses between them is only what the framework hands over
 * through `globalThis` — the QueryClient and the host session.
 *
 * `authShared()` is what makes requests from here authenticated at all.
 * `i18n()` is what makes `useFormatters()` resolve. The framework's `mock()`
 * plugin is deliberately absent: its toggle is driven from the host's dev panel
 * over the host's eventBus, which does not cross the realm boundary.
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
import { connectSlice } from './slices/connectSlice';
import { initConnectEffects } from './effects/connectEffects';
import { ConnectorsApiService } from './api/ConnectorsApiService';

// Register API services BEFORE build so plugin sync finds them.
apiRegistry.register(ConnectorsApiService);
apiRegistry.initialize();

const mfeApp = createFrontX()
  .use(effects())
  .use(i18n())
  .use(queryCacheShared())
  .use(authShared())
  .build();

registerSlice(connectSlice, initConnectEffects);

export { mfeApp };
