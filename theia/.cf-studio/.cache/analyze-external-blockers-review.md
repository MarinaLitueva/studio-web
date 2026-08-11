# Analyze External Blockers — Code Review Findings

Date: 2026-07-29  
Workflow: `cf-coding-review`  
Review depth: per-layer  
Status: **FAIL**  
Fixes approved: **none**

## Scope

The review started from three CI blockers observed after the Analyze gauge
redesign:

1. `git-executor.ts` contains `checkout --force`, while an existing safety test
   prohibits force and checkout commands in the executor.
2. The full Jest suite reported that the first concurrent workspace-config
   mutation returned `conflict` instead of `applied`.
3. The save-and-push E2E saved `guide.md`, but no corresponding Git Operations
   row appeared within 15 seconds.

Analyze rendering, gauges, trend charts, and unrelated dirty-worktree changes
were excluded.

## Summary

| ID | Severity | Summary | Confidence |
|---|---|---|---|
| F-001 | MAJOR | A frontend repository-cache miss silently drops a valid post-save enqueue | CONFIRMED |
| F-002 | MAJOR | Force confirmation does not pin the remote revision that will be checked out | HIGH |
| F-003 | MAJOR | Removed repositories can leave SCM-open waiters unresolved and block later saves | CONFIRMED |
| F-004 | MAJOR | Studio post-save preparation can reject after the file has already been persisted | HIGH |
| F-005 | MAJOR | Invalid workspace-config create input escapes as an exception instead of a structured conflict | HIGH |
| F-006 | MAJOR | Git remote validation does not explicitly restrict transport/helper protocols | MEDIUM |
| F-007 | MINOR | Git error sanitization covers only the `userinfo@host` credential form | MEDIUM |

## Findings

### F-001 — Frontend repository-cache miss silently drops post-save enqueue

- **Severity:** MAJOR
- **Location:** `studio/src/browser/git-operations-contribution.ts:158-165`;
  `studio/src/browser/studio-saveable-service.ts:72-77`
- **Evidence:** `resolveRepository()` first receives an authoritative
  `repositoryId` from the backend and then returns it only when
  `this.repositories.get(location.repositoryId)` succeeds. The save service
  returns successfully without calling `enqueueOperation` when this lookup
  yields `undefined`.
- **Root cause:** Authoritative backend ownership resolution is coupled to a
  best-effort frontend descriptor cache.
- **Impact:** A Markdown file can be saved successfully while its Git operation
  is permanently lost. No operation row, audit record, status, or retry path is
  created. This is the strongest static explanation for the missing
  `guide.md` E2E row.
- **Suggested fix:** Carry the backend-resolved repository identity directly
  into `enqueueOperation`. Treat the frontend descriptor as optional UI
  metadata, or refresh/synthesize it without dropping the save.
- **Verification:** Add a frontend test in which `resolveWorkspacePath`
  returns a valid repository ID absent from the local descriptor cache and
  assert that `enqueueOperation` is still invoked. Re-run the save-and-push E2E.
- **Confidence:** CONFIRMED

### F-002 — Force confirmation does not pin the checked-out remote revision

- **Severity:** MAJOR
- **Location:** `studio/src/node/workspace-git-service.ts:421-443`;
  `studio/src/node/git-executor.ts:312-322`;
  `studio/src/node/git-publish-service.test.ts:546-553`
- **Evidence:** `forceUpdate()` validates only the local
  `expectedRevision`, then fetches and executes
  `checkout --force -B <branch> <trackingRef>`. The request does not contain
  the remote tracking revision seen during preview. The existing publish
  safety test simultaneously asserts that `git-executor.ts` contains neither
  `--force` nor `checkout`.
- **Root cause:** The new workspace force-update capability was added to the
  shared executor without reconciling the old global safety invariant, and its
  confirmation token covers only local HEAD.
- **Impact:** If the remote advances between preview and confirmation, the
  user can be reset to a remote commit they did not review. The contradictory
  safety contracts also keep the full Jest suite red.
