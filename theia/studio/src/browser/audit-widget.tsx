import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct, LazyServiceIdentifier } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/lib/browser/widgets/widget';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { AuditFrontendController } from './audit-controller';
import type { StudioAuditEntry } from '../common/studio-protocol';

export type AuditFilter = 'all' | 'modified' | 'committed' | 'pushing' | 'pushed' | 'pending' | 'failed' | 'blocked';
export type AuditOutcome = Exclude<AuditFilter, 'all'>;

export interface AuditEntryViewModel {
    readonly sequence: number;
    readonly relativePath: string;
    readonly contentHash: string;
    readonly sha: string;
    readonly time: string;
    readonly outcome: AuditOutcome;
}

export const AUDIT_FILTERS: ReadonlyArray<{ id: AuditFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'modified', label: 'Modified' },
    { id: 'committed', label: 'Committed' },
    { id: 'pushing', label: 'Pushing' },
    { id: 'pushed', label: 'Pushed' },
    { id: 'pending', label: 'Pending' },
    { id: 'failed', label: 'Failed' },
    { id: 'blocked', label: 'Blocked' }
] as const;

@injectable()
export class AuditWidget extends ReactWidget {
    static readonly ID = 'studio:audit';
    static readonly LABEL = 'Audit';

    @inject(new LazyServiceIdentifier(() => AuditFrontendController))
    protected readonly controller: AuditFrontendController;

    protected activeFilter: AuditFilter = 'all';

    @postConstruct()
    protected init(): void {
        this.id = AuditWidget.ID;
        this.title.label = AuditWidget.LABEL;
        this.title.caption = AuditWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-history';
        this.toDispose.push(this.controller.onDidChange(() => this.update()));
        this.node.tabIndex = 0;
        this.update();
    }

    setFilter(filter: AuditFilter): void {
        if (this.activeFilter === filter) {
            return;
        }
        this.activeFilter = filter;
        this.update();
    }

    getFilter(): AuditFilter {
        return this.activeFilter;
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected render(): React.ReactNode {
        const entries = this.getVisibleEntries();
        const counts = this.getCounts();
        return (
            <div className='studio-audit' data-testid='audit-widget'>
                <header className='studio-audit__header'>
                    <div>
                        <div className='studio-audit__eyebrow'>Sanitized browser audit</div>
                        <h2>Audit</h2>
                    </div>
                    <div className='studio-audit__summary' data-testid='audit-summary'>
                        <span>{counts.total} entries</span>
                        <span>{counts.latestTime ?? 'No activity yet'}</span>
                    </div>
                </header>
                <nav className='studio-audit__filters' aria-label='Audit filters' data-testid='audit-filters'>
                    {AUDIT_FILTERS.map(filter => {
                        const active = this.activeFilter === filter.id;
                        return (
                            <button
                                key={filter.id}
                                className={`theia-button secondary studio-audit__filter${active ? ' studio-audit__filter--active' : ''}`}
                                data-testid={`audit-filter-${filter.id}`}
                                aria-pressed={active}
                                onClick={() => this.setFilter(filter.id)}
                            >
                                <span>{filter.label}</span>
                                <span className='studio-audit__filter-count' data-testid={`audit-badge-${filter.id}`}>
                                    {counts.byFilter.get(filter.id) ?? 0}
                                </span>
                            </button>
                        );
                    })}
                </nav>
                <div className='studio-audit__list' data-testid='audit-list'>
                    {entries.length === 0 ? (
                        <div className='studio-audit__empty' data-testid='audit-empty'>No matching audit entries.</div>
                    ) : entries.map(entry => (
                        <article
                            key={`${entry.sequence}:${entry.relativePath}:${entry.contentHash}`}
                            className='studio-audit__row'
                            data-testid={`audit-row-${entry.sequence}`}
                        >
                            <div className='studio-audit__row-top'>
                                <div className='studio-audit__path-group'>
                                    <span className='studio-audit__sequence'>#{entry.sequence}</span>
                                    <span className='studio-audit__path'>{entry.relativePath}</span>
                                </div>
                                <span
                                    className={`studio-status-badge studio-status-badge--${entry.outcome}`}
                                    data-testid={`audit-outcome-${entry.sequence}`}
                                >
                                    {formatOutcomeLabel(entry.outcome)}
                                </span>
                            </div>
                            <dl className='studio-audit__meta'>
                                <div>
                                    <dt>Hash</dt>
                                    <dd>{entry.contentHash}</dd>
                                </div>
                                <div>
                                    <dt>SHA</dt>
                                    <dd>{entry.sha}</dd>
                                </div>
                                <div>
                                    <dt>Time</dt>
                                    <dd>{entry.time}</dd>
                                </div>
                            </dl>
                        </article>
                    ))}
                </div>
            </div>
        );
    }

    protected getVisibleEntries(): AuditEntryViewModel[] {
        const entries = this.getAuditEntries();
        if (this.activeFilter === 'all') {
            return entries;
        }
        return entries.filter(entry => entry.outcome === this.activeFilter);
    }

    protected getCounts(): { total: number; latestTime?: string; byFilter: Map<AuditFilter, number> } {
        const entries = this.getAuditEntries();
        const byFilter = new Map<AuditFilter, number>(AUDIT_FILTERS.map(filter => [filter.id, 0]));
        for (const entry of entries) {
            byFilter.set(entry.outcome, (byFilter.get(entry.outcome) ?? 0) + 1);
        }
        return {
            total: entries.length,
            latestTime: entries[0]?.time,
            byFilter: byFilter.set('all', entries.length)
        };
    }

    protected getAuditEntries(): AuditEntryViewModel[] {
        return this.controller.getEntries().map(toViewModel);
    }
}

function toViewModel(entry: StudioAuditEntry): AuditEntryViewModel {
    return {
        sequence: entry.sequence,
        relativePath: entry.relativePath,
        contentHash: entry.contentHash,
        sha: entry.sha || 'Unavailable',
        time: entry.time,
        outcome: entry.outcome
    };
}

function formatOutcomeLabel(outcome: AuditOutcome): string {
    switch (outcome) {
        case 'modified':
            return 'Modified';
        case 'committed':
            return 'Committed';
        case 'pushing':
            return 'Pushing';
        case 'pushed':
            return 'Pushed';
        case 'pending':
            return 'Pending';
        case 'failed':
            return 'Failed';
        case 'blocked':
            return 'Blocked';
        default:
            return 'Modified';
    }
}
