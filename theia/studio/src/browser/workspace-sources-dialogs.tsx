import * as React from '@theia/core/shared/react';
import type {
    WorkspaceConfigConflict,
    WorkspaceDiagnostic,
    WorkspaceSourceRenameImpactPreview,
    WorkspaceSourceSyncPreview,
    WorkspaceSyncTrustPreview
} from '../common/workspace-protocol';

export type WorkspaceSourceDraftKind = 'local' | 'remote';

export interface WorkspaceSourceDraft {
    readonly sourceId: string;
    readonly label: string;
    readonly kind: WorkspaceSourceDraftKind;
    readonly localPath: string;
    readonly remoteUrl: string;
    readonly ref: string;
}

export interface WorkspaceSourceValidationErrors {
    sourceId?: string;
    localPath?: string;
    remoteUrl?: string;
    ref?: string;
}

interface ModalProps {
    readonly title: string;
    readonly testId: string;
    readonly children: React.ReactNode;
    readonly actions: React.ReactNode;
    readonly onClose: () => void;
}

interface SourceEditorDialogProps {
    readonly mode: 'add' | 'edit';
    readonly draft: WorkspaceSourceDraft;
    readonly onDraftChange: (draft: WorkspaceSourceDraft) => void;
    readonly validation: WorkspaceSourceValidationErrors;
    readonly busy: boolean;
    readonly backendError?: string;
    readonly diagnostics?: readonly WorkspaceDiagnostic[];
    readonly localPathHint?: string;
    readonly onCancel: () => void;
    readonly onSave: () => void;
    readonly onSaveAndSync: () => void;
}

interface ConfirmDialogProps {
    readonly title: string;
    readonly testId: string;
    readonly body: React.ReactNode;
    readonly confirmLabel: string;
    readonly confirmClassName?: string;
    readonly busy?: boolean;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
}

interface RenameImpactDialogProps {
    readonly impacts: readonly WorkspaceSourceRenameImpactPreview[];
    readonly message: string;
    readonly busy: boolean;
    readonly onCancel: () => void;
    readonly onConfirm: (impactIds: readonly string[]) => void;
}

interface RawTomlEditorDialogProps {
    readonly loading: boolean;
    readonly draft: string;
    readonly revision: string;
    readonly busy: boolean;
    readonly backendError?: string;
    readonly diagnostics?: readonly WorkspaceDiagnostic[];
    readonly conflict?: WorkspaceConfigConflict;
    readonly onDraftChange: (draft: string) => void;
    readonly onCancel: () => void;
    readonly onReloadLatest: () => void;
    readonly onSave: () => void;
    readonly onSaveAndSync: () => void;
    readonly onRetryWithLatestRevision?: () => void;
}

interface SyncConfirmationDialogProps {
    readonly title: string;
    readonly preview?: WorkspaceSyncTrustPreview;
    readonly sourcePreviews: readonly WorkspaceSourceSyncPreview[];
    readonly forceSourceIds: readonly string[];
    readonly busy: boolean;
    readonly backendError?: string;
    readonly onToggleForce: (sourceId: string) => void;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
}

export function createSourceDraft(input?: Partial<WorkspaceSourceDraft>): WorkspaceSourceDraft {
    return {
        sourceId: input?.sourceId ?? '',
        label: input?.label ?? input?.sourceId ?? '',
        kind: input?.kind ?? 'local',
        localPath: input?.localPath ?? '',
        remoteUrl: input?.remoteUrl ?? '',
        ref: input?.ref ?? ''
    };
}

export function validateSourceDraft(draft: WorkspaceSourceDraft): WorkspaceSourceValidationErrors {
    const errors: WorkspaceSourceValidationErrors = {};
    const sourceId = draft.sourceId.trim();
    if (!sourceId) {
        errors.sourceId = 'Source ID is required.';
    } else if (sourceId === '.' || sourceId === '..' || /[\\/]/u.test(sourceId) || /[\r\n\t]/u.test(sourceId)) {
        errors.sourceId = 'Source ID must not contain path separators or control whitespace.';
    }

    if (draft.kind === 'local') {
        if (!draft.localPath.trim()) {
            errors.localPath = 'Local path is required for local sources.';
        }
    } else if (!draft.remoteUrl.trim()) {
        errors.remoteUrl = 'Remote URL is required for remote sources.';
    }

    if (draft.ref && !draft.ref.trim()) {
        errors.ref = 'Ref must not be blank.';
    }
    return errors;
}

