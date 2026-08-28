/**
 * The New project wizard — this MFE's second mounted root, drawn inside the
 * shell's overlay frame.
 */

// @cpt-dod:cpt-studiofrontend-dod-project-create-steps:p1
import React, { useEffect, useRef } from 'react';
import {
  apiRegistry,
  eventBus,
  invalidateQueryCacheForApp,
  useFrontX,
  useMfeBridge,
} from '@gears-frontx/react';
import { useAppDispatch, useAppSelector } from '@gears-frontx/react';
import { Button, Skeleton } from '@gears-frontx/ui-kit';
import {
  OrganizationProvider,
  WorkspaceProvider,
  useHostChrome,
  useOrganization,
  useWorkspace,
} from '@constructor-studio/mfe-shared';
import { useProjectCreateScreenTranslations, useProjectCreateText } from '../../i18n';
import { closeProjectWizard, requestProjectCreate } from '../../actions/wizardActions';
import '../../events/wizardEvents';
import { CREATE_SLICE_KEY, editDraft, goToStep, resetWizard } from '../../slices/createSlice';
import { useCurrentUser } from '../../shared/useCurrentUser';
import { AccountsApiService, childrenPageParams } from '../../api/AccountsApiService';
import { isFinalStep, nextStep, prevStep, stepFor, type WizardStepKey } from '../../model/wizardSteps';
import { DetailsStep } from './steps/DetailsStep';
import { RepositoriesStep } from './steps/RepositoriesStep';
import { RepositoriesFooterNote } from './steps/RepositoriesFooterNote';
import styles from './NewProjectWizard.module.css';

/** One entry per step key. Adding a step touches this map and `WIZARD_STEPS`. */
const STEP_BODIES: Record<WizardStepKey, React.FC> = {
  details: DetailsStep,
  repositories: RepositoriesStep,
};

const STEP_FOOTER_NOTES: Partial<Record<WizardStepKey, React.FC>> = {
  repositories: RepositoriesFooterNote,
};

const WizardBody: React.FC = () => {
  const bridge = useMfeBridge();
  const { containerRef, dataTheme } = useHostChrome();
  const { isLoaded, error: translationsFailed } = useProjectCreateScreenTranslations();
  const t = useProjectCreateText();
  const dispatch = useAppDispatch();

  const stepKey = useAppSelector((state) => state[CREATE_SLICE_KEY].stepKey);
  const draft = useAppSelector((state) => state[CREATE_SLICE_KEY].draft);
  const submitting = useAppSelector((state) => state[CREATE_SLICE_KEY].submitting);
  const error = useAppSelector((state) => state[CREATE_SLICE_KEY].error);
  const { loading: orgLoading } = useOrganization();
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = workspace?.id ?? null;

  // Every opening starts clean. The store outlives this root (it belongs to the
  // MFE app, which `init.ts` builds once for any entry), so without this a
  // half-filled draft would reappear with no affordance explaining why.
  useEffect(() => {
    dispatch(resetWizard());
  }, [dispatch]);

  const { id: currentUserId } = useCurrentUser();
  useEffect(() => {
    if (currentUserId && !draft.ownerId) dispatch(editDraft({ ownerId: currentUserId }));
  }, [currentUserId, draft.ownerId, dispatch]);


  /**
   * The skeleton is for the first load and nothing else.
   */
  const everLoaded = useRef(false);
  everLoaded.current ||= isLoaded;
  const showSkeleton = !everLoaded.current && !translationsFailed;

  const step = stepFor(draft, stepKey);
  const back = prevStep(draft, step.key);
  const final = isFinalStep(draft, step.key);
  const Body = STEP_BODIES[step.key];
  const FooterNote = STEP_FOOTER_NOTES[step.key];

  const app = useFrontX();

  useEffect(() => {
    const subscription = eventBus.on('mfe/projects/created', () => {
      if (workspaceId) {
        // The workspace's own page is the one that gained a row — it is the
        // list's root now, so nothing above it changed.
        const accounts = apiRegistry.getService(AccountsApiService);
        void invalidateQueryCacheForApp(app, accounts.children(childrenPageParams(workspaceId)));
      }
      closeProjectWizard(bridge);
    });
    return () => subscription.unsubscribe();
  }, [app, bridge, workspaceId]);

  const onPrimary = (): void => {
    if (final) {
      if (!workspaceId) return;
      requestProjectCreate(workspaceId, draft);
      return;
    }
    const next = nextStep(draft, step.key);
    if (next) dispatch(goToStep(next.key));
  };

  const onSecondary = (): void => {
    if (back) dispatch(goToStep(back.key));
    else closeProjectWizard(bridge);
  };

  return (
    <div ref={containerRef} className={styles.wizard} data-theme={dataTheme}>
      {showSkeleton ? (
        <Skeleton className={styles.titleSkeleton} />
      ) : (
        <h2 className={styles.title}>{t(step.titleKey)}</h2>
      )}

      <div className={styles.body}>
        {showSkeleton ? <Skeleton className={styles.bodySkeleton} /> : <Body />}
      </div>

      {(translationsFailed || error || (final && !workspaceId && !workspaceLoading)) && (
        <p className={styles.error} role="alert">
          {translationsFailed
            ? 'Could not load this screen.'
            : error
              ? error.kind === 'i18n'
                ? t(error.key)
                : error.text
              : t('error_no_workspace')}
        </p>
      )}

      <div className={styles.footer}>
        {/* Left slot is the step's to fill — the pick counter on repositories. */}
        <div className={styles.footerNote}>{FooterNote ? <FooterNote /> : null}</div>
        <Button variant="ghost" size="sm" onClick={onSecondary} disabled={submitting}>
          {back ? t('back') : t('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={onPrimary}
          disabled={
            submitting ||
            orgLoading ||
            workspaceLoading ||
            !step.isComplete(draft) ||
            (final && !workspaceId)
          }
        >
          {final ? t('create') : t('continue')}
        </Button>
      </div>
    </div>
  );
};

WizardBody.displayName = 'WizardBody';

export const NewProjectWizard: React.FC = () => (
  <OrganizationProvider>
    <WorkspaceProvider>
      <WizardBody />
    </WorkspaceProvider>
  </OrganizationProvider>
);

NewProjectWizard.displayName = 'NewProjectWizard';
