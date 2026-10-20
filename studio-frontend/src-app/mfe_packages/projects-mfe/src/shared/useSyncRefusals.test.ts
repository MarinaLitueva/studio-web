import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notify, bridge } = vi.hoisted(() => ({ notify: vi.fn(), bridge: { id: 'bridge' } }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useMfeBridge: () => bridge,
}));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  notify,
}));
vi.mock('../i18n', () => {
  const t = (key: string, params?: Record<string, string>) =>
    params ? `${key} ${JSON.stringify(params)}` : key;
  return { useSourcesText: () => t };
});

import { eventBus } from '@gears-frontx/react';
import type { Refusal } from '@constructor-studio/mfe-shared';
import { useSyncRefusals } from './useSyncRefusals';

const refuse = (
  event: 'mfe/artifacts/cancel-refused' | 'mfe/artifacts/retry-refused',
  projectId: string,
  refusal: Refusal
) => eventBus.emit(event, { projectId, repo: 'acme/api', refusal });

beforeEach(() => notify.mockClear());

describe('a refused cancel or retry', () => {
  it("becomes the shell's error toast, with the gear's reason", () => {
    renderHook(() => useSyncRefusals('p-1'));
    refuse('mfe/artifacts/cancel-refused', 'p-1', { kind: 'provider', text: 'run is gone' });
    expect(notify).toHaveBeenCalledWith(
      bridge,
      {
        kind: 'error',
        text: 'sync_cancel_refused_because {"path":"acme/api","reason":"run is gone"}',
      },
      'projects'
    );
  });

  it('says which it was when the gear gave no reason', () => {
    renderHook(() => useSyncRefusals('p-1'));
    refuse('mfe/artifacts/retry-refused', 'p-1', {
      kind: 'i18n',
      key: 'artifacts_reason_retry_refused',
    });
    expect(notify.mock.calls[0][1]).toEqual({
      kind: 'error',
      text: 'sync_retry_refused {"path":"acme/api"}',
    });
  });

  it("is not shown for another project's sources", () => {
    renderHook(() => useSyncRefusals('p-1'));
    refuse('mfe/artifacts/cancel-refused', 'p-2', { kind: 'provider', text: 'no' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('stops listening when the section goes', () => {
    const { unmount } = renderHook(() => useSyncRefusals('p-1'));
    unmount();
    refuse('mfe/artifacts/cancel-refused', 'p-1', { kind: 'provider', text: 'no' });
    refuse('mfe/artifacts/retry-refused', 'p-1', { kind: 'provider', text: 'no' });
    expect(notify).not.toHaveBeenCalled();
  });
});
