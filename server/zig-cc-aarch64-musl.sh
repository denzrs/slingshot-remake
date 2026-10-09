#!/usr/bin/env bash
args=()
for a in "$@"; do
  [[ "$a" == --target=* ]] && continue
  [[ "$a" == *fix-cortex-a53* ]] && continue
  args+=("$a")
done
exec zig cc -target aarch64-linux-musl -nostartfiles "${args[@]}"
