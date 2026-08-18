import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const OVERLAY_DOMAIN = 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.overlay.v1';

const { mockRegistry, mounted } = vi.hoisted(() => ({
  mockRegistry: { executeActionsChain: vi.fn() },
  mounted: { value: [] as { id: string }[] },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useFrontX: () => ({ mfeRegistry: mockRegistry }),
  useMountedExtensions: () => mounted.value,
  // Stand-in for the real slot: this suite is about whether the slot is in the
  // tree and when, not about what the mounter does with it.
  ExtensionDomainSlot: () => <div data-testid="overlay-slot" />,
}));

import { SearchDialog } from './SearchDialog';

describe('SearchDialog', () => {
  beforeEach(() => {
    mounted.value = [];
    mockRegistry.executeActionsChain.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /**
   * The regression this suite exists for: the slot used to render only while the
   * dialog was visible, and visibility is derived from something being mounted.
   * The mounter had no element to attach to, so clicking search did nothing at
   * all — no error, no dialog.
   */
  it('keeps the overlay slot in the tree while closed, so the mounter has a container', () => {
    render(<SearchDialog />);
    expect(screen.getByTestId('overlay-slot')).toBeTruthy();
  });

  it('hides the frame while nothing is mounted', () => {
    const { container } = render(<SearchDialog />);
    expect((container.firstChild as HTMLElement).className).toContain('hidden');
    expect((container.firstChild as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the dialog once an extension is mounted in the overlay domain', () => {
    mounted.value = [{ id: 'ext.search' }];
    render(<SearchDialog />);
    expect((screen.getByRole('dialog') as HTMLElement).getAttribute('aria-label')).toBe(
      'Search Constructor Studio'
    );
  });

  describe('dismissal', () => {
    beforeEach(() => {
      mounted.value = [{ id: 'ext.search' }];
    });

    it('unmounts the open extension, naming it as the subject', async () => {
      render(<SearchDialog />);
      fireEvent.click(screen.getByLabelText('Close search'));
      await vi.waitFor(() =>
        expect(mockRegistry.executeActionsChain).toHaveBeenCalledWith(
          expect.objectContaining({
            action: expect.objectContaining({
              target: OVERLAY_DOMAIN,
              payload: { subject: 'ext.search' },
            }),
          })
        )
      );
    });

    it('closes on Escape', async () => {
      render(<SearchDialog />);
      fireEvent.keyDown(document, { key: 'Escape' });
      await vi.waitFor(() => expect(mockRegistry.executeActionsChain).toHaveBeenCalled());
    });

    it('does nothing on Escape while closed', () => {
      mounted.value = [];
      render(<SearchDialog />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(mockRegistry.executeActionsChain).not.toHaveBeenCalled();
    });
  });
});
