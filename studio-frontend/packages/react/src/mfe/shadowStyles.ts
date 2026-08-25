/**
 * Constructable stylesheets for shadow-root adoption.
 *
 * Styles used to reach a shadow root as DOM nodes, including the `<link>`
 * `MfeHandlerMF.injectRemoteStylesheets` appends before `mount`. A `<link>` in a
 * still-detached shadow root does not even start loading until the container is
 * attached — which `DefaultExtensionMounter` does only after `mount` resolves
 * (measured: nothing after 300ms detached, 18ms after attaching). So first paint
 * was unstyled: a flash on every mount, a jump in the overlay whose card
 * shrink-wraps content that late CSS sizes.
 *
 * Fetching the CSS as text and adopting it as a constructed sheet puts all of it
 * in front of the first render — adoption is synchronous, and sheets are shared
 * instead of re-parsed per mount. No new deployment requirement: the handler
 * already `fetch()`es every JS chunk from the same origins.
 *
 * @packageDocumentation
 */

/**
 * Adoption is all-or-nothing, and that is a cascade fact: adopted sheets rank
 * after a root's own `styleSheets` whatever the insertion order, so moving only
 * some of them would silently re-rank the rest — the shell's Tailwind would start
 * beating the ui-kit theme. A runtime without constructed sheets therefore keeps
 * the DOM-node path for all of them. jsdom 26 is that runtime, which is why the
 * fallback is what vitest exercises.
 */
const CONSTRUCTED_SHEETS_SUPPORTED: boolean = (() => {
  if (typeof ShadowRoot === 'undefined' || typeof CSSStyleSheet === 'undefined') return false;
  if (!('adoptedStyleSheets' in ShadowRoot.prototype)) return false;
  try {
    new CSSStyleSheet().replaceSync('');
    return true;
  } catch {
    return false;
  }
})();

export function constructedSheetsSupported(): boolean {
  return CONSTRUCTED_SHEETS_SUPPORTED;
}

/**
 * Sheets built from a host `<style>`, keyed by the element. Mutated in place
 * rather than rebuilt, so a Vite HMR update to the shell's CSS reaches every
 * root that already adopted it.
 */
const sheetByElement = new WeakMap<Element, { text: string; sheet: CSSStyleSheet }>();

/** Sheets built from CSS text the caller owns (base resets, per-MFE additions). */
const sheetByText = new Map<string, CSSStyleSheet>();

/**
 * Sheets fetched from a URL — the host's own `<link>`s and each MFE's own CSS.
 * A resolved entry is kept for the realm's life, which is what makes the second
 * mount free. Prod URLs are content-hashed; in dev they are stable while the
 * bytes change, so HMR of an MFE's own CSS needs a reload (the `<style>` path
 * above has no such gap).
 */
const sheetByHref = new Map<string, Promise<CSSStyleSheet | null>>();

/**
 * Sheets to adopt, plus any `<link>` that could not be fetched. Nothing is
 * dropped: an unresolved link goes back to the caller to clone the old way,
 * which is slower but never blank.
 */
export interface ResolvedStyles {
  readonly sheets: readonly CSSStyleSheet[];
  readonly unresolvedLinks: readonly HTMLLinkElement[];
}

/** Cached by the text itself, so callers must pass stable strings. */
export function sheetFromText(css: string): CSSStyleSheet {
  const cached = sheetByText.get(css);
  if (cached) return cached;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  sheetByText.set(css, sheet);
  return sheet;
}

function sheetFromElement(element: Element): CSSStyleSheet {
  const text = element.textContent ?? '';
  const cached = sheetByElement.get(element);
  if (cached && cached.text === text) return cached.sheet;
  const sheet = cached?.sheet ?? new CSSStyleSheet();
  sheet.replaceSync(text);
  sheetByElement.set(element, { text, sheet });
  return sheet;
}

function sheetFromHref(href: string): Promise<CSSStyleSheet | null> {
  const cached = sheetByHref.get(href);
  if (cached) return cached;

  const pending = fetch(href)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .then((css) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      return sheet;
    })
    .catch((error: unknown) => {
      sheetByHref.delete(href);
      console.warn(
        `[shadowStyles] Could not adopt stylesheet '${href}'; falling back to a cloned <link>:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    });

  sheetByHref.set(href, pending);
  return pending;
}

async function resolveLinks(links: readonly HTMLLinkElement[]): Promise<ResolvedStyles> {
  const sheets: CSSStyleSheet[] = [];
  const unresolvedLinks: HTMLLinkElement[] = [];
  const resolved = await Promise.all(links.map((link) => sheetFromHref(link.href)));
  resolved.forEach((sheet, index) => {
    if (sheet) sheets.push(sheet);
    else unresolvedLinks.push(links[index]!);
  });
  return { sheets, unresolvedLinks };
}

function isSameOrigin(href: string): boolean {
  try {
    return new URL(href, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * The shell's own stylesheets, in `document.head` order — `<style>` in dev, a
 * `<link>` in a production build, both adopted.
 *
 * Cross-origin host links are deliberately NOT fetched: awaiting a third party
 * would put its latency between the click and the first paint (63ms measured for
 * Google Fonts, 3x the MFE's own CSS), and all that lives there is `@font-face`,
 * which a shadow root ignores anyway. They keep the cloned-`<link>` path. The
 * MFE's own CSS is fetched cross-origin regardless — first paint depends on it,
 * and the handler already fetches JS from that origin.
 */
export async function hostDocumentStyles(): Promise<ResolvedStyles> {
  const inline = Array.from(document.head.querySelectorAll('style'), sheetFromElement);
  const links = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  );
  const sameOrigin = links.filter((link) => isSameOrigin(link.href));
  const crossOrigin = links.filter((link) => !isSameOrigin(link.href));
  const linked = await resolveLinks(sameOrigin);
  return {
    sheets: [...inline, ...linked.sheets],
    unresolvedLinks: [...linked.unresolvedLinks, ...crossOrigin],
  };
}

/**
 * The MFE's own compiled CSS, taken over from the `<link>`s the handler injected.
 * Matched by tag, not by the handler's private id prefix: at this point in
 * `mount` nothing else has put a link in this root, so the two are the same set
 * and this survives a change in that private format. Resolved links are removed,
 * leaving `removeInjectedStylesheets` nothing to do on unmount.
 */
export async function remoteEntryStyles(shadowRoot: ShadowRoot): Promise<ResolvedStyles> {
  const links = Array.from(shadowRoot.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  if (links.length === 0) return { sheets: [], unresolvedLinks: [] };
  const resolved = await resolveLinks(links);
  for (const link of links) {
    if (!resolved.unresolvedLinks.includes(link)) link.remove();
  }
  return resolved;
}
