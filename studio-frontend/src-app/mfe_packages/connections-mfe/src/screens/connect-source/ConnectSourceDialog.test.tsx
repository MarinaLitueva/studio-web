import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FrontXProvider, createFrontXApp, i18nRegistry } from '@gears-frontx/react';
import { createMfeBridgeFixture } from '../../../../../__test-utils__/createMfeBridgeFixture';
import { CONNECT_SOURCE_NAMESPACE } from '../../i18n';
import en from './i18n/en.json';
import { ConnectSourceDialog } from './ConnectSourceDialog';

/**
 * What this asserts is the shape of the form, not the write: the four fields
 * the gear's body needs, the two that must NOT be there, and the gate on the
 * primary action. The provider list is stubbed because the point is the form,
 * and a real `useApiQuery` here would be a request.
 */
const providers = [
  {
    provider: 'github',
    display_name: 'GitHub',
    default_base_url: 'https://api.github.com',
    instance_id: 'i',
    category: 'source_code',
    credential_label: 'Personal access token',
    credential_hint: 'ghp_…',
  },
];

vi.mock('@gears-frontx/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gears-frontx/react')>();
  return {
    ...actual,
    useApiQuery: () => ({
      data: { items: providers },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

async function mount(organization: unknown = { id: 'org-1', name: 'Acme' }) {
  createFrontXApp({});
  const { mfeApp } = await import('../../init');
  const { STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION } = await import(
    '../../shared/hostProperties'
  );
  const { bridge } = createMfeBridgeFixture({
    domainId: 'overlay',
    instanceId: 'inst',
    // See `organization.test.tsx`: the fixture types properties as strings and
    // the shell publishes this one as an object. `null` is a published "there
    // is none", which is not the same as never publishing at all.
    initialProperties: {
      [STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION]: organization as unknown as string,
    },
  });
  i18nRegistry.register(CONNECT_SOURCE_NAMESPACE, 'en' as never, en);

  render(
    <FrontXProvider app={mfeApp}>
      <ConnectSourceDialog bridge={bridge} />
    </FrontXProvider>
  );
}

describe('ConnectSourceDialog', () => {
  it('asks for exactly the four fields the gear needs', async () => {
    await mount();

    expect(screen.getByLabelText(en.field_provider)).toBeTruthy();
    expect(screen.getByLabelText(en.field_label)).toBeTruthy();
    expect(screen.getByLabelText(en.field_base_url)).toBeTruthy();
    // The credential's label comes from the chosen provider once one is picked;
    // before that it is the generic one.
    expect(screen.getByLabelText(en.field_token)).toBeTruthy();
  });

  it('offers no scope, no owner and no test button', async () => {
    await mount();

    expect(screen.queryByText(/scope/i)).toBeNull();
    expect(screen.queryByText(/owner/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /test/i })).toBeNull();
  });

  it('keeps Create inert until the draft can be sent', async () => {
    await mount();

    expect((screen.getByRole('button', { name: en.create }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('refuses and says why when the shell has published no organization', async () => {
    await mount(null);

    expect(screen.getByRole('alert').textContent).toBe(en.error_no_org);
    expect((screen.getByRole('button', { name: en.create }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('portals the provider popover inside this root instead of document.body', async () => {
    // `SelectContent`'s `container` prop is read at render time; without the
    // ref-mirroring fix in `ConnectSourceDialog`, the very first render (the
    // only one guaranteed before an opening) bakes in `container={undefined}`
    // and Base UI falls back to portalling into `document.body` — outside the
    // real shadow root's styles. Regression-tested by reverting the fix
    // locally and confirming this assertion fails: with the old
    // `containerRef.current ?? undefined` read, the popover lands as a
    // sibling of the root at `document.body`, not nested inside it.
    await mount();

    const dialogRoot = document.querySelector('[data-theme]');
    expect(dialogRoot).not.toBeNull();

    fireEvent.click(screen.getByLabelText(en.field_provider));

    const listbox = screen.getByRole('listbox');
    expect(dialogRoot?.contains(listbox)).toBe(true);
  });
});
