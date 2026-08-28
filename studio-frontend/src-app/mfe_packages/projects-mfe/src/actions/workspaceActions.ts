/**
 * Opening and closing the New workspace form, handing the created workspace to
 * the shell, and telling it that this MFE works in a workspace at all.
 */

// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-overlay:p1
// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-announce:p1
// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-slot:p1
import { eventBus, type ChildMfeBridge } from '@gears-frontx/react';
import './../events/workspaceEvents';

/** Infrastructure actions of the extension lifecycle; `mount` auto-loads. */
const MOUNT_EXT = 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~';
const UNMOUNT_EXT = 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~';

const OVERLAY_DOMAIN = 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.overlay.v1';
const SCREEN_DOMAIN = 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1';

/** Host-owned. Declared in this MFE's `mfe.json` -> `domainActions`. */
const WORKSPACES_PUBLISH_ACTION =
  'gts.frontx.mfes.comm.action.v1~constructor_studio.context.workspaces.publish.v1~';

/** This MFE's third extension. Must match `mfe.json`. */
export const WORKSPACE_EXTENSION_ID =
  'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.overlay.v1~constructor_studio.overlays.workspace_create.main.v1';

function send(
  bridge: ChildMfeBridge | null,
  type: string,
  payload: Record<string, unknown>,
  target: string = OVERLAY_DOMAIN
): void {
  if (!bridge) return;
  void bridge
    .executeActionsChain({ action: { type, target, payload } })
    .catch((error: unknown) => {
      console.error('[projects] workspace action failed', type, error);
    });
}

export function openWorkspaceForm(bridge: ChildMfeBridge | null): void {
  send(bridge, MOUNT_EXT, { subject: WORKSPACE_EXTENSION_ID });
}

export function closeWorkspaceForm(bridge: ChildMfeBridge | null): void {
  send(bridge, UNMOUNT_EXT, { subject: WORKSPACE_EXTENSION_ID });
}

export function publishCreatedWorkspace(
  bridge: ChildMfeBridge | null,
  workspace: { id: string; name: string }
): void {
  send(bridge, WORKSPACES_PUBLISH_ACTION, { kind: 'created', workspace });
}

export function publishWorkspaceScope(bridge: ChildMfeBridge | null): void {
  send(bridge, WORKSPACES_PUBLISH_ACTION, { kind: 'scoped' }, SCREEN_DOMAIN);
}

export function requestWorkspaceCreate(orgId: string, name: string): void {
  eventBus.emit('mfe/workspaces/create-requested', { orgId, name });
}
