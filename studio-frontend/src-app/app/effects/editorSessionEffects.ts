// @cpt-flow:cpt-studiofrontend-flow-editor-session-open:p1
// @cpt-flow:cpt-studiofrontend-flow-editor-session-retry:p1
// @cpt-algo:cpt-studiofrontend-algo-editor-session-launch:p1
// @cpt-algo:cpt-studiofrontend-algo-editor-session-wait:p1
// @cpt-dod:cpt-studiofrontend-dod-editor-session-reuse-or-launch:p1
// @cpt-dod:cpt-studiofrontend-dod-editor-session-ready:p1
// @cpt-dod:cpt-studiofrontend-dod-editor-session-retry:p1
// @cpt-dod:cpt-studiofrontend-dod-editor-session-switch:p1
// @cpt-dod:cpt-studiofrontend-dod-editor-session-address:p1

import { apiRegistry, type FrontXApp } from '@gears-frontx/react';
import {
  AccountsApiService,
  ConnectorsApiService,
  PROJECT_CONFIG_TYPE,
  errorMessage,
  isNotFound,
  parseProblemDetails,
  sessionSources,
  type ProjectConfig,
  type SessionSource,
} from '@constructor-studio/mfe-shared';
import {
  StudioEventsApiService,
  StudioSessionApiService,
  StudioTasksApiService,
  type StudioRun,
  type StudioRunEvent,
  type StudioRunState,
  type StudioSession,
} from '@/app/api';
import { publishFrameUrl } from '@/app/mfe/sharedContext';
import {
  editorSessionFailed,
  editorSessionLaunching,
  editorSessionReady,
  editorSessionReset,
  editorSessionShown,
  readEditorSession,
  type EditorSessionFailure,
} from '@/app/slices/editorSessionSlice';

const POLL_INTERVAL_MS = 2_000;
const RECORD_DEADLINE_MS = 3 * 60_000;

export interface EditorScope {
  projectId: string | null;
  orgId: string | null;
  editor: boolean;
  visit: number;
}

export interface EditorSession {
  sync(scope: EditorScope): void;
  retry(): void;
}

type Outcome = { ready: true } | { ready: false; failure: EditorSessionFailure };
type Launched = { ready: true; url: string } | { ready: false; failure: EditorSessionFailure };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// @cpt-dod:cpt-studiofrontend-dod-editor-session-per-project:p1
export function sessionWorkspaceId(projectId: string): string {
  return projectId;
}

function runOutcome(state: StudioRunState, error: string | null | undefined): Outcome | null {
  if (state === 'succeeded') return { ready: true };
  if (state === 'failed' || state === 'cancelled') {
    return { ready: false, failure: { kind: 'run', error: error ?? null } };
  }
  return null;
}

const RUN_GONE: Outcome = { ready: false, failure: { kind: 'run', error: null } };

function endOf(read: StudioRun | 'gone' | null): Outcome | null {
  if (read === 'gone') return RUN_GONE;
  return read ? runOutcome(read.state, read.last_error) : null;
}


function launchRefusal(error: unknown): EditorSessionFailure {
  return isNotFound(error)
    ? { kind: 'unavailable' }
    : { kind: 'refused', detail: parseProblemDetails(error).detail };
}

