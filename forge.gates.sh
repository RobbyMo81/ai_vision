#!/usr/bin/env bash
# forge.gates.sh — enforced quality gates for FORGE stories.

set -euo pipefail

echo "[GATES] Running lint..."
pnpm run lint

echo "[GATES] Running TypeScript typecheck..."
pnpm run typecheck

echo "[GATES] Running tests..."
pnpm test

echo "[GATES] Running build..."
pnpm run build

echo "[GATES] All gates passed"
