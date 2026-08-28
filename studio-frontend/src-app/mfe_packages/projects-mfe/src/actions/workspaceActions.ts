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

/**
 * The chain, awaited. Rejects when the host refuses it and when there is no
 * bridge to ask — a caller that depends on the host having heard it must be
 * able to tell "delivered" from "never sent".
 */
function send(
  bridge: ChildMfeBridge | null,
  type: string,
  payload: Record<string, unknown>,
  target: string = OVERLAY_DOMAIN
): Promise<void> {
  if (!bridge) return Promise.reject(new Error(`no MFE bridge for ${type}`));
  return bridge.executeActionsChain({ action: { type, target, payload } }).then(() => undefined);
}

/**
 * Lifecycle actions nothing downstream waits on. A missing bridge is ordinary
 * here — `ProjectsRoot` publishes its scope from an effect that runs once
 * before the bridge is handed over — so it is not worth a line in the console.
 */
function sendAndForget(
  bridge: ChildMfeBridge | null,
  type: string,
  payload: Record<string, unknown>,
  target: string = OVERLAY_DOMAIN
): void {
  if (!bridge) return;
  void send(bridge, type, payload, target).catch((error: unknown) => {
    console.error('[projects] workspace action failed', type, error);
  });
}

export function openWorkspaceForm(bridge: ChildMfeBridge | null): void {
  sendAndForget(bridge, MOUNT_EXT, { subject: WORKSPACE_EXTENSION_ID });
}

/**
 * Awaited by the form: it may only close once the shell has the workspace.
 *
 * A refusal is reported and not raised. By the time this runs the shell has
 * been told, and neither call site has anything to offer the member about an
 * overlay that will not unmount.
 */
export function closeWorkspaceForm(bridge: ChildMfeBridge | null): Promise<void> {
  return send(bridge, UNMOUNT_EXT, { subject: WORKSPACE_EXTENSION_ID }).catch(
    (error: unknown) => {
      console.error('[projects] closing the workspace form failed', error);
    }
  );
}

/**
 * The announcement itself. The tenant is already written when this runs, so its
 * failure is the caller's to handle — never fire-and-forget.
 */
export function publishCreatedWorkspace(
  bridge: ChildMfeBridge | null,
  workspace: { id: string; name: string }
): Promise<void> {
  return send(bridge, WORKSPACES_PUBLISH_ACTION, { kind: 'created', workspace });
}

export function publishWorkspaceScope(bridge: ChildMfeBridge | null): void {
  sendAndForget(bridge, WORKSPACES_PUBLISH_ACTION, { kind: 'scoped' }, SCREEN_DOMAIN);
}

export function requestWorkspaceCreate(orgId: string, name: string): void {
  eventBus.emit('mfe/workspaces/create-requested', { orgId, name });
}
