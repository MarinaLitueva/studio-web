#!/usr/bin/env bash
# Studio wrapper around the `codex` binary used by @theia/ai-codex.
#
# The codex TypeScript SDK spawns codex with child_process.spawn() and only
# passes a working directory when the caller sets `workingDirectory`. Theia's
# CodexServiceImpl forwards request.options as-is and the ai-codex client does
# not set it, so codex inherits the Theia backend's cwd (/app/browser-app — not
# a git repo) and aborts with "Not inside a trusted directory ...".
#
# Fix: run codex in the session workspace, which the entrypoint guarantees is a
# git repo, so the trust check passes for every subcommand. We deliberately do
# NOT inject --skip-git-repo-check: that flag is only accepted by `codex exec`,
# NOT by `codex exec resume`, so appending it breaks thread resumption
# (exit code 2: "unexpected argument '--skip-git-repo-check'").
set -euo pipefail

cd "${STUDIO_WORKSPACE_DIR:-/workspace}" 2>/dev/null || true

exec /usr/local/bin/codex "$@"
