/**
 * Opening and closing the Connect source form.
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-create-overlay:p1
import { eventBus, type ChildMfeBridge } from '@gears-frontx/react';
import { closeOverlay, openOverlay } from '@constructor-studio/mfe-shared';
import type { ConnectionDraft } from '../model/connectionDraft';
import './../events/connectEvents';

/** This MFE's second extension. Must match `mfe.json`. */
export const CONNECT_EXTENSION_ID =
  'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.overlay.v1~constructor_studio.overlays.connect_source.main.v1';

export function openConnectDialog(bridge: ChildMfeBridge | null): void {
  openOverlay(bridge, CONNECT_EXTENSION_ID, 'connections');
}

export function closeConnectDialog(bridge: ChildMfeBridge | null): void {
  void closeOverlay(bridge, CONNECT_EXTENSION_ID, 'connections');
}

export function requestConnectionCreate(orgId: string, draft: ConnectionDraft): void {
  eventBus.emit('mfe/connections/create-requested', { orgId, draft });
}
