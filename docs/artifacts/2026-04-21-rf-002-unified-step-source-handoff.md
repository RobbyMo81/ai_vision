# RF-002 Unified Step Source Handoff

Date: 2026-04-21

## Summary

Captured the workflow step array once before building `resolvedDefinition` so later getter side effects cannot swap the execution loop onto a different source.

## What Changed

- `src/workflow/engine.ts`
  - Captures `definition.steps` before the object spread.
  - Uses the resolved definition for the direct execution loop, bootstrap handoff, wrap-up handoff, and terminal step counts.
- `src/workflow/engine.test.ts`
  - Adds a regression test that proves the loop stays on the resolved array even if the original `steps` getter changes later.

## Validation

- `pnpm test -- src/workflow/engine.test.ts`

## Notes

- Full repository typecheck in this environment ended in a V8 `SIGABRT` heap abort during `tsc --noEmit`, not a confirmed kernel `SIGKILL` OOM event.
- Treat local runtime skew against the CI-pinned Node 24 baseline as the first discriminator before attributing the crash to the TypeScript graph itself.
- The typecheck run did not report source errors before the V8 heap abort was reached.
