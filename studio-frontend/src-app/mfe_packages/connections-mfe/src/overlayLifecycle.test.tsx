/**
 * The overlay entry has to hand the re-anchored ui-kit theme to the base class
 * exactly the way the screenset entry does (`lifecycle.tsx`) and the sibling
 * overlay in projects-mfe does (`overlayLifecycle.tsx`).
 *
 * It used to publish that sheet from an `initializeStyles` override — a hook
 * `ThemeAwareReactLifecycle` does not have any more; the base class takes the
 * sheet at construction now. Nothing called the override, so the dialog's
 * shadow root came up without a single kit token and every ui-kit control in
 * it rendered against unresolved custom properties.
 */
import { describe, expect, it } from 'vitest';
import { anchorKitThemeOnShadowHost } from '@gears-frontx/react';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';

describe('connections-mfe dialog lifecycle', () => {
  it('hands the re-anchored kit theme to ThemeAwareReactLifecycle', async () => {
    const module = await import('./overlayLifecycle');
    const lifecycle = module.default;
    const additionalStyles = Reflect.get(lifecycle, 'additionalStyles') as
      | (() => readonly string[])
      | undefined;

    expect(typeof additionalStyles).toBe('function');
    expect(additionalStyles?.call(lifecycle)).toEqual([anchorKitThemeOnShadowHost(kitTheme)]);
  });
});
