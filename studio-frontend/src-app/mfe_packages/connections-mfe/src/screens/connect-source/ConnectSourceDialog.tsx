/**
 * The Connect source form
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-create-overlay:p1
// @cpt-dod:cpt-studiofrontend-dod-connection-create-verify:p1
// @cpt-dod:cpt-studiofrontend-dod-connection-create-announce:p1
import React, { useCallback, useEffect, useState } from 'react';
import {
  apiRegistry,
  eventBus,
  invalidateQueryCacheForApp,
  useApiQuery,
  useAppDispatch,
  useAppSelector,
  useFrontX,
  type ChildMfeBridge,
} from '@gears-frontx/react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gears-frontx/ui-kit';
import { BridgeProvider } from '../../shared/bridge';
import { OrganizationProvider, useOrganization } from '../../shared/organization';
import { useHostChrome } from '../../shared/useHostChrome';
import { useConnectSourceScreenTranslations, useConnectSourceText } from '../../i18n';
import { ConnectorsApiService } from '../../api/ConnectorsApiService';
import { isDraftUsable } from '../../model/connectionDraft';
import { CONNECT_SLICE_KEY, editDraft, resetForm } from '../../slices/connectSlice';
import { closeConnectDialog, requestConnectionCreate } from '../../actions/connectActions';
import '../../events/connectEvents';
import styles from './ConnectSourceDialog.module.css';

const DialogBody: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => {
  const { containerRef, dataTheme } = useHostChrome(bridge);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const attachContainer = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      setContainerEl(node);
    },
    [containerRef]
  );
  const { isLoaded } = useConnectSourceScreenTranslations();
  const t = useConnectSourceText();
  const dispatch = useAppDispatch();
  const app = useFrontX();

  const draft = useAppSelector((state) => state[CONNECT_SLICE_KEY].draft);
  const submitting = useAppSelector((state) => state[CONNECT_SLICE_KEY].submitting);
  const error = useAppSelector((state) => state[CONNECT_SLICE_KEY].error);
  const { org, loading: orgLoading } = useOrganization();
  const orgId = org?.id ?? null;

  const connectors = apiRegistry.getService(ConnectorsApiService);
  const { data: providerData, isError: providersFailed } = useApiQuery(connectors.providers);
  const providers = providerData?.items ?? [];
  const chosen = providers.find((provider) => provider.provider === draft.provider);


  useEffect(() => {
    dispatch(resetForm());
  }, [dispatch]);

  useEffect(() => {
    const subscription = eventBus.on('mfe/connections/created', () => {
      if (orgId) {
        void invalidateQueryCacheForApp(app, connectors.connections({ tenantId: orgId }));
      }
      closeConnectDialog(bridge);
    });
    return () => subscription.unsubscribe();
  }, [app, bridge, connectors, orgId]);

  const blocked = submitting || orgLoading || !orgId || !isDraftUsable(draft);

  const onCreate = (): void => {
    if (!orgId) return;
    requestConnectionCreate(orgId, draft);
  };

  return (
    <div ref={attachContainer} className={styles.dialog} data-theme={dataTheme}>
      <BridgeProvider bridge={bridge}>
        <h2 className={styles.title}>{isLoaded ? t('title') : ''}</h2>

        <div className={styles.body}>
          <div className={styles.field}>
            <Label className={styles.fieldLabel} htmlFor="cs-provider">
              {t('field_provider')}
            </Label>
            <Select
              value={draft.provider}
              onValueChange={(next) => dispatch(editDraft({ provider: next ?? '' }))}
            >
              <SelectTrigger
                id="cs-provider"
                className={styles.providerTrigger}
                aria-label={t('field_provider')}
              >
                <SelectValue placeholder={t('field_provider_placeholder')}>
                  {(selected) =>
                    selected ? (chosen?.display_name ?? String(selected)) : t('field_provider_placeholder')
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent container={containerEl ?? undefined}>
                {providers.map((provider) => (
                  <SelectItem key={provider.provider} value={provider.provider}>
                    {provider.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className={styles.field}>
            <Label className={styles.fieldLabel} htmlFor="cs-label">
              {t('field_label')}
            </Label>
            <Input
              id="cs-label"
              value={draft.label}
              onChange={(event) => dispatch(editDraft({ label: event.target.value }))}
            />
            <span className={styles.fieldHint}>{t('field_label_hint')}</span>
          </div>

          <div className={styles.field}>
            <Label className={styles.fieldLabel} htmlFor="cs-base-url">
              {t('field_base_url')}
            </Label>
            <Input
              id="cs-base-url"
              value={draft.baseUrl}
              placeholder={chosen?.default_base_url ?? ''}
              onChange={(event) => dispatch(editDraft({ baseUrl: event.target.value }))}
            />
          </div>

          <div className={styles.field}>
            <Label className={styles.fieldLabel} htmlFor="cs-token">
              {chosen?.credential_label || t('field_token')}
            </Label>
            <Input
              id="cs-token"
              type="password"
              autoComplete="off"
              value={draft.token}
              placeholder={chosen?.credential_hint ?? ''}
              onChange={(event) => dispatch(editDraft({ token: event.target.value }))}
            />
          </div>
        </div>

        {(error || providersFailed || (!orgId && !orgLoading)) && (
          <p className={styles.error} role="alert">
            {error
              ? error === 'error_generic'
                ? t('error_generic')
                : error
              : providersFailed
                ? t('error_providers')
                : t('error_no_org')}
          </p>
        )}

        <div className={styles.footer}>
          <div className={styles.footerNote} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => closeConnectDialog(bridge)}
            disabled={submitting}
          >
            {t('cancel')}
          </Button>
          <Button size="sm" onClick={onCreate} disabled={blocked}>
            {t('create')}
          </Button>
        </div>
      </BridgeProvider>
    </div>
  );
};

DialogBody.displayName = 'DialogBody';

export const ConnectSourceDialog: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => (
  <OrganizationProvider bridge={bridge}>
    <DialogBody bridge={bridge} />
  </OrganizationProvider>
);

ConnectSourceDialog.displayName = 'ConnectSourceDialog';
