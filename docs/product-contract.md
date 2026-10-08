# Business rules and event contract

Relay models synthetic USD transactions for one warehouse. It produces cash and stock reports from complete event batches. Multiple currencies, tax accounting, revenue recognition, reservations, and multi-warehouse operations are outside the current model.

## Metrics

| Metric | Definition |
|---|---|
| Booked order value | Accepted quantity multiplied by the accepted unit price, in cents |
| Gross collections | Unique successful payment captures |
| Refunds issued | Unique successful refunds |
| Net collections | Gross collections minus refunds; a cash metric, not recognized revenue |
| Physical stock | Opening quantity plus receipts plus signed adjustments minus shipments |

An order for two units at 2,500 cents has booked value 5,000 cents. A 5,000-cent capture adds that amount to gross collections. A later 2,500-cent refund reduces cumulative net collections to 2,500 cents. It does not replenish physical stock; that requires a separate receipt or adjustment. An order alone does not reduce physical stock.

Accepted order prices remain unchanged when the product catalog changes. Historical product attributes are selected using the order's event time.

## Event envelope

[Event](../relay/domain.py) requires `source`, `event_id`, `event_type`, `schema_version`, `occurred_at`, `ingested_at`, `entity_id`, and `payload`. Each event type has a typed payload contract. Money and quantities use strict integers. Unsupported required schemas and invalid values become exceptions with their original input reference.

Timestamps must include an offset and are normalized to UTC. `occurred_at` determines the business date. `ingested_at` records arrival and is excluded from the business-content hash. Additional fields are retained; additional business content still participates in the hash.

Identity is `(source, event_id)`:

- Identical business content under the same identity is a replay. One deterministic representative contributes to the result.
- Different business content under the same identity is a conflict. Every conflicting variant is quarantined; arrival order does not select a winner.
- A business change requires a new identity and the appropriate relation to its entity.

## Relationships and late events

Refunds require corresponding captured payments. Shipments require accepted orders and cannot exceed accepted quantities. Cumulative refunds cannot exceed the captured amount under the current rules. Missing prerequisites are reported as pending; they are distinct from malformed input.

A late refund belongs to its event date, even when it arrives several days later. Daily cash results record captures and refunds on their own dates. They are not expected to equal daily bookings.

The current engine rebuilds a self-contained batch. It resolves reordered prerequisites present in that batch; it does not maintain an incremental cross-batch state store. Adding a missing prerequisite requires evaluating the complete corrected batch. Date-range backfills and dependency-aware incremental updates are not implemented.

## Publication

Raw input is retained with a checksum. Candidate output is written in a run-specific staging directory. Checks include input validity, relationship readiness, reconciliation, and inventory constraints. Negative physical stock blocks publication.

Only a complete candidate that passes the checks can become the active snapshot. Completed files are synchronized and renamed before a SQLite transaction updates the publication pointer. A failed or blocked attempt preserves the previous publication.

A failure between output completion and pointer commit can leave an unreferenced snapshot. The store detects that output but does not delete it automatically. Retry validates retained-input integrity and creates a linked child run. The child reprocesses the full input.

## Reproducibility and tests

Snapshot manifests record artifact hashes and run/transformation metadata. Business fingerprints compare financial totals, daily results, inventory, and historical order lines. Run IDs and execution timestamps can differ between otherwise equivalent runs.

[Domain tests](../tests/test_domain.py), [engine tests](../tests/test_engine.py), and [store tests](../tests/test_store.py) cover the contract, including hand-calculated fixtures, replay/permutation properties, conflicts, historical attributes, pending relationships, and interruption before publication. See [verification](evidence/verification.md) for the recorded results and testing limits.
