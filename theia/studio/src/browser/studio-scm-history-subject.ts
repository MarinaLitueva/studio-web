import type {
    HistoryGraphEntry
} from '@theia/scm/lib/browser/scm-history-graph-model';

export function withHistorySubject(entry: HistoryGraphEntry): HistoryGraphEntry {
    if (entry.item.subject?.trim()) {
        return entry;
    }
    const subject = entry.item.message
        ?.split(/\r?\n/, 1)[0]
        ?.trim() ?? '';
    if (!subject) {
        return entry;
    }
    return {
        ...entry,
        item: {
            ...entry.item,
            subject
        }
    };
}
