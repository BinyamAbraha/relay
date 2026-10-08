# ADR 001: Single-host run control

Status: accepted.

## Context

The application needs durable run requests, safe retries, and consistent snapshot publication on one machine. Local setup should not depend on external databases or schedulers.

## Decision

Use SQLite for run metadata and the active publication pointer, a file lock to serialize writers, and one local worker. DuckDB performs analytical transformations and writes immutable snapshot artifacts. All processing storage uses an accessible local filesystem; network filesystems are outside the supported topology.

## Consequences

SQLite transactions protect control state while completed files are retained separately. Crash boundaries can be tested directly without external services. Readers use completed snapshots while a writer prepares the next candidate.

This design does not provide multi-host scheduling, high availability, or multi-user authentication. Each input batch is rebuilt in full. A distributed implementation would need shared durable storage and a coordination protocol that preserves the publication and recovery behavior. Incremental updates would require equivalence checks against full rebuilds.
