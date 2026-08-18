/**
 * SearchDialog Component
 *
 * The frame the global search opens in: a scrim over everything and a centred
 * card holding the overlay domain's slot. The shell owns the frame, the keyboard
 * affordances and the dismissal; the content is whichever MFE mounted into the
 * overlay domain — search today, potentially the inbox next.
 *
 * Why the shell owns only the frame: search results span projects, artifacts,
 * findings and people, which is search-mfe's territory. Duplicating that list
 * here would mean two implementations of one product surface.
 *
 * The slot is ALWAYS in the tree, and only the frame around it is hidden. The
 * mounter attaches the extension's root to the slot's element, so a slot that
 * renders only once something is mounted has nothing to attach to at mount time
 * — the click would appear to do nothing. This is the same reason
 * MfeScreenContainer keeps the screen slot permanently mounted.
 */

import React, { useCallback, useEffect } from 'react';
import {
  useFrontX,
  useMountedExtensions,
  ExtensionDomainSlot,
  overlayDomain,
  FRONTX_ACTION_UNMOUNT_EXT,
} from '@gears-frontx/react';

export const SearchDialog: React.FC = () => {
  const app = useFrontX();
  // Visibility is derived, not stored: the dialog is open exactly while
  // something is mounted in the overlay domain. Deliberately NOT the
  // `layout/overlay` slice — the generic `Overlay` component already renders a
  // blurred full-screen veil off that same flag, so sharing it would stack two
  // overlays on one state.
  const mounted = useMountedExtensions(overlayDomain.id);
  const openExtensionId = mounted[0]?.id;
  const visible = Boolean(openExtensionId);

  const close = useCallback(async () => {
    if (!openExtensionId) return;
    // Unmounting is the whole dismissal: an overlay MFE left mounted keeps its
    // subscriptions and its shadow root alive, and the dialog's visibility is
    // derived from that mount.
    await app.mfeRegistry?.executeActionsChain({
      action: {
        type: FRONTX_ACTION_UNMOUNT_EXT,
        target: overlayDomain.id,
        payload: { subject: openExtensionId },
      },
    });
  }, [app.mfeRegistry, openExtensionId]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, close]);

  return (
    <div
      // `hidden` rather than unmounted — see the note on the slot above.
      className={visible ? 'fixed inset-0 z-modal flex items-start justify-center' : 'hidden'}
      aria-hidden={!visible}
    >
      <button
        type="button"
        aria-label="Close search"
        onClick={() => void close()}
        className="absolute inset-0 cursor-default bg-[rgb(15_18_24_/_0.48)]"
      />
      {/* 640×520 at 112px from the top, per the mockup; capped so a short
          viewport scrolls the card's own content instead of the page. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search Constructor Studio"
        className="relative mt-28 flex h-[520px] max-h-[calc(100vh-8rem)] w-[640px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      >
        {app.mfeRegistry && (
          <ExtensionDomainSlot
            registry={app.mfeRegistry}
            domainId={overlayDomain.id}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
};

SearchDialog.displayName = 'SearchDialog';
