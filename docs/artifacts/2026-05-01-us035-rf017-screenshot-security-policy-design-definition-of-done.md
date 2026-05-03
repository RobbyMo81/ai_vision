# Screenshot Security Policy Design — Definition Of Done

Story: `US-035`
Tracker Row: `RF-017`

The story is done only when all of the following are true:

1. Design artifact exists:
   - a governed screenshot security policy design is saved under `docs/artifacts/`
   - supporting investigations remain under `docs/debriefs/`

2. Screenshot classes are defined:
   - `live_frame`
   - `debug_frame`
   - `evidence`
   - `sensitive_blocked`

3. Sensitive-data behavior is explicit:
   - `pii_wait` capture behavior is defined
   - sensitive-target step behavior is defined
   - private account/page behavior is addressed or explicitly deferred

4. Persistence policy is explicit:
   - durable screenshots are classified as opt-in evidence or an intentional exception
   - `workflow_runs.result_json` base64 policy is defined
   - wrap-up artifact base64 policy is defined
   - `session_screenshots` metadata policy is defined

5. Access and audit policy is explicit:
   - `/api/screenshot` binding decision is recorded
   - MCP screenshot gate/audit decision is recorded
   - screenshot block telemetry is defined

6. Retention policy is explicit:
   - live frame retention
   - rolling/debug frame retention
   - evidence screenshot retention
   - success/failure cleanup behavior

7. Legacy policy is explicit:
   - historical result JSON containing screenshot base64 is either migrated, sanitized forward-only, or left as legacy with rationale

8. Follow-on implementation split exists:
   - payload contract story
   - persistence sanitization story
   - sensitive screenshot gate story
   - rolling/debug cleanup story, if separate

9. Governance surfaces are updated:
   - `prd.json` contains `US-035`
   - `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md` contains `RF-017`
   - `progress.txt` records Summary of Work
   - Forge history and history index are updated at completion

10. Validation is recorded:
   - `jq empty prd.json` exits `0`
   - the closing Summary of Work includes typecheck/test status or an explicit design-only not-run rationale

