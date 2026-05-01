# TypeScript Memory Troubleshooting

Date: 2026-04-22

## Mandatory Pre-Flight

Before investigating `pnpm run typecheck` or `tsc --noEmit` memory failures, compare the local runtime against the CI-pinned Node 24 baseline.

```bash
node -v
pnpm -v
pnpm exec tsc -v
env | grep '^NODE_OPTIONS=' || true
```

If the local Node version is newer than 24, do not treat the failure as a TypeScript graph regression until Node 24 parity has been checked.

## Failure Classification

Use this order of elimination:

1. Node runtime parity
2. OS or cgroup kill path
3. TypeScript checker graph density

## Node 24 Runtime Warnings That Are Not Heap Lockouts

Not every Node 24 warning belongs to the heap-lockout path.

During the `US-025 / RF-007` production HITL test, Node 24 emitted:

```text
[DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead.
```

Classification:

- This is a runtime API deprecation warning.
- This is not a V8 heap abort.
- This is not a `SIGABRT`.
- This is not a kernel `SIGKILL`.
- This does not indicate TypeScript checker graph expansion.

Correct handling:

- Track it as HTTP/server hardening work.
- Inspect `src/ui/server.ts` and `src/webhooks/server.ts`.
- Replace legacy `url.parse()` with WHATWG `URL` parsing in a dedicated hardening story.
- Do not route this warning through the TypeScript heap-lockout remediation path.

### Node / V8 Path

Treat this as a Node runtime failure when you see:

- `SIGABRT`
- `FATAL ERROR: Reached heap limit`
- `FATAL ERROR: Ineffective mark-compacts near heap limit`
- repeated major GC churn before abort

Recommended repro:

```bash
NODE_OPTIONS="--report-on-fatalerror --report-on-signal --report-uncaught-exception --trace-gc --max-old-space-size=4096 --heapsnapshot-near-heap-limit=1" pnpm exec tsc --noEmit --extendedDiagnostics || true
```

### OS / Kernel Path

Treat this as an OS memory-pressure failure when you see:

- `SIGKILL`
- `dmesg` OOM-killer entries
- cgroup memory caps or kill evidence

Check:

```bash
dmesg | grep -i "oom\|killed process\|out of memory" | tail -n 50 || true
free -h
ulimit -a
cat /sys/fs/cgroup/memory.max 2>/dev/null || true
cat /sys/fs/cgroup/memory.current 2>/dev/null || true
cat /sys/fs/cgroup/memory.high 2>/dev/null || true
```

### TypeScript Checker Path

Only analyze the TypeScript graph after the Node 24 parity check and OS kill-path checks are clear.

Collect:

```bash
pnpm exec tsc --noEmit --listFilesOnly | wc -l
pnpm exec tsc --noEmit --extendedDiagnostics || true
```

Report these values when available:

- `Files`
- `Instantiations`
- `Memory used`
- `Check time`
- `Total time`

Treat extremely high `Instantiations`, `Memory used`, or `Check time` with a normal process exit as checker-graph evidence.

## Rule Of Thumb

- `SIGABRT` is a V8 self-abort until proven otherwise.
- `SIGKILL` is the stronger OS or kernel memory-pressure signature.
- Node version skew against CI is the first discriminator, not a secondary note.
