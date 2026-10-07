/**
 * Follows `studio-tasks` runs on the tenant's event stream until each settles.
 * Runs are read on an interval only while the stream cannot say.
 */

import { isNotFound } from '../errors/notFound';
import type { StudioEventsApiService } from './StudioEventsApiService';
import type { StudioTasksApiService } from './StudioTasksApiService';
import { isRunSettled, runUpdateFromEvent, runUpdateFromRun, type RunUpdate } from './runs';

export const RUN_POLL_INTERVAL_MS = 2_000;

export const RUN_MAX_READ_FAILURES = 5;

export interface RunFollowerOptions {
  events: Pick<StudioEventsApiService, 'streamFrom'>;
  tasks: Pick<StudioTasksApiService, 'run'>;
  onRun: (update: RunUpdate) => void;
  /** The gear does not know the run, or `RUN_MAX_READ_FAILURES` reads in a row failed; it is no longer followed. */
  onLost: (runId: string, error: unknown) => void;
  /** A read failed; `failures` counts them in a row. */
  onReadFailed?: (runId: string, error: unknown, failures: number) => void;
}

export interface RunFollower {
  /**
   * Follows these runs too. A stream not yet open starts at `cursor`, read
   * before the runs were started; `null` reads them on an interval instead.
   * A run that joins an open stream is read once, for what it did before.
   */
  follow(runIds: readonly string[], cursor: number | null): void;
  /** Follows nothing more, and closes the stream. */
  stop(): void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createRunFollower(options: RunFollowerOptions): RunFollower {
  const followed = new Set<string>();
  const failures = new Map<string, number>();
  let stream: ReturnType<StudioEventsApiService['streamFrom']> | null = null;
  let connection: Promise<string> | null = null;
  let polling = false;

  const close = (): void => {
    const open = stream;
    const id = connection;
    stream = null;
    connection = null;
    if (open && id) void id.then((value) => open.disconnect(value), () => undefined);
  };

  const forget = (runId: string): void => {
    followed.delete(runId);
    failures.delete(runId);
    if (followed.size === 0) close();
  };

  const apply = (update: RunUpdate): void => {
    if (!followed.has(update.runId)) return;
    if (isRunSettled(update.state)) forget(update.runId);
    options.onRun(update);
  };

  const lose = (runId: string, error: unknown): void => {
    if (!followed.has(runId)) return;
    forget(runId);
    options.onLost(runId, error);
  };

  const read = async (runId: string): Promise<void> => {
    try {
      const run = await options.tasks.run({ runId }).fetch({ staleTime: 0 });
      failures.delete(runId);
      apply(runUpdateFromRun(run));
    } catch (error) {
      if (!followed.has(runId)) return;
      if (isNotFound(error)) return lose(runId, error);
      const count = (failures.get(runId) ?? 0) + 1;
      failures.set(runId, count);
      options.onReadFailed?.(runId, error, count);
      if (count >= RUN_MAX_READ_FAILURES) lose(runId, error);
    }
  };

  const poll = async (): Promise<void> => {
    if (polling) return;
    polling = true;
    close();
    while (followed.size > 0) {
      await sleep(RUN_POLL_INTERVAL_MS);
      await Promise.all([...followed].map(read));
    }
    polling = false;
  };

  const fallBack = (from: typeof stream): void => {
    if (stream !== from) return;
    stream = null;
    connection = null;
    void poll();
  };

  return {
    follow(runIds, cursor) {
      const joining = runIds.filter((runId) => !followed.has(runId));
      if (joining.length === 0) return;
      joining.forEach((runId) => followed.add(runId));
      if (polling) return;
      if (stream) {
        joining.forEach((runId) => void read(runId));
        return;
      }
      if (cursor === null) {
        void poll();
        return;
      }
      const opened = options.events.streamFrom(cursor);
      stream = opened;
      connection = opened.connect(
        (event) => {
          const update = runUpdateFromEvent(event);
          if (update) apply(update);
        },
        () => fallBack(opened)
      );
      connection.catch(() => fallBack(opened));
    },

    stop() {
      followed.clear();
      failures.clear();
      close();
    },
  };
}
