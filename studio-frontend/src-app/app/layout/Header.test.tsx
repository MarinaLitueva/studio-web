import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const SCREEN_DOMAIN = 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1';

const projects = {
  id: 'ext.projects',
  domain: SCREEN_DOMAIN,
  entry: 'entry.projects',
  presentation: { label: 'Projects', icon: 'lucide:folder-kanban', route: '/projects', order: 20 },
};

const { mounted } = vi.hoisted(() => ({ mounted: { value: [] as unknown[] } }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useMountedExtensions: () => mounted.value,
}));

import { Header } from './Header';

describe('Header', () => {
  beforeEach(() => {
    mounted.value = [projects];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('titles the header with the mounted screen label', () => {
    render(<Header />);
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy();
  });

  it('renders no title while no screen is mounted', () => {
    mounted.value = [];
    render(<Header />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders its children alongside the title', () => {
    render(
      <Header>
        <span>breadcrumb</span>
      </Header>
    );
    expect(screen.getByText('breadcrumb')).toBeTruthy();
  });

  it('no longer owns the sign-out control — the menu does', () => {
    render(<Header />);
    expect(screen.queryByText('Sign out')).toBeNull();
  });
});
