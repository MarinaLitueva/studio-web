/**
 * Opening and closing the Connect source form.
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-create-overlay:p1
import { eventBus, type ChildMfeBridge } from '@gears-frontx/react';
import type { ConnectionDraft } from '../model/connectionDraft';
import './../events/connectEvents';

/** Infrastructure actions of the extension lifecycle; `mount` auto-loads. */
const MOUNT_EXT = 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~';
const UNMOUNT_EXT = 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~';

const OVERLAY_DOMAIN = 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.overlay.v1';

/** This MFE's second extension. Must match `mfe.json`. */
export const CONNECT_EXTENSION_ID =
  'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.overlay.v1~constructor_studio.overlays.connect_source.main.v1';

function send(
  bridge: ChildMfeBridge | null,
  type: string,
  target: string,
  subject: string
): void {
  if (!bridge) return;
  void bridge
    .executeActionsChain({ action: { type, target, payload: { subject } } })
    .catch((error: unknown) => {
      console.error('[connections] extension action failed', type, subject, error);
    });
}

export function openConnectDialog(bridge: ChildMfeBridge | null): void {
  send(bridge, MOUNT_EXT, OVERLAY_DOMAIN, CONNECT_EXTENSION_ID);
}

export function closeConnectDialog(bridge: ChildMfeBridge | null): void {
  send(bridge, UNMOUNT_EXT, OVERLAY_DOMAIN, CONNECT_EXTENSION_ID);
}

export function requestConnectionCreate(orgId: string, draft: ConnectionDraft): void {
  eventBus.emit('mfe/connections/create-requested', { orgId, draft });
}
