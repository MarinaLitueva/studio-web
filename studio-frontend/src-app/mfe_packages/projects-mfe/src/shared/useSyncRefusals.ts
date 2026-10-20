import { useEffect } from 'react';
import { eventBus, useMfeBridge } from '@gears-frontx/react';
import { notify } from '@constructor-studio/mfe-shared';
import { useSourcesText } from '../i18n';
import type { RepoRefusal } from '../events/artifactEvents';

// @cpt-dod:cpt-studiofrontend-dod-project-sources-menu-refusals:p1
export function useSyncRefusals(projectId: string): void {
  const bridge = useMfeBridge();
  const t = useSourcesText();

  useEffect(() => {
    const show = (refused: RepoRefusal, withoutReason: string, withReason: string) => {
      if (refused.projectId !== projectId) return;
      const { repo: path, refusal } = refused;
      const text =
        refusal.kind === 'provider'
          ? t(withReason, { path, reason: refusal.text })
          : t(withoutReason, { path });
      notify(bridge, { kind: 'error', text }, 'projects');
    };
    const cancel = eventBus.on('mfe/artifacts/cancel-refused', (refused) =>
      show(refused, 'sync_cancel_refused', 'sync_cancel_refused_because')
    );
    const retry = eventBus.on('mfe/artifacts/retry-refused', (refused) =>
      show(refused, 'sync_retry_refused', 'sync_retry_refused_because')
    );
    return () => {
      cancel.unsubscribe();
      retry.unsubscribe();
    };
  }, [bridge, t, projectId]);
}
