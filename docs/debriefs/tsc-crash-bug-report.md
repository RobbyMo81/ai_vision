# TSC Crash Bug Report

Story: `US-020`
Structured Story Artifact: `docs/artifacts/tsc-crash-forge-story.yaml`
Source Investigation: `docs/debriefs/tsc_crash_error_investigation.md`
Status: Draft investigation artifact

## Current State

- Runtime-schema leakage from [src/workflow/types.ts](/home/spoq/ai-vision/src/workflow/types.ts) has been reduced by replacing exported `z.infer` workflow types with static interfaces.
- The remaining MCP expansion node in [src/mcp/server.ts](/home/spoq/ai-vision/src/mcp/server.ts) was contained by routing tool registration through a non-generic registration helper and explicit DTO-style handler boundaries.
- CI-aligned validation now passes: `/home/spoq/.nvm/versions/node/v24.14.0/bin/node ./node_modules/typescript/bin/tsc --noEmit` exited `0`.

## Observed Crash Signature

- Failing command: `pnpm exec tsc --noEmit --extendedDiagnostics`
- Current observed terminal signal: `SIGABRT`
- Current observed fatal text: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`
- Current interpretation: V8 self-abort is observed; kernel OOM kill is not yet confirmed.

## Environment Baseline

| Field | Value | Status |
| --- | --- | --- |
| Local Node version | `v25.8.1` | Observed |
| pnpm version | `10.32.1` | Observed |
| TypeScript version | `5.9.3` | Observed |
| `NODE_OPTIONS` preset | Not set in baseline repro | Observed |
| Host OS | Headless Linux on HP OMEN 40L | Observed |
| CI baseline | Node 24 | Observed |

## Node 24 Parity Result

| Check | Result | Evidence |
| --- | --- | --- |
| Local runtime compared to CI-pinned Node 24 | Mismatch confirmed | Local default runtime is `v25.8.1`; CI is pinned to Node 24 |
| Behavior reproduced under Node 24 | No longer reproduced after containment refactors | `/home/spoq/.nvm/versions/node/v24.14.0/bin/node ./node_modules/typescript/bin/tsc --noEmit` now exits `0` |
| Runtime skew treated as first discriminator | Yes | Required by `US-020` story definition |

## Diagnostics Metrics

| Metric | Value | Status |
| --- | --- | --- |
| Files loaded by `tsc` | `369` | Observed |
| Instantiations | Pending | Not yet captured before abort |
| Memory used | Pending | Not yet captured before abort |
| Check time | Pending | Not yet captured before abort |
| Total time | Pending | Not yet captured before abort |

## Layer Classification

| Layer | Status | Evidence |
| --- | --- | --- |
| OS / Kernel | Inconclusive | No `dmesg` or cgroup evidence captured yet |
| Node.js / V8 Runtime | Resolved symptom | Prior `SIGABRT` heap abort is no longer reproduced under Node `v24.14.0` after the workflow and MCP containment refactors |
| TypeScript Checker / AST | Confirmed primary contributing layer | Flattening exported workflow types and neutralizing MCP tool generic expansion removed the compiler heap failure without any runtime memory tuning |

## Ruled-In Bug Path

Current ruled-in path: `TypeScript Checker / AST Expansion`

Reasoning:

- The original crash ended in `SIGABRT`, which established V8 as the failure surface but not the root cause.
- Replacing exported `z.infer` workflow types with static interfaces reduced the graph enough to change the crash profile from fast failure to delayed failure.
- Neutralizing MCP tool registration generics in [src/mcp/server.ts](/home/spoq/ai-vision/src/mcp/server.ts) removed the last remaining expansion node and allowed the full Node 24 typecheck to complete successfully.
- The fix required no Node heap increase, which is strong evidence that checker graph shape, not runtime heap tuning, was the root problem.

## Ruled-Out Layers

### OS / Kernel

Not ruled out yet.

Evidence still required:

- `dmesg` OOM-killer output
- cgroup memory ceiling state
- host memory pressure snapshot

### TypeScript Checker / AST

Not ruled out yet.

Evidence still required:

- `Instantiations`
- `Memory used`
- `Check time`
- comparison of loaded file count versus expected graph shape under Node 24 parity

## Refactoring Procedures

### Procedure 1: Runtime Parity Refactor Gate

- Capture exact local runtime versions: Node, pnpm, TypeScript, and `NODE_OPTIONS`.
- Re-run the repro under Node 24 before attributing the crash to the checker graph.
- If Node 24 materially changes the behavior, classify the failure as runtime-version-sensitive and pin remediation around runtime parity first.

### Procedure 2: V8 Abort Evidence Path

- Run the repro with fatal-report, GC trace, and heap-near-limit flags.
- Persist crash-report outputs and any heap snapshots into the artifact record.
- If the crash remains `SIGABRT` with the same V8 signatures, keep Node/V8 as the primary bug path.

### Procedure 3: OS / Kernel Elimination Path

- Collect `dmesg`, `free -h`, `ulimit -a`, and cgroup memory files.
- If there is no `SIGKILL` or OOM-killer evidence, explicitly rule out OS/kernel as the primary layer.

### Procedure 4: Checker Density Refactor Path

- If Node 24 parity is established and the crash persists, collect extended diagnostics until `Instantiations`, `Memory used`, and `Check time` are visible.
- Isolate the heaviest type surfaces and narrow the checker graph to the offending slice.
- Refactor recursive or high-fanout type paths only after runtime and OS layers are ruled out.

## Rust Decoder Viability Assessment

### Verdict

Viable as a targeted runtime boundary optimization, but not as the primary architectural fix for the current `tsc` memory failure.

### Why It Helps Less Than It First Appears

- The current bridge payload surface in [src/engines/python-bridge.ts](/home/spoq/ai-vision/src/engines/python-bridge.ts) is comparatively flat: HTTP request/response bodies, engine IDs, and small event payloads.
- The largest compile-time type surfaces visible in the current repo are the Zod-derived workflow and MCP contracts in [src/workflow/types.ts](/home/spoq/ai-vision/src/workflow/types.ts) and [src/mcp/server.ts](/home/spoq/ai-vision/src/mcp/server.ts).
- There is already a concrete `TS2589` suppression in [src/mcp/server.ts](/home/spoq/ai-vision/src/mcp/server.ts), which is direct evidence that generic/schema depth pressure already exists outside the Python bridge.
- Replacing Python-to-Node payload decoding with Rust would move some runtime validation work out of TypeScript, but it would not materially shrink the Zod inference graph that dominates workflow definitions, MCP tool schemas, and their downstream imports.

### What A Rust Decoder Would Actually Buy

- Faster runtime decoding and validation for large bridge payloads.
- A flatter Node-side surface if the Rust crate generated a single exported DTO layer and TypeScript stopped inferring deep shapes from schemas.
- A path to centralize structural validation in one native boundary for bridge events and task results.

### What It Would Not Solve By Itself

- The `WorkflowDefinitionSchema` discriminated union and its `z.infer` fan-out in [src/workflow/types.ts](/home/spoq/ai-vision/src/workflow/types.ts).
- MCP schema generic depth in [src/mcp/server.ts](/home/spoq/ai-vision/src/mcp/server.ts).
- Broad compile-time reach of `WorkflowDefinition` and `WorkflowStep` through orchestrator, memory, and wrap-up layers.

### Repo-Specific Recommendation

1. Keep the interface-first export pattern in [src/workflow/types.ts](/home/spoq/ai-vision/src/workflow/types.ts).
2. Keep MCP tool registration behind the non-generic boundary in [src/mcp/server.ts](/home/spoq/ai-vision/src/mcp/server.ts) and avoid reintroducing direct SDK generic inference for every tool.
3. Treat Rust as a secondary optimization track for runtime throughput or boundary hardening, not as the primary remedy for the compiler failure.
4. When adding new workflow or MCP surfaces, prefer explicit DTO interfaces over exported `z.infer` types on large unions.

### Integration Risk

- The repo already has a Rust foothold via [tools/config-gui/Cargo.toml](/home/spoq/ai-vision/tools/config-gui/Cargo.toml), so adding Rust is operationally viable.
- Adding N-API or WASM to the bridge still increases CI and local build complexity, and it introduces a third language into the core automation path.
- Because the present evidence points to Zod/type-inference breadth as the dominant compile-time issue, a Rust decoder should be justified on runtime throughput or boundary hardening, not sold as the standalone fix for the current heap abort.

## Required Follow-Through

- Record exact local Node version.
- Record exact TypeScript version.
- Record whether `NODE_OPTIONS` was already set before repro.
- Node 24 parity check completed; preserve the final passing evidence under Node `v24.14.0` in follow-up artifacts.
- Capture OS-layer evidence.
- Update the layer classification table from provisional to final.
