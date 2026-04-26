#!/usr/bin/env bash
# forge.gates.sh — Quality Gates for this project
# FORGE runs this after each story. Must exit 0 to mark story passing.
# Customize per project. Commit alongside your code.

set -euo pipefail

echo "[GATES] Running lint..."
pnpm run lint

echo "[GATES] Running TypeScript typecheck..."
pnpm run typecheck

echo "[GATES] Running tests..."
pnpm test

echo "[GATES] Running build..."
pnpm run build

# Uncomment if Python backend is present:
# echo "[GATES] Running Python tests..."
# python -m pytest tests/ -v --tb=short

echo "[GATES] All gates passed"
exit 0
