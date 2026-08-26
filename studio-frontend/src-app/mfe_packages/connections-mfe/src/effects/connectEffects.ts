/**
 * Creating the connection: the only place in this MFE that writes.
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-create-write:p1
// @cpt-dod:cpt-studiofrontend-dod-connection-create-verify:p1
// @cpt-algo:cpt-studiofrontend-algo-connection-create-write:p2
// @cpt-flow:cpt-studiofrontend-flow-connection-create:p1
import { apiRegistry, eventBus, type AppDispatch } from '@gears-frontx/react';
import { ConnectorsApiService } from '../api/ConnectorsApiService';
import { isDraftUsable, toCreateBody } from '../model/connectionDraft';
import { submitFailed, submitStarted } from '../slices/connectSlice';
import '../events/connectEvents';

function refusalText(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  if (typeof data === 'object' && data !== null) {
    const record = data as { message?: unknown; detail?: unknown };
    const message = record.message ?? record.detail;
    if (typeof message === 'string' && message.trim()) return message;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : null;
}

export function initConnectEffects(dispatch: AppDispatch): void {
  eventBus.on('mfe/connections/create-requested', ({ orgId, draft }) => {
    const connectors = apiRegistry.getService(ConnectorsApiService);

    // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-1
    if (!isDraftUsable(draft) || !orgId) return;
    // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-1

    dispatch(submitStarted());

    void (async () => {
      try {
        // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-4
        const created = await connectors.createConnection.fetch(toCreateBody(draft, orgId));
        // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-4
        // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-7
        eventBus.emit('mfe/connections/created', {
          id: created.connection.id,
          label: created.connection.label,
        });
        // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-7
      } catch (error) {
        // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-5
        // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-6
        dispatch(submitFailed(refusalText(error) ?? 'error_generic'));
        // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-5
        // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-6
      }
    })();
  });
}
