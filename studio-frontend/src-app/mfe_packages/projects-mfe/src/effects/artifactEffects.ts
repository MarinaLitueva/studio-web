// @cpt-dod:cpt-studiofrontend-dod-project-artifacts-sync-unit:p1
// @cpt-algo:cpt-studiofrontend-algo-project-artifacts-sync:p2
// @cpt-algo:cpt-studiofrontend-algo-project-artifacts-run-control:p2
import {
  apiRegistry,
  eventBus,
  type AppDispatch,
  type FrontXApp,
  type RootState,
} from '@gears-frontx/react';
import {
  StudioEventsApiService,
  StudioTasksApiService,
  createRunFollower,
  errorMessage,
  refusalFrom,
  violationOfType,
  type RunFollower,
} from '@constructor-studio/mfe-shared';
import { ArtifactIngestApiService } from '../api/ArtifactIngestApiService';
import {
  ARTIFACT_SYNC_SLICE_KEY,
  importAbandoned,
  importStarted,
  projectImport,
  repoCancelling,
  repoControlRefused,
  repoEnqueued,
  repoProgressed,
  repoRetried,
  repoUpdated,
} from '../slices/artifactSyncSlice';
import { NAV_SLICE_KEY } from '../slices/navSlice';
import { recordAttempt } from '../shared/importAttempts';
import type { RepoRef, SyncRequest } from '../events/artifactEvents';
import '../events/artifactEvents';

const CONCURRENCY = 3;

/** The gear's answer to a cancel of a run that has already ended. */
const CANCEL_REFUSED = 'TASK_CANCEL_REFUSED';

/** One project's import, watched until the project in scope changes. */
interface Watch {
  follower: RunFollower;
  /** The repository each run syncs. */
  repos: Map<string, string>;
  ended: boolean;
  end: () => void;
}

async function bounded<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await work(item);
    }
  });
  await Promise.all(runners);
}

export function initArtifactEffects(dispatch: AppDispatch, app: FrontXApp): void {
  const watches = new Map<string, Watch>();
  const events = () => apiRegistry.getService(StudioEventsApiService);
  const tasks = () => apiRegistry.getService(StudioTasksApiService);

  const openProjectId = (): string | null =>
    (app.store.getState() as RootState)[NAV_SLICE_KEY].projectId;

  const runOf = (projectId: string, repo: string): string | null =>
    projectImport((app.store.getState() as RootState)[ARTIFACT_SYNC_SLICE_KEY], projectId).repos.find(
      (row) => row.repo === repo
    )?.runId ?? null;

  /** `null` when it cannot be read: the runs are then read on an interval. */
  const readCursor = async (): Promise<number | null> => {
    try {
      return (await events().cursor.fetch({ staleTime: 0 })).latest_seq;
    } catch (error) {
      console.warn('[artifacts] no event cursor:', errorMessage(error));
      return null;
    }
  };

  const watch = (projectId: string): Watch => {
    const current = watches.get(projectId);
    if (current) return current;

    const repos = new Map<string, string>();
    const follower = createRunFollower({
      events: events(),
      tasks: tasks(),
      onRun: (update) => {
        const repo = repos.get(update.runId);
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-10
        if (repo) dispatch(repoUpdated({ projectId, repo, update }));
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-10
      },
      onLost: (runId, error) => {
        const repo = repos.get(runId);
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-12
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-13
        if (repo) {
          dispatch(
            repoProgressed({
              projectId,
              repo,
              status: 'lost',
              reason: refusalFrom(error, 'artifacts_reason_task_lost'),
            })
          );
        }
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-12
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-13
      },
    });

    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-16
    const unsubscribe = app.store.subscribe(() => {
      if (openProjectId() === projectId) return;
      const state = (app.store.getState() as RootState)[ARTIFACT_SYNC_SLICE_KEY];
      const running = projectImport(state, projectId).phase === 'running';
      next.end();
      if (running) dispatch(importAbandoned(projectId));
    });
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-16

    const next: Watch = {
      follower,
      repos,
      ended: false,
      end: () => {
        if (next.ended) return;
        next.ended = true;
        follower.stop();
        unsubscribe();
        if (watches.get(projectId) === next) watches.delete(projectId);
      },
    };
    watches.set(projectId, next);
    return next;
  };

  eventBus.on('mfe/artifacts/sync-requested', (request: SyncRequest) => {
    const { projectId, workspaceId, repos, unsyncable } = request;
    const ingest = apiRegistry.getService(ArtifactIngestApiService);
    watches.get(projectId)?.end();

    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-1
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-2
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-3
    recordAttempt(projectId);
    dispatch(importStarted({ projectId, repos: repos.map((r) => r.repo), unsyncable }));
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-1
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-2
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-3

    if (repos.length === 0) return;
    const mine = watch(projectId);

    void (async () => {
      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-4
      const cursor = await readCursor();
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-4

      await bounded(repos, CONCURRENCY, async (entry) => {
        if (mine.ended) return;
        let runId: string;
        try {
          // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-5
          const enqueued = await ingest.sync.fetch({
            provider: entry.provider,
            base_url: entry.baseUrl,
            secret_ref: entry.secretRef,
            repo_full_path: entry.repo,
            project_id: projectId,
            workspace_id: workspaceId ?? undefined,
          });
          // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-5
          runId = enqueued.run_id;
        } catch (error) {
          if (!mine.ended) {
            dispatch(
              repoProgressed({
                projectId,
                repo: entry.repo,
                status: 'failed',
                reason: refusalFrom(error, 'artifacts_reason_request_failed'),
              })
            );
          }
          return;
        }
        if (mine.ended) return;
        mine.repos.set(runId, entry.repo);
        dispatch(repoEnqueued({ projectId, repo: entry.repo, runId }));
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-6
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-7
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-8
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-9
        mine.follower.follow([runId], cursor);
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-6
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-7
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-8
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-9
      });
    })();
  });

  // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-1
  eventBus.on('mfe/artifacts/cancel-requested', ({ projectId, repo }: RepoRef) => {
    const runId = runOf(projectId, repo);
    if (!runId) return;
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-3
    dispatch(repoCancelling({ projectId, repo }));
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-3
    void (async () => {
      try {
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-2
        await tasks().cancel(runId).fetch(undefined);
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-2
      } catch (error) {
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-4
        // It ended meanwhile; its terminal event says how.
        if (violationOfType(error, CANCEL_REFUSED)) return;
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-4
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-8
        dispatch(
          repoControlRefused({
            projectId,
            repo,
            refusal: refusalFrom(error, 'artifacts_reason_cancel_refused'),
          })
        );
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-8
      }
    })();
  });
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-1

  // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-5
  eventBus.on('mfe/artifacts/retry-requested', ({ projectId, repo }: RepoRef) => {
    const runId = runOf(projectId, repo);
    if (!runId) return;
    const mine = watch(projectId);
    mine.repos.set(runId, repo);
    void (async () => {
      const cursor = await readCursor();
      try {
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-6
        await tasks().retry(runId).fetch(undefined);
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-6
      } catch (error) {
        if (!mine.ended) {
          dispatch(
            repoControlRefused({
              projectId,
              repo,
              refusal: refusalFrom(error, 'artifacts_reason_retry_refused'),
            })
          );
        }
        return;
      }
      if (mine.ended) return;
      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-7
      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-9
      dispatch(repoRetried({ projectId, repo }));
      mine.follower.follow([runId], cursor);
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-7
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-9
    })();
  });
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-5
}
