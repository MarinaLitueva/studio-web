import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FrontXProvider, createFrontXApp, i18nRegistry } from '@gears-frontx/react';
import { CONNECTION_LIST_NAMESPACE } from '../../../i18n';
import en from '../i18n/en.json';
import { ConnectionsToolbar } from './ConnectionsToolbar';

/**
 * The header's controls come from the kit and are configured, not written, so
 * what is worth asserting is that each one still reaches the accessibility tree
 * under the name the mockup gives it. A misconfigured kit control renders empty
 * and nothing else fails — exactly the sort of break a type-check does not catch.
 *
 * Translations are registered synchronously: the registry's default and
 * fallback language are both English, so this resolves every key without
 * racing the async loader.
 */
async function mount(busy: boolean) {
  createFrontXApp({});
  const { mfeApp } = await import('../../../init');
  i18nRegistry.register(CONNECTION_LIST_NAMESPACE, 'en' as never, en);

  render(
    <FrontXProvider app={mfeApp}>
      <ConnectionsToolbar query="" onQueryChange={vi.fn()} busy={busy} />
    </FrontXProvider>
  );
}

describe('ConnectionsToolbar', () => {
  it('renders the title, the search box and Connect source', async () => {
    await mount(false);

    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: en.search_placeholder })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.connect_source })).toBeTruthy();
  });

  it('shows a skeleton instead of the title until the screen is ready', async () => {
    await mount(true);

    expect(screen.queryByText(en.title)).toBeNull();
  });
});
