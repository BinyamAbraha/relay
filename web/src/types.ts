export type Status =
  "queued" | "running" | "published" | "blocked" | "failed" | "cancelled";
export interface Run {
  id: string;
  scenario: string;
  status: Status;
  created_at: string;
  updated_at: string;
  raw_hash: string;
  input_count: number;
  elapsed_ms: number | null;
  error: string | null;
  parent_id: string | null;
  steps: { name: string; detail: string; at: string }[];
}
export interface Check {
  id: string;
  name: string;
  expected: number;
  observed: number;
  difference: number;
  unit: string;
  passed: boolean;
  description: string;
}
export interface Exception {
  code: string;
  event_id: string;
  line: number | null;
  message: string;
  severity: string;
}
export interface Totals {
  booked_cents: number;
  captured_cents: number;
  refunded_cents: number;
  net_cents: number;
}
export interface Event {
  source: string;
  event_id: string;
  event_type: string;
  entity_id: string;
  occurred_at: string;
  ingested_at: string;
  payload: Record<string, unknown>;
  input_line: number;
  business_hash: string;
}
export interface Order {
  order_id: string;
  customer_id: string;
  occurred_at: string;
  booked_cents: number;
  captured_cents: number;
  refunded_cents: number;
  net_cents: number;
  events?: Event[];
  lines?: {
    sku: string;
    product: string;
    quantity: number;
    unit_price_cents: number;
    product_event_id: string;
  }[];
  run_id?: string;
}
export interface Report {
  run_id: string;
  scenario: string;
  totals: Totals;
  fingerprint: string;
  input_count: number;
  accepted_count: number;
  duplicate_count: number;
  exceptions: Exception[];
  checks: Check[];
  can_publish: boolean;
  daily: ({ date: string; events: number } & Totals)[];
  inventory: { sku: string; product: string; on_hand: number }[];
  event_time_min: string;
  event_time_max: string;
  arrival_time_max: string;
  orders?: Order[];
  transform_version: string;
}
export interface Overview {
  mode: string;
  active_run: Run | null;
  report: Report | null;
  runs: Run[];
  orphan_snapshots: string[];
}
export interface Scenario {
  id: string;
  name: string;
  category: string;
  description: string;
  invariant: string;
  outcome: string;
}
export interface Benchmark {
  recorded_at?: string;
  platform?: string;
  python?: string;
  processor?: string;
  method?: string;
  results: {
    orders: number;
    events: number;
    elapsed_seconds: number;
    events_per_second: number;
    peak_rss_mib: number;
    repeat: number;
    checks_passed: boolean;
  }[];
}
export interface Compare {
  before: string;
  after: string;
  same_business_result: boolean;
  metrics: { id: string; before: number; after: number; difference: number }[];
  before_fingerprint: string;
  after_fingerprint: string;
}
export interface Bundle {
  mode: "recorded";
  exported_at: string;
  overview: Overview;
  scenarios: Scenario[];
  reports: Record<string, Report>;
  benchmarks: Benchmark;
}
