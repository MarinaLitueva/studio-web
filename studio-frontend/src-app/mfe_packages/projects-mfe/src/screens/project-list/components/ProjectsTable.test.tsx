import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrontXProvider, createFrontXApp, i18nRegistry } from '@gears-frontx/react';
import {
  createMfeBridgeFixture,
  mfeContextValue,
} from '../../../../../../__test-utils__/createMfeBridgeFixture';
import { OrganizationProvider, STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION } from '@constructor-studio/mfe-shared';
import { PROJECT_LIST_NAMESPACE } from '../../../i18n';
import en from '../i18n/en.json';
import { ProjectsTable } from './ProjectsTable';
import { TENANT_TYPES, type TenantDto } from '../../../api/types';
import type { TreeRow } from '../../../shared/projectTree';
import type { ProjectConfigState } from '../../../shared/useProjectConfig';
import type { UserLookup } from '../../../shared/users';

/**
 * The click path of one row, without any HTTP: the table takes its rows as
 * props. It exists because "the project row does not react" has two very
 * different causes — a wrong `tenant_type` on the wire, or this code — and this
 * test rules out the second one for good.
 */

const CONFIG = { status: 'draft' as const, owner_id: 'user-1' };

/** Reassigned per test: the Status cell reads all four fields differently. */
let configState: ProjectConfigState;

vi.mock('../../../shared/useProjectConfig', () => ({
  useProjectConfig: () => configState,
}));

/** Reassigned per test, like `configState`: the Owner cell reads all three. */
let ownerState: UserLookup = {
  user: { id: 'user-1', username: 'ada', display_name: 'Ada L.' },
  loading: false,
  failed: false,
};

vi.mock('../../../shared/users', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/users')>(
    '../../../shared/users'
  );
  return { ...actual, useUserById: () => ownerState };
});

function tenant(id: string, tenantType: string, childCount = 0): TenantDto {
  return {
    id,
    name: id,
    status: 'active',
    tenant_type: tenantType,
    parent_id: 'ws',
    self_managed: false,
    depth: 3,
    child_count: childCount,
    created_at: '2026-08-20T09:00:00Z',
    updated_at: '2026-08-20T09:00:00Z',
  };
}

const row = (t: TenantDto, over: Partial<TreeRow> = {}): TreeRow => ({
  tenant: t,
  level: 0,
  expandable: t.child_count > 0,
  expanded: false,
  pending: false,
  ...over,
});

const PROJECT = tenant('proj', TENANT_TYPES.project);
const EMPTY_WORKSPACE = tenant('empty-ws', TENANT_TYPES.workspace);
const FULL_WORKSPACE = tenant('full-ws', TENANT_TYPES.workspace, 2);

async function mount(rows: TreeRow[], onToggle: (tenantId: string) => void = () => undefined) {
  createFrontXApp({});
  const { mfeApp } = await import('../../../init');
  const { bridge } = createMfeBridgeFixture({
    domainId: 'screen',
    instanceId: 'inst',
    // The shell publishes an object here, not a string — the fixture's property
    // map is typed for strings only, which is all this cast is about.
    initialProperties: {
      [STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION]: { id: 'org', name: 'Org' } as unknown as string,
    },
  });
  i18nRegistry.register(PROJECT_LIST_NAMESPACE, 'en' as never, en);

  render(
    <FrontXProvider app={mfeApp} mfeBridge={mfeContextValue(bridge)}>
      <OrganizationProvider>
        <ProjectsTable rows={rows} onToggle={onToggle} />
      </OrganizationProvider>
    </FrontXProvider>
  );
  return mfeApp;
}

const beforeEachState = () => {
  configState = { config: CONFIG, loading: false, unset: false, failed: false };
  ownerState = {
    user: { id: 'user-1', username: 'ada', display_name: 'Ada L.' },
    loading: false,
    failed: false,
  };
};

describe('ProjectsTable rows', () => {
  beforeEach(beforeEachState);

  it('opens the project on click — a project row is never disabled', async () => {
    const app = await mount([row(PROJECT)]);
    const button = screen.getByRole('button', { name: /proj/ }) as HTMLButtonElement;

    expect(button.disabled).toBe(false);
    // A leaf claims no expansion state.
    expect(button.getAttribute('aria-expanded')).toBeNull();

    await act(async () => {
      fireEvent.click(button);
    });

    const state = app.store.getState() as Record<string, { projectId: string | null }>;
    expect(state['projects/nav'].projectId).toBe('proj');
  });

  it('draws a project row from its metadata and a container row from the tenant', async () => {
    await mount([row(PROJECT), row(FULL_WORKSPACE)]);

    // The project's own status, not the tenant lifecycle every tenant reports.
    expect(screen.getByText(en.status_draft)).toBeTruthy();
    expect(screen.getByText(en.status_active)).toBeTruthy();
    // The owner id resolved against the organization's users.
    expect(screen.getByText('Ada L.')).toBeTruthy();
  });

  it('keeps the tenant lifecycle ahead of missing metadata', async () => {
    // A project that never reached the wizard 404s on its metadata; suspending
    // it must still read as suspended rather than as "no attributes".
    configState = { config: null, loading: false, unset: true, failed: false };
    const suspended = { ...tenant('susp', TENANT_TYPES.project), status: 'suspended' as const };
    await mount([row(suspended)]);

    expect(screen.getByText(en.status_suspended)).toBeTruthy();
    expect(screen.queryByText(en.status_unset)).toBeNull();
  });

  it('says so when a healthy project carries no attributes yet', async () => {
    configState = { config: null, loading: false, unset: true, failed: false };
    await mount([row(PROJECT)]);

    expect(screen.getByText(en.status_unset)).toBeTruthy();
  });

  it('shows a degraded cell, not a value, when the metadata read fails', async () => {
    // 500/timeout: neither "Unknown" nor "no owner" is true, and both would
    // outlive the failure by a cache window.
    configState = { config: null, loading: false, unset: false, failed: true };
    await mount([row(PROJECT)]);

    expect(screen.getAllByText(en.load_failed)).toHaveLength(2);
    expect(screen.queryByText(en.status_unknown)).toBeNull();
    expect(screen.queryByText(en.no_owner)).toBeNull();
  });

  it('toggles a workspace that has children, and disables one that has none', async () => {
    const toggled: string[] = [];
    await mount([row(FULL_WORKSPACE), row(EMPTY_WORKSPACE)], (id: string) => {
      toggled.push(id);
    });

    const full = screen.getByRole('button', { name: /full-ws/ }) as HTMLButtonElement;
    expect(full.disabled).toBe(false);
    expect(full.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      fireEvent.click(full);
    });
    expect(toggled).toEqual(['full-ws']);

    // Nothing to open and nothing to expand: the row is inert on purpose.
    expect((screen.getByRole('button', { name: /empty-ws/ }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
