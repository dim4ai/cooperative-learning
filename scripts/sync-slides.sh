#!/usr/bin/env bash
# Copies the shared slide player and live board from client-editor (canonical) into the lesson clients,
# and the student avatars from client-student into client-teacher and client-player.
#   scripts/sync-slides.sh          — copy
#   scripts/sync-slides.sh --check  — fail if any copy differs (used in CI)
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=client-editor/src/slides
FILES=(model.ts render.ts paper.ts SlidePlayer.tsx Board.tsx)
TARGETS=(client-teacher/src/slides client-student/src/slides client-player/src/slides)

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

# Student avatars: canonical in client-student (the student picks one), the teacher and the player show them too
AV_SRC=client-student/src
for AV_DST in client-teacher/src client-player/src; do
  expected="$( header "$AV_SRC/avatars.tsx"; cat "$AV_SRC/avatars.tsx" )"
  if [[ "${1:-}" == "--check" ]]; then
    if [[ ! -f "$AV_DST/avatars.tsx" ]] || [[ "$(cat "$AV_DST/avatars.tsx")" != "$expected" ]]; then
      echo "out of sync: $AV_DST/avatars.tsx (run scripts/sync-slides.sh)" >&2
      status=1
    fi
    if ! diff -rq "$AV_SRC/avatars" "$AV_DST/avatars" >/dev/null 2>&1; then
      echo "out of sync: $AV_DST/avatars/ (run scripts/sync-slides.sh)" >&2
      status=1
    fi
  else
    printf '%s\n' "$expected" > "$AV_DST/avatars.tsx"
    rm -rf "$AV_DST/avatars" && cp -r "$AV_SRC/avatars" "$AV_DST/avatars"
  fi
done
exit $status
