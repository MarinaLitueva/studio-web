/**
 * The shared-property ids the MFEs read from the shell. The shell is the only
 * publisher; nothing here derives an answer of its own.
 */

/** Tenant id of the open project, or `null` at organization scope. */
export const STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.context.project.selected.v1~';

/** `{id, name}` of the organization in scope, or `null` when there is none. */
export const STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.context.organization.selected.v1~';

/** `{id, displayName?, email?}` of the signed-in subject, or `null`. */
export const STUDIO_SHARED_PROPERTY_SESSION_PROFILE =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.session.user.profile.v1~';
