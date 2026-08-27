// @cpt-flow:cpt-frontx-flow-request-lifecycle-query-client-lifecycle:p2

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  FrontXApp,
  MfeEntryLifecycle,
  ChildMfeBridge,
  MfeMountContext,
} from '@gears-frontx/framework';
import { FrontXProvider } from '../FrontXProvider';
import { hasFrontXQueryClientActivator, resolveFrontXQueryClient } from '../queryClient';
import {
  constructedSheetsSupported,
  prewarmShadowStyles,
  remoteStylesheetHrefs,
  sheetFromText,
  supersedeLink,
  warmShadowStyles,
} from './shadowStyles';

interface ProviderMountOptions {
  mfeBridge?: {
    bridge: ChildMfeBridge;
    extensionId: string;
    domainId: string;
  };
}

/** Strips the `:<timestamp>` suffix `BridgeFactory.createBridge` appends.
 * TODO: drop the fallback once the wrapper in @gears-frontx/mfes forwards the
 * third argument.
 * */
function extensionIdFromInstanceId(instanceId: string | undefined): string | undefined {
  if (typeof instanceId !== 'string' || instanceId === '') return undefined;
  return instanceId.replace(/:\d+$/, '');
}

function mountedMfePair(
  bridge: ChildMfeBridge,
  mountContext?: MfeMountContext
): { readonly extensionId: string; readonly domainId: string } | undefined {
  const domainId = mountContext?.domainId ?? bridge.domainId;
  const extensionId =
    mountContext?.extensionId ?? extensionIdFromInstanceId(bridge.instanceId);

  if (typeof domainId !== 'string' || typeof extensionId !== 'string') return undefined;
  return { extensionId, domainId };
}

function resolveProviderMountOptions(
  app: FrontXApp,
  bridge: ChildMfeBridge,
  mountContext?: MfeMountContext
): ProviderMountOptions {
  const pair = mountedMfePair(bridge, mountContext);
  const declaresMountedMfe =
    typeof mountContext?.extensionId === 'string' && typeof mountContext?.domainId === 'string';

  if (
    declaresMountedMfe &&
    !resolveFrontXQueryClient(app) &&
    !hasFrontXQueryClientActivator(app)
  ) {
    throw new Error(
      '[FrontXProvider] Mounted MFEs require queryCacheShared() in the child app and queryCache() in the host app before loading the MFE app.'
    );
  }

  return {
    mfeBridge: pair ? { bridge, extensionId: pair.extensionId, domainId: pair.domainId } : undefined,
  };
}

interface MountRuntimeAwareProviderProps {
  readonly app: FrontXApp;
  readonly mfeBridge?: Readonly<{
    readonly bridge: ChildMfeBridge;
    readonly extensionId: string;
    readonly domainId: string;
  }>;
  readonly children: React.ReactNode;
}

function MountRuntimeAwareProvider({
  app,
  mfeBridge,
  children,
}: Readonly<MountRuntimeAwareProviderProps>): React.JSX.Element {
  return (
    <FrontXProvider app={app} mfeBridge={mfeBridge}>
      {children}
    </FrontXProvider>
  );
}

/**
 * Box-model resets and `:host` defaults needed inside every shadow root. Not
 * part of Tailwind's compiled output, but required for consistent rendering.
 */
const BASE_RESETS = `
      *, *::before, *::after {
        box-sizing: border-box;
        border-width: 0;
        border-style: solid;
        border-color: currentColor;
      }
      * { margin: 0; padding: 0; }
      :host {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        color: hsl(var(--foreground));
        background-color: hsl(var(--background));
      }
    `;

/** Per-subclass CSS, supplied at construction rather than by overriding a hook. */
export interface ThemeAwareReactLifecycleOptions {
  readonly additionalStyles?: readonly string[];
}

/**
 * Abstract base class for React-based MFE lifecycle implementations.
 */
// @cpt-dod:cpt-frontx-dod-mfe-isolation-author-state-lifecycle:p1
export abstract class ThemeAwareReactLifecycle implements MfeEntryLifecycle<ChildMfeBridge> {
  private root: Root | null = null;

  constructor(
    private readonly app: FrontXApp,
    private readonly options?: ThemeAwareReactLifecycleOptions
  ) { }

