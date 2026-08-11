#!/usr/bin/env bash
set -euo pipefail

workspace_root="${1:-/Volumes/coding/cf-work/}"
codex_path="${THEIA_CODEX_PATH:-$(command -v codex)}"
claude_sdk_path="${THEIA_CLAUDE_CODE_PATH:-$(npm root -g)/@anthropic-ai/claude-agent-sdk/sdk.mjs}"

if [[ ! -x "$codex_path" ]]; then
  printf 'Codex executable is not available: %s\n' "$codex_path" >&2
  exit 1
fi

if [[ ! -f "$claude_sdk_path" ]]; then
  printf 'Claude Agent SDK is not available: %s\n' "$claude_sdk_path" >&2
  exit 1
fi

export THEIA_CODEX_PATH="$codex_path"
export THEIA_CLAUDE_CODE_PATH="$claude_sdk_path"
export STUDIO_GIT_MODE="${STUDIO_GIT_MODE:-push}"

npm run build:browser
npm run start:browser -- --hostname="${THEIA_HOSTNAME:-127.0.0.1}" --port="${THEIA_PORT:-3003}" "$workspace_root"
