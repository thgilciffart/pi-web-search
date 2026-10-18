#!/usr/bin/env bash
# Creates ../.pi-types symlinks to the pi packages on this machine so
# `npm run typecheck` / `bun run typecheck` can resolve the host-provided
# modules that pi injects at runtime (typebox, @earendil-works/*).
#
# Usage: ./scripts/link-pi-types.sh

set -euo pipefail

target_dir="$(cd "$(dirname "$0")/../.." && pwd)/.pi-types"

if ! pi_bin="$(command -v pi)"; then
	echo "Could not find pi on PATH" >&2
	exit 1
fi
pi_root="$(dirname "$(readlink -f "$pi_bin")")"

# The executable lives inside dist/ or dist/bundle/. Walk up to its package
# instead of searching below the executable's directory.
pi_pkg="$pi_root"
while [ "$pi_pkg" != "/" ]; do
	if [ "$(basename "$pi_pkg")" = "pi-coding-agent" ] && [ -f "$pi_pkg/package.json" ]; then
		break
	fi
	pi_pkg="$(dirname "$pi_pkg")"
done
if [ "$pi_pkg" = "/" ]; then
	echo "Could not locate @earendil-works/pi-coding-agent near $pi_root" >&2
	exit 1
fi

mkdir -p "$target_dir"
ln -sfn "$(dirname "$pi_pkg")/pi-ai" "$target_dir/pi-ai"
ln -sfn "$(dirname "$pi_pkg")/pi-tui" "$target_dir/pi-tui"
ln -sfn "$pi_pkg" "$target_dir/pi-coding-agent"

# typebox ships in pi's managed npm directory.
typebox=""
if [ -d "$HOME/.pi" ]; then
	typebox="$(find "$HOME/.pi" -maxdepth 4 -type d -name typebox -print -quit 2>/dev/null)"
fi
if [ -n "$typebox" ] && [ -f "$typebox/package.json" ]; then
	ln -sfn "$typebox" "$target_dir/typebox"
	echo "linked $target_dir/typebox -> $typebox"
fi

echo "linked pi type roots in $target_dir"
