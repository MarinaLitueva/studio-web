import { injectable } from '@theia/core/shared/inversify';
import { DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import {
    type StudioAuditEntry,
    type StudioRuntimeClient
} from '../common/studio-protocol';

type StudioAuditRuntimeProxy = Pick<StudioRuntimeClient, 'onAuditEvent'> & {
    getAuditDeltas(request: { afterSequence: number }): Promise<{ lastSequence: number; entries: readonly StudioAuditEntry[] }>;
    onDidOpenConnection?: (listener: () => void) => { dispose(): void };
    onDidCloseConnection?: (listener: () => void) => { dispose(): void };
};

const MAX_RETAINED_AUDIT_ENTRIES = 200;

@injectable()
export class AuditFrontendController implements FrontendApplicationContribution, Pick<StudioRuntimeClient, 'onAuditEvent'> {
    protected runtime: StudioAuditRuntimeProxy | undefined;

    protected readonly entries = new Map<number, StudioAuditEntry>();
    protected entryOrder: number[] = [];
    protected lastSequence = 0;
    protected readonly onDidChangeEmitter = new Emitter<void>();
    protected readonly toDispose = new DisposableCollection(this.onDidChangeEmitter);

    get onDidChange(): Event<void> {
        return this.onDidChangeEmitter.event;
    }

    bindRuntime(runtime: StudioAuditRuntimeProxy): void {
        if (this.runtime === runtime) {
            return;
        }
        this.runtime = runtime;
        const opened = runtime.onDidOpenConnection?.(() => {
            void this.refreshInBackground();
        });
        const closed = runtime.onDidCloseConnection?.(() => {
            this.onDidChangeEmitter.fire();
        });
        if (opened) {
            this.toDispose.push(opened);
        }
        if (closed) {
            this.toDispose.push(closed);
        }
    }

    async onStart(): Promise<void> {
        await this.refresh();
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    onAuditEvent(entry: StudioAuditEntry): void {
        this.applyEntry(entry);
    }

    getEntries(): readonly StudioAuditEntry[] {
        return this.entryOrder
            .map(sequence => this.entries.get(sequence))
            .filter((entry): entry is StudioAuditEntry => Boolean(entry));
    }

    protected async refresh(): Promise<void> {
        const delta = await this.runtime?.getAuditDeltas({ afterSequence: this.lastSequence });
        if (!delta) {
            return;
        }
        for (const entry of delta.entries) {
            this.applyEntry(entry);
        }
        this.lastSequence = Math.max(this.lastSequence, delta.lastSequence);
        this.onDidChangeEmitter.fire();
    }

    protected async refreshInBackground(): Promise<void> {
        try {
            await this.refresh();
        } catch {
            // Git operations controller already surfaces runtime health.
        }
    }

    protected applyEntry(entry: StudioAuditEntry): void {
        if (entry.sequence <= this.lastSequence || this.entries.has(entry.sequence)) {
            return;
        }
        this.entries.set(entry.sequence, entry);
        this.entryOrder = [entry.sequence, ...this.entryOrder].slice(0, MAX_RETAINED_AUDIT_ENTRIES);
        const retained = new Set(this.entryOrder);
        for (const sequence of [...this.entries.keys()]) {
            if (!retained.has(sequence)) {
                this.entries.delete(sequence);
            }
        }
        this.lastSequence = entry.sequence;
        this.onDidChangeEmitter.fire();
    }
}
