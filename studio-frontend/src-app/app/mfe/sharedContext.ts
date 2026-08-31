/**
 * Everything the shell tells the MFEs about itself, in one place.
 */

import type { FrontXApp } from '@gears-frontx/react';
import {
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  STUDIO_SHARED_PROPERTY_SESSION_PROFILE,
} from '@/app/mfe/contextActions';
import { APP_CONTEXT_SLICE_KEY, type ContextEntity } from '@/app/slices/appContextSlice';
import { APP_SESSION_SLICE_KEY, type SessionProfile } from '@/app/slices/appSessionSlice';

function publish(app: FrontXApp, propertyId: string, value: unknown): void {
  try {
    app.mfeRegistry?.updateSharedProperty(propertyId, value);
  } catch (error) {
    console.warn(
      `Failed to publish ${propertyId} to MFEs:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

interface ContextSliceShape {
  org?: ContextEntity | null;
  workspace?: ContextEntity | null;
  project?: ContextEntity | null;
}

function contextState(app: FrontXApp): ContextSliceShape {
  const state = app.store.getState() as Record<string, unknown>;
  return (state[APP_CONTEXT_SLICE_KEY] as ContextSliceShape | undefined) ?? {};
}

function sessionState(app: FrontXApp): { profile?: SessionProfile | null } {
  const state = app.store.getState() as Record<string, unknown>;
  return (state[APP_SESSION_SLICE_KEY] as { profile?: SessionProfile | null } | undefined) ?? {};
}

/**
 * Which project the session is inside, as a tenant id — `null` at organization
 * scope, which is a published answer and not an absent one.
 */
export function publishSelectedProject(app: FrontXApp): void {
  publish(app, STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT, contextState(app).project?.id ?? null);
}

/**
 * Which organization is in scope — the answer no MFE should be deriving.
 */
export function publishSelectedOrganization(app: FrontXApp): void {
  const org = contextState(app).org ?? null;
  publish(
    app,
    STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
    org ? { id: org.id, name: org.name } : null
  );
}

// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-shell-owns:p1
export function publishSelectedWorkspace(app: FrontXApp): void {
  const workspace = contextState(app).workspace ?? null;
  publish(
    app,
    STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
    workspace ? { id: workspace.id, name: workspace.name } : null
  );
}

/** Who is signed in, for display. See `appSessionSlice` for why it is stored. */
export function publishSessionProfile(app: FrontXApp): void {
  publish(app, STUDIO_SHARED_PROPERTY_SESSION_PROFILE, sessionState(app).profile ?? null);
}

/**
 * All three at once, for `bootstrapMFE` to call as soon as the domains are
 * registered. Anything already resolved lands here; anything not yet resolved
 * lands as `null`, which is the seed every declared property needs.
 */
export function publishStudioContext(app: FrontXApp): void {
  publishSelectedOrganization(app);
  publishSelectedWorkspace(app);
  publishSelectedProject(app);
  publishSessionProfile(app);
}
