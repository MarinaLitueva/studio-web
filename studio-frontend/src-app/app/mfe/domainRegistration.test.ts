/**
 * Registers the shell's domains on a REAL registry. `bootstrap.test.ts` mocks
 * `registerDomain`, so it cannot see the registry's own checks — the one that
 * refuses a domain declaring an action without a handler once took the whole
 * screen slot down (#319) with every unit test green.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFrontXApp,
  gtsPlugin,
  themeSchema,
  languageSchema,
  extensionScreenSchema,
  type JSONSchema,
} from '@gears-frontx/react';
import extensionOverlaySchemaJson from './schemas/extension_overlay.v1.json';
import extensionScreenLeveledSchemaJson from './schemas/extension_screen_leveled.v1.json';
import actionContextPublishSchemaJson from './schemas/action_context_publish.v1.json';
import actionContextWorkspacesPublishSchemaJson from './schemas/action_context_workspaces_publish.v1.json';
import actionContextArtifactOpenSchemaJson from './schemas/action_context_artifact_open.v1.json';
import sharedPropertyContextArtifactSchemaJson from './schemas/shared_property_context_artifact.v1.json';
import sharedPropertyContextSectionSchemaJson from './schemas/shared_property_context_section.v1.json';
import sharedPropertyContextProjectSchemaJson from './schemas/shared_property_context_project.v1.json';
import sharedPropertyContextOrganizationSchemaJson from './schemas/shared_property_context_organization.v1.json';
import sharedPropertyContextWorkspaceSchemaJson from './schemas/shared_property_context_workspace.v1.json';
import sharedPropertySessionProfileSchemaJson from './schemas/shared_property_session_user_profile.v1.json';
import sharedPropertySpaceFrameUrlSchemaJson from './schemas/shared_property_space_frame_url.v1.json';
import entryIframeSchemaJson from './schemas/entry_iframe.v1.json';
import { bootstrapMFE } from './bootstrap';

// What main.tsx registers before constructing the app — same list as
// overlayContract.test.ts; keep the three in step.
for (const schema of [
  themeSchema,
  languageSchema,
  extensionScreenSchema,
  extensionOverlaySchemaJson,
  extensionScreenLeveledSchemaJson,
  actionContextPublishSchemaJson,
  actionContextWorkspacesPublishSchemaJson,
  actionContextArtifactOpenSchemaJson,
  sharedPropertyContextArtifactSchemaJson,
  sharedPropertyContextProjectSchemaJson,
  sharedPropertyContextOrganizationSchemaJson,
  sharedPropertyContextWorkspaceSchemaJson,
  sharedPropertyContextSectionSchemaJson,
  sharedPropertySessionProfileSchemaJson,
  sharedPropertySpaceFrameUrlSchemaJson,
  entryIframeSchemaJson,
]) {
  gtsPlugin.registerSchema(schema as JSONSchema);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shell domains on a real registry', () => {
  it('register — every declared action has a handler, and every handler a declaration', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const app = createFrontXApp({ microfrontends: { typeSystem: gtsPlugin, mfeHandlers: [] } });

    await expect(bootstrapMFE(app)).resolves.toBeUndefined();
  });
});
