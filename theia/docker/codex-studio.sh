#!/usr/bin/env bash
# Studio wrapper around the `codex` binary used by @theia/ai-codex.
#
# The codex TypeScript SDK spawns codex with child_process.spawn() and passes a
# working directory ONLY via `--cd` when the caller sets `workingDirectory`.
# Theia's CodexServiceImpl forwards `request.options` as-is and the ai-codex
# client does not populate `workingDirectory`, so codex inherits the Theia
# backend's cwd (/app/browser-app — not a git repo) and aborts with
# "Not inside a trusted directory and --skip-git-repo-check was not specified".
#
# Fix, without patching node_modules: run codex in the session workspace (which
# the entrypoint guarantees is a git repo) and tolerate non-git workspaces. If
# the SDK already supplied --skip-git-repo-check, don't add a duplicate.
set -euo pipefail

cd "${STUDIO_WORKSPACE_DIR:-/workspace}" 2>/dev/null || true

for arg in "$@"; do
  if [ "$arg" = "--skip-git-repo-check" ]; then
    exec /usr/local/bin/codex "$@"
  fi
done

exec /usr/local/bin/codex "$@" --skip-git-repo-check
