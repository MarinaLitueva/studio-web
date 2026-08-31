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
  setContextWorkspacesStatus,
  setContextWorkspace,
  addContextWorkspace,
  setScreenUsesWorkspace,
  setContextProjects,
  openContextProject,
  closeContextProject,
  type ContextEntity,
  type WorkspacesStatus,
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

interface ContextSliceShape {
  org?: ContextEntity | null;
  workspacesStatus?: WorkspacesStatus;
}

function contextSlice(app: FrontXApp): ContextSliceShape {
  const state = app.store.getState() as Record<string, unknown>;
  return (state['app/context'] as ContextSliceShape | undefined) ?? {};
}

function currentOrgId(app: FrontXApp): string | null {
  return contextSlice(app).org?.id ?? null;
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
      dispatch(setContextWorkspacesStatus('ready'));
      publishSelectedWorkspace(app);
      return;
    }
    const accounts = apiRegistry.getService(AccountsApiService);
    dispatch(setContextWorkspacesStatus('pending'));
    try {
      // @cpt-begin:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-1
      const page = await accounts
        .tenantChildrenOfType({
          tenantId: orgId,
          tenantType: TENANT_TYPES.workspace,
          limit: WORKSPACE_PAGE_LIMIT,
        })
        .fetch();
      // @cpt-end:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-1
      // @cpt-begin:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-2
      // @cpt-begin:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-3
      if (currentOrgId(app) !== orgId) return;
      // @cpt-end:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-2
      // @cpt-end:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-3
      // @cpt-begin:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-7
      dispatch(setContextWorkspaces((page?.items ?? []).map(toEntity)));
      dispatch(setContextWorkspacesStatus('ready'));
      publishSelectedWorkspace(app);
      // @cpt-end:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-7
    } catch (error) {
      if (currentOrgId(app) !== orgId) return;
      // @cpt-begin:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-4
      console.warn(
        'Failed to list workspaces:',
        error instanceof Error ? error.message : String(error)
      );
      dispatch(setContextWorkspacesStatus('failed'));
      // @cpt-end:cpt-studiofrontend-algo-workspace-scope-resolve:p1:inst-4
    }
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
    if (currentOrgId(app) === orgId) {
      // Not a change: reselecting must not clear the workspaces and the open
      // project, nor re-read a list that has not moved. It is still the
      // member's way of asking again after a failed read, so that case alone
      // resolves.
      if (contextSlice(app).workspacesStatus === 'failed') void resolveWorkspaces(orgId);
      return;
    }
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
    if (contextSlice(app).workspacesStatus === 'failed') {
      void resolveWorkspaces(currentOrgId(app));
    }
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
