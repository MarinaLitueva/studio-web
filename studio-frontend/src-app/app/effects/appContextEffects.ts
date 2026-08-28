/**
 * App Context Effects
 *
 * Fills the top bar's context slot and reacts to selections in it.
 *
 * Organizations are resolved here because account-management is a service the
 * shell already owns. Projects are not resolved here at all — the studio-project
 * gear belongs to projects-mfe, so those events only carry state the MFE has
 * already loaded for its own screen.
 *
 * Selections made IN the slot also have to reach that MFE, and this is where
 * they leave the shell: `publishSelectedProject` mirrors every project
 * transition onto a shared property, the only host -> child channel that
 * survives an MFE's module realm.
 */

import {
  eventBus,
  apiRegistry,
  type FrontXApp,
} from '@gears-frontx/react';
import { AccountsApiService, TENANT_TYPES, type Tenant } from '@/app/api';
import {
  publishSelectedOrganization,
  publishSelectedProject,
  publishSelectedWorkspace,
} from '@/app/mfe/sharedContext';
import {
  setContextLoading,
  setContextOrganizations,
  setContextOrg,
  setContextWorkspaces,
  setContextWorkspace,
  addContextWorkspace,
  setScreenUsesWorkspace,
  setContextProjects,
  openContextProject,
  closeContextProject,
  type ContextEntity,
} from '@/app/slices/appContextSlice';

/** Tenants Studio calls organizations; workspaces are their children. */
function isOrganization(tenant: Tenant): boolean {
  return tenant.tenant_type === TENANT_TYPES.organization;
}

/** Account-management's own listing ceiling, so one page is enough. */
const WORKSPACE_PAGE_LIMIT = 200;

function toEntity(tenant: Tenant): ContextEntity {
  return { id: tenant.id, name: tenant.name };
}

function currentOrgId(app: FrontXApp): string | null {
  const state = app.store.getState() as Record<string, unknown>;
  const context = state['app/context'] as { org?: ContextEntity | null } | undefined;
  return context?.org?.id ?? null;
}

/**
 * Register context effects.
 *
 * Called once during app initialization, alongside the bootstrap effects.
 */
export function registerAppContextEffects(app: FrontXApp): void {
  const dispatch = app.store.dispatch;

  const resolveWorkspaces = async (orgId: string | null): Promise<void> => {
    if (!orgId || !apiRegistry.has(AccountsApiService)) {
      dispatch(setContextWorkspaces([]));
      publishSelectedWorkspace(app);
      return;
    }
    const accounts = apiRegistry.getService(AccountsApiService);
    let items: ContextEntity[] = [];
    try {
      // @cpt-begin:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-1
      const page = await accounts
        .tenantChildrenOfType({
          tenantId: orgId,
          tenantType: TENANT_TYPES.workspace,
          limit: WORKSPACE_PAGE_LIMIT,
        })
        .fetch();
      items = (page?.items ?? []).map(toEntity);
      // @cpt-end:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-1
    } catch (error) {
      // @cpt-begin:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-2
      // @cpt-begin:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-3
      console.warn(
        'Failed to list workspaces:',
        error instanceof Error ? error.message : String(error)
      );
      items = [];
      // @cpt-end:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-2
      // @cpt-end:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-3
    }
    // @cpt-begin:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-5
    dispatch(setContextWorkspaces(items));
    publishSelectedWorkspace(app);
    // @cpt-end:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-5
  };

  eventBus.on('app/context/fetch', async () => {
    if (!apiRegistry.has(AccountsApiService)) return;

    const accounts = apiRegistry.getService(AccountsApiService);
    dispatch(setContextLoading(true));
    try {
      const me = await accounts.me.fetch();
      const homeTenantId = me?.subject_tenant_id;
      if (!homeTenantId) return;

      const home = await accounts.tenant({ tenantId: homeTenantId }).fetch();
      let children: Tenant[] = [];
      try {
        children = (await accounts.tenantChildren({ tenantId: homeTenantId }).fetch())?.items ?? [];
      } catch (error) {
        console.warn(
          'Failed to list child tenants:',
          error instanceof Error ? error.message : String(error)
        );
      }

      const items = [...(isOrganization(home) ? [home] : []), ...children.filter(isOrganization)].map(
        toEntity
      );
      const current = items.find((item) => item.id === home.id) ?? items[0] ?? null;
      dispatch(setContextOrganizations({ current, items }));
      publishSelectedOrganization(app);
      await resolveWorkspaces(current?.id ?? null);
    } catch (error) {
      console.warn(
        'Failed to resolve organizations:',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      dispatch(setContextLoading(false));
    }
  });

  eventBus.on('app/context/org/changed', ({ orgId }) => {
    dispatch(setContextOrg(orgId));
    publishSelectedOrganization(app);
    publishSelectedWorkspace(app);
    publishSelectedProject(app);
    void resolveWorkspaces(currentOrgId(app));
  });

  eventBus.on('app/context/workspace/changed', ({ workspaceId }) => {
    dispatch(setContextWorkspace(workspaceId));
    publishSelectedWorkspace(app);
    publishSelectedProject(app);
  });

  /** Created by an MFE and handed over as an action chain — see contextActions. */
  eventBus.on('app/context/workspace/created', ({ id, name }) => {
    dispatch(addContextWorkspace({ id, name }));
    publishSelectedWorkspace(app);
    publishSelectedProject(app);
  });

  eventBus.on('app/context/workspace/scoped', () => {
    dispatch(setScreenUsesWorkspace(true));
  });

  eventBus.on('app/context/screen/changing', () => {
    dispatch(setScreenUsesWorkspace(false));
  });

  //  Published by whoever owns projects (projects-mfe)

  eventBus.on('app/context/project/opened', ({ id, name }) => {
    dispatch(openContextProject({ id, name }));
    publishSelectedProject(app);
  });

  eventBus.on('app/context/projects', ({ items }) => {
    dispatch(setContextProjects(items));
  });

  eventBus.on('app/context/project/closed', () => {
    dispatch(closeContextProject());
    publishSelectedProject(app);
  });

  eventBus.on('app/context/project/changed', ({ projectId }) => {
    const state = app.store.getState() as Record<string, unknown>;
    const context = state['app/context'] as { projects?: ContextEntity[] } | undefined;
    const picked = context?.projects?.find((project) => project.id === projectId);
    if (!picked) return;
    dispatch(openContextProject(picked));
    publishSelectedProject(app);
  });
}
