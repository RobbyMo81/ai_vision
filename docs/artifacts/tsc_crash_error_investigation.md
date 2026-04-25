Objective: Identify which layer owns the `tsc` crash on this headless Linux host (HP OMEN 40L): Node.js runtime, OS/kernel, or TypeScript checker graph. Focus first on runtime-version disparity versus CI, then eliminate lower layers with evidence.

Constraints:
- Read-only investigation only.
- Do not edit repository files.
- Prefer one-line commands so output is captured cleanly.
- If a diagnostic command may fail, append `|| true` so the output is still returned.
- Treat `SIGABRT` and `SIGKILL` as different failure classes and do not conflate them.

Known baseline:
- CI is pinned to Node.js 24.
- The failing local command is `pnpm exec tsc --noEmit`.
- The observed local failure is a V8 heap abort during `tsc`, not yet a confirmed kernel OOM kill.
- Project size is modest enough that a 4 GB heap blowup is suspicious until proven otherwise.

Task 0: Establish the runtime baseline
Run:
1. `cd /home/spoq/ai-vision && node -v && pnpm -v`
2. `cd /home/spoq/ai-vision && pnpm exec tsc -v`
3. `cd /home/spoq/ai-vision && env | grep '^NODE_OPTIONS=' || true`
4. `cd /home/spoq/ai-vision && uname -a && cat /etc/os-release || true`

Goal:
- Record exact local Node, pnpm, and TypeScript versions.
- Compare local Node against CI’s pinned Node 24.
- Detect whether a global or shell-level `NODE_OPTIONS` leak is already altering memory behavior before the explicit repro command.

Task 1: Create a temporary config for consistent repro
Run:
`cd /home/spoq/ai-vision && tmp=$(mktemp /tmp/tsconfig-diag.XXXXXX.json) && node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({extends:'/home/spoq/ai-vision/tsconfig.json', include:['src/**/*'], exclude:['node_modules','dist']}))" "$tmp" && echo "$tmp"`

Goal:
- Reproduce on a stable temporary config without mutating the repo.
- Reuse the same `tmp` path for all subsequent `tsc` commands.

Task 2: Verify Node/V8 internal abort behavior
Run:
1. `cd /home/spoq/ai-vision && NODE_OPTIONS="--report-on-fatalerror --report-on-signal --report-uncaught-exception --trace-gc --max-old-space-size=4096 --heapsnapshot-near-heap-limit=1" pnpm exec tsc -p "$tmp" --noEmit --extendedDiagnostics || true`
2. `cd /home/spoq/ai-vision && ls -1 node_report*.json report.*.json Heap*.heapsnapshot 2>/dev/null || true`

Goal:
- Confirm whether failure is a V8-managed self-abort.
- Capture evidence of repeated major GC / ineffective mark-compact cycles near heap limit.
- If a Node crash report is generated, inspect it for:
  - `totalPhysicalMemory`
  - `heapSizeLimit`
  - `javascriptHeap`
  - process arguments
  - Node version and V8 version

Interpretation:
- `SIGABRT` plus V8 fatal heap messages points to Node/V8 self-termination.
- This is not equivalent to a kernel OOM kill.

Task 3: Measure TypeScript graph shape and checker density
Run:
1. `cd /home/spoq/ai-vision && pnpm exec tsc -p "$tmp" --noEmit --listFilesOnly | wc -l`
2. `cd /home/spoq/ai-vision && pnpm exec tsc -p "$tmp" --showConfig || true`
3. `cd /home/spoq/ai-vision && pnpm exec tsc -p "$tmp" --noEmit --extendedDiagnostics || true`

Goal:
- Determine whether the compiler graph is larger than expected.
- Extract and report:
  - `Files`
  - `Lines`
  - `Symbols`
  - `Types`
  - `Instantiations`
  - `Memory used`
  - `Check time`
  - `Total time`

Interpretation:
- If file count is normal but `Instantiations`, `Types`, or `Check time` are extreme, suspect TypeScript checker/AST pathology.
- If the process aborts before useful diagnostics print, note that as runtime pressure obscuring AST-layer visibility.

