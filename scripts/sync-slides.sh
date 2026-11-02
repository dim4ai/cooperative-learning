#!/usr/bin/env bash
# Copies the shared slide player from client-editor (canonical) into the lesson clients.
#   scripts/sync-slides.sh          — copy
#   scripts/sync-slides.sh --check  — fail if any copy differs (used in CI)
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=client-editor/src/slides
FILES=(model.ts render.ts paper.ts SlidePlayer.tsx)
TARGETS=(client-teacher/src/slides client-student/src/slides)

header() { printf '// GENERATED COPY of %s — do not edit here, edit the original and run scripts/sync-slides.sh\n' "$1"; }

status=0
for dir in "${TARGETS[@]}"; do
  mkdir -p "$dir"
  for f in "${FILES[@]}"; do
    expected="$( header "$SRC/$f"; cat "$SRC/$f" )"
    if [[ "${1:-}" == "--check" ]]; then
      if [[ ! -f "$dir/$f" ]] || [[ "$(cat "$dir/$f")" != "$expected" ]]; then
        echo "out of sync: $dir/$f (run scripts/sync-slides.sh)" >&2
        status=1
      fi
    else
      printf '%s\n' "$expected" > "$dir/$f"
    fi
  done
done
exit $status
