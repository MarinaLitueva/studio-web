import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataGridLoadContext } from '@gears-frontx/ui-kit';
import en from './i18n/en.json';
import projectEn from '../../i18n/en.json';
import { sourceRow } from '../../../../model/sourceRows.fixture';
import { filterSourceRows, type SourceRow } from '../../../../model/sourceRows';
import type { SourcesLoad } from '../../../../shared/useSourcesLoad';

/** The Sources section on the kit's DataGrid (#688). */

const { sources, retry, openSourcesConnect, bridge } = vi.hoisted(() => ({
  sources: { current: { ready: true, failed: false, rows: [] as SourceRow[] } },
  retry: vi.fn(),
  openSourcesConnect: vi.fn(),
  bridge: { id: 'bridge' },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useMfeBridge: () => bridge,
  useFormatters: () => ({ formatRelative: () => 'recently' }),
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('../../../../i18n', async () => {
  const { dictionaryText } = await import('@frontx-test-utils/dictionaryText');
  return {
    useSourcesText: () => dictionaryText(en),
    useProjectText: () => dictionaryText(projectEn),
    useSourcesSectionTranslations: () => ({ isLoaded: true, error: null }),
  };
});

// The rows as the hook builds them, searched and paged as its load does.
vi.mock('../../../../shared/useSourcesLoad', () => ({
  useSourcesLoad: (): SourcesLoad => {
    const { ready, failed, rows } = sources.current;
    return {
      ready,
      failed,
      rows,
      footer: { sources: rows.length, specs: 3, createdInStudio: 1, openPullRequests: 0 },
      windowDays: 7,
      retry,
      load: async (context: DataGridLoadContext) => {
        const shown = filterSourceRows(rows, context.filters?.textSearch?.value ?? '');
        const { page, limit } = context.pagination ?? { page: 1, limit: shown.length };
        return { results: shown.slice((page - 1) * limit, page * limit), total: shown.length };
      },
      rowsBridge: <></>,
    };
  },
}));
vi.mock('../../../../shared/useSourceRowActions', () => ({
  useSourceRowActions: () => ({
    connectionsRead: true,
    providerName: (provider: string) => provider,
    syncNow: vi.fn(),
    cancelSync: vi.fn(),
    openSpecs: vi.fn(),
  }),
}));
vi.mock('../../../../shared/useSyncRefusals', () => ({ useSyncRefusals: () => undefined }));
vi.mock('../../../../actions/sourcesConnectActions', () => ({ openSourcesConnect }));

import { SourcesSection } from './SourcesSection';

const rows = (count: number, name = (index: number) => `acme/repo-${index}`) =>
  Array.from({ length: count }, (_, index) =>
    sourceRow({ id: `c:${name(index)}`, name: name(index).split('/')[1], fullPath: name(index) })
  );

function section(props: { orgId?: string | null; workspaceId?: string | null } = {}) {
  const { orgId = 'org-1', workspaceId = 'ws-1' } = props;
  return render(<SourcesSection projectId="p-1" orgId={orgId} workspaceId={workspaceId} />);
}

const shownRows = () => screen.queryAllByRole('button', { name: /^Actions for / }).length;
const search = () => screen.getByPlaceholderText('Search sources');
const FOOTER = /sources · 3 specs from sources · 1 created in Studio · 0 open pull requests$/;

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  sources.current = { ready: true, failed: false, rows: [] };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SourcesSection', () => {
  it('shows a skeleton until every read has answered', () => {
    sources.current.ready = false;
    const { container } = section();

    expect(container.querySelector('[class*="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(FOOTER)).toBeNull();
  });

  it('shows a skeleton while the organization or the workspace is unknown', () => {
    sources.current.rows = rows(2);
    const { container } = section({ workspaceId: null });

    expect(container.querySelector('[class*="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says the sources could not be read, and Try again reads them again', () => {
    sources.current.failed = true;
    section();

    expect(screen.getByRole('alert').textContent).toBe("The project's sources could not be read.");
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(FOOTER)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('with no sources, offers Connect source, and still counts', async () => {
    section();

    expect(await screen.findByText('No sources connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect source' }));
    expect(openSourcesConnect).toHaveBeenCalledWith(bridge);
    expect(screen.getByText(FOOTER).textContent).toMatch(/^0 sources/);
  });

  it('shows the rows, keeps the ones the search matches, and leaves the footer as it was', async () => {
    sources.current.rows = [...rows(2), ...rows(1, () => 'lab/tool')];
    section();

    await waitFor(() => expect(shownRows()).toBe(3));
    fireEvent.change(search(), { target: { value: 'ACME' } });
    await waitFor(() => expect(shownRows()).toBe(2));
    expect(screen.getByText(FOOTER).textContent).toMatch(/^3 sources/);
  });

  it('says when nothing matches, and Clear search brings the rows back', async () => {
    sources.current.rows = rows(2);
    section();
    await waitFor(() => expect(shownRows()).toBe(2));

    fireEvent.change(search(), { target: { value: 'nothing like it' } });
    expect(await screen.findByText('No sources match this search.')).toBeTruthy();
    expect(screen.queryByText('No sources connected')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(shownRows()).toBe(2));
    expect((search() as HTMLInputElement).value).toBe('');
  });

  it('pages from 13 sources, not before', async () => {
    sources.current.rows = rows(12);
    section();
    await waitFor(() => expect(shownRows()).toBe(12));
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    cleanup();

    sources.current.rows = rows(13);
    section();
    await waitFor(() => expect(shownRows()).toBe(12));
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
  });
});
