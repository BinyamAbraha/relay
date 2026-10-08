# Verification

The application has been checked on Apple Silicon macOS with Python 3.11 and Node.js 22, and on Ubuntu through [GitHub Actions](https://github.com/BinyamAbraha/relay/actions/workflows/ci.yml).

## Automated checks

| Command | Recorded result | Coverage |
|---|---|---|
| `make test` | 39 passed | Domain contracts, hand-calculated fixtures, generated replay/permutation cases, relationship constraints, recovery, API limits |
| `make lint` | Passed | Python lint/format and frontend formatting |
| `npm run --prefix web build` | Passed | TypeScript checks and local production assets |
| `make browser-test` | 10 passed | Local execution, interruption/retry, record search, comparison, stale and empty states, accessibility scans |
| `make public-demo` | Passed | Eight scenario expectations, recovery child, recorded export, static build |
| `make public-test` | 2 passed | Public root navigation without API requests, saved recovery evidence, narrow layout |

The backend suite includes worker-process termination before publication, retained-input tampering, concurrent identical submissions, and selection of the oldest queued request after more than 200 newer requests. A Starlette TestClient/httpx deprecation warning remains; it does not fail the assertions.

## Installation and CI

A fresh installation copy on macOS installed pinned dependencies, built the frontend, and seeded the expected scenario outcomes. The Ubuntu workflow installs dependencies and Chromium, then runs backend, formatting, local browser, static demo, and documentation checks. The workflow page links each result to the source revision that was tested.

## Interface review

Desktop and narrow layouts have been inspected for text wrapping, aligned financial columns, long identifiers, contained table scrolling, recorded-mode disclosure, and the distinction between candidate and published values. Browser checks cover keyboard dismissal, navigation, preservation of loaded results after a failed refresh, and empty states.

Axe returned zero violations for the scanned WCAG A/AA rules and states. Automated scans do not replace human assistive-technology review.

- [Desktop overview](overview-desktop.png)
- [Mobile overview](overview-mobile.png)
- [Blocked run](blocked-run.png)
- [Scenario Lab](scenarios-desktop.png)
- [Record explorer](orders-desktop.png)
- [Comparison](compare-desktop.png)
- [Recorded walkthrough](relay-walkthrough.webm)

## Integrity and performance

The CLI `verify` operation checks retained-input integrity and compares six output-file hashes against a published snapshot's manifest. The recorded baseline and duplicate-delivery results have matching business fingerprints. The interrupted run and recovery child reference the same retained input.

[Benchmark methodology](../benchmarks.md) defines the timing boundary, memory measurement, repetitions, and limitations. The [original](benchmark-before.json) and [optimized](benchmark-after.json) records retain individual observations.

## Scope

Testing covers synthetic data, local batch processing, and the recorded frontend. A cloud Python worker, production load, physical power loss, external provider integration, and multi-user authorization have not been tested. The public site serves static recorded results.
