/**
 * The New project wizard's own events.
 */

import '@gears-frontx/react';
import type { ProjectDraft } from '../model/projectDraft';

declare module '@gears-frontx/react' {
  interface EventPayloadMap {
    'mfe/projects/create-requested': { workspaceId: string; draft: ProjectDraft };
    'mfe/projects/created': { id: string; name: string };
  }
}
