# Implementation Handoff: Reddit LLM Payload Propagation Trace

Date: 2026-04-23
Prepared for: Design / implementation engineers

## Prompt

Fix the `write_and_post_to_reddit` workflow so the generated Reddit title/body survives the full path from draft generation to browser submission.

The latest live run proved the publish path works, but the generated content is being lost before the submit step:

- Gemini produced a Reddit title/body draft.
- The workflow reached the Reddit submit page.
- The duplicate-check prompt received an empty title.
- The browser-use submit step fell back to synthetic copy instead of the generated title/body.
- The post was still published, which masks the upstream propagation bug.

Your job is to preserve the generated payload and make the loss visible.

## Required Outcome

The workflow must trace the title/body handoff across these three layers:

1. Gemini draft generation
2. Workflow runtime resolution
3. Browser-use submission

Add a trace call that makes the handoff observable at each boundary.

## Required Trace Call

Use a single trace event name:

`workflow.llm_layer.trace`

Emit it at all three boundaries with the same session and workflow identifiers so the run can be correlated end-to-end.

### Required fields

- `sessionId`
- `workflowId`
- `stepId`
- `layerFrom`
- `layerTo`
- `title`
- `bodyPreview`
- `titleLength`
- `bodyLength`
- `resolvedKeys`
- `urlBefore`
- `urlAfter`

### Required emission points

1. Immediately after Gemini draft generation completes.
2. Immediately after workflow runtime substitution resolves the Reddit submit-step payload.
3. Immediately before browser-use receives the submit or draft prompt.

## Layer Contract

### 1. Gemini Draft Layer

Goal:
- Generate `reddit_post_title` and `reddit_post_text`
- Record the draft payload before it leaves the writer boundary

Pass condition:
- Both generated fields exist and have non-zero length

Fail condition:
- Draft generation never produced a usable title/body payload

### 2. Workflow Resolution Layer

Goal:
- Carry `reddit_post_title` and `reddit_post_text` into runtime params
- Preserve those values when step templates are cloned for execution

Pass condition:
- The resolved submit-step payload still contains the generated title/body

Fail condition:
- One or both fields disappear before the browser-use submit step

### 3. Browser-Use Submission Layer

Goal:
- Receive the resolved Reddit title/body exactly as generated
- Submit the post without substituting fallback text

Pass condition:
- The agent prompt contains the generated title/body and the final post uses that content

Fail condition:
- The agent receives empty strings or invents fallback content

## Implementation Constraints

- Do not remove the existing HITL review gates.
- Do not weaken the duplicate check.
- Do not silently substitute synthetic content when the generated payload is missing.
- If payload loss is detected, fail loudly and record the missing layer in telemetry.

## Likely Touch Points

- `src/workflow/engine.ts`
- `src/workflow/types.ts`
- `src/telemetry/manager.ts`
- `src/telemetry/types.ts`
- `src/workflow/wrap-up.ts` if trace data needs to be persisted into the run artifact

## Acceptance Criteria

- The Reddit workflow emits a trace record for each of the three LLM layers.
- The trace shows where the title/body is lost, if it is still being lost.
- The submit step receives non-empty generated title/body content.
- The published Reddit post title matches the generated title, not a fallback title.
- The final URL resolves to `/comments/`.
- The workflow run artifact makes the payload handoff visible for later diagnosis.

## Validation Plan

Run the built-in `write_and_post_to_reddit` workflow against `r/test` and verify:

- the generated title/body appear in the trace records
- the duplicate-check step sees the resolved title
- the submit step receives the resolved title/body
- the final post URL is a `/comments/` URL
- the posted title matches the Gemini-generated title

## Deliverable

Implement the trace call and payload preservation fix, then write a short evidence note showing:

- where the payload was dropped, or
- that the payload now survives all three layers intact

