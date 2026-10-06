#!/usr/bin/env bash
# Creates ../.pi-types symlinks to the pi packages on this machine so
# `npm run typecheck` / `bun run typecheck` can resolve the host-provided
# modules that pi injects at runtime (typebox, @earendil-works/*).
#
# Usage: ./scripts/link-pi-types.sh

set -euo pipefail

target_dir="$(cd "$(dirname "$0")/../.." && pwd)/.pi-types"
mkdir -p "$target_dir"

pi_root="$(dirname "$(readlink -f "$(command -v pi)")")"

# Locate the pi-coding-agent package (global bun/npm install).
pi_pkg="$(dirname "$(find "$pi_root" -path "*@earendil-works/pi-coding-agent/package.json" -print -quit 2>/dev/null)")"
if [ -z "$pi_pkg" ] || [ ! -d "$pi_pkg" ]; then
	echo "Could not locate @earendil-works/pi-coding-agent near $pi_root" >&2
	exit 1
fi

ln -sfn "$(dirname "$pi_pkg")/pi-ai" "$target_dir/pi-ai"
ln -sfn "$(dirname "$pi_pkg")/pi-tui" "$target_dir/pi-tui"
ln -sfn "$pi_pkg" "$target_dir/pi-coding-agent"

# typebox ships in pi's managed npm directory.
typebox="$(find "$HOME/.pi" -maxdepth 4 -type d -name typebox -print -quit 2>/dev/null)"
if [ -n "$typebox" ] && [ -f "$typebox/package.json" ]; then
	ln -sfn "$typebox" "$target_dir/typebox"
	echo "linked $target_dir/typebox -> $typebox"
fi

echo "linked pi type roots in $target_dir"
