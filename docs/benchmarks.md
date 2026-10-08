# Benchmarks

These measurements cover deterministic synthetic batches on an Apple Silicon M4 Mac mini with 16 GB RAM and Python 3.11. Each workload ran three times in fresh child processes. The table reports median elapsed time and maximum observed peak RSS for the optimized version.

| Orders | Events | Original median | Optimized median | Relative speed | Optimized peak RSS |
|---:|---:|---:|---:|---:|---:|
| 100 | 319 | 0.2570 s | 0.0167 s | 15.4× | 76.8 MiB |
| 1,000 | 3,100 | 2.4812 s | 0.1107 s | 22.4× | 127.8 MiB |
| 5,000 | 15,464 | 12.7283 s | 0.5571 s | 22.8× | 258.5 MiB |
| 33,000 | 102,009 | Not measured | 4.0762 s | Not measured | 988.5 MiB |

Raw observations: [original](evidence/benchmark-before.json) and [optimized](evidence/benchmark-after.json).

## Measurement scope

`bench-child` in [cli.py](../relay/cli.py) starts its timer before `generate()` and calls `evaluate()` without an output directory. The measurement includes generation, validation, relationship resolution, SQL processing, reconciliation, and report assembly.

Process launch and imports occur before the timer. Raw-input persistence, Parquet writes, file synchronization, the publication transaction, API calls, and browser rendering are excluded. OS cache state and other machine activity were not controlled.

Peak RSS comes from `resource.getrusage` and includes the interpreter and imported libraries. macOS reports bytes and Linux reports KiB; the CLI converts both to MiB. This is the peak memory of the whole process, not the DuckDB memory limit.

## Optimization and tradeoff

The original engine inserted normalized rows using DuckDB `executemany`. Profiling a 1,000-order batch identified those insertion calls as the main bottleneck. The current `bulk_insert()` in [engine.py](../relay/engine.py) serializes each table into one JSON parameter. SQL uses `json_each` and typed casts to load rows in bulk. Table names and types are defined by the implementation; input data is passed as a parameter.

For 15,464 events, median elapsed time decreased from 12.7283 s to 0.5571 s. Maximum observed peak RSS increased from 171.4 MiB to 258.5 MiB. The JSON buffers improve measured speed at the cost of additional memory.

Business fingerprints matched across the overlapping workloads before and after the change. All optimized repetitions passed publication checks. The largest workload has no original measurement, so no speedup is reported for it.

## Reproduce

From an installed checkout:

```bash
.venv/bin/python -m relay.cli benchmark --sizes 100 1000 5000 33000 --repeats 3
```

Results are written to `benchmarks.json` in the configured data directory. To profile one batch:

```bash
.venv/bin/python -m cProfile -s cumulative -m relay.cli bench-child --orders 1000
```

Profiling adds overhead; its elapsed time is not comparable to the unprofiled timing table. The original measurements are preserved observations from the earlier implementation, not a second engine available in the current checkout.

## Limits

These results do not measure end-to-end ingestion, concurrent workloads, network traffic, cloud costs, or production throughput. Three repetitions provide a small sample. Larger batches retain several in-memory representations, so memory use is a practical limit of this implementation.