  mount(
    container: Element | ShadowRoot,
    bridge: ChildMfeBridge,
    mountContext?: MfeMountContext
  ): void {
    // First: a mount that cannot succeed must say so at the call site, before
    // any stylesheet work is done on its behalf.
    const providerMountOptions = resolveProviderMountOptions(this.app, bridge, mountContext);

    if (container instanceof ShadowRoot && constructedSheetsSupported()) {
      const warm = warmShadowStyles(container);
      if (warm) {
        container.adoptedStyleSheets = [
          ...warm.sheets,
          sheetFromText(BASE_RESETS),
          ...this.additionalStyles().map((css) => sheetFromText(css)),
        ];
        // The handler's own `<link>`s carry the same bytes as `warm.sheets`;
        // left applying, they would be parsed a second time per mount.
        for (const link of warm.supersededLinks) supersedeLink(link);
        for (const link of warm.crossOriginLinks) {
          container.appendChild(link.cloneNode(true));
        }
        this.renderRoot(container, bridge, providerMountOptions);
        return;
      }
      // Cold cache. Warm it for the next mount and take the DOM-node path for
      // this one — the old behaviour, not a partial adoption.
      prewarmShadowStyles(remoteStylesheetHrefs(container));
    }

    if (container instanceof ShadowRoot) {
      this.adoptHostStylesIntoShadowRoot(container);
      this.appendStyleElement(container, BASE_RESETS);
      // Shadow-only: what `additionalStyles()` returns is `:host`-anchored, so
      // in a plain element it would be a `<style>` node whose every rule is
      // inert.
      for (const css of this.additionalStyles()) {
        this.appendStyleElement(container, css);
      }
    } else {
      this.appendStyleElement(container, BASE_RESETS);
    }
    this.renderRoot(container, bridge, providerMountOptions);
  }

  unmount(_container: Element | ShadowRoot): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  private renderRoot(
    container: Element | ShadowRoot,
    bridge: ChildMfeBridge,
    providerMountOptions: ProviderMountOptions
  ): void {
    this.root = createRoot(container);
    this.root.render(
      <MountRuntimeAwareProvider
        app={this.app}
        mfeBridge={providerMountOptions.mfeBridge}
      >
        {this.renderContent(bridge)}
      </MountRuntimeAwareProvider>
    );
  }

  private appendStyleElement(container: Element | ShadowRoot, css: string): void {
    const style = document.createElement('style');
    style.textContent = css;
    container.appendChild(style);
  }

  /**
   * Fallback path only (no constructed stylesheets): copy all inline `<style>`
   * and `<link rel="stylesheet">` from the host document into the shadow root.
   * The `<link>` clones load asynchronously and the `<style>` clones re-parse the
   * host's whole CSS on every mount — which is the flicker `adoptStyles` exists
   * to avoid.
   */
  protected adoptHostStylesIntoShadowRoot(shadowRoot: ShadowRoot): void {
    const styleElements = document.head.querySelectorAll('style');
    styleElements.forEach((el) => {
      const clone = document.createElement('style');
      clone.textContent = el.textContent ?? '';
      shadowRoot.appendChild(clone);
    });
    const linkElements = document.head.querySelectorAll('link[rel="stylesheet"]');
    linkElements.forEach((el) => {
      const clone = el.cloneNode(true) as HTMLLinkElement;
      shadowRoot.appendChild(clone);
    });
  }

  /**
   * CSS not covered by the host stylesheet (e.g. a re-anchored ui-kit theme,
   * MFE-specific `@font-face` rules).
   *
   * Normally supplied as `options.additionalStyles` at construction rather than
   * overridden: every MFE in this repo contributes the same one sheet, and seven
   * identical overrides had to be edited in lockstep whenever the base class
   * moved. It stays a method so a subclass whose CSS depends on instance state
   * still has somewhere to put that.
   *
   * CSS **text**, not elements, because the base class has to own placement:
   * these are the last sheets in the cascade, and only it knows whether they
   * become adopted sheets or `<style>` nodes.
   *
   * Applied only when the container is a ShadowRoot, since re-anchoring to
   * `:host` is the reason this exists. A custom handler that mounts into a plain
   * element gets `BASE_RESETS` and the host document's own cascade, and needs
   * neither.
   */
  protected additionalStyles(): readonly string[] {
    return this.options?.additionalStyles ?? [];
  }

  /**
   * Return the screen-specific React component tree.
   */
  protected abstract renderContent(bridge: ChildMfeBridge): React.ReactNode;
}
