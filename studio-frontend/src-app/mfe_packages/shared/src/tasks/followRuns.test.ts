import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunFollower, RUN_MAX_READ_FAILURES, RUN_POLL_INTERVAL_MS } from './followRuns';
import type { RunUpdate } from './runs';
import type { StudioEvent } from './StudioEventsApiService';
import type { StudioRun, StudioRunState } from './StudioTasksApiService';

function taskEvent(runId: string, state: StudioRunState, extra: object = {}): StudioEvent {
  return {
    seq: 1,
    at_ms: 0,
    kind: `task.${state}`,
    subject_type: 'task_run',
    subject_id: runId,
    source: 'studio-tasks',
    payload: { run_id: runId, state, ...extra },
  };
}

function run(id: string, state: StudioRunState): StudioRun {
  return { id, state, progress: null, summary: null, result: null, last_error: null, attempts: 1 } as StudioRun;
}

const notFound = { response: { status: 404 } };
const unavailable = { response: { status: 503 } };

function harness({ connect = 'open' }: { connect?: 'open' | 'refused' } = {}) {
  const stream: { onEvent: ((event: StudioEvent) => void) | null; onComplete: (() => void) | null } = {
    onEvent: null,
    onComplete: null,
  };
  const disconnect = vi.fn();
  const events = {
    streamFrom: vi.fn((_cursor: number) => ({
      connect: (onEvent: (event: StudioEvent) => void, onComplete?: () => void) => {
        stream.onEvent = onEvent;
        stream.onComplete = onComplete ?? null;
        return connect === 'open' ? Promise.resolve('connection-1') : Promise.reject(new Error('refused'));
      },
      disconnect,
    })),
  };
  const read = vi.fn<(runId: string) => Promise<StudioRun>>((runId) => Promise.resolve(run(runId, 'running')));
  const tasks = { run: vi.fn(({ runId }: { runId: string }) => ({ fetch: () => read(runId) })) };
  const updates: RunUpdate[] = [];
  const lost: [string, unknown][] = [];
  const readFailures: number[] = [];
  const follower = createRunFollower({
    events: events as never,
    tasks: tasks as never,
    onRun: (update) => updates.push(update),
    onLost: (runId, error) => lost.push([runId, error]),
    onReadFailed: (_runId, _error, failures) => readFailures.push(failures),
  });
  return { follower, events, stream, disconnect, read, updates, lost, readFailures };
}

describe('createRunFollower', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens one stream at the cursor and reports the task events of the runs it follows', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onEvent?.(taskEvent('r-1', 'running', { phase: 'cloning' }));
    h.stream.onEvent?.(taskEvent('r-other', 'running'));
    h.stream.onEvent?.({ ...taskEvent('r-1', 'running'), kind: 'workspace.created' });

    expect(h.events.streamFrom).toHaveBeenCalledTimes(1);
    expect(h.events.streamFrom).toHaveBeenCalledWith(7);
    expect(h.updates).toEqual([{ runId: 'r-1', state: 'running', phase: 'cloning' }]);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('leaves out of an update what the event did not say', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onEvent?.(taskEvent('r-1', 'running'));

    expect(h.updates[0]).toEqual({ runId: 'r-1', state: 'running' });
    expect(h.updates[0]).not.toHaveProperty('phase');
  });

  it('closes the stream once the last run settles, and reports nothing after it', async () => {
    const h = harness();
    h.follower.follow(['r-1', 'r-2'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onEvent?.(taskEvent('r-1', 'succeeded'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.disconnect).not.toHaveBeenCalled();

    h.stream.onEvent?.(taskEvent('r-2', 'cancelled'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.disconnect).toHaveBeenCalledWith('connection-1');

    h.stream.onEvent?.(taskEvent('r-2', 'running'));
    expect(h.updates.map((u) => [u.runId, u.state])).toEqual([
      ['r-1', 'succeeded'],
      ['r-2', 'cancelled'],
    ]);
  });

  it('reads a run that joins an open stream once, for what it did before, and opens no second stream', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.follower.follow(['r-2'], 9);
    await vi.advanceTimersByTimeAsync(5 * RUN_POLL_INTERVAL_MS);

    expect(h.events.streamFrom).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledWith('r-2');
    expect(h.updates).toEqual([expect.objectContaining({ runId: 'r-2', state: 'running' })]);
  });

  it('ignores a run it already follows', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.events.streamFrom).toHaveBeenCalledTimes(1);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('reads the runs on an interval when there is no cursor, until each settles', async () => {
    const h = harness();
    h.read.mockResolvedValueOnce(run('r-1', 'running')).mockResolvedValueOnce(run('r-1', 'succeeded'));
    h.follower.follow(['r-1'], null);

    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS - 1);
    expect(h.read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(10 * RUN_POLL_INTERVAL_MS);

    expect(h.events.streamFrom).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.updates.map((u) => u.state)).toEqual(['running', 'succeeded']);
  });

  it('falls back to reading on an interval when the stream ends', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onComplete?.();
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);

    expect(h.read).toHaveBeenCalledWith('r-1');
    // A run joining now is read with the rest, not on a new stream.
    h.follower.follow(['r-2'], 9);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    expect(h.events.streamFrom).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledWith('r-2');
  });

  it('falls back to reading on an interval when the stream cannot open', async () => {
    const h = harness({ connect: 'refused' });
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);

    expect(h.read).toHaveBeenCalledWith('r-1');
  });

  it('gives a run up at once when the gear does not know it', async () => {
    const h = harness();
    h.read.mockRejectedValue(notFound);
    h.follower.follow(['r-1'], null);
    await vi.advanceTimersByTimeAsync(5 * RUN_POLL_INTERVAL_MS);

    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.lost).toEqual([['r-1', notFound]]);
    expect(h.readFailures).toEqual([]);
  });

  it(`gives a run up after ${RUN_MAX_READ_FAILURES} failed reads in a row, and a good read resets the count`, async () => {
    const h = harness();
    h.read
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce(run('r-1', 'running'))
      .mockRejectedValue(unavailable);
    h.follower.follow(['r-1'], null);
    await vi.advanceTimersByTimeAsync((RUN_MAX_READ_FAILURES + 5) * RUN_POLL_INTERVAL_MS);

    expect(h.readFailures).toEqual([1, 1, 2, 3, 4, 5]);
    expect(h.lost).toEqual([['r-1', unavailable]]);
    expect(h.read).toHaveBeenCalledTimes(RUN_MAX_READ_FAILURES + 2);
  });

  it('stop closes the stream and reports nothing more', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.follower.stop();
    await vi.advanceTimersByTimeAsync(0);
    h.stream.onEvent?.(taskEvent('r-1', 'succeeded'));

    expect(h.disconnect).toHaveBeenCalledWith('connection-1');
    expect(h.updates).toEqual([]);
  });

  it('stop ends the reads on an interval', async () => {
    const h = harness();
    h.follower.follow(['r-1'], null);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    h.follower.stop();
    await vi.advanceTimersByTimeAsync(10 * RUN_POLL_INTERVAL_MS);

    expect(h.read).toHaveBeenCalledTimes(1);
  });
});
