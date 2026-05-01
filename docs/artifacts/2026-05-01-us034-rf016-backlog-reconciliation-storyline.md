# Backlog Reconciliation: US-012, US-020, US-021

Story: `US-034`
Tracker Row: `RF-016`
Date: `2026-05-01`

## Problem

The backlog has three older stories whose governance state no longer matches the repository evidence:

- `US-012` remains `passes: false` in `prd.json`, but `progress.txt`, source code, tests, and FORGE history already show that the browser-use live event bridge was implemented.
- `US-020` remains open in `prd.json`, but later evidence and history imply the diagnostic classification work may already be complete or should be explicitly retired.
- `US-021` remains open in `prd.json`, while the tracker records the remediation protocol as complete under `EN-006` and the history currently points `US-021` at an unrelated governance story title.

This leaves future agents with conflicting story names, mismatched status surfaces, and stale backlog entries that can be reopened by mistake.

## Why This Story Exists

The repository needs one governed reconciliation pass that resolves the stale backlog state as documentation/governance work, rather than spawning three separate implementation stories for work that may already be done or superseded.

`US-034` exists to reconcile `US-012`, `US-020`, and `US-021` against current evidence, close or retire them explicitly, and align PRD, tracker, and history naming so later agents do not reopen stale work.

## Scope

This is a reconciliation story.

It must:

- verify `US-012` against current source, tests, progress, and FORGE history
- close `US-012` as implemented if the existing evidence satisfies its acceptance criteria
- decide whether `US-020` is `archived-complete` or `retired`
- decide whether `US-021` is completed by adding any missing remediation report artifact or retired as superseded
- reconcile tracker naming drift between `US-020`/`US-021` and `EN-007`/`EN-006`
- reconcile history naming drift where `US-012`, `US-020`, and `US-021` currently point at mismatched story titles
- leave a clear FORGE evidence trail for the final decisions

It must not:

- create three separate implementation stories for the same backlog cleanup
- reopen already-completed implementation code unless evidence shows a claimed completion is false
- change unrelated direct-gate stories
- replace existing historical evidence with undocumented guesses

## Source Evidence

- `prd.json`
- `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
- `progress.txt`
- `docs/history/forge_history.md`
- `docs/history/history_index.md`
- `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`
- `docs/debriefs/tsc-crash-bug-report.md`
- `docs/artifacts/tsc-crash-forge-story.yaml`
- `docs/artifacts/tsc-crash-remediation-forge-story.yaml`
- `docs/artifacts/2026-04-23-tsc-crash-remediation-implementation-handoff.md`
- browser-use live event bridge source and tests

## Outcome Required

At the end of this story:

- `US-012` is explicitly closed with evidence or reopened with a concrete blocker
- `US-020` has one explicit terminal classification: archived-complete or retired
- `US-021` has one explicit terminal classification: closed with complete remediation evidence or retired as superseded
- PRD, tracker, progress, and FORGE history use aligned names for these stories
- future agents can tell from repo state why these backlog items should not be reopened automatically