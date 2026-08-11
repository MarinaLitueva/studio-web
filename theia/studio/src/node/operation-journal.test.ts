import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { OperationJournal } from './operation-journal';

describe('operation journal', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-journal-'));
        await fs.mkdir(path.join(tempDir, 'repo'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('replays persisted state and monotonic deltas', async () => {
        const journal = createJournal();
        await journal.initialize();

        await journal.appendTransition(scope('key-1', 'a.txt', 'hash-a'), 'op-1', 'queued', '2026-07-27T00:00:00.000Z');
        await journal.appendTransition(scope('key-1', 'a.txt', 'hash-a'), 'op-1', 'validating', '2026-07-27T00:00:01.000Z');
        await journal.appendTransition(scope('key-1', 'a.txt', 'hash-a'), 'op-1', 'no-changes', '2026-07-27T00:00:02.000Z');
        await journal.appendTransition(scope('key-2', 'b.txt', 'hash-b'), 'op-2', 'pushed', '2026-07-27T00:00:03.000Z', undefined, 'a'.repeat(40));

        const replayed = createJournal();
        await replayed.initialize();

        expect(replayed.getLastSequence()).toBe(4);
        expect(replayed.getOperation('op-1')).toEqual({
            journalSchemaVersion: 2,
            operationId: 'op-1',
            workspaceId: 'workspace-1',
            repositoryId: 'repository-1',
            repositoryFingerprint: 'fingerprint-1',
            repositoryConfigRevision: 'config-1',
            relativePath: 'a.txt',
            repositoryRelativePath: 'a.txt',
            languageId: 'markdown',
            contentHash: 'hash-a',
            idempotencyKey: 'key-1',
            savedAt: '2026-07-27T00:00:00.000Z',
            state: 'no-changes',
            createdAt: '2026-07-27T00:00:00.000Z',
            updatedAt: '2026-07-27T00:00:02.000Z',
            createdSequence: 1,
            lastSequence: 3
        });
        expect(replayed.getOperation('op-2')?.commitSha).toBe('a'.repeat(40));
        expect(replayed.getEventsAfter(1).map(event => event.sequence)).toEqual([2, 3, 4]);
        const auditEntries = replayed.getAuditEntriesAfter(0).entries;
        expect(auditEntries[auditEntries.length - 1]).toEqual({
            sequence: 4,
            relativePath: 'b.txt',
            contentHash: 'invalid',
            sha: 'a'.repeat(40),
            time: '2026-07-27T00:00:03.000Z',
            outcome: 'pushed'
        });
    });

    it('finds existing requests by idempotency scope and rejects mismatched reuse', async () => {
        const journal = createJournal();
        await journal.initialize();
        await journal.appendTransition(scope('key-1', 'a.txt', 'hash-a'), 'op-1', 'queued', '2026-07-27T00:00:00.000Z');

        expect(journal.findExisting(scope('key-1', 'a.txt', 'hash-a'))?.operationId).toBe('op-1');
        expect(journal.findExisting({
            ...scope('key-1', 'a.txt', 'hash-a'),
            savedAt: '2026-07-27T00:00:10.000Z'
        })?.savedAt).toBe('2026-07-27T00:00:00.000Z');
        expect(() => journal.findExisting(scope('key-1', 'b.txt', 'hash-a'))).toThrow('Idempotency key conflict');
    });

    it('ignores only a trailing corrupt record', async () => {
        const journal = createJournal();
        await journal.initialize();
        await journal.appendTransition(scope('key-1', 'a.txt', 'hash-a'), 'op-1', 'queued', '2026-07-27T00:00:00.000Z');
        await fs.appendFile(journal.getJournalPath(), '{"bad-json"\n', 'utf8');

        const replayed = createJournal();
        await replayed.initialize();

        expect(replayed.getLastSequence()).toBe(1);
        expect(replayed.getEventsAfter(0)).toHaveLength(1);
    });

    it('fails closed on corruption in the middle of the log', async () => {
        const journal = createJournal();
        await journal.initialize();
        await journal.appendTransition(scope('key-1', 'a.txt', 'hash-a'), 'op-1', 'queued', '2026-07-27T00:00:00.000Z');
        await journal.appendTransition(scope('key-1', 'a.txt', 'hash-a'), 'op-1', 'validating', '2026-07-27T00:00:01.000Z');

        const filePath = journal.getJournalPath();
        const lines = (await fs.readFile(filePath, 'utf8')).split('\n').filter(Boolean);
        await fs.writeFile(filePath, `${lines[0]}\n{not-json}\n${lines[1]}\n`, 'utf8');

        const replayed = createJournal();
        await expect(replayed.initialize()).rejects.toThrow('corrupted before the trailing record');
    });

    it('serializes concurrent appends and rejects repository-local storage', async () => {
        const journal = createJournal();
        await Promise.all([
            journal.appendTransition(scope('key-1', 'a.txt', 'hash-a'), 'op-1', 'queued', '2026-07-27T00:00:00.000Z'),
            journal.appendTransition(scope('key-2', 'b.txt', 'hash-b'), 'op-2', 'queued', '2026-07-27T00:00:00.000Z')
        ]);

        expect(journal.getEventsAfter(0).map(event => event.sequence)).toEqual([1, 2]);
        expect(() => new OperationJournal({
            dataDir: path.join(tempDir, 'repo', '.studio'),
            repositoryRoot: path.join(tempDir, 'repo')
        })).toThrow('STUDIO_DATA_DIR must be outside');
    });

    it('persists a compensating blocked delta for legacy nonterminal operations exactly once', async () => {
        const journal = createJournal();
        await journal.initialize();
        await fs.appendFile(journal.getJournalPath(), `${JSON.stringify({
            sequence: 1,
            operationId: 'legacy-op',
            state: 'push-pending',
            timestamp: '2026-07-27T00:00:00.000Z',
            workspaceId: 'workspace-1',
            relativePath: 'a.txt',
            repositoryRelativePath: 'a.txt',
            languageId: 'markdown',
            contentHash: 'hash-a',
            idempotencyKey: 'legacy-key',
            savedAt: '2026-07-27T00:00:00.000Z'
        })}\n`);

        const replayed = createJournal();
        await replayed.initialize();

        expect(replayed.getEventsAfter(0).map(event => event.state)).toEqual([
            'push-pending',
            'blocked'
        ]);
        expect(replayed.getOperation('legacy-op')).toMatchObject({
            journalSchemaVersion: 1,
            state: 'blocked',
            lastSequence: 2,
            failureReason: expect.stringContaining('repository identity is missing')
        });

        const restarted = createJournal();
        await restarted.initialize();
        expect(restarted.getEventsAfter(0).map(event => event.state)).toEqual([
            'push-pending',
            'blocked'
        ]);
        expect(restarted.getLastSequence()).toBe(2);
    });

    function createJournal(): OperationJournal {
        return new OperationJournal({
            dataDir: path.join(tempDir, 'data'),
            repositoryRoot: path.join(tempDir, 'repo')
        });
    }
});

function scope(idempotencyKey: string, relativePath: string, contentHash: string) {
    return {
        journalSchemaVersion: 2 as const,
        workspaceId: 'workspace-1',
        repositoryId: 'repository-1',
        repositoryFingerprint: 'fingerprint-1',
        repositoryConfigRevision: 'config-1',
        relativePath,
        repositoryRelativePath: relativePath,
        languageId: 'markdown' as const,
        contentHash,
        idempotencyKey,
        savedAt: '2026-07-27T00:00:00.000Z'
    };
}