- **Suggested fix:** Include the previewed remote revision in the confirmation
  contract and reject when either local or remote state changes. Replace the
  shared-source token scan with behavior-level tests scoped separately to
  publish and explicitly confirmed workspace sync; do not simply delete the
  safety assertion.
- **Verification:** Preview a diverged source, advance the fake remote, then
  confirm using the old token. The update must require a new preview. Verify
  that publish paths still cannot invoke destructive Git commands.
- **Confidence:** HIGH

### F-003 — Repository removal can leave SCM-open waiters unresolved

- **Severity:** MAJOR
- **Location:** `studio/src/browser/git-operations-contribution.ts:234-246`,
  `293-308`, `323-382`; `studio/src/browser/studio-saveable-service.ts:91-106`
- **Evidence:** `requestScmRepository()` creates waiter promises.
  `onRepositoriesChanged()` removes unknown repository IDs from the open queue
  and queued-ID set but does not settle the corresponding waiters. The save
  service keeps both backend enqueue and SCM selection inside one global
  `enqueueTail`.
- **Root cause:** Queue cleanup and controller disposal do not own a terminal
  completion path for every waiter.
- **Impact:** A removed or stuck repository can leave `selectRepository()`
  pending forever. Because selection is inside the global save tail, later
  saves—even for other repositories—can be blocked and retained in an
  unbounded promise chain.
- **Suggested fix:** Resolve or reject waiters when repositories disappear and
  during controller shutdown. Keep serialization around operation enqueue
  only; run best-effort SCM selection separately or through a bounded
  per-repository queue with cancellation.
- **Verification:** Queue two selections, remove the repository before open
  completes, and assert both promises settle. Then save to another repository
  and verify that its operation is enqueued.
- **Confidence:** CONFIRMED

### F-004 — Post-save preparation can report failure after persistence

- **Severity:** MAJOR
- **Location:** `studio/src/browser/studio-saveable-service.ts:51-92`
- **Evidence:** After `super.save()` persists the file, the override still
  awaits session lookup, content hashing, and repository resolution before it
  creates the caught background enqueue task. Rejections in these preparatory
  calls escape from `save()`.
- **Root cause:** File persistence and Studio automation preparation share the
  same returned promise even though later enqueue execution is intentionally
  background work.
- **Impact:** The editor can report that saving failed even though the file was
  already written, encouraging duplicate user actions and obscuring the real
  Git-automation failure.
- **Suggested fix:** Define an explicit boundary: return the persisted save
  result independently, then perform all Studio automation preparation in a
  separately observed task that reports actionable status through Theia
  logging/UI.
- **Verification:** Make `getSession`, hashing, and repository resolution fail
  independently after a successful base save. The save result should remain
  successful while Studio reports the automation failure.
- **Confidence:** HIGH

### F-005 — Invalid create input escapes the structured conflict contract

- **Severity:** MAJOR
- **Location:** `studio/src/node/workspace-config-mutation-service.ts:121-156`,
  `369-415`; `studio/src/node/studio-backend-module.ts:225-232`
- **Evidence:** `renderNewWorkspaceConfig()` throws plain `Error` for invalid
  source path/URL/branch/role combinations. `create()` and the RPC endpoint do
  not translate these errors into `WorkspaceConfigMutationConflict`.
- **Root cause:** Input validation is implemented inside a throwing renderer
  rather than at the RPC/service boundary that owns the structured response.
- **Impact:** Malformed create requests become backend exceptions instead of
  actionable `invalid-request` responses, breaking the advertised mutation
  result contract.
- **Suggested fix:** Validate before rendering or catch validation errors and
  return a structured `invalid-request` conflict with diagnostics.
- **Verification:** Add invalid create cases for path, URL, branch, and role.
  Each RPC call must resolve to a typed conflict and must not reject.
- **Confidence:** HIGH

### F-006 — Git transport/helper protocols are not explicitly restricted

