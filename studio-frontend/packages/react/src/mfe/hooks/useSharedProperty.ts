/**
 * useSharedProperty Hook - Shared property subscription
 *
 * Subscribes to shared property updates from the host.
 *
 * React Layer: L3
 */
// @cpt-flow:cpt-frontx-flow-react-bindings-use-shared-property:p1
// @cpt-algo:cpt-frontx-algo-react-bindings-mfe-context-guard:p1
// @cpt-dod:cpt-frontx-dod-react-bindings-mfe-hooks:p1

import { useSyncExternalStore, useCallback } from 'react';
import { useMfeContext } from '../MfeContext';

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for subscribing to a shared property.
 *
 * Subscribes to property updates from the host and returns the current value.
 * Must be used within a MfeProvider (i.e., inside an MFE component).
 *
 * Returns `undefined` while the host has published nothing under this id, and
 * `null` when it published `null` — the two are distinct answers ("not said yet"
 * versus "said there is none") and callers branch on them.
 *
 * @param propertyTypeId - Type ID of the shared property to subscribe to
 * @returns Current property value
 *
 * @example
 * ```tsx
 * function MyMfeComponent() {
 *   const userData = useSharedProperty('gts.frontx.mfes.comm.shared_property.v1~myapp.user_data.v1');
 *
 *   return <div>User: {userData?.name}</div>;
 * }
 * ```
 */
// @cpt-begin:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-call-shared-property
// @cpt-begin:cpt-frontx-dod-react-bindings-mfe-hooks:p1:inst-call-shared-property
export function useSharedProperty<T = unknown>(
  propertyTypeId: string
): T | null | undefined {
  // @cpt-begin:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-read-bridge
  // @cpt-begin:cpt-frontx-algo-react-bindings-mfe-context-guard:p1:inst-throw-no-mfe-context
  // Enforce MfeProvider context requirement
  const { bridge } = useMfeContext(); // Throws if not in MfeProvider
  // @cpt-end:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-read-bridge
  // @cpt-end:cpt-frontx-algo-react-bindings-mfe-context-guard:p1:inst-throw-no-mfe-context

  // @cpt-begin:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-subscribe-property
  // @cpt-begin:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-rerender-on-property-change
  // Subscribe to property updates via bridge
  const subscribe = useCallback((callback: () => void) => {
    return bridge.subscribeToProperty(propertyTypeId, () => {
      // When property changes, trigger React re-render
      callback();
    });
  }, [bridge, propertyTypeId]);
  // @cpt-end:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-subscribe-property
  // @cpt-end:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-rerender-on-property-change

  // @cpt-begin:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-return-property-value
  const getSnapshot = useCallback(() => {
    const property = bridge.getProperty(propertyTypeId);
    // Type narrowing: caller specifies expected type T (standard React hook pattern)
    // Similar to useState<T>, useContext<T> - type safety is caller's responsibility
    // `property.value` may itself be null; only an absent property reads undefined.
    return property ? (property.value as T | null) : undefined;
  }, [bridge, propertyTypeId]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return value;
  // @cpt-end:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-return-property-value
}
// @cpt-end:cpt-frontx-flow-react-bindings-use-shared-property:p1:inst-call-shared-property
// @cpt-end:cpt-frontx-dod-react-bindings-mfe-hooks:p1:inst-call-shared-property
