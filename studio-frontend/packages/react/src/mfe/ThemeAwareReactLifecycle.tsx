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
  hostDocumentStyles,
  remoteEntryStyles,
  sheetFromText,
} from './shadowStyles';

interface ProviderMountOptions {
  mfeBridge?: {
    bridge: ChildMfeBridge;
    extensionId: string;
    domainId: string;
  };
}

function resolveProviderMountOptions(
  app: FrontXApp,
  bridge: ChildMfeBridge,
  mountContext?: MfeMountContext
): ProviderMountOptions {
  const extensionId = mountContext?.extensionId;
  const domainId = mountContext?.domainId;
  const isMountedMfe = typeof extensionId === 'string' && typeof domainId === 'string';

  if (
    isMountedMfe &&
    !resolveFrontXQueryClient(app) &&
    !hasFrontXQueryClientActivator(app)
  ) {
    throw new Error(
      '[FrontXProvider] Mounted MFEs require queryCacheShared() in the child app and queryCache() in the host app before loading the MFE app.'
    );
  }

  return {
    mfeBridge:
      isMountedMfe
        ? { bridge, extensionId, domainId }
        : undefined,
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

/**
 * Abstract base class for React-based MFE lifecycle implementations.
 *
 * Styling strategy: every stylesheet the mounted tree needs is resolved to a
 * constructed `CSSStyleSheet` and adopted BEFORE the first render, so the
 * container reaches the document already painted correctly. Four sources, in
 * cascade order:
 *
 * 1. the MFE's own compiled CSS, taken over from the `<link>`s
 *    `MfeHandlerMF.injectRemoteStylesheets` appended just before this call;
 * 2. the host document's stylesheets (the full compiled Tailwind, including MFE
 *    utilities — the shell's content paths cover `src-app/mfe_packages/**`);
 * 3. `BASE_RESETS`;
 * 4. whatever `additionalStyles()` returns.
 *
 * That order is the DOM order these sheets used to have, so moving them to
 * adoption re-ranks nothing. It has to be all four or none: adopted sheets are
 * appended after a shadow root's own `styleSheets` and therefore beat every
 * `<style>` in it regardless of insertion order. See `shadowStyles.ts` for the
 * measurements behind this, and for the `<style>`/`<link>` fallback used where
 * constructed sheets do not exist (jsdom, hence every vitest run).
 *
 * `mount` therefore returns a promise when it has sheets to fetch —
 * `MfeEntryLifecycle` declares `void | Promise<void>` and `DefaultMountManager`
 * awaits it, and the mounter attaches the container only after that promise
 * settles, which is exactly the window those fetches need. It is deliberately
 * NOT an `async` method: contract validation has to keep throwing at the call
 * site rather than one tick later as a rejection, and the fallback path (no
 * shadow root, or no constructed sheets — i.e. every jsdom test) stays entirely
 * synchronous.
 *
 * Theme CSS variables are delivered via CSS inheritance from `:root` (Shadow
 * DOM) or via MountManager injection (iframe). MFE lifecycles do NOT need to
 * subscribe to theme changes or call applyThemeToShadowRoot.
 *
 * Concrete subclasses must provide:
 * - `renderContent(bridge)` - screen component rendering
 */
// @cpt-dod:cpt-frontx-dod-mfe-isolation-author-state-lifecycle:p1
export abstract class ThemeAwareReactLifecycle implements MfeEntryLifecycle<ChildMfeBridge> {
  private root: Root | null = null;

  private mountGeneration = 0;

  constructor(private readonly app: FrontXApp) { }

  mount(
    container: Element | ShadowRoot,
    bridge: ChildMfeBridge,
    mountContext?: MfeMountContext
  ): void | Promise<void> {
    // First, and synchronously: a mount that cannot succeed must say so at the
    // call site, before any stylesheet work is started on its behalf.
    const providerMountOptions = resolveProviderMountOptions(this.app, bridge, mountContext);
    const generation = ++this.mountGeneration;

    if (container instanceof ShadowRoot && constructedSheetsSupported()) {
      return this.adoptStyles(container).then(() => {
        if (generation !== this.mountGeneration) return;
        this.renderRoot(container, bridge, providerMountOptions);
      });
    }

    if (container instanceof ShadowRoot) {
      this.adoptHostStylesIntoShadowRoot(container);
      this.appendStyleElement(container, BASE_RESETS);
      // Shadow-only, same as the guard each subclass used to carry: what
      // `additionalStyles()` returns is `:host`-anchored, so in a plain element
      // it would be a `<style>` node whose every rule is inert.
      for (const css of this.additionalStyles()) {
        this.appendStyleElement(container, css);
      }
    } else {
      this.appendStyleElement(container, BASE_RESETS);
    }
    this.renderRoot(container, bridge, providerMountOptions);
  }

  unmount(_container: Element | ShadowRoot): void {
    this.mountGeneration += 1;
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

  /**
   * Resolve and adopt all four style sources. Anything that could not be fetched
   * keeps the old `<link>` path — late styles beat missing styles.
   */
  private async adoptStyles(shadowRoot: ShadowRoot): Promise<void> {
    const [remote, host] = await Promise.all([
      remoteEntryStyles(shadowRoot),
      hostDocumentStyles(),
    ]);

    shadowRoot.adoptedStyleSheets = [
      ...remote.sheets,
      ...host.sheets,
      sheetFromText(BASE_RESETS),
      ...this.additionalStyles().map((css) => sheetFromText(css)),
    ];

    for (const link of [...remote.unresolvedLinks, ...host.unresolvedLinks]) {
      // A remote link that failed to resolve is still in place; only the host's
      // needs cloning in.
      if (link.parentNode !== shadowRoot) {
        shadowRoot.appendChild(link.cloneNode(true));
      }
    }
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
   * Hook for subclasses to contribute CSS not covered by the host stylesheet
   * (e.g. a re-anchored ui-kit theme, MFE-specific `@font-face` rules).
   *
   * Returns CSS **text** rather than appending elements, because the base class
   * has to own placement: these are the last sheets in the cascade, and only the
   * base class knows whether they become adopted sheets or `<style>` nodes.
   *
   * Applied only when the container is a ShadowRoot, since re-anchoring to
   * `:host` is the reason this hook exists. A custom handler that mounts into a
   * plain element gets `BASE_RESETS` and the host document's own cascade, and
   * needs neither.
   */
  protected additionalStyles(): string[] {
    return [];
  }

  /**
   * Return the screen-specific React component tree.
   */
  protected abstract renderContent(bridge: ChildMfeBridge): React.ReactNode;
}
