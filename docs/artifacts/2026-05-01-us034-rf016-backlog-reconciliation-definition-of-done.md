# Backlog Reconciliation: US-012, US-020, US-021 — Definition Of Done

Story: `US-034`
Tracker Row: `RF-016`

The story is done only when all of the following are true:

1. `US-012` is reconciled:
   - its acceptance criteria are checked against current source, tests, progress, and history
   - the final status is explicit
   - the decision is backed by repo evidence

2. `US-020` is reconciled:
   - its diagnostic artifacts are reviewed
   - the final status is explicit: archived-complete or retired
   - the decision explains why future agents should not reopen the story automatically

3. `US-021` is reconciled:
   - remediation artifacts are reviewed
   - the final status is explicit: completed or retired as superseded
   - any missing remediation report required to close the story is added if it is the only narrow blocker

4. Governance surfaces align:
   - `prd.json` uses the final story names and pass states
   - tracker naming aligns with `US-012`, `US-020`, and `US-021`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` uses the reconciled story names
   - `docs/history/history_index.md` uses the reconciled story names
   - stale references that would reopen the wrong backlog item are removed or rewritten

5. Validation passes:
   - `jq empty prd.json` exits `0`
   - the closing response includes the final status of `US-012`, `US-020`, and `US-021`

6. Forge evidence trail exists:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-016` row exists in the tracker
   - `US-034` exists in `prd.json`
   - `progress.txt` records the story seed or completion summary
   - `AGENTS.md` is not used for the long-form story entry