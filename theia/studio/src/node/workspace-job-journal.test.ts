import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceJobJournal } from './workspace-job-journal';

describe('workspace job journal', () => {
    let tempDir: string;
    let sourceRoot: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-job-journal-'));
        sourceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(sourceRoot);
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('replays persisted state and monotonic deltas', async () => {
        const journal = createJournal();
        await journal.initialize();

        const queued = await journal.appendSnapshot(job('job-1', 'key-1', 'source-a', 'batch-1', 'queued', 'queued'));
        await journal.appendSnapshot({
            ...queued,
            state: 'running',
            phase: 'syncing-sources',
            updatedAt: '2026-07-29T00:00:01.000Z',
            progress: { completedSources: 0, totalSources: 2, activeSourceId: 'source-a' }
        }, queued.createdAt, queued.createdSequence);
        await journal.appendSnapshot(job('job-2', 'key-2', 'source-b', 'batch-1', 'completed', 'completed'));

        const replayed = createJournal();
        await replayed.initialize();

        expect(replayed.getLastSequence()).toBe(3);
        expect(replayed.getJob('job-1')).toMatchObject({
            jobId: 'job-1',
            state: 'running',
            phase: 'syncing-sources',
            createdSequence: 1,
            lastSequence: 2
        });
        expect(replayed.getDeltaAfter(1).events.map(event => event.sequence)).toEqual([2, 3]);
        expect(replayed.getBatch('batch-1')).toMatchObject({
            totalSources: 2,
            runningSources: 1,
            completedSources: 1,
            state: 'running'
        });
    });

    it('ignores only a trailing truncated record', async () => {
        const journal = createJournal();
        await journal.initialize();
        await journal.appendSnapshot(job('job-1', 'key-1', 'source-a', 'batch-1', 'queued', 'queued'));
        await fs.appendFile(journal.getJournalPath(), '{"broken"', 'utf8');

        const replayed = createJournal();
        await replayed.initialize();

        expect(replayed.getLastSequence()).toBe(1);
        expect(replayed.getCurrentJobs()).toHaveLength(1);
    });

    it('fails closed on corruption and sequence gaps', async () => {
        const journal = createJournal();
        await journal.initialize();
        await journal.appendSnapshot(job('job-1', 'key-1', 'source-a', 'batch-1', 'queued', 'queued'));
        await journal.appendSnapshot(job('job-2', 'key-2', 'source-b', 'batch-1', 'queued', 'queued'));

        const journalPath = journal.getJournalPath();
        const lines = (await fs.readFile(journalPath, 'utf8')).split('\n').filter(Boolean);
        await fs.writeFile(journalPath, `${lines[0]}\n{not-json}\n${lines[1]}\n`, 'utf8');

        await expect(createJournal().initialize()).rejects.toThrow('corrupted before the trailing record');

        const parsedSecond = JSON.parse(lines[1]) as { sequence: number };
        parsedSecond.sequence = 4;
        await fs.writeFile(journalPath, `${lines[0]}\n${JSON.stringify(parsedSecond)}\n`, 'utf8');

        await expect(createJournal().initialize()).rejects.toThrow('sequence gap');
    });

    it('rejects idempotency collisions with different scope', async () => {
        const journal = createJournal();
        await journal.initialize();
        await journal.appendSnapshot(job('job-1', 'same-key', 'source-a', 'batch-1', 'queued', 'queued'));

        expect(() => journal.findExisting({
            kind: 'source-sync',
            batchId: 'batch-1',
            sourceId: 'source-b',
            sourceIds: ['source-a', 'source-b'],
            idempotencyKey: 'same-key'
        })).toThrow('idempotency key conflict');
    });

    it('redacts credential-like content and rejects dataDir inside a source root', async () => {
        const journal = createJournal();
        await journal.initialize();
        const persisted = await journal.appendSnapshot({
            ...job('job-1', 'key-1', 'source-a', 'batch-1', 'failed', 'failed'),
            lastError: {
                code: 'auth-required',
                message: 'token=ghp_secret123 password=hunter2 Bearer abc123',
                sourceId: 'source-a',
                retryable: false
            }
        });

        expect(persisted.lastError?.message).toContain('token=[redacted]');
        expect(persisted.lastError?.message).not.toContain('hunter2');
        expect(() => new WorkspaceJobJournal({
            dataDir: path.join(sourceRoot, '.studio-state'),
            sourceRoots: [sourceRoot]
        })).toThrow('dataDir must be outside');
    });

    it('persists interrupted recovery markers exactly once on replay', async () => {
        const journal = createJournal();
        await journal.initialize();
        await journal.appendSnapshot(job('job-1', 'key-1', 'source-a', 'batch-1', 'running', 'syncing-sources'));

        const replayed = createJournal();
        await replayed.initialize();
        await replayed.markInterruptedOnRecovery();

        expect(replayed.getJob('job-1')).toMatchObject({
            state: 'failed',
            phase: 'failed',
            retry: { recoveryState: 'interrupted' },
            cleanupMarker: { required: true, safe: false }
        });

        const restarted = createJournal();
        await restarted.initialize();
        await restarted.markInterruptedOnRecovery();
        expect(restarted.getEventsAfter(0).map(event => event.job.state)).toEqual(['running', 'failed']);
    });

    function createJournal(): WorkspaceJobJournal {
        return new WorkspaceJobJournal({
            dataDir: path.join(tempDir, 'state'),
            sourceRoots: [sourceRoot]
        });
    }
});

function job(
    jobId: string,
    idempotencyKey: string,
    sourceId: string,
    batchId: string,
    state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'awaiting-confirmation',
    phase: 'queued' | 'preflight' | 'syncing-sources' | 'completed' | 'cancelled' | 'failed' | 'awaiting-confirmation'
) {
    return {
        jobId,
        kind: 'source-sync' as const,
        batchId,
        sourceId,
        sourceIds: ['source-a', 'source-b'],
        idempotencyKey,
        state,
        phase,
        startedAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
        progress: {
            completedSources: state === 'completed' ? 2 : 0,
            totalSources: 2,
            activeSourceId: sourceId
        },
        retry: {
            rootJobId: jobId,
            attempt: 0,
            recoveryState: 'none' as const
        }
    };
}