- **Severity:** MAJOR
- **Location:** `studio/src/node/git-executor.ts:265-297`, `564-589`;
  `studio/src/node/workspace-git-service.ts:251-272`;
  `studio/src/node/git-publish-service.ts:620-634`
- **Evidence:** Remote validation rejects empty/control-character/leading-dash
  values, which protects argv framing, but does not enforce an allowlist of
  Git transports. The values later reach clone/fetch/pull/push and URL rewrite
  configuration.
- **Root cause:** Remote URLs are treated as inert argv values without an
  explicit application-level Git protocol policy.
- **Impact:** Safety depends on ambient Git defaults and configuration. If a
  helper protocol such as `ext::` is enabled, a crafted workspace or runtime
  remote could invoke an unsafe transport under the backend process.
- **Suggested fix:** Allowlist required transports and set restrictive
  per-command Git protocol configuration/environment. Apply the same policy
  to workspace sync and publish.
- **Verification:** Prove helper-style remotes are rejected before subprocess
  execution and that approved HTTPS/SSH forms continue to work. Also verify the
  effective Git-version defaults used by packaged Studio.
- **Confidence:** MEDIUM

### F-007 — Credential sanitization accepts a narrower grammar than remotes

- **Severity:** MINOR
- **Location:** `studio/src/node/git-executor.ts:603-607`;
  `studio/src/node/workspace-git-service.ts:646-657`
- **Evidence:** Sanitizers redact credentials in
  `scheme://userinfo@host`, while accepted remote strings can contain
  credential-like data in path or query forms.
- **Root cause:** Redaction is regex-based and narrower than the accepted remote
  grammar.
- **Impact:** Some authentication failures may expose tokens in backend logs or
  UI-visible error text.
- **Suggested fix:** Parse and sanitize supported URL forms structurally before
  including remote values or Git stderr in errors.
- **Verification:** Add userinfo, query-token, path-token, and malformed URL
  cases and assert that no secret substring survives.
- **Confidence:** MEDIUM

## Unresolved CI Blocker

### Workspace-config concurrent mutation fails only in the full Jest suite

The focused workspace-config suite passes, while the earlier full Jest run
reported:

```text
expected firstResult.status to be "applied", received "conflict"
```

Static review did not confirm a local defect in the intended serialization
path. The service removes its static per-config queue entry in `finally`, and
the focused test proves the expected first-writer/second-conflict behavior.

Do not change the contract based only on the full-suite symptom. The next
diagnostic step is to trace:

1. canonical `configPath`;
2. whether the static queue already contains that path on entry;
3. queue entry/exit ownership;
4. `latestRawToml !== current.rawToml` values immediately before commit;
5. fake-timer state and leaked mocks around the failing suite.

## Coverage and Residual Risk

- The review was read-only; no production fixes were applied.
- Focused tests reported by reviewer passes covered the principal Git,
  workspace-config, saveable, and Git Operations suites.
- The full Jest suite and E2E were not rerun by this review workflow.
- The causal link between F-001 and the exact E2E run is high-confidence static
  analysis, but a trace at the early return is still the cheapest definitive
  proof.
- The effective Git protocol defaults must be checked before treating F-006 as
  an exploitable vulnerability rather than a defense-in-depth gap.

## Theia Integration Context

- Pinned Theia version: `1.73.1`.
- Frontend extension points in scope:
  `FrontendApplicationContribution`, `SaveableService`,
  `FilesystemSaveableService`, `CommandService`, `CommandRegistry`, and
  `ScmService`.
- Frontend/backend boundary: browser save and SCM selection call
  `StudioRuntimeService` RPC methods such as `getSession`,
  `resolveWorkspacePath`, and `enqueueOperation`; Git and workspace-config
  mutations execute in node services.
- Service rebindings: `SaveableService` and `FilesystemSaveableService` are
  rebound to `StudioSaveableService`.
- Upstream patches: none.
- Internal or unstable APIs: no direct internal Theia API dependency was
  required for these findings. The string command ID `git.openRepository`
  remains a comparatively brittle integration point.