export function SourceEditorDialog(props: SourceEditorDialogProps): React.ReactElement {
    const submitDisabled = props.busy || Object.keys(props.validation).length > 0;
    return (
        <Modal title={props.mode === 'add' ? 'Add Workspace Source' : 'Edit Workspace Source'} testId='workspace-source-editor-dialog' onClose={props.onCancel} actions={
            <>
                <button className='theia-button secondary' data-testid='workspace-source-editor-cancel' onClick={props.onCancel}>Cancel</button>
                <button className='theia-button secondary' data-testid='workspace-source-editor-save-sync' onClick={props.onSaveAndSync} disabled={submitDisabled}>Save &amp; Sync</button>
                <button className='theia-button' data-testid='workspace-source-editor-save' onClick={props.onSave} disabled={submitDisabled}>Save</button>
            </>
        }>
            <div className='studio-workspace-sources__form-grid'>
                <label className='studio-workspace-sources__field'>
                    <span>Source ID</span>
                    <input
                        data-testid='workspace-source-input-source-id'
                        value={props.draft.sourceId}
                        onChange={event => props.onDraftChange({ ...props.draft, sourceId: event.currentTarget.value, label: props.mode === 'add' ? event.currentTarget.value : props.draft.label })}
                    />
                    {props.validation.sourceId && <span className='studio-workspace-sources__field-error'>{props.validation.sourceId}</span>}
                </label>
                <label className='studio-workspace-sources__field'>
                    <span>Type</span>
                    <select
                        data-testid='workspace-source-input-kind'
                        value={props.draft.kind}
                        onChange={event => props.onDraftChange({
                            ...props.draft,
                            kind: event.currentTarget.value as WorkspaceSourceDraftKind
                        })}
                        disabled={props.mode === 'edit'}
                    >
                        <option value='local'>Local path</option>
                        <option value='remote'>Remote repository</option>
                    </select>
                </label>
                {props.draft.kind === 'local' ? (
                    <label className='studio-workspace-sources__field studio-workspace-sources__field--wide'>
                        <span>Local Path</span>
                        <input
                            data-testid='workspace-source-input-local-path'
                            value={props.draft.localPath}
                            onChange={event => props.onDraftChange({ ...props.draft, localPath: event.currentTarget.value })}
                        />
                        {props.validation.localPath && <span className='studio-workspace-sources__field-error'>{props.validation.localPath}</span>}
                    </label>
                ) : (
                    <>
                        <label className='studio-workspace-sources__field studio-workspace-sources__field--wide'>
                            <span>Remote URL</span>
                            <input
                                data-testid='workspace-source-input-remote-url'
                                value={props.draft.remoteUrl}
                                onChange={event => props.onDraftChange({ ...props.draft, remoteUrl: event.currentTarget.value })}
                            />
                            {props.validation.remoteUrl && <span className='studio-workspace-sources__field-error'>{props.validation.remoteUrl}</span>}
                        </label>
                        <label className='studio-workspace-sources__field'>
                            <span>Ref</span>
                            <input
                                data-testid='workspace-source-input-ref'
                                value={props.draft.ref}
                                onChange={event => props.onDraftChange({ ...props.draft, ref: event.currentTarget.value })}
                            />
                            {props.validation.ref && <span className='studio-workspace-sources__field-error'>{props.validation.ref}</span>}
                        </label>
                        <div className='studio-workspace-sources__field studio-workspace-sources__field--wide'>
                            <span>Resolved checkout path</span>
                            <code data-testid='workspace-source-resolved-local-path'>{props.localPathHint ?? 'Derived from source ID by the backend.'}</code>
                        </div>
                    </>
                )}
            </div>
            {props.backendError && <div className='studio-workspace-sources__dialog-error' data-testid='workspace-source-editor-error'>{props.backendError}</div>}
            <DiagnosticsList diagnostics={props.diagnostics} testId='workspace-source-editor-diagnostics' />
        </Modal>
    );
}

export function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement {
    return (
        <Modal title={props.title} testId={props.testId} onClose={props.onCancel} actions={
            <>
                <button className='theia-button secondary' data-testid={`${props.testId}-cancel`} onClick={props.onCancel}>Cancel</button>
                <button
                    className={props.confirmClassName ?? 'theia-button'}
                    data-testid={`${props.testId}-confirm`}
                    onClick={props.onConfirm}
                    disabled={props.busy}
                >
                    {props.confirmLabel}
                </button>
            </>
        }>
            {props.body}
        </Modal>
    );
}

export function RenameImpactDialog(props: RenameImpactDialogProps): React.ReactElement {
    return (
        <Modal title='Confirm Source ID Rename' testId='workspace-source-rename-dialog' onClose={props.onCancel} actions={
            <>
                <button className='theia-button secondary' data-testid='workspace-source-rename-cancel' onClick={props.onCancel}>Cancel</button>
                <button className='theia-button' data-testid='workspace-source-rename-confirm' onClick={() => props.onConfirm(props.impacts.map(impact => impact.impactId))} disabled={props.busy}>Confirm Rename</button>
            </>
        }>
            <p>{props.message}</p>
            <ul className='studio-workspace-sources__diagnostic-list' data-testid='workspace-source-rename-impacts'>
                {props.impacts.map(impact => (
                    <li key={impact.impactId}>
                        <strong>{impact.path}</strong> line {impact.range.line}:{impact.range.column} {impact.evidence}
                    </li>
                ))}
            </ul>
        </Modal>
    );
}

