# Roadmap

The current release supports single-host batch processing, durable run control, immutable snapshots, a local investigation interface, and a public recorded demo. See [architecture](architecture.md) and [verification](evidence/verification.md) for implemented behavior and evidence.

## Planned improvements

| Area | Proposed change | Acceptance criterion |
|---|---|---|
| Query storage | Replace per-request report JSON loading with an indexed detail store | Search and pagination return the same records with measured memory and latency bounds |
| Incremental processing | Recompute affected partitions and dependencies | Results match full rebuilds for late, reordered, and corrected events |
| Retention | Add bounded retention and reviewed orphan cleanup | Active snapshots and evidence required by retained runs remain intact |
| Operations | Extend shutdown and multi-process tests | Accepted requests remain traceable across worker restarts and contention |
| Frontend | Generate API types and split page modules | Existing browser journeys and accessibility checks continue to pass |
| Accessibility | Add human assistive-technology review | Core investigation and recovery tasks work with keyboard and screen reader |

## Outside the current release

Cloud backend deployment, external provider ingestion, distributed orchestration, multiple currencies, multiple warehouses, and multi-user authorization are not implemented. Each needs its own requirements and verification before being treated as supported.
