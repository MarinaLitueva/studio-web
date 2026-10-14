import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** Only source-code drivers reach the picker (algo `...-project-create-repos`, `inst-1`). */

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: {
    getService: () => ({ providers: 'providers', connections: () => 'connections' }),
  },
  useApiQuery: (read: string) => ({
    data:
      read === 'providers'
        ? {
            items: [
              { provider: 'github', display_name: 'GitHub', category: 'source_code' },
              { provider: 'openai', display_name: 'OpenAI', category: 'model' },
            ],
          }
        : {
            items: [
              { id: 'c-github', provider: 'github', label: 'acme' },
              { id: 'c-openai', provider: 'openai', label: 'llm' },
            ],
          },
    isLoading: false,
    isError: false,
  }),
}));

import { useSourceConnections } from './useConnections';

describe('the source connections', () => {
  it('leave out a provider that is not a source-code driver, and its connections', () => {
    const { result } = renderHook(() => useSourceConnections('org-1'));

    expect(result.current.providers.map((entry) => entry.provider)).toEqual(['github']);
    expect(result.current.connections.map((entry) => entry.id)).toEqual(['c-github']);
  });
});