export function RawTomlEditorDialog(props: RawTomlEditorDialogProps): React.ReactElement {
    return (
        <Modal title='Edit Raw Workspace TOML' testId='workspace-source-raw-dialog' onClose={props.onCancel} actions={
            <>
                <button className='theia-button secondary' data-testid='workspace-source-raw-cancel' onClick={props.onCancel}>Close</button>
                <button className='theia-button secondary' data-testid='workspace-source-raw-save-sync' onClick={props.onSaveAndSync} disabled={props.loading || props.busy}>Save &amp; Sync</button>
                <button className='theia-button' data-testid='workspace-source-raw-save' onClick={props.onSave} disabled={props.loading || props.busy}>Save</button>
            </>
        }>
            <div className='studio-workspace-sources__meta'>Expected revision: {props.revision}</div>
            <textarea
                className='studio-workspace-sources__textarea'
                data-testid='workspace-source-raw-input'
                value={props.draft}
                onChange={event => props.onDraftChange(event.currentTarget.value)}
                readOnly={props.loading}
            />
            {props.backendError && <div className='studio-workspace-sources__dialog-error' data-testid='workspace-source-raw-error'>{props.backendError}</div>}
            <DiagnosticsList diagnostics={props.diagnostics} testId='workspace-source-raw-diagnostics' />
            {props.conflict?.code === 'revision-mismatch' && (
                <div className='studio-workspace-sources__conflict-box' data-testid='workspace-source-raw-conflict'>
                    <strong>Revision conflict</strong>
                    <p>{props.conflict.message}</p>
                    <div className='studio-workspace-sources__inline-actions'>
                        <button className='theia-button secondary' data-testid='workspace-source-raw-reload-latest' onClick={props.onReloadLatest}>Reload Latest</button>
                        {props.onRetryWithLatestRevision && (
                            <button className='theia-button secondary' data-testid='workspace-source-raw-retry-latest' onClick={props.onRetryWithLatestRevision}>
                                Save Using Latest Revision
                            </button>
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
}

export function SyncConfirmationDialog(props: SyncConfirmationDialogProps): React.ReactElement {
    const missingForceConfirmation = props.sourcePreviews.some(
        preview => preview.forceRequired && !props.forceSourceIds.includes(preview.sourceId)
    );
    return (
        <Modal title={props.title} testId='workspace-source-sync-dialog' onClose={props.onCancel} actions={
            <>
                <button className='theia-button secondary' data-testid='workspace-source-sync-cancel' onClick={props.onCancel}>Cancel</button>
                <button className='theia-button' data-testid='workspace-source-sync-confirm' onClick={props.onConfirm} disabled={props.busy || missingForceConfirmation}>Confirm Sync</button>
            </>
        }>
            {props.preview && props.preview.reasons.length > 0 && (
                <ul className='studio-workspace-sources__diagnostic-list' data-testid='workspace-source-sync-reasons'>
                    {props.preview.reasons.map(reason => <li key={reason}>{reason}</li>)}
                </ul>
            )}
            <div className='studio-workspace-sources__list'>
                {props.sourcePreviews.map(preview => (
                    <label key={preview.sourceId} className='studio-workspace-sources__sync-preview' data-testid={`workspace-source-sync-preview-${preview.sourceId}`}>
                        <div>
                            <strong>{preview.sourceId}</strong>
                            <div className='studio-workspace-sources__meta'>{preview.confirmationMessage ?? preview.blockedReason ?? preview.eligibility}</div>
                        </div>
                        {preview.forceRequired ? (
                            <input
                                type='checkbox'
                                data-testid={`workspace-source-sync-force-${preview.sourceId}`}
                                checked={props.forceSourceIds.includes(preview.sourceId)}
                                onChange={() => props.onToggleForce(preview.sourceId)}
                            />
                        ) : (
                            <span className='studio-workspace-sources__pill'>{preview.eligibility}</span>
                        )}
                    </label>
                ))}
            </div>
            {props.backendError && <div className='studio-workspace-sources__dialog-error' data-testid='workspace-source-sync-error'>{props.backendError}</div>}
        </Modal>
    );
}

function DiagnosticsList(props: { diagnostics?: readonly WorkspaceDiagnostic[]; testId: string }): React.ReactElement | null {
    if (!props.diagnostics || props.diagnostics.length === 0) {
        return null;
    }
    return (
        <ul className='studio-workspace-sources__diagnostic-list' data-testid={props.testId}>
            {props.diagnostics.map(diagnostic => (
                <li key={`${diagnostic.code}:${diagnostic.message}`}>{diagnostic.message}</li>
            ))}
        </ul>
    );
}

function Modal(props: ModalProps): React.ReactElement {
    return (
        <div className='studio-workspace-sources__modal-backdrop' data-testid={props.testId}>
            <div className='studio-workspace-sources__modal' role='dialog' aria-modal='true'>
                <div className='studio-workspace-sources__modal-header'>
                    <h3>{props.title}</h3>
                    <button className='theia-button secondary' data-testid={`${props.testId}-close`} onClick={props.onClose}>Close</button>
                </div>
                <div className='studio-workspace-sources__modal-body'>
                    {props.children}
                </div>
                <div className='studio-workspace-sources__modal-actions'>
                    {props.actions}
                </div>
            </div>
        </div>
    );
}