export function createEditorSession(app: FrontXApp): EditorSession {
  const dispatch = app.store.dispatch;
  const events = () => apiRegistry.getService(StudioEventsApiService);
  const sessions = () => apiRegistry.getService(StudioSessionApiService);
  const tasks = () => apiRegistry.getService(StudioTasksApiService);

  let project: string | null = null;
  let org: string | null = null;
  let enteredVisit: number | null = null;
  let generation = 0;
  let inFlight = false;
  /** Ends the wait in flight at once, closing its stream. */
  let stopWait: (() => void) | null = null;

  const readCursor = async (): Promise<number | null> => {
    try {
      return (await events().cursor.fetch({ staleTime: 0 })).latest_seq;
    } catch (error) {
      console.warn('[editor-session] no event cursor:', errorMessage(error));
      return null;
    }
  };

  const readRun = async (runId: string): Promise<StudioRun | 'gone' | null> => {
    try {
      return await tasks().run({ runId }).fetch({ staleTime: 0 });
    } catch (error) {
      return isNotFound(error) ? 'gone' : null;
    }
  };

  const readSources = async (projectId: string, orgId: string): Promise<SessionSource[]> => {
    const [config, connections] = await Promise.all([
      apiRegistry
        .getService(AccountsApiService)
        .getTenantMetadata<ProjectConfig>({ tenantId: projectId, metadataType: PROJECT_CONFIG_TYPE })
        .fetch(),
      apiRegistry.getService(ConnectorsApiService).connections({ tenantId: orgId }).fetch(),
    ]);
    return sessionSources(config?.value?.sources ?? [], connections.items);
  };

  /** The run on the stream from `cursor`; read every two seconds when the stream cannot answer */
  const waitForRun = (runId: string, cursor: number | null, superseded: () => boolean): Promise<Outcome | null> =>
    new Promise((resolve) => {
      const stream = cursor === null ? null : events().streamFrom(cursor);
      let connection: Promise<string> | null = null;
      let settled = false;
      let polling = false;
      const settle = (outcome: Outcome | null): void => {
        if (settled) return;
        settled = true;
        if (stopWait === stop) stopWait = null;
        if (stream && connection) void connection.then((id) => stream.disconnect(id), () => undefined);
        resolve(outcome);
      };
      const stop = (): void => settle(null);
      stopWait = stop;

      const answer = (state: StudioRunState, error: string | null | undefined): void => {
        // A late event or read, after the answer or a switch, is nobody's.
        if (settled) return;
        if (superseded()) return settle(null);
        const outcome = runOutcome(state, error);
        if (outcome) settle(outcome);
      };

      const poll = async (): Promise<void> => {
        if (polling) return;
        polling = true;
        while (!settled) {
          await sleep(POLL_INTERVAL_MS);
          if (settled) return;
          const run = await readRun(runId);
          if (run === 'gone') settle(RUN_GONE);
          else if (run) answer(run.state, run.last_error);
        }
      };

      if (!stream) {
        void poll();
        return;
      }
      connection = stream.connect(
        (event) => {
          if (!event.kind.startsWith('task.') || event.subject_id !== runId) return;
          const run = event.payload as StudioRunEvent;
          answer(run.state, run.error);
        },
        () => void poll()
      );
      connection.catch(() => void poll());
    });

  const waitForRecord = async (sessionId: string, superseded: () => boolean): Promise<Outcome | null> => {
    const deadline = Date.now() + RECORD_DEADLINE_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      if (superseded()) return null;
      try {
        // The read itself probes the container.
        const record = await sessions().session({ sessionId }).fetch({ staleTime: 0 });
        if (record.state === 'running') return { ready: true };
        if (record.state === 'stopped') return { ready: false, failure: { kind: 'stopped' } };
      } catch (error) {
        if (isNotFound(error)) return { ready: false, failure: { kind: 'stopped' } };
      }
    }
    return { ready: false, failure: { kind: 'timeout' } };
  };

  const followRun = async (
    runId: string,
    cursor: number | null,
    retrying: boolean,
    superseded: () => boolean
  ): Promise<Outcome | null> => {
    const ended = endOf(await readRun(runId));
    if (superseded()) return null;
    if (!ended) return waitForRun(runId, cursor, superseded);
    if (ended.ready || !retrying || ended === RUN_GONE) return ended;

    const from = await readCursor();
    if (superseded()) return null;
    try {
      await tasks().retry(runId).fetch(undefined);
    } catch {
      // Refused: somebody else put it back, or it ended meanwhile. The run says which.
      const now = await readRun(runId);
      if (superseded()) return null;
      const answered = now === null ? ended : endOf(now);
      if (answered) return answered;
    }
    if (superseded()) return null;
    return waitForRun(runId, from, superseded);
  };

  const reuseOrLaunch = async (
    projectId: string,
    orgId: string,
    retrying: boolean,
    superseded: () => boolean
  ): Promise<Launched | null> => {
    const cursor = await readCursor();
    let repos: SessionSource[];
    try {
      repos = await readSources(projectId, orgId);
    } catch (error) {
      // A session launched without its sources would be reused as it is.
      console.warn('[editor-session] sources unreadable:', errorMessage(error));
      return { ready: false, failure: { kind: 'sources' } };
    }
    if (superseded()) return null;

    let session: StudioSession;
    try {
      session = await sessions().launch.fetch({ workspace_id: sessionWorkspaceId(projectId), repos });
    } catch (error) {
      return { ready: false, failure: launchRefusal(error) };
    }
    if (superseded()) return null;

    const { url } = session;
    if (session.state === 'running') return { ready: true, url };
    if (session.state !== 'starting') return { ready: false, failure: { kind: 'stopped' } };
    dispatch(editorSessionLaunching());
    const waited = session.ready_run_id
      ? await followRun(session.ready_run_id, cursor, retrying, superseded)
      : await waitForRecord(session.id, superseded);
    if (!waited) return null;
    return waited.ready ? { ready: true, url } : waited;
  };

  const launch = async (projectId: string, orgId: string, retrying: boolean): Promise<void> => {
    if (!apiRegistry.has(StudioSessionApiService)) return;
    generation += 1;
    const mine = generation;
    const superseded = (): boolean => generation !== mine;
    inFlight = true;
    // Drawn at once only when somebody is waiting on an answer: a live session never flashes it.
    if (retrying || readEditorSession(app).phase === 'failed') dispatch(editorSessionLaunching());
    try {
      const outcome = await reuseOrLaunch(projectId, orgId, retrying, superseded);
      if (!outcome || superseded()) return;
      if (outcome.ready) {
        publishFrameUrl(app, outcome.url);
        dispatch(editorSessionReady());
      } else {
        dispatch(editorSessionFailed(outcome.failure));
      }
    } catch (error) {
      console.warn('[editor-session] launch failed:', errorMessage(error));
      if (!superseded()) dispatch(editorSessionFailed({ kind: 'run', error: null }));
    } finally {
      if (!superseded()) inFlight = false;
    }
  };

  const abandon = (): void => {
    generation += 1;
    inFlight = false;
    stopWait?.();
  };

  const sync = ({ projectId, orgId, editor, visit }: EditorScope): void => {
    if (projectId !== project) {
      if (project !== null) publishFrameUrl(app, null);
      abandon();
      project = projectId;
      enteredVisit = null;
      dispatch(editorSessionReset());
    }
    org = orgId;
    const shown = editor && projectId !== null;
    if (readEditorSession(app).shown !== shown) dispatch(editorSessionShown(shown));
    if (!shown || !projectId || !orgId || visit === enteredVisit) return;
    enteredVisit = visit;
    if (!inFlight) void launch(projectId, orgId, false);
  };

  const retry = (): void => {
    if (!project || !org || inFlight) return;
    void launch(project, org, true);
  };

  return { sync, retry };
}
