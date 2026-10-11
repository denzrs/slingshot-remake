#!/usr/bin/env bash
args=()
for a in "$@"; do
  [[ "$a" == --target=* ]] && continue
  args+=("$a")
done
exec zig cc -target aarch64-linux-musl -nostartfiles "${args[@]}"
