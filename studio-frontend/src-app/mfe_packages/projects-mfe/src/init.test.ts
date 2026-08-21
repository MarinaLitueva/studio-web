import { afterEach, describe, expect, it, vi } from 'vitest';

const build = vi.fn();
const use = vi.fn();
const createFrontX = vi.fn(() => ({
  use,
}));
const registerSlice = vi.fn();
const register = vi.fn();
const initialize = vi.fn();
const effects = vi.fn(() => 'effects-plugin');
const queryCacheShared = vi.fn(() => 'query-cache-shared-plugin');
const authShared = vi.fn(() => 'auth-shared-plugin');
const i18n = vi.fn(() => 'i18n-plugin');

vi.mock('@gears-frontx/react', () => ({
  createFrontX,
  registerSlice,
  apiRegistry: {
    register,
    initialize,
  },
  effects,
  i18n,
  queryCacheShared,
  authShared,
}));

vi.mock('./api/AccountsApiService', () => ({
  AccountsApiService: class AccountsApiService {},
}));

vi.mock('./slices/navSlice', () => ({
  navSlice: { name: 'projects/nav' },
}));

vi.mock('./effects/projectsEffects', () => ({
  initProjectsEffects: vi.fn(),
}));

describe('projects-mfe init', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    use.mockImplementation(() => ({ use, build }));
    build.mockReturnValue({ id: 'projects-mfe-app' });
  });

  it('registers the accounts service before build and the nav slice after it', async () => {
    use.mockImplementation(() => ({ use, build }));
    const expectedApp = { id: 'projects-mfe-app' };
    build.mockReturnValue(expectedApp);

    const { initProjectsEffects } = await import('./effects/projectsEffects');
    const module = await import('./init');

    expect(register).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(createFrontX).toHaveBeenCalledTimes(1);
    expect(effects).toHaveBeenCalledTimes(1);
    expect(queryCacheShared).toHaveBeenCalledTimes(1);
    expect(authShared).toHaveBeenCalledTimes(1);
    expect(i18n).toHaveBeenCalledTimes(1);
    expect(use.mock.calls).toEqual(
      expect.arrayContaining([
        ['effects-plugin'],
        ['i18n-plugin'],
        ['query-cache-shared-plugin'],
        ['auth-shared-plugin'],
      ])
    );
    expect(build).toHaveBeenCalledTimes(1);
    expect(registerSlice).toHaveBeenCalledWith({ name: 'projects/nav' }, initProjectsEffects);
    expect(module.mfeApp).toBe(expectedApp);
  });
});
