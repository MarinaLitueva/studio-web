import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct, LazyServiceIdentifier } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/lib/browser/widgets/widget';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { resolveRemoteCheckoutRelativePath } from '../common/git-remote-reference';
import type {
    ConfirmWorkspaceSyncRequest,
    ReadWorkspaceRawTomlResponse,
    RemoveWorkspaceSourceRequest,
    WorkspaceConfigConflict,
    WorkspaceConfigMutationResponse,
    WorkspaceConfiguredSource,
    WorkspaceDiagnostic,
    WorkspaceJobActivity,
    WorkspaceObservedSourceState,
    WorkspaceRepositorySuggestion,
    WorkspaceScanCandidate,
    WorkspaceSnapshot,
    WorkspaceSourceRenameImpactPreview,
    WorkspaceSourceSyncPreview,
    WorkspaceSyncTrustPreview,
    WorkspaceSyncResponse
} from '../common/workspace-protocol';
import { WorkspaceSourcesFrontendController } from './workspace-sources-controller';
import {
    ConfirmDialog,
    createSourceDraft,
    RawTomlEditorDialog,
    RenameImpactDialog,
    SourceEditorDialog,
    SyncConfirmationDialog,
    validateSourceDraft,
    type WorkspaceSourceDraft,
    type WorkspaceSourceValidationErrors
} from './workspace-sources-dialogs';

interface SourceRowModel {
    readonly source: WorkspaceConfiguredSource;
    readonly observed?: WorkspaceObservedSourceState;
}

type SourcePanelState =
    | 'missing-config'
    | 'empty-config'
    | 'invalid-config'
    | 'legacy'
    | 'migration'
    | 'canonical-shadow'
    | 'canonical-active';

interface SourceDialogState {
    readonly mode: 'add' | 'edit';
    readonly originalSourceId?: string;
    readonly draft: WorkspaceSourceDraft;
    readonly validation: WorkspaceSourceValidationErrors;
    readonly busy: boolean;
    readonly backendError?: string;
    readonly diagnostics?: readonly WorkspaceDiagnostic[];
    readonly saveAndSync: boolean;
}

interface RawTomlDialogState {
    readonly loading: boolean;
    readonly busy: boolean;
    readonly revision: string;
    readonly draft: string;
    readonly backendError?: string;
    readonly diagnostics?: readonly WorkspaceDiagnostic[];
    readonly conflict?: WorkspaceConfigConflict;
}

interface SyncDialogState {
    readonly title: string;
    readonly request: ConfirmWorkspaceSyncRequest;
    readonly preview?: WorkspaceSyncTrustPreview;
    readonly sourcePreviews: readonly WorkspaceSourceSyncPreview[];
    readonly reasons: readonly string[];
    readonly forceSourceIds: readonly string[];
    readonly busy: boolean;
    readonly backendError?: string;
}

interface RenameConfirmationState {
    readonly impacts: readonly WorkspaceSourceRenameImpactPreview[];
    readonly message: string;
    readonly busy: boolean;
    readonly confirm: (impactIds: readonly string[]) => Promise<void>;
    readonly cancel: () => void;
}

interface SaveEditedSourceResult {
    readonly mutation?: WorkspaceConfigMutationResponse;
    readonly sync?: WorkspaceSyncResponse;
}

interface SaveEditedSourceCallbacks {
    readonly onRenameConfirmed: (result: SaveEditedSourceResult | undefined) => void;
}

@injectable()
export class WorkspaceSourcesWidget extends ReactWidget {
    static readonly ID = 'studio:workspace-sources';
    static readonly LABEL = 'Workspace Sources';

