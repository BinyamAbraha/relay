# Interface behavior

The interface supports two tasks: investigating a reported value and inspecting a processing failure. Published results remain separate from candidate output so a failed attempt does not appear to invalidate the previous report.

## Screens

| Screen | Purpose |
|---|---|
| Overview | Current publication, financial metrics, physical inventory, recent runs, and checks |
| Scenario Lab | Defined input conditions and expected outcomes; local execution or recorded inspection |
| Pipeline runs | Recent attempts, processing steps, terminal state, and retry lineage |
| Reconciliation | Expected, observed, and difference values for published checks |
| Record explorer | Order search and pagination, accepted line items, and event lineage |
| Compare snapshots | Fingerprint equality and financial differences between selected publications |
| Engineering evidence | Processing architecture, measured benchmarks, and supported scope |

## Visual system

[styles.css](../web/src/styles.css) defines a neutral canvas, white surfaces, near-black text, and restrained blue actions. Shared React components in [App.tsx](../web/src/App.tsx) provide headings, panels, buttons, status badges, metrics, and error/empty states. Financial columns use tabular numerals. Monospace text identifies records and timestamps.

Status is conveyed by text and icons as well as color. Dense tables scroll within their containers on narrow screens. Navigation collapses into a toggleable panel. Labels describe the underlying condition, such as "Duplicate payments" or "Interrupted publication".

## Data and states

The [client adapter](../web/src/client.ts) reads either local API responses or a recorded bundle through the same [TypeScript view models](../web/src/types.ts).

- Loading states appear while data is being fetched.
- Empty states explain the missing result and available action.
- Failed refreshes retain already loaded results with a connection notice.
- Blocked and failed runs show their error and candidate checks separately from the active publication.
- Run progress displays processing stages rather than an estimated completion percentage.
- Local retry creates a new linked run using retained input.

The recorded build has a persistent disclosure with capture time and source-publication context. Its controls inspect saved evidence. Mutation controls are available in local mode only.

## Accessibility

The application provides keyboard navigation, visible focus styles, named controls, a skip link, and dialog focus handling with Escape dismissal. Charts include a data-table alternative. Reduced-motion preferences are respected.

Browser tests check narrow-screen overflow, navigation, record inspection, and axe rules across the main screens. Human screen-reader review remains planned. See [verification](evidence/verification.md) and the [browser journeys](../web/tests/journeys.spec.ts).
