# TSC Crash Layered Remediation Implementation Handoff

Story: `US-021`
Tracker Row: `EN-006`
Source Story Card: `docs/artifacts/tsc-crash-remediation-forge-story.yaml`
Source Bug Report: `docs/debriefs/tsc-crash-bug-report.md`

## Forge System Instructions

You are working inside the Forge system. Use the Forge build loop explicitly:

1. Read the source story card and bug report first.
2. Recover or verify the current repo state before changing code.
3. Implement the smallest coherent change set that advances the remediation workflow.
4. Run the relevant quality gates.
5. Write back the evidence, memory, and follow-through artifacts required by Forge.

Do not treat this as a free-form investigation. The target is to turn the already classified tsc crash findings into a durable remediation workflow with explicit layer gating and a final classified report path.

## Task

Implement the layered remediation protocol for the `tsc --noEmit` crash path.

The remediation must:

- capture local Node, pnpm, TypeScript, and `NODE_OPTIONS`
- compare local runtime behavior against the CI-pinned Node 24 baseline first
- separate Node/V8 remediation from OS/kernel remediation
- block TypeScript refactoring until upstream runtime and OS layers are ruled out
- persist the outcome as a classified remediation artifact pair

## Required Outputs

The implementation is not complete until all of the following exist:

1. A working remediation flow that classifies the crash path by layer.
2. A human-readable remediation report that names the ruled-in layer.
3. The YAML story artifact remains consistent with the implemented workflow.
4. Tracker, progress, and Forge memory updates are written for handoff continuity.

## Acceptance Criteria

- Runtime parity is checked before checker refactoring is allowed.
- `SIGABRT` and V8 heap evidence route to Node/V8 remediation.
- `SIGKILL`, `dmesg`, and cgroup evidence route to OS/kernel remediation.
- TypeScript checker refactoring is only eligible after upstream layers are ruled out.
- The final report clearly states which layer is ruled in and which layers are ruled out.
- The remediation result is persisted in both YAML and human-readable form.

## Definition of Done

Done means the repo can produce a classified remediation result for the `tsc --noEmit` failure that:

- identifies the active remediation layer as OS/kernel, Node/V8, or TypeScript checker
- rules out competing layers with evidence
- records the concise procedures for the ruled-in path
- leaves the repository with the Forge-required evidence trail, progress update, and memory context for the next agent

## Implementation Notes

- Keep the layering explicit; do not collapse runtime parity, OS checks, and checker refactoring into one undifferentiated retry loop.
- Preserve the `SIGABRT` versus `SIGKILL` distinction.
- Use the existing `docs/artifacts/tsc-crash-remediation-forge-story.yaml` as the authoritative story shape.
- Keep the report concise and evidence-backed.

## Hand-Off Reminder

If any artifact is missing, the handoff is incomplete.
If the remediation is blocked by missing evidence, stop at the narrowest blocker and record it clearly.
