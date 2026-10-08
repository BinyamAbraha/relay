# Relay

[![Verify Relay](https://github.com/BinyamAbraha/relay/actions/workflows/ci.yml/badge.svg)](https://github.com/BinyamAbraha/relay/actions/workflows/ci.yml)

**Order, payment, refund, and inventory reporting with validation and recovery.**

Relay processes synthetic business events on one host. It handles duplicate delivery, quarantines conflicting events, checks financial and stock totals, and publishes complete snapshots. A React interface provides run history, record lineage, and snapshot comparison.

[Recorded demo](https://relay-data-operations.binyam267285.chatgpt.site) · [Case study](docs/portfolio/case-study.md) · [Video](docs/evidence/relay-walkthrough.webm)

![Relay overview](docs/evidence/overview-desktop.png)

## Run locally

Prerequisites: Python 3.11 and Node.js 22 on macOS or Linux. Installation and checks have passed on Apple Silicon macOS and Ubuntu GitHub Actions. Windows is not supported by the current file-lock implementation.

```bash
bash scripts/setup.sh
bash scripts/start.sh
```

Open **http://127.0.0.1:8000**. API documentation is at **http://127.0.0.1:8000/docs**.

Generated data is stored in `.relay`, which is excluded from Git. Set `RELAY_DATA_DIR` to use a different accessible local directory. Keep staging and snapshot directories on the same filesystem.

## Features

- Eight deterministic scenarios covering baseline processing, duplicate delivery, late refunds, conflicting identities, invalid schemas, missing prerequisites, interrupted publication, and negative stock.
- Strict money, timestamp, and schema validation with retained source input.
- Historical product attributes, DuckDB SQL reports, Parquet artifacts, and independent source-ledger reconciliation.
- SQLite run control, idempotent requests, cancellation, retained-input retry, and immutable snapshots.
- Run inspection, record lineage, order search, snapshot comparison, and measured benchmarks.

Stack: Python, Pydantic, DuckDB, Parquet, SQLite, FastAPI, React, TypeScript, Vite, pytest/Hypothesis, and Playwright/axe.

## Explore the application

In the local application:

1. Run **Baseline batch**, then **Duplicate payments**. Compare the snapshots; their business fingerprints match.
2. Run **Conflicting payment**. Inspect the exceptions and the preserved previous publication.
3. Run **Interrupted publication**, then **Retry retained input**. Inspect the failed parent and published child.
4. In **Record explorer**, search `ORD-10400` and follow its accepted price, capture, shipment, and refund.

The public demo displays saved results from these scenarios. It does not execute the backend. Its recorded label identifies the capture time; new runs and retries require a local installation.

## Checks and builds

```bash
make test             # Backend tests
make lint             # Python and frontend lint/format checks
make browser-setup    # Install Chromium for browser checks
make browser-test     # Local browser journeys and accessibility scans
make public-demo      # Export recorded evidence and build static assets
make public-test      # Verify the static build without a backend
make benchmark        # Measure generation through report assembly
```

Browser tests need ports 8000 and 4174 to be free for local and static checks respectively. `make public-demo` writes the static application to `web/dist-recorded`. The writable local application uses `web/dist`.

## Performance

The largest measured workload processed **102,009 synthetic events in a median 4.0762 seconds**, with maximum observed peak RSS **988.5 MiB**, across three repetitions on an M4 Mac mini. This measures generation through report assembly and excludes disk persistence, publication, imports, API, and UI work. [Methodology and results](docs/benchmarks.md).

## Documentation

- [Architecture and code map](docs/architecture.md)
- [Business rules and event contract](docs/product-contract.md)
- [Interface behavior](docs/interface-specification.md)
- [Verification evidence](docs/evidence/verification.md)
- [Design decision: single-host processing](docs/decisions/001-local-control-plane.md)
- [Roadmap](docs/roadmap.md)

## Limitations

Relay uses full-batch processing, synthetic USD data, and one warehouse. Incremental recomputation, distributed workers, authentication, multi-user operation, external provider connectors, and a cloud backend are not implemented. The local benchmarks are not production-load measurements.

## Development

AI tools assisted implementation, testing, and documentation.
