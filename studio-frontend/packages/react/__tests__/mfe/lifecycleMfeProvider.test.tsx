/**
 * `MfeProvider` must be mounted for a lifecycle whose runtime dropped the
 * `mountContext` argument — the case every CSS-shipping MFE hits, and the reason
 * `useMfeBridge`/`useSharedProperty` used to throw inside them.
 */

import React from 'react';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import {
  createFrontX,
  type ChildMfeBridge,
  type FrontXApp,
  queryCache,
  queryCacheShared,
  resetSharedQueryClient,
} from '@gears-frontx/framework';
import { ThemeAwareReactLifecycle, useMfeBridge, useSharedProperty } from '@gears-frontx/react';

afterEach(() => {
  resetSharedQueryClient();
});

const PROPERTY_ID = 'gts.frontx.mfes.comm.shared_property.v1~test.org.v1~';

function makeBridge(properties: Map<string, unknown>): ChildMfeBridge {
  return {
    domainId: 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.main.v1',
    // Shaped as BridgeFactory.createBridge builds it: `${extensionId}:${Date.now()}`.
    instanceId: 'gts.frontx.mfes.ext.extension.v1~test.screen.main.v1:1700000000000',
    executeActionsChain: vi.fn().mockResolvedValue(undefined),
    subscribeToProperty: vi.fn().mockReturnValue(() => undefined),
    getProperty: vi.fn((id: string) =>
      properties.has(id) ? { value: properties.get(id) } : undefined
    ),
    registerActionHandler: vi.fn(),
  } as unknown as ChildMfeBridge;
}

interface Observed {
  instanceId?: string;
  property?: unknown;
}

const Probe: React.FC<{ onRender: (observed: Observed) => void }> = ({ onRender }) => {
  const bridge = useMfeBridge();
  const property = useSharedProperty<{ id: string }>(PROPERTY_ID);
  onRender({ instanceId: bridge.instanceId, property });
  return null;
};

class ProbeLifecycle extends ThemeAwareReactLifecycle {
  constructor(
    app: FrontXApp,
    private readonly onRender: (observed: Observed) => void
  ) {
    super(app);
  }

  protected renderContent(): React.ReactNode {
    return React.createElement(Probe, { onRender: this.onRender });
  }
}

describe('ThemeAwareReactLifecycle MFE provider', () => {
  it('mounts MfeProvider from the bridge when the runtime drops mountContext', async () => {
    const childApp = createFrontX().use(queryCacheShared()).build();
    const hostApp = createFrontX().use(queryCache()).build();

    let observed: Observed | undefined;
    const lifecycle = new ProbeLifecycle(childApp, (next) => {
      observed = next;
    });

    const container = document.createElement('div');
    const bridge = makeBridge(new Map([[PROPERTY_ID, { id: 'org-1' }]]));

    await act(async () => {
      // Two arguments, exactly as the stylesheet wrapper in @gears-frontx/mfes calls it.
      lifecycle.mount(container, bridge);
    });

    await waitFor(() => {
      expect(observed?.instanceId).toBe(bridge.instanceId);
    });
    expect(observed?.property).toEqual({ id: 'org-1' });

    act(() => {
      lifecycle.unmount(container);
      childApp.destroy();
      hostApp.destroy();
    });
  });

  it('reads a published null as null, and an absent property as undefined', async () => {
    const childApp = createFrontX().use(queryCacheShared()).build();
    const hostApp = createFrontX().use(queryCache()).build();

    let observed: Observed | undefined;
    const lifecycle = new ProbeLifecycle(childApp, (next) => {
      observed = next;
    });

    const container = document.createElement('div');

    await act(async () => {
      lifecycle.mount(container, makeBridge(new Map([[PROPERTY_ID, null]])));
    });
    await waitFor(() => {
      expect(observed).toBeDefined();
    });
    expect(observed?.property).toBeNull();

    act(() => {
      lifecycle.unmount(container);
    });

    const second = document.createElement('div');
    await act(async () => {
      lifecycle.mount(second, makeBridge(new Map()));
    });
    await waitFor(() => {
      expect(observed?.property).toBeUndefined();
    });

    act(() => {
      lifecycle.unmount(second);
      childApp.destroy();
      hostApp.destroy();
    });
  });
});
