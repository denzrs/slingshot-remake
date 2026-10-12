#!/usr/bin/env bash
# rustc appends -Wl,--fix-cortex-a53-843419 for aarch64; zig's linker driver rejects it, so drop it.
# The codegen half of the A53 workaround (+fix-cortex-a53-835769) is still applied via RUSTFLAGS.
args=()
for a in "$@"; do
  [[ "$a" == --target=* ]] && continue
  [[ "$a" == -Wl,--fix-cortex-a53-843419 ]] && continue
  args+=("$a")
done
exec zig cc -target aarch64-linux-musl -nostartfiles "${args[@]}"