Task 4: Distinguish kernel kill from V8 abort
Run:
1. `dmesg | grep -i "oom\\|killed process\\|out of memory" | tail -n 50 || true`
2. `free -h || true`
3. `ulimit -a || true`
4. `cat /sys/fs/cgroup/memory.max 2>/dev/null || true`
5. `cat /sys/fs/cgroup/memory.current 2>/dev/null || true`
6. `cat /sys/fs/cgroup/memory.high 2>/dev/null || true`

Goal:
- Determine whether the kernel or cgroup killed the process.
- Separate OS-enforced memory exhaustion from V8’s internal heap ceiling.

Interpretation:
- Kernel OOM evidence typically aligns with `SIGKILL` and `dmesg` entries like `Out of memory: Killed process`.
- Absence of `dmesg` OOM evidence plus V8 fatal heap output strongly favors a Node runtime-layer abort.

Task 5: Version alignment check against CI
If Node 24 is available locally, rerun the same repro command under Node 24 and compare.
Use the same temp tsconfig and the same diagnostic flags.

Goal:
- Determine whether the failure is sensitive to Node major version.
- If Node 24 succeeds or materially delays the failure compared to local Node > 24, classify this as strong runtime-version evidence.

Task 6: Sequential elimination
Classify layers in this order:
1. OS / Kernel
2. Node.js Runtime / V8
3. TypeScript AST / Checker

Decision rules:
- If `dmesg` or cgroup data shows a kill or hard memory ceiling, rule in OS/kernel.
- If the process ends with V8 fatal heap diagnostics and `SIGABRT`, rule in Node/V8 runtime behavior.
- If the graph size is modest but `Instantiations`, `Types`, or `Check time` are extreme, rule in TypeScript checker density.
- If local Node is newer than CI’s Node 24 and behavior changes under Node 24, elevate runtime-version mismatch as the primary hypothesis.
- If `NODE_OPTIONS` is already set in the environment, treat that as a first-class suspect and report its exact value.

Required output format:
1. `Observed crash signature`
2. `Environment baseline`
3. `Runtime-version comparison`
4. `V8 / abort evidence`
5. `TypeScript diagnostics`
6. `OS / kernel evidence`
7. `Layer elimination result`
8. `Most likely root cause`

Mandatory values to include:
- Exact local Node version
- Exact TypeScript version
- Whether `NODE_OPTIONS` was already set before repro
- `Files`
- `Instantiations`
- `Memory used`
- `Check time`
- Whether a Node crash report was produced
- Whether Node 24 was tested, and the result

Final comparison table:
| Layer | Status | Evidence |
| --- | --- | --- |
| OS / Kernel | ruled in / ruled out / inconclusive | brief evidence |
| Node.js Runtime / V8 | ruled in / ruled out / inconclusive | brief evidence |
| TypeScript AST / Checker | ruled in / ruled out / inconclusive | brief evidence |

Failure model:
- Node.js Runtime / V8:
  - Trigger: V8 heap exhaustion
  - Signal: `SIGABRT`
  - Evidence: `FATAL ERROR: Reached heap limit` or `Ineffective mark-compacts near heap limit`
- OS / Kernel:
  - Trigger: system RAM or cgroup exhaustion
  - Signal: usually `SIGKILL`
  - Evidence: `dmesg` OOM-killer lines or cgroup memory cap
- Compiler Logic:
  - Trigger: pathological type expansion / recursive instantiation
  - Signal: usually regular compiler failure or extreme diagnostics, not a kernel kill
  - Evidence: very high `Instantiations`, `Types`, `Memory used`, or `Check time`

Specific hypotheses to test:
1. Local Node major version is newer than CI’s Node 24, and V8 heap/GC behavior regressed enough to abort during `tsc`.
2. A leaked `NODE_OPTIONS` value is constraining or altering heap behavior locally.
3. The TypeScript checker graph contains a pathological instantiation pattern that newer Node/V8 exposes more aggressively than CI.