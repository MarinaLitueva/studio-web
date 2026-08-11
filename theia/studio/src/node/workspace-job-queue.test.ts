import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceJobJournal } from './workspace-job-journal';
import {
    WorkspaceJobQueue,
    type WorkspaceJobExecutor
} from './workspace-job-queue';

describe('workspace job queue', () => {
    let tempDir: string;
    let sourceRoots: string[];

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-job-queue-'));
        sourceRoots = [
            path.join(tempDir, 'source-a'),
            path.join(tempDir, 'source-b'),
            path.join(tempDir, 'source-c')
        ];
        await Promise.all(sourceRoots.map(root => fs.mkdir(root)));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('reuses identical idempotent requests and rejects conflicting scope reuse', async () => {
        const queue = createQueue({
            execute: async () => ({ outcome: 'completed' })
        });
        await queue.initialize();

        const first = await queue.enqueue({
            kind: 'source-sync',
            sourceId: 'source-a',
            idempotencyKey: 'same-key'
        });
        const duplicate = await queue.enqueue({
            kind: 'source-sync',
            sourceId: 'source-a',
            idempotencyKey: 'same-key'
        });
        await queue.whenIdle();

        expect(duplicate.reusedExisting).toBe(true);
        expect(duplicate.job.jobId).toBe(first.job.jobId);
        await expect(queue.enqueue({
            kind: 'source-sync',
            sourceId: 'source-b',
            sourceIds: ['source-b'],
            idempotencyKey: 'same-key'
        })).rejects.toThrow('idempotency key conflict');
    });

    it('preserves per-source ordering while running different sources concurrently', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const started: string[] = [];
        const finished: string[] = [];
        const queue = createQueue({
            execute: async job => {
                started.push(job.sourceId);
                if (started.length === 2) {
                    release();
                }
                await gate;
                finished.push(job.jobId);
                return { outcome: 'completed' };
            }
        }, 2);
        await queue.initialize();

        const firstA = await queue.enqueue({ kind: 'source-sync', sourceId: 'source-a', idempotencyKey: 'a-1' });
        const firstB = await queue.enqueue({ kind: 'source-sync', sourceId: 'source-b', idempotencyKey: 'b-1' });
        const secondA = await queue.enqueue({ kind: 'source-sync', sourceId: 'source-a', idempotencyKey: 'a-2' });

        await queue.whenIdle();

        expect(new Set(started.slice(0, 2))).toEqual(new Set(['source-a', 'source-b']));
        expect(finished.indexOf(firstA.job.jobId)).toBeLessThan(finished.indexOf(secondA.job.jobId));
        expect(firstB.job.sourceId).toBe('source-b');
    });

    it('aggregates batch partial success without rolling back completed sources', async () => {
        const queue = createQueue({
            execute: async job => {
                if (job.sourceId === 'source-b') {
                    return {
                        outcome: 'failed',
                        error: {
                            code: 'network',
                            message: 'temporary network issue',
                            sourceId: job.sourceId,
                            retryable: true
                        },
                        cleanupRequired: true,
                        cleanupSafe: false
                    };
                }
                return { outcome: 'completed' };
            }
        });
        await queue.initialize();

        const response = await queue.enqueueBatch({
            kind: 'source-sync',
            sourceIds: ['source-a', 'source-b'],
            idempotencyKey: 'batch-key',
            batchId: 'batch-1'
        });
        await queue.whenIdle();

        const batch = queue.getBatch('batch-1')!;
        expect(response.batch.batchId).toBe('batch-1');
        expect(batch.completedSources).toBe(1);
        expect(batch.failedSources).toBe(1);
        expect(batch.state).toBe('failed');
        expect(queue.getJob(response.jobs[0]!.jobId)?.state).toBe('completed');
    });

    it('cancels queued jobs immediately and active jobs through abort', async () => {
        let resolveActive: () => void = () => undefined;
        const queue = createQueue({
            execute: async (_job, context) => {
                await context.report({
                    phase: 'syncing-sources',
                    cleanupRequired: true,
                    cleanupSafe: false,
                    cleanupReason: 'mid-sync'
                });
                await new Promise<void>(resolve => {
                    resolveActive = resolve;
                    context.signal.addEventListener('abort', () => resolve(), { once: true });
                });
                return { outcome: 'cancelled', cleanupRequired: true, cleanupSafe: false, cleanupReason: 'mid-sync' };
            }
        }, 1);
        await queue.initialize();

        const active = await queue.enqueue({ kind: 'source-sync', sourceId: 'source-a', idempotencyKey: 'active' });
        const queued = await queue.enqueue({ kind: 'source-sync', sourceId: 'source-a', idempotencyKey: 'queued' });

        const cancelledQueued = await queue.cancel(queued.job.jobId);
        await queue.cancel(active.job.jobId);
        resolveActive();
        await queue.whenIdle();

        expect(cancelledQueued.state).toBe('cancelled');
        expect(queue.getJob(active.job.jobId)).toMatchObject({
            state: 'cancelled',
            cleanupMarker: { required: true, safe: false }
        });
    });

    it('marks interrupted running jobs on recovery and retries with lineage', async () => {
        const journal = createJournal();
        const seedQueue = new WorkspaceJobQueue(journal, {
            execute: async () => {
                throw new Error('should not run');
            }
        });
        await journal.initialize();
        await journal.appendSnapshot({
            jobId: 'job-1',
            kind: 'source-sync',
            batchId: 'batch-1',
            sourceId: 'source-a',
            sourceIds: ['source-a'],
            idempotencyKey: 'seed-key',
            state: 'running',
            phase: 'syncing-sources',
            startedAt: '2026-07-29T00:00:00.000Z',
            updatedAt: '2026-07-29T00:00:00.000Z',
            progress: { completedSources: 0, totalSources: 1, activeSourceId: 'source-a' },
            cleanupMarker: { required: true, safe: false, reason: 'syncing', updatedAt: '2026-07-29T00:00:00.000Z' },
            retry: { rootJobId: 'job-1', attempt: 0, recoveryState: 'none' }
        });
        void seedQueue;

        const attempts: string[] = [];
        const replayed = new WorkspaceJobQueue(createJournal(), {
            execute: async job => {
                attempts.push(job.retry.recoveryState);
                return { outcome: 'completed' };
            }
        });
        await replayed.initialize();

        const interrupted = replayed.getJob('job-1')!;
        expect(interrupted.state).toBe('failed');
        expect(interrupted.retry.recoveryState).toBe('interrupted');

        const retried = await replayed.retry('job-1');
        await replayed.whenIdle();

        expect(retried.jobId).not.toBe('job-1');
        expect(replayed.getJob(retried.jobId)).toMatchObject({
            state: 'completed',
            retry: {
                rootJobId: 'job-1',
                retryOfJobId: 'job-1',
                attempt: 1,
                recoveryState: 'recovered'
            }
        });
        expect(attempts).toEqual(['recovered']);
    });

    it('does not auto-retry auth or force confirmation failures', async () => {
        const queue = createQueue({
            execute: async job => ({
                outcome: 'failed',
                error: {
                    code: job.sourceId === 'source-a' ? 'auth-required' : 'force-required',
                    message: 'manual confirmation required',
                    sourceId: job.sourceId,
                    retryable: false
                }
            })
        });
        await queue.initialize();

        const authJob = await queue.enqueue({ kind: 'source-sync', sourceId: 'source-a', idempotencyKey: 'auth' });
        await queue.whenIdle();
        await expect(queue.retry(authJob.job.jobId)).rejects.toThrow('manual intervention');
    });

    it('replays monotonic events and sanitizes persisted errors', async () => {
        const seen: number[] = [];
        const queue = createQueue({
            execute: async (_job, context) => {
                await context.report({
                    phase: 'syncing-sources',
                    progress: { completedSources: 0, totalSources: 1, activeSourceId: 'source-a' }
                });
                return {
                    outcome: 'failed',
                    error: {
                        code: 'execution-error',
                        message: 'token=ghp_secret123 password=hunter2',
                        sourceId: 'source-a',
                        retryable: true
                    }
                };
            }
        });
        await queue.initialize();
        queue.subscribe(event => {
            seen.push(event.sequence);
        });

        const enqueued = await queue.enqueue({ kind: 'source-sync', sourceId: 'source-a', idempotencyKey: 'redact' });
        await queue.whenIdle();

        const delta = queue.getEventsAfter(1);
        expect(delta.events.every((event, index, events) => index === 0 || event.sequence > events[index - 1]!.sequence)).toBe(true);
        expect(seen).toEqual([1, 2, 3, 4]);
        expect(queue.getJob(enqueued.job.jobId)?.lastError?.message).toBe('token=[redacted] password=[redacted]');

        const replayed = createQueue({
            execute: async () => ({ outcome: 'completed' })
        });
        await replayed.initialize();
        expect(replayed.getEventsAfter(2).events.map(event => event.sequence)).toEqual([3, 4]);
    });

    function createQueue(executor: WorkspaceJobExecutor, concurrency = 3): WorkspaceJobQueue {
        return new WorkspaceJobQueue(createJournal(), executor, concurrency);
    }

    function createJournal(): WorkspaceJobJournal {
        return new WorkspaceJobJournal({
            dataDir: path.join(tempDir, 'state'),
            sourceRoots
        });
    }
});
