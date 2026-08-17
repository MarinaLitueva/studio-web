import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { clearUser } from '@gears-frontx/react';

const SCREEN_DOMAIN = 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1';

const projects = {
  id: 'ext.projects',
  domain: SCREEN_DOMAIN,
  entry: 'entry.projects',
  presentation: { label: 'Projects', icon: 'lucide:folder-kanban', route: '/projects', order: 20 },
};
const search = {
  id: 'ext.search',
  domain: SCREEN_DOMAIN,
  entry: 'entry.search',
  presentation: { label: 'Search', icon: 'lucide:search', route: '/search', order: 10 },
};

interface TestUser {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

const {
  mockAuth,
  mockDispatch,
  mockEventBus,
  mockRegistry,
  menuState,
  bootstrapState,
  registered,
  headerState,
  mounted,
} = vi.hoisted(() => ({
    mockAuth: { logout: vi.fn() },
    mockDispatch: vi.fn(),
    mockEventBus: { emit: vi.fn() },
    mockRegistry: { getExtensionsForDomain: vi.fn(), executeActionsChain: vi.fn() },
    menuState: { collapsed: false, items: [], visible: true },
    bootstrapState: { status: 'ready' as 'pending' | 'ready' | 'failed' },
    registered: { value: [] as unknown[] },
    headerState: {
      user: { displayName: 'Alexander Johanson', email: 'alex@studio' } as TestUser | null,
      loading: false,
    },
    mounted: { value: [] as unknown[] },
  }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useFrontX: () => ({ mfeRegistry: mockRegistry, auth: mockAuth }),
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      'layout/menu': menuState,
      'layout/header': headerState,
      'app/mfe-bootstrap': bootstrapState,
    }),
  useDomainExtensions: () => registered.value,
  useMountedExtensions: () => mounted.value,
  eventBus: mockEventBus,
}));

import { Menu } from './Menu';

describe('Menu', () => {
  beforeEach(() => {
    menuState.collapsed = false;
    headerState.user = { displayName: 'Alexander Johanson', email: 'alex@studio' };
    headerState.loading = false;
    mounted.value = [projects];
    bootstrapState.status = 'ready';
    // Deliberately reverse order: the menu is responsible for sorting by
    // presentation.order, not the registry.
    registered.value = [projects, search];
    mockRegistry.getExtensionsForDomain.mockReturnValue([projects, search]);
    mockAuth.logout.mockResolvedValue({ type: 'none' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('brand', () => {
    it('shows the full product name when expanded', () => {
      render(<Menu />);
      expect(screen.getByText('Constructor Studio')).toBeTruthy();
    });

    it('shows the short mark when collapsed', () => {
      menuState.collapsed = true;
      render(<Menu />);
      expect(screen.getByText('CS')).toBeTruthy();
      expect(screen.queryByText('Constructor Studio')).toBeNull();
    });
  });

  describe('screen items', () => {
    it('renders one item per screen extension, ordered by presentation.order', () => {
      render(<Menu />);
      const labels = screen.getAllByRole('button').map((b) => b.textContent);
      expect(labels).toContain('Search');
      expect(labels.indexOf('Search')).toBeLessThan(labels.indexOf('Projects'));
    });

    it('hides item labels when collapsed', () => {
      menuState.collapsed = true;
      render(<Menu />);
      expect(screen.queryByText('Projects')).toBeNull();
    });

    it('mounts the clicked screen into the screen domain', () => {
      render(<Menu />);
      fireEvent.click(screen.getByText('Projects'));
      expect(mockRegistry.executeActionsChain).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({ payload: { subject: 'ext.projects' } }),
        })
      );
    });
  });

  describe('collapse toggle', () => {
    it('emits the collapsed layout event when expanded', () => {
      render(<Menu />);
      fireEvent.click(screen.getByLabelText('Collapse menu'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('layout/menu/collapsed', { collapsed: true });
    });

    it('emits the expanded layout event when collapsed', () => {
      menuState.collapsed = true;
      render(<Menu />);
      fireEvent.click(screen.getByLabelText('Expand menu'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('layout/menu/collapsed', { collapsed: false });
    });

    it('labels the toggle only when expanded', () => {
      render(<Menu />);
      expect(screen.getByText('Collapse')).toBeTruthy();
    });
  });

  describe('user block', () => {
    it('renders the signed-in identity', () => {
      render(<Menu />);
      expect(screen.getByText('Alexander Johanson')).toBeTruthy();
      expect(screen.getByText('alex@studio')).toBeTruthy();
    });

    it('falls back to the email when no display name is known', () => {
      headerState.user = { email: 'alex@studio' };
      render(<Menu />);
      expect(screen.getByText('alex@studio')).toBeTruthy();
    });

    it('hides the identity text when collapsed', () => {
      menuState.collapsed = true;
      render(<Menu />);
      expect(screen.queryByText('Alexander Johanson')).toBeNull();
    });

    it('sign-out clears the user and logs out via the auth runtime', async () => {
      render(<Menu />);
      fireEvent.click(screen.getByLabelText('Sign out'));

      await waitFor(() => expect(mockAuth.logout).toHaveBeenCalled());
      expect(mockDispatch).toHaveBeenCalledWith(clearUser());
    });

    it('follows the IdP redirect returned by logout', async () => {
      mockAuth.logout.mockResolvedValue({ type: 'redirect', redirectUrl: 'https://idp/logout' });
      const assign = vi.fn();
      vi.spyOn(window, 'location', 'get').mockReturnValue({
        ...window.location,
        set href(value: string) {
          assign(value);
        },
      } as unknown as Location);

      render(<Menu />);
      fireEvent.click(screen.getByLabelText('Sign out'));

      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://idp/logout'));
      vi.restoreAllMocks();
    });

    it('shows no sign-out control while the user is still loading', () => {
      headerState.user = null;
      headerState.loading = true;
      render(<Menu />);
      expect(screen.queryByLabelText('Sign out')).toBeNull();
    });
  });
});
