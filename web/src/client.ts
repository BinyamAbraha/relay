import type {
  Bundle,
  Overview,
  Run,
  Report,
  Scenario,
  Order,
  Benchmark,
  Compare,
} from "./types";
export const recorded =
  import.meta.env.VITE_RELAY_MODE === "recorded" ||
  new URLSearchParams(location.search).get("demo") === "1";
let bundlePromise: Promise<Bundle> | undefined;
export const bundle = (): Promise<Bundle> =>
  (bundlePromise ??= fetch(`${import.meta.env.BASE_URL}demo.json`).then((r) => {
    if (!r.ok)
      throw Error(
        "Recorded evidence could not be loaded. Export a demo bundle first.",
      );
    return r.json();
  }));
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, init);
  if (!r.ok) {
    const body = await r
      .json()
      .catch(() => ({ detail: `Request failed (${r.status})` }));
    throw Error(
      typeof body.detail === "string"
        ? body.detail
        : JSON.stringify(body.detail),
    );
  }
  return r.json();
}
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
export const api = {
  overview: async (): Promise<Overview> =>
    recorded ? (await bundle()).overview : request("/overview"),
  scenarios: async (): Promise<Scenario[]> =>
    recorded ? (await bundle()).scenarios : request("/scenarios"),
  run: async (id: string): Promise<{ run: Run; report: Report | null }> => {
    if (!recorded) return request(`/runs/${id}`);
    const b = await bundle();
    const run = b.overview.runs.find((r) => r.id === id);
    if (!run) throw Error("Run not present in this recording.");
    return { run, report: b.reports[id] ?? null };
  },
  start: async (scenario: string): Promise<Run> => {
    if (recorded)
      throw Error("Run controls are available in the local application.");
    return post("/runs", { scenario, orders: 160, seed: 42 });
  },
  retry: async (id: string): Promise<Run> => {
    if (recorded) throw Error("Retry is available in the local application.");
    return post(`/runs/${id}/retry`);
  },
  cancel: async (id: string): Promise<Run> => {
    if (recorded) throw Error("Cancellation is available locally.");
    return post(`/runs/${id}/cancel`);
  },
  orders: async (
    search: string,
    offset: number,
    runId?: string,
  ): Promise<{ items: Order[]; total: number; run_id?: string }> => {
    if (!recorded)
      return request(
        `/orders?search=${encodeURIComponent(search)}&offset=${offset}&limit=15${runId ? `&run_id=${runId}` : ""}`,
      );
    const b = await bundle();
    const id = runId ?? b.overview.active_run?.id;
    const items = (id ? (b.reports[id]?.orders ?? []) : []).filter((o) =>
      (o.order_id + " " + o.customer_id)
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
    return {
      items: items.slice(offset, offset + 15),
      total: items.length,
      run_id: id,
    };
  },
  order: async (id: string, runId?: string): Promise<Order> => {
    if (!recorded)
      return request(`/orders/${id}${runId ? `?run_id=${runId}` : ""}`);
    const b = await bundle();
    const rid = runId ?? b.overview.active_run?.id;
    const order = rid
      ? b.reports[rid]?.orders?.find((o) => o.order_id === id)
      : undefined;
    if (!order) throw Error("Order not in the recorded snapshot.");
    return { ...order, run_id: rid };
  },
  compare: async (before: string, after: string): Promise<Compare> => {
    if (!recorded) return request(`/compare?before=${before}&after=${after}`);
    const b = await bundle();
    const a = b.reports[before],
      c = b.reports[after];
    return {
      before,
      after,
      same_business_result: a.fingerprint === c.fingerprint,
      before_fingerprint: a.fingerprint,
      after_fingerprint: c.fingerprint,
      metrics: Object.keys(a.totals).map((key) => ({
        id: key,
        before: a.totals[key as keyof typeof a.totals],
        after: c.totals[key as keyof typeof c.totals],
        difference:
          c.totals[key as keyof typeof c.totals] -
          a.totals[key as keyof typeof a.totals],
      })),
    };
  },
  benchmarks: async (): Promise<Benchmark> =>
    recorded ? (await bundle()).benchmarks : request("/benchmarks"),
};
