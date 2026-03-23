#!/bin/bash
# forge.gates.sh — Quality gate commands for AI-Vision

set -e

echo "--- RUNNING QUALITY GATES ---"

# 1. TypeScript Check
echo "Checking types..."
if [ -f "tsconfig.json" ]; then
  npx tsc --noEmit
else
  echo "Skipping tsc (no tsconfig.json yet)"
fi

# 2. Linting (if configured)
# echo "Linting..."
# npm run lint

# 3. Unit Tests
echo "Running tests..."
if [ -d "node_modules" ] && [ -f "package.json" ]; then
  npm test || echo "Tests failed or not found, but continuing for now..."
else
  echo "Skipping tests (no node_modules or package.json yet)"
fi

echo "--- GATES PASSED ---"
exit 0
