import { withHistorySubject } from './studio-scm-history-subject';
import type { HistoryGraphEntry } from '@theia/scm/lib/browser/scm-history-graph-model';

function entry(subject: string, message?: string): HistoryGraphEntry {
    return {
        item: {
            id: 'abc123',
            parentIds: [],
            subject,
            message
        },
        graphRow: {
            lane: 0,
            color: 0,
            edges: [],
            hasContinuation: false,
            hasTopLine: false
        }
    };
}

describe('Studio SCM history graph compatibility', () => {
    it('uses the first commit-message line when the provider omits subject', () => {
        expect(withHistorySubject(entry('', 'chore(studio): save README.md\n\nSaved-At: now')).item.subject)
            .toBe('chore(studio): save README.md');
    });

    it('accepts the actual VS Code 1.95 payload with no subject property', () => {
        const original = entry('', 'fix: visible title');
        const { subject: _subject, ...itemWithoutSubject } = original.item;
        const actualProviderEntry = {
            ...original,
            item: itemWithoutSubject
        } as unknown as HistoryGraphEntry;

        expect(withHistorySubject(actualProviderEntry).item.subject)
            .toBe('fix: visible title');
    });

    it('preserves a provider-supplied subject', () => {
        const original = entry('Provider subject', 'Different message');
        expect(withHistorySubject(original)).toBe(original);
    });
});
