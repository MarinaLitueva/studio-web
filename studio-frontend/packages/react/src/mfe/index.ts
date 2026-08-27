/**
 * MFE Module - MFE context and hooks for @gears-frontx/react
 *
 * Provides React integration for MFE components.
 */

export { MfeContext, useMfeContext, type MfeContextValue } from './MfeContext';
export { MfeProvider, type MfeProviderProps } from './MfeProvider';
export {
  useMfeBridge,
  useSharedProperty,
  useHostAction,
  useDomainExtensions,
  useMountedExtensions,
  useRegisteredPackages,
} from './hooks';
export {
  ThemeAwareReactLifecycle,
  type ThemeAwareReactLifecycleOptions,
} from './ThemeAwareReactLifecycle';
export { anchorKitThemeOnShadowHost } from './anchorKitThemeOnShadowHost';
export { prewarmShadowStyles } from './shadowStyles';
export { ExtensionDomainSlot, type ExtensionDomainSlotProps } from './components/ExtensionDomainSlot';
