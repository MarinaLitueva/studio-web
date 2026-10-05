import { describe, expect, it } from 'vitest';
import { frontxThemes } from './index';

/**
 * The kit's theme.css owns the palette, the radius scale and the type ramp
 * (ADR-0034). A theme here says which kit palette it sits on, restates the one
 * token whose kit value is wrong for this app — `--font-sans`, because the
 * registered family is 'Inter Variable', not 'Inter'. Dracula adds its own
 * colours on top.
 */
describe('frontxThemes', () => {
  it('registers more than one theme', () => {
    expect(frontxThemes.length).toBeGreaterThan(1);
  });

  it.each(frontxThemes.map((theme) => [theme.id, theme] as const))(
    'theme %s declares its appearance, so data-theme picks the kit palette',
    (_id, theme) => {
      expect(theme.appearance).toMatch(/^(light|dark)$/);
    }
  );

  it.each(frontxThemes.map((theme) => [theme.id, theme] as const))(
    'theme %s declares a --font-sans stack led by Inter Variable, with a system fallback',
    (_id, theme) => {
      const stack = theme.variables['--font-sans'];
      expect(stack).toMatch(/^'Inter Variable'/);
      expect(stack).toMatch(/system-ui/);
    }
  );

  it('leaves the kit palette alone on the light and dark themes', () => {
    for (const id of ['default', 'light', 'dark']) {
      const theme = frontxThemes.find((entry) => entry.id === id);
      const kitNames = Object.keys(theme?.variables ?? {}).filter(
        (name) => name !== '--font-sans'
      );
      expect(kitNames).toEqual([]);
    }
  });
});