    @inject(new LazyServiceIdentifier(() => WorkspaceSourcesFrontendController))
    protected readonly controller: WorkspaceSourcesFrontendController;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @postConstruct()
    protected init(): void {
        this.id = WorkspaceSourcesWidget.ID;
        this.title.label = WorkspaceSourcesWidget.LABEL;
        this.title.caption = WorkspaceSourcesWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-repo';
        this.node.tabIndex = 0;
        this.toDispose.push(this.controller.onDidChange(() => this.update()));
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected render(): React.ReactNode {
        return <WorkspaceSourcesView controller={this.controller} openerService={this.openerService} />;
    }
}

function WorkspaceSourcesView(props: {
    controller: WorkspaceSourcesFrontendController;
    openerService: OpenerService;
}): React.ReactElement {
    const snapshot = props.controller.getSnapshot();
    const diagnostics = snapshot?.diagnostics ?? [];
    const panelState = getPanelState(snapshot, diagnostics);
    const activity = props.controller.getActivity();
    const sources = getSourceRows(snapshot);
    const suggestions = snapshot?.suggestions ?? [];
    const scanCandidates = snapshot?.latestScan?.candidates ?? [];
    const configErrors = diagnostics.filter(diagnostic => diagnostic.severity === 'error' && diagnostic.scope === 'config');
    const [sourceDialog, setSourceDialog] = React.useState<SourceDialogState | undefined>(undefined);
    const [removeSourceId, setRemoveSourceId] = React.useState<string | undefined>(undefined);
    const [rawDialog, setRawDialog] = React.useState<RawTomlDialogState | undefined>(undefined);
    const [syncDialog, setSyncDialog] = React.useState<SyncDialogState | undefined>(undefined);
    const [renameDialog, setRenameDialog] = React.useState<RenameConfirmationState | undefined>(undefined);

    const openSourceDialog = React.useCallback((mode: 'add' | 'edit', source?: WorkspaceConfiguredSource, suggestion?: WorkspaceRepositorySuggestion | WorkspaceScanCandidate) => {
        const scanCandidate = isScanCandidate(suggestion) ? suggestion : undefined;
        const repositorySuggestion = isRepositorySuggestion(suggestion) ? suggestion : undefined;
        const remoteUrl = source?.remoteUrl ?? scanCandidate?.remoteUrl ?? '';
        const ref = source?.ref ?? scanCandidate?.ref ?? '';
        setSourceDialog({
            mode,
            originalSourceId: source?.sourceId,
            draft: createSourceDraft({
                sourceId: source?.sourceId ?? repositorySuggestion?.sourceId ?? '',
                label: source?.label ?? suggestion?.label ?? '',
                kind: remoteUrl ? 'remote' : 'local',
                localPath: source?.localPath ?? suggestion?.localPath ?? '',
                remoteUrl,
                ref
            }),
            validation: {},
            busy: false,
            saveAndSync: false
        });
    }, []);

    const selectedRemoveSource = sources.find(candidate => candidate.source.sourceId === removeSourceId)?.source;

    const submitSourceDialog = React.useCallback(async (saveAndSync: boolean) => {
        if (!snapshot || !sourceDialog) {
            return;
        }
        const validation = validateSourceDraft(sourceDialog.draft);
        if (Object.keys(validation).length > 0) {
            setSourceDialog({
                ...sourceDialog,
                validation
            });
            return;
        }

        setSourceDialog({
            ...sourceDialog,
            busy: true,
            backendError: undefined,
            diagnostics: [],
            saveAndSync
        });

        const syncSourceId = sourceDialog.draft.sourceId.trim();
        const source = toConfiguredSource(sourceDialog.draft);
        try {
            const addResponse = sourceDialog.mode === 'add'
                ? await props.controller.addWorkspaceSource({
                    workspaceId: snapshot.identity.workspaceId,
                    configPath: snapshot.identity.configPath,
                    expectedRevision: snapshot.config.revision,
                    source,
                    ...(saveAndSync ? { sync: { sourceIds: [syncSourceId], trustConfirmed: false } } : {})
                })
                : undefined;
            const editResult = sourceDialog.mode === 'edit'
                ? await saveEditedSource(
                    props.controller,
                    snapshot,
                    sourceDialog,
                    source,
                    saveAndSync,
                    setRenameDialog,
                    {
                        onRenameConfirmed: result => {
                            const mutation = result?.mutation;
                            if (mutation?.conflict) {
                                return;
                            }
                            setSourceDialog(undefined);
                            const syncResponse = result?.sync ?? mutation?.sync;
                            if (syncResponse) {
                                const nextDialog = maybeCreateSyncDialog(`Confirm Sync for ${syncSourceId}`, syncResponse);
                                if (nextDialog) {
                                    setSyncDialog(nextDialog);
                                }
                            }
                        }
                    }
                )
                : undefined;
            const response = sourceDialog.mode === 'add' ? addResponse : editResult?.mutation;
            if (!response) {
                if (sourceDialog.mode === 'edit' && editResult?.sync) {
                    setSourceDialog(undefined);
                    const nextDialog = maybeCreateSyncDialog(`Confirm Sync for ${syncSourceId}`, editResult.sync);
                    if (nextDialog) {
                        setSyncDialog(nextDialog);
                    }
                    return;
                }
                setSourceDialog(undefined);
                return;
            }
            if (response.conflict) {
                const conflict = response.conflict;
                setSourceDialog(current => current && ({
                    ...current,
                    busy: false,
                    backendError: conflict.message,
                    diagnostics: conflict.diagnostics,
                    validation
                }));
                return;
            }
            setSourceDialog(undefined);
            if (response.sync) {
                const nextDialog = maybeCreateSyncDialog('Confirm Workspace Sync', response.sync);
                if (nextDialog) {
                    setSyncDialog(nextDialog);
                }
            }
        } catch (error) {
            setSourceDialog(current => current && ({
                ...current,
                busy: false,
                backendError: toErrorMessage(error)
            }));
        }
    }, [props.controller, renameDialog, snapshot, sourceDialog]);

    const openRawTomlDialog = React.useCallback(async () => {
        if (!snapshot) {
            return;
        }
        setRawDialog({
            loading: true,
            busy: false,
            revision: snapshot.config.revision,
            draft: '',
            diagnostics: []
        });
        try {
            const response = await props.controller.readWorkspaceRawToml({
                workspaceId: snapshot.identity.workspaceId,
                configPath: snapshot.identity.configPath
            });
            setRawDialog(fromRawTomlResponse(response));
        } catch (error) {
            setRawDialog({
                loading: false,
                busy: false,
                revision: snapshot.config.revision,
                draft: '',
                backendError: toErrorMessage(error),
                diagnostics: []
            });
        }
    }, [props.controller, snapshot]);

    const saveRawToml = React.useCallback(async (saveAndSync: boolean, retryWithLatestRevision = false) => {
        if (!snapshot || !rawDialog) {
            return;
        }
        const expectedRevision = retryWithLatestRevision
            ? rawDialog.conflict?.currentRevision ?? snapshot.config.revision
            : rawDialog.revision;
        setRawDialog({
            ...rawDialog,
            busy: true,
            backendError: undefined
        });
        try {
            const response = await props.controller.saveWorkspaceRawToml({
                workspaceId: snapshot.identity.workspaceId,
                configPath: snapshot.identity.configPath,
                expectedRevision,
                rawToml: rawDialog.draft,
                ...(saveAndSync ? { sync: { trustConfirmed: false } } : {})
            });
            if (!response) {
                setRawDialog(undefined);
                return;
            }
            if (response.conflict) {
                const conflict = response.conflict;
                setRawDialog(current => current && ({
                    ...current,
                    busy: false,
                    revision: conflict.currentRevision ?? current.revision,
                    backendError: conflict.message,
                    diagnostics: conflict.diagnostics,
                    conflict
                }));
                return;
            }
            setRawDialog(undefined);
            if (response.sync) {
                const nextDialog = maybeCreateSyncDialog('Confirm Workspace Sync', response.sync);
                if (nextDialog) {
                    setSyncDialog(nextDialog);
                }
            }
        } catch (error) {
            setRawDialog(current => current && ({
                ...current,
                busy: false,
                backendError: toErrorMessage(error)
            }));
        }
    }, [props.controller, rawDialog, snapshot]);

    const reloadRawToml = React.useCallback(async () => {
        if (!snapshot) {
            return;
        }
        const response = await props.controller.readWorkspaceRawToml({
            workspaceId: snapshot.identity.workspaceId,
            configPath: snapshot.identity.configPath
        });
        setRawDialog(fromRawTomlResponse(response));
    }, [props.controller, snapshot]);

    const startSync = React.useCallback(async (sourceIds?: readonly string[]) => {
        if (!snapshot) {
            return;
        }
        const response = await props.controller.startWorkspaceSync({
            workspaceId: snapshot.identity.workspaceId,
            configPath: snapshot.identity.configPath,
            expectedRevision: snapshot.config.revision,
            ...(sourceIds ? { sourceIds } : {}),
            trustConfirmed: false
        });
        if (response) {
            const nextDialog = maybeCreateSyncDialog(sourceIds?.length === 1 ? `Confirm Sync for ${sourceIds[0]}` : 'Confirm Workspace Sync', response);
            if (nextDialog) {
                setSyncDialog(nextDialog);
            }
        }
    }, [props.controller, snapshot]);

    const confirmSync = React.useCallback(async () => {
        if (!syncDialog) {
            return;
        }
        setSyncDialog({
            ...syncDialog,
            busy: true,
            backendError: undefined
        });
        try {
            const response = await props.controller.confirmWorkspaceSync({
                ...syncDialog.request,
                trustConfirmed: true,
                ...(syncDialog.forceSourceIds.length > 0 ? { forceSourceIds: syncDialog.forceSourceIds } : {})
            });
            if (response?.job.state === 'awaiting-confirmation') {
                const nextDialog = maybeCreateSyncDialog(syncDialog.title, response);
                if (nextDialog) {
                    setSyncDialog(nextDialog);
                }
                return;
            }
            setSyncDialog(undefined);
        } catch (error) {
            setSyncDialog(current => current && ({
                ...current,
                busy: false,
                backendError: toErrorMessage(error)
            }));
        }
    }, [props.controller, syncDialog]);

    const removeSource = React.useCallback(async () => {
        if (!snapshot || !selectedRemoveSource) {
            return;
        }
        const request: RemoveWorkspaceSourceRequest = {
            workspaceId: snapshot.identity.workspaceId,
            configPath: snapshot.identity.configPath,
            expectedRevision: snapshot.config.revision,
            sourceId: selectedRemoveSource.sourceId
        };
        await props.controller.removeWorkspaceSource(request);
        setRemoveSourceId(undefined);
    }, [props.controller, selectedRemoveSource, snapshot]);

    const localPathHint = snapshot ? computeRemoteLocalPath(
        snapshot,
        sourceDialog?.draft.sourceId,
        sourceDialog?.draft.remoteUrl
    ) : undefined;

    return (
        <div className='studio-workspace-sources' data-testid='workspace-sources-widget'>
            <header className='studio-workspace-sources__header'>
                <div>
                    <div className='studio-workspace-sources__eyebrow'>Unified workspace source control</div>
                    <h2>Workspace Sources</h2>
                </div>
                <div className='studio-workspace-sources__status' data-testid='workspace-sources-status'>
                    <span className={`studio-workspace-sources__pill${props.controller.isConnected() ? '' : ' studio-workspace-sources__pill--warning'}`}>
                        {props.controller.isConnected() ? 'Connected' : 'Disconnected'}
                    </span>
                    <span className='studio-workspace-sources__pill'>{snapshot?.state ?? 'unavailable'}</span>
                    <span className='studio-workspace-sources__pill'>{snapshot?.migration.mode ?? 'unknown'}</span>
                </div>
            </header>

            <section className='studio-workspace-sources__actions' data-testid='workspace-sources-actions'>
                <button className='theia-button secondary' data-testid='workspace-sources-refresh' onClick={() => void props.controller.refresh()}>
                    Refresh
                </button>
                {snapshot && shouldShowCreateButton(snapshot) && (
                    <button
                        className='theia-button secondary'
                        data-testid='workspace-sources-create'
                        onClick={() => void props.controller.createWorkspaceConfig({
                            workspaceId: snapshot.identity.workspaceId,
                            configPath: snapshot.identity.configPath,
                            revisionToken: snapshot.config.revision,
                            sources: []
                        })}
                    >
                        Create Config
                    </button>
                )}
                {snapshot && (
                    <>
                        <button className='theia-button secondary' data-testid='workspace-sources-add' onClick={() => openSourceDialog('add')}>
                            Add Source
                        </button>
                        <button className='theia-button secondary' data-testid='workspace-sources-scan' onClick={() => void props.controller.scanWorkspaceSources({
                            workspaceId: snapshot.identity.workspaceId,
                            configPath: snapshot.identity.configPath,
                            roots: ['.'],
                            maxDepth: 3,
                            maxEntries: 100
                        })}>
                            Scan
                        </button>
                        <button className='theia-button secondary' data-testid='workspace-sources-sync' onClick={() => void startSync()}>
                            Sync
                        </button>
                        <button className='theia-button secondary' data-testid='workspace-sources-edit-raw' onClick={() => void openRawTomlDialog()}>
                            Edit Raw TOML
                        </button>
                        <button className='theia-button secondary' data-testid='workspace-sources-open-raw' onClick={() => void openConfig(props.openerService, snapshot.identity.configPath)}>
                            Open Config
                        </button>
                    </>
                )}
            </section>

            <section className='studio-workspace-sources__panel' data-testid={`workspace-sources-panel-${panelState}`}>
                <h3>{formatPanelTitle(panelState)}</h3>
                <p>{formatPanelDescription(panelState, snapshot, diagnostics)}</p>
                {configErrors.length > 0 && (
                    <ul className='studio-workspace-sources__diagnostic-list' data-testid='workspace-sources-config-errors'>
                        {configErrors.map(diagnostic => (
                            <li key={`${diagnostic.code}:${diagnostic.message}`}>{diagnostic.message}</li>
                        ))}
                    </ul>
                )}
            </section>

            <section className='studio-workspace-sources__grid'>
                <article className='studio-workspace-sources__card' data-testid='workspace-sources-config-card'>
                    <h3>Configured sources</h3>
                    <p className='studio-workspace-sources__meta'>Revision {snapshot?.config.revision ?? 'unavailable'}</p>
                    {snapshot?.config.resolveRootUri && (
                        <p className='studio-workspace-sources__meta' data-testid='workspace-sources-root-status'>
                            Workspace Sources root: {new URI(snapshot.config.resolveRootUri).path.toString()}
                            {' · '}
                            {snapshot.config.canonicalResolveRootUri ? 'Ready' : 'Not created'}
                        </p>
                    )}
                    {sources.length === 0 ? (
                        <div className='studio-workspace-sources__empty' data-testid='workspace-sources-empty-config'>No configured sources yet.</div>
                    ) : (
                        <div className='studio-workspace-sources__list'>
                            {sources.map(({ source, observed }) => (
                                <article key={source.sourceId} className='studio-workspace-sources__row' data-testid={`workspace-source-row-${source.sourceId}`}>
                                    <div className='studio-workspace-sources__row-top'>
                                        <div>
                                            <strong>{source.label}</strong>
                                            <div className='studio-workspace-sources__meta'>{source.localPath}</div>
                                        </div>
                                        <span className={`studio-workspace-sources__badge studio-workspace-sources__badge--${observed?.status ?? 'present'}`} data-testid={`workspace-source-status-${source.sourceId}`}>
                                            {observed?.status ?? 'present'}
                                        </span>
                                    </div>
                                    <div className='studio-workspace-sources__meta-row'>
                                        <span>Provider: {source.provider ?? 'unknown'}</span>
                                        <span>Sync: {observed?.syncEligibility ?? 'not-configured'}</span>
                                        {observed?.blockedReason && <span>{observed.blockedReason}</span>}
                                    </div>
                                    <div className='studio-workspace-sources__inline-actions'>
                                        <button className='theia-button secondary' data-testid={`workspace-source-edit-${source.sourceId}`} onClick={() => openSourceDialog('edit', source)}>
                                            Edit
                                        </button>
                                        <button className='theia-button secondary' data-testid={`workspace-source-sync-${source.sourceId}`} onClick={() => void startSync([source.sourceId])}>
                                            Sync
                                        </button>
                                        <button className='theia-button secondary' data-testid={`workspace-source-remove-${source.sourceId}`} onClick={() => setRemoveSourceId(source.sourceId)}>
                                            Remove
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </article>

                <article className='studio-workspace-sources__card' data-testid='workspace-sources-suggestions-card'>
                    <h3>Detected suggestions</h3>
                    <p className='studio-workspace-sources__meta'>{suggestions.length} active suggestions</p>
                    {suggestions.length === 0 ? (
                        <div className='studio-workspace-sources__empty' data-testid='workspace-sources-empty-suggestions'>No active suggestions.</div>
                    ) : (
                        <div className='studio-workspace-sources__list'>
                            {suggestions.map(suggestion => (
                                <article key={`${suggestion.suggestionId}:${suggestion.candidateId}`} className='studio-workspace-sources__row' data-testid={`workspace-suggestion-row-${suggestion.candidateId}`}>
                                    <div className='studio-workspace-sources__row-top'>
                                        <div>
                                            <strong>{suggestion.label}</strong>
                                            <div className='studio-workspace-sources__meta'>{suggestion.localPath}</div>
                                        </div>
                                        <span className='studio-workspace-sources__pill'>{suggestion.disposition}</span>
                                    </div>
                                    <p className='studio-workspace-sources__reason'>{suggestion.reason}</p>
                                    <div className='studio-workspace-sources__inline-actions'>
                                        {snapshot && canAddSuggestion(snapshot, suggestion) && (
                                            <button className='theia-button secondary' data-testid={`workspace-suggestion-add-${suggestion.candidateId}`} onClick={() => openSourceDialog('add', undefined, suggestion)}>
                                                Add
                                            </button>
                                        )}
                                        {snapshot && suggestion.disposition === 'new' && (
                                            <button className='theia-button secondary' data-testid={`workspace-suggestion-ignore-${suggestion.candidateId}`} onClick={() => void props.controller.ignoreWorkspaceSuggestion({
                                                workspaceId: snapshot.identity.workspaceId,
                                                configPath: snapshot.identity.configPath,
                                                candidateId: suggestion.candidateId,
                                                rootPath: suggestion.rootPath
                                            })}>
                                                Ignore
                                            </button>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </article>

                <article className='studio-workspace-sources__card' data-testid='workspace-sources-activity-card'>
                    <h3>Activity</h3>
                    {activity ? (
                        <div className='studio-workspace-sources__activity' data-testid='workspace-sources-activity-event'>
                            <div><strong>{activity.job.kind}</strong> {activity.job.state}</div>
                            <div className='studio-workspace-sources__meta'>Phase: {activity.job.phase}</div>
                            <div className='studio-workspace-sources__meta'>Updated: {activity.job.updatedAt}</div>
                        </div>
                    ) : (
                        <div className='studio-workspace-sources__empty' data-testid='workspace-sources-empty-activity'>No recent activity.</div>
                    )}
                    {renderJobs(snapshot?.jobs ?? [])}
                </article>

                <article className='studio-workspace-sources__card' data-testid='workspace-sources-scan-card'>
                    <h3>Latest scan</h3>
                    <p className='studio-workspace-sources__meta'>
                        {snapshot?.latestScan ? `Generated ${snapshot.latestScan.generatedAt}` : 'No scan preview available.'}
                    </p>
                    {scanCandidates.length === 0 ? (
                        <div className='studio-workspace-sources__empty' data-testid='workspace-sources-empty-scan'>No scan candidates.</div>
                    ) : (
                        <div className='studio-workspace-sources__list'>
                            {scanCandidates.map(candidate => (
                                <article key={candidate.candidateId} className='studio-workspace-sources__row' data-testid={`workspace-scan-candidate-${candidate.candidateId}`}>
                                    <div className='studio-workspace-sources__row-top'>
                                        <div>
                                            <strong>{candidate.label}</strong>
                                            <div className='studio-workspace-sources__meta'>{candidate.localPath}</div>
                                        </div>
                                        <span className='studio-workspace-sources__pill'>{candidate.ignoredLocally ? 'ignored' : candidate.provider ?? 'detected'}</span>
                                    </div>
                                    <div className='studio-workspace-sources__meta-row'>
                                        <span>Root: {candidate.rootPath}</span>
                                        {candidate.remoteUrl && <span>{candidate.remoteUrl}</span>}
                                    </div>
                                    <div className='studio-workspace-sources__inline-actions'>
                                        <button className='theia-button secondary' data-testid={`workspace-scan-add-${candidate.candidateId}`} onClick={() => openSourceDialog('add', undefined, candidate)}>
                                            Add
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </article>
            </section>

            {sourceDialog && (
                <SourceEditorDialog
                    mode={sourceDialog.mode}
                    draft={sourceDialog.draft}
                    onDraftChange={draft => setSourceDialog({
                        ...sourceDialog,
                        draft,
                        validation: validateSourceDraft(draft),
                        backendError: undefined,
                        diagnostics: []
                    })}
                    validation={sourceDialog.validation}
                    busy={sourceDialog.busy}
                    backendError={sourceDialog.backendError}
                    diagnostics={sourceDialog.diagnostics}
                    localPathHint={sourceDialog.draft.kind === 'remote' ? localPathHint : undefined}
                    onCancel={() => setSourceDialog(undefined)}
                    onSave={() => void submitSourceDialog(false)}
                    onSaveAndSync={() => void submitSourceDialog(true)}
                />
            )}
            {selectedRemoveSource && (
                <ConfirmDialog
                    title='Remove Workspace Source'
                    testId='workspace-source-remove-dialog'
                    body={<p data-testid='workspace-source-remove-message'>Remove <strong>{selectedRemoveSource.sourceId}</strong> from the canonical config?</p>}
                    confirmLabel='Remove Source'
                    confirmClassName='theia-button'
                    onCancel={() => setRemoveSourceId(undefined)}
                    onConfirm={() => void removeSource()}
                />
            )}
            {rawDialog && (
                <RawTomlEditorDialog
                    loading={rawDialog.loading}
                    draft={rawDialog.draft}
                    revision={rawDialog.revision}
                    busy={rawDialog.busy}
                    backendError={rawDialog.backendError}
                    diagnostics={rawDialog.diagnostics}
                    conflict={rawDialog.conflict}
                    onDraftChange={draft => setRawDialog({ ...rawDialog, draft, backendError: undefined, conflict: undefined })}
                    onCancel={() => setRawDialog(undefined)}
                    onReloadLatest={() => void reloadRawToml()}
                    onSave={() => void saveRawToml(false)}
                    onSaveAndSync={() => void saveRawToml(true)}
                    onRetryWithLatestRevision={rawDialog.conflict?.code === 'revision-mismatch' ? () => void saveRawToml(false, true) : undefined}
                />
            )}
            {syncDialog && (
                <SyncConfirmationDialog
                    title={syncDialog.title}
                    preview={syncDialog.preview}
                    sourcePreviews={syncDialog.sourcePreviews}
                    forceSourceIds={syncDialog.forceSourceIds}
                    busy={syncDialog.busy}
                    backendError={syncDialog.backendError}
                    onToggleForce={sourceId => setSyncDialog({
                        ...syncDialog,
                        forceSourceIds: syncDialog.forceSourceIds.includes(sourceId)
                            ? syncDialog.forceSourceIds.filter(candidate => candidate !== sourceId)
                            : [...syncDialog.forceSourceIds, sourceId]
                    })}
                    onCancel={() => setSyncDialog(undefined)}
                    onConfirm={() => void confirmSync()}
                />
            )}
            {renameDialog && (
                <RenameImpactDialog
                    impacts={renameDialog.impacts}
                    message={renameDialog.message}
                    busy={renameDialog.busy}
                    onCancel={renameDialog.cancel}
                    onConfirm={impactIds => void renameDialog.confirm(impactIds)}
                />
            )}
        </div>
    );
}

async function saveEditedSource(
    controller: WorkspaceSourcesFrontendController,
    snapshot: WorkspaceSnapshot,
    dialog: SourceDialogState,
    source: WorkspaceConfiguredSource,
    saveAndSync: boolean,
    setRenameDialog: React.Dispatch<React.SetStateAction<RenameConfirmationState | undefined>>,
    callbacks: SaveEditedSourceCallbacks
): Promise<SaveEditedSourceResult | undefined> {
    const originalSourceId = dialog.originalSourceId ?? source.sourceId;
    if (originalSourceId === source.sourceId) {
        return {
            mutation: await controller.updateWorkspaceSource({
                workspaceId: snapshot.identity.workspaceId,
                configPath: snapshot.identity.configPath,
                expectedRevision: snapshot.config.revision,
                source,
                ...(saveAndSync ? { sync: { sourceIds: [source.sourceId], trustConfirmed: false } } : {})
            })
        };
    }

    const originalSource = getSourceById(snapshot, originalSourceId);
    const applyRename = async (confirmedImpactIds?: readonly string[]): Promise<SaveEditedSourceResult | undefined> => {
        const renamed = await controller.renameWorkspace({
            workspaceId: snapshot.identity.workspaceId,
            configPath: snapshot.identity.configPath,
            expectedRevision: snapshot.config.revision,
            sourceId: originalSourceId,
            nextSourceId: source.sourceId,
            ...(confirmedImpactIds ? { confirmedImpactIds } : {})
        });
        if (!renamed || renamed.conflict) {
            if (renamed?.conflict?.code === 'confirmation-required' && renamed.conflict.impacts) {
                setRenameDialog({
                    impacts: renamed.conflict.impacts,
                    message: renamed.conflict.message,
                    busy: false,
                    cancel: () => setRenameDialog(undefined),
                    confirm: async impactIds => {
                        setRenameDialog(current => current && ({ ...current, busy: true }));
                        const confirmed = await applyRename(impactIds);
                        if (!confirmed?.mutation?.conflict) {
                            setRenameDialog(undefined);
                        }
                        callbacks.onRenameConfirmed(confirmed);
                    }
                });
            }
            return {
                mutation: renamed
            };
        }
        const latestSnapshot = controller.getSnapshot();
        if (!latestSnapshot) {
            return {
                mutation: renamed
            };
        }
        const updateNeeded = source.localPath !== originalSource?.localPath
            || source.remoteUrl !== originalSource?.remoteUrl
            || source.ref !== originalSource?.ref;
        if (!updateNeeded) {
            if (saveAndSync) {
                return {
                    sync: await controller.startWorkspaceSync({
                        workspaceId: latestSnapshot.identity.workspaceId,
                        configPath: latestSnapshot.identity.configPath,
                        expectedRevision: latestSnapshot.config.revision,
                        sourceIds: [source.sourceId],
                        trustConfirmed: false
                    })
                };
            }
            return {
                mutation: renamed
            };
        }
        return {
            mutation: await controller.updateWorkspaceSource({
                workspaceId: latestSnapshot.identity.workspaceId,
                configPath: latestSnapshot.identity.configPath,
                expectedRevision: latestSnapshot.config.revision,
                source,
                ...(saveAndSync ? { sync: { sourceIds: [source.sourceId], trustConfirmed: false } } : {})
            })
        };
    };

    return applyRename();
}

function maybeCreateSyncDialog(title: string, response: WorkspaceSyncResponse): SyncDialogState | undefined {
    const sourcePreviews = response.job.sourcePreviews ?? [];
    if (response.job.state !== 'awaiting-confirmation' && !response.job.preview && sourcePreviews.length === 0) {
        return undefined;
    }
    return {
        title,
        request: {
            workspaceId: response.snapshot.identity.workspaceId,
            configPath: response.snapshot.identity.configPath,
            jobId: response.job.jobId,
            trustConfirmed: false
        },
        preview: response.job.preview,
        sourcePreviews,
        reasons: response.job.preview?.reasons ?? sourcePreviews.map(preview => preview.confirmationMessage ?? preview.blockedReason ?? preview.eligibility),
        forceSourceIds: [],
        busy: false
    };
}

function fromRawTomlResponse(response: ReadWorkspaceRawTomlResponse | undefined): RawTomlDialogState | undefined {
    if (!response) {
        return undefined;
    }
    return {
        loading: false,
        busy: false,
        revision: response.revision,
        draft: response.rawToml ?? '',
        diagnostics: response.diagnostics
    };
}

function toConfiguredSource(draft: WorkspaceSourceDraft): WorkspaceConfiguredSource {
    return {
        sourceId: draft.sourceId.trim(),
        label: draft.sourceId.trim(),
        localPath: draft.kind === 'local' ? draft.localPath.trim() : '',
        ...(draft.kind === 'remote' ? { remoteUrl: draft.remoteUrl.trim() } : {}),
        ...(draft.kind === 'remote' && draft.ref.trim() ? { ref: draft.ref.trim(), defaultBranch: draft.ref.trim() } : {}),
        ...(draft.kind === 'local' ? { provider: 'local' as const } : {}),
        configured: true,
        authoritative: true,
        include: 'member'
    };
}

async function openConfig(openerService: OpenerService, configPath: string): Promise<void> {
    const target = configPath.startsWith('file://') ? new URI(configPath) : new URI(`file://${configPath}`);
    await open(openerService, target);
}

function getSourceRows(snapshot: WorkspaceSnapshot | undefined): SourceRowModel[] {
    if (!snapshot) {
        return [];
    }
    const observedById = new Map(snapshot.observedSources.map(observed => [observed.sourceId, observed]));
    return snapshot.configuredSources.map(source => ({
        source,
        observed: observedById.get(source.sourceId)
    }));
}

function getPanelState(snapshot: WorkspaceSnapshot | undefined, diagnostics: readonly WorkspaceDiagnostic[]): SourcePanelState {
    if (!snapshot || snapshot.migration.mode === 'single-folder') {
        return 'missing-config';
    }
    if (diagnostics.some(diagnostic => diagnostic.severity === 'error' && diagnostic.scope === 'config')) {
        return 'invalid-config';
    }
    if (snapshot.migration.mode === 'legacy') {
        return snapshot.migration.status === 'pending' || snapshot.migration.status === 'in-progress' || snapshot.migration.status === 'recovering'
            ? 'migration'
            : 'legacy';
    }
    if (snapshot.migration.mode === 'canonical-shadow') {
        return 'canonical-shadow';
    }
    if (snapshot.configuredSources.length === 0) {
        return 'empty-config';
    }
    return 'canonical-active';
}

function formatPanelTitle(state: SourcePanelState): string {
    switch (state) {
        case 'missing-config':
            return 'Missing canonical config';
        case 'empty-config':
            return 'Empty canonical config';
        case 'invalid-config':
            return 'Invalid or unsupported config';
        case 'legacy':
            return 'Legacy workspace mode';
        case 'migration':
            return 'Migration in progress';
        case 'canonical-shadow':
            return 'Canonical shadow config';
        case 'canonical-active':
            return 'Canonical config active';
        default:
            return 'Workspace sources';
    }
}

function formatPanelDescription(state: SourcePanelState, snapshot: WorkspaceSnapshot | undefined, diagnostics: readonly WorkspaceDiagnostic[]): string {
    switch (state) {
        case 'missing-config':
            return 'The opened folder is not backed by an active canonical workspace config yet.';
        case 'empty-config':
            return 'The canonical config is active but does not define any member sources yet.';
        case 'invalid-config':
            return diagnostics.find(diagnostic => diagnostic.scope === 'config' && diagnostic.severity === 'error')?.message
                ?? 'The current workspace config could not be validated.';
        case 'legacy':
            return 'A legacy workspace config is still active. Review the migration state before switching over.';
        case 'migration':
            return `Migration status: ${snapshot?.migration.status ?? 'unknown'}.`;
        case 'canonical-shadow':
            return 'A canonical config exists in shadow mode and is not the active source of truth yet.';
        case 'canonical-active':
            return 'The canonical workspace config is the active source of truth for this workspace.';
        default:
            return 'Workspace source status is unavailable.';
    }
}

function renderJobs(jobs: readonly WorkspaceJobActivity[]): React.ReactNode {
    if (jobs.length === 0) {
        return null;
    }
    return (
        <div className='studio-workspace-sources__jobs' data-testid='workspace-sources-job-list'>
            {jobs.map(job => (
                <article key={job.jobId} className='studio-workspace-sources__job' data-testid={`workspace-sources-job-${job.jobId}`}>
                    <div className='studio-workspace-sources__row-top'>
                        <strong>{job.kind}</strong>
                        <span className='studio-workspace-sources__pill'>{job.state}</span>
                    </div>
                    <div className='studio-workspace-sources__meta-row'>
                        <span>Phase: {job.phase}</span>
                        <span>Updated: {job.updatedAt}</span>
                    </div>
                    {job.lastError && <p className='studio-workspace-sources__reason'>{job.lastError.message}</p>}
                </article>
            ))}
        </div>
    );
}

function shouldShowCreateButton(snapshot: WorkspaceSnapshot): boolean {
    return snapshot.migration.mode === 'single-folder' || snapshot.migration.mode === 'legacy';
}

function canAddSuggestion(snapshot: WorkspaceSnapshot, suggestion: WorkspaceRepositorySuggestion): boolean {
    return Boolean(snapshot.identity.workspaceId && snapshot.identity.configPath && suggestion.disposition === 'new');
}

function computeRemoteLocalPath(
    snapshot: WorkspaceSnapshot,
    sourceId: string | undefined,
    remoteUrl: string | undefined
): string | undefined {
    if (!sourceId) {
        return undefined;
    }
    const resolveRootPath = snapshot.config.resolveRootUri
        ? trimTrailingSlashes(new URI(snapshot.config.resolveRootUri).path.toString())
        : `${deriveConfigDirectory(snapshot.identity.configPath)}/${(snapshot.config.resolveWorkdir?.trim() || '.workspace-sources').replace(/^\/+|\/+$/gu, '')}`;
    const relativeCheckoutPath = resolveRemoteCheckoutRelativePath(
        remoteUrl ?? '',
        sourceId,
        snapshot.config.resolveNamespace
    );
    return `${resolveRootPath}/${relativeCheckoutPath}`;
}

function getSourceById(snapshot: WorkspaceSnapshot, sourceId: string): WorkspaceConfiguredSource | undefined {
    return snapshot.configuredSources.find(source => source.sourceId === sourceId);
}

function isScanCandidate(
    suggestion: WorkspaceRepositorySuggestion | WorkspaceScanCandidate | undefined
): suggestion is WorkspaceScanCandidate {
    return Boolean(suggestion && 'ignoredLocally' in suggestion);
}

function isRepositorySuggestion(
    suggestion: WorkspaceRepositorySuggestion | WorkspaceScanCandidate | undefined
): suggestion is WorkspaceRepositorySuggestion {
    return Boolean(suggestion && 'suggestionId' in suggestion);
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function deriveConfigDirectory(configPath: string): string {
    const normalized = configPath.replace(/\\/gu, '/');
    return normalized.replace(/\/[^/]+$/u, '');
}

function trimTrailingSlashes(value: string): string {
    return value.replace(/\/+$/u, '');
}
