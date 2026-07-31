# Chromium Trace Engine Spike Tools

These tools implement the Batch 0 isolation and evidence boundary. They are not
production Trace parsing code.

Current status:

```text
Batch 0 / Checkpoint 1: tool boundaries and self-tests complete
Batch 0 / Tool commit: represented by this commit
Batch 0 / Real Spike: not run
Batch 0 / Report: not generated
```

## First Checkpoint

Run without installing a Trace Engine, reading a real manifest, or starting a
browser:

```bash
node scripts/trace-spike/self-test.js
node scripts/trace-spike/run-spike.js --dry-run
```

The dry run creates and safely removes only a
`/private/tmp/netlog-trace-spike.*` directory. It prints no local path.

## Real Spike Gate

Real execution is implemented but must not run before the tool commit and
separate authorization. It requires all values explicitly:

```bash
node scripts/trace-spike/run-spike.js \
  --execute \
  --engine-package "@paulirish/trace_engine" \
  --engine-version "EXACT_VERSION_AFTER_REVIEW" \
  --tool-commit-sha "FULL_TOOL_COMMIT_SHA" \
  --manifest "$TRACE_SPIKE_MANIFEST" \
  --prd "$TRACE_SPIKE_PRD" \
  --output-dir "docs/superpowers/reports"
```

No candidate version is hard-coded. The real manifest and all Trace samples
must remain outside every Git worktree. The runner must not print their paths or
contents.

## Files

- `run-spike.js`: the only orchestration entry and the only `--dry-run` owner.
- `spike-core.js`: manifest, normalization, privacy, decision, and cleanup logic.
- `self-test.js`: Node built-in assertion tests.
- `sample-manifest.example.json`: synthetic structure example without real paths.
- `probes/*`: templates copied only into an authorized temporary clone.

The tools do not modify `src/`, dependency manifests, lock files, or CI.
