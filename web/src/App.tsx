import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  FileCheck2,
  FlaskConical,
  GitCompareArrows,
  Layers3,
  LayoutDashboard,
  Menu,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Terminal,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { api, bundle, recorded } from "./client";
import type {
  Check as CheckType,
  Overview,
  Report,
  Run,
  Scenario,
  Status,
} from "./types";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value / 100);
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const date = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
const short = (value: string) => value.slice(0, 8);
const metricNames: Record<string, string> = {
  booked_cents: "Booked order value",
  captured_cents: "Gross collections",
  refunded_cents: "Refunds issued",
  net_cents: "Net collections",
};
const statusLabels: Record<Status, string> = {
  published: "Published",
  blocked: "Blocked",
  failed: "Interrupted",
  cancelled: "Cancelled",
  queued: "Queued",
  running: "Running",
};
const scenarioNames: Record<string, string> = {
  baseline: "Baseline batch",
  duplicates: "Duplicate payments",
  late_refund: "Late refund",
  conflict: "Conflicting payment",
  invalid: "Unsupported schema",
  missing_payment: "Refund without payment",
  interrupted: "Interrupted publication",
  negative_stock: "Negative inventory",
};

function useLoad<T>(loader: () => Promise<T>, deps: unknown[], interval = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError("");
    const load = () =>
      loader()
        .then((value) => {
          if (!cancelled) {
            setData(value);
            setError("");
            setLoading(false);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setError(String(e.message));
            setLoading(false);
          }
        });
    void load();
    const timer =
      interval && !recorded ? window.setInterval(load, interval) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [...deps, version]); // loaders are paired with explicit dependency lists
  return { data, error, loading, reload: () => setVersion((v) => v + 1) };
}
function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      <span className="status-dot" />
      {statusLabels[status]}
    </span>
  );
}
function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}
function Button({
  children,
  onClick,
  kind = "secondary",
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  kind?: string;
  disabled?: boolean;
}) {
  return (
    <button className={`button ${kind}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Database size={26} />
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="notice danger" role="alert">
      <TriangleAlert size={18} />
      <div>
        <strong>Request failed.</strong>
        <p>{message}</p>
      </div>
      {retry && (
        <button className="text-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Loading evidence…
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}
function Panel({
  title,
  caption,
  action,
  children,
  className = "",
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {caption && <p>{caption}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-button"
      aria-label={`Copy ${value}`}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
function Checks({
  checks,
  compact = false,
}: {
  checks: CheckType[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "checks compact" : "checks"}>
      {checks.map((c) => (
        <div className="check-row" key={c.id}>
          {c.passed ? (
            <CheckCircle2 size={18} className="green" />
          ) : (
            <XCircle size={18} className="red" />
          )}
          <div>
            <strong>{c.name}</strong>
            {!compact && <p>{c.description}</p>}
          </div>
          <span className={c.passed ? "check-result" : "check-result red"}>
            {c.passed ? "Passed" : `${c.observed} ${c.unit}`}
          </span>
        </div>
      ))}
    </div>
  );
}
function Metrics({ report }: { report: Report }) {
  return (
    <div className="metrics">
      {(
        [
          "booked_cents",
          "captured_cents",
          "refunded_cents",
          "net_cents",
        ] as const
      ).map((key, index) => (
        <div className="metric" key={key}>
          <div className="metric-label">
            {metricNames[key]}
            {index === 2 ? (
              <ArrowDownLeft size={15} />
            ) : (
              <ArrowUpRight size={15} />
            )}
          </div>
          <strong>{money(report.totals[key])}</strong>
          <span>
            {
              [
                "Accepted line-item value",
                "Unique successful captures",
                "Successful refunds",
                "Collections less refunds",
              ][index]
            }
          </span>
        </div>
      ))}
    </div>
  );
}
function CashChart({ report }: { report: Report }) {
  const data = report.daily,
    max = Math.max(...data.map((d) => d.captured_cents), 1);
  return (
    <div className="chart">
      <div className="chart-legend">
        <span>
          <i className="legend-blue" />
          Gross collections
        </span>
        <span>
          <i className="legend-gray" />
          Refunds issued
        </span>
        <span className="chart-unit">USD · effective date</span>
      </div>
      <div className="chart-body">
        <div className="chart-axis">
          {[1, 0.75, 0.5, 0.25, 0].map((n) => (
            <span key={n}>{money(max * n).replace(".00", "")}</span>
          ))}
        </div>
        <div className="chart-plot">
          <div className="grid-lines">
            {[0, 1, 2, 3, 4].map((n) => (
              <i key={n} />
            ))}
          </div>
          <div className="bar-groups">
            {data.map((d) => (
              <div className="bar-group" key={d.date}>
                <div
                  className="bars"
                  title={`${d.date}: collected ${money(d.captured_cents)}, refunded ${money(d.refunded_cents)}`}
                >
                  <div
                    className="bar blue"
                    style={{ height: `${(d.captured_cents / max) * 100}%` }}
                  />
                  <div
                    className="bar gray"
                    style={{ height: `${(d.refunded_cents / max) * 100}%` }}
                  />
                </div>
                <span>{d.date.slice(5).replace("-", " / ")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="chart-note">
        Refunds stay on their effective date, even when they arrive later.
      </p>
      <details>
        <summary>View chart data</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date (UTC)</th>
                <th className="numeric">Collections</th>
                <th className="numeric">Refunds</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td className="numeric">{money(d.captured_cents)}</td>
                  <td className="numeric">{money(d.refunded_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
function RunList({ runs, go }: { runs: Run[]; go: (path: string) => void }) {
  return (
    <div className="run-list">
      {runs.length ? (
        runs.map((run) => (
          <button
            className="run-list-item"
            key={run.id}
            onClick={() => go(`runs/${run.id}`)}
          >
            <span className={`run-symbol ${run.status}`}>
              {run.status === "published" ? (
                <Check size={17} />
              ) : run.status === "blocked" ? (
                <ShieldCheck size={17} />
              ) : (
                <Activity size={17} />
              )}
            </span>
            <span className="run-summary">
              <strong>{scenarioNames[run.scenario] ?? run.scenario}</strong>
              <span>
                <code>{short(run.id)}</code> ·{" "}
                {run.elapsed_ms === null
                  ? "Awaiting worker"
                  : `${(run.elapsed_ms / 1000).toFixed(2)}s`}
              </span>
            </span>
            <Badge status={run.status} />
            <ChevronRight size={16} />
          </button>
        ))
      ) : (
        <Empty title="No runs yet" detail="Start with the baseline scenario." />
      )}
    </div>
  );
}

function OverviewPage({
  state,
  go,
}: {
  state: Overview;
  go: (path: string) => void;
}) {
  const report = state.report,
    active = state.active_run;
  return (
    <>
      <Heading
        eyebrow="Workspace overview"
        title="Order and inventory reporting"
        description="Order, cash, and inventory reporting from the latest validated snapshot."
        actions={
          <Button kind="primary" onClick={() => go("scenarios")}>
            <Play size={15} />
            Run a scenario
          </Button>
        }
      />
      {!report || !active ? (
        <Panel title="Your first publication">
          <Empty
            title="No published snapshot"
            detail="Generate the reference dataset and publish your first verified snapshot."
            action={
              <Button kind="primary" onClick={() => go("scenarios")}>
                Open scenario lab <ArrowRight size={16} />
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="notice success">
            <ShieldCheck size={21} />
            <div>
              <strong>Last published snapshot verified</strong>
              <p>
                {report.checks.length} checks passed ·{" "}
                {number(report.accepted_count)} unique events · Published{" "}
                {date(active.updated_at)}
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => go(`runs/${active.id}`)}
            >
              Inspect publication <ArrowRight size={15} />
            </button>
          </div>
          {state.runs[0] && state.runs[0].id !== active.id && (
            <div className="subtle-notice">
              <Clock3 size={15} />
              Latest attempt: {statusLabels[state.runs[0].status].toLowerCase()}
              . These metrics still show the last valid publication.
            </div>
          )}
          <Metrics report={report} />
          <div className="two-column">
            <Panel
              title="Cash movement"
              caption="Successful captures and refunds, by business date"
              action={<Pill>USD</Pill>}
            >
              <CashChart report={report} />
            </Panel>
            <Panel
              title="Recent activity"
              caption="Recent pipeline runs"
              action={
                <button className="text-button" onClick={() => go("runs")}>
                  All runs <ArrowRight size={14} />
                </button>
              }
            >
              <RunList runs={state.runs.slice(0, 4)} go={go} />
              <div className="panel-footnote">
                <Layers3 size={14} />
                Failed attempts never replace a valid report.
              </div>
            </Panel>
          </div>
          <div className="two-column">
            <Panel
              title="Physical inventory"
              caption="Receipts + adjustments − shipments"
              action={<Pill>{report.inventory.length} products</Pill>}
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th className="numeric">On hand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.inventory.map((i) => (
                      <tr key={i.sku}>
                        <td>
                          <strong>{i.product}</strong>
                        </td>
                        <td>
                          <code>{i.sku}</code>
                        </td>
                        <td className="numeric">
                          {number(i.on_hand)}{" "}
                          <span className="muted">units</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel
              title="Publication checks"
              caption="Source calculations compared with SQL totals"
              action={
                <button className="text-button" onClick={() => go("checks")}>
                  Details <ArrowRight size={14} />
                </button>
              }
            >
              <Checks checks={report.checks} compact />
            </Panel>
          </div>
          <div className="provenance">
            <FileCheck2 size={15} />
            <span>
              Synthetic reference data · Business period{" "}
              {report.event_time_min.slice(0, 10)} →{" "}
              {report.event_time_max.slice(0, 10)}
            </span>
            <code>{report.transform_version}</code>
          </div>
        </>
      )}
    </>
  );
}
function ScenariosPage({
  state,
  go,
}: {
  state: Overview;
  go: (path: string) => void;
}) {
  const { data, error, loading, reload } = useLoad(api.scenarios, []);
  const [pending, setPending] = useState(""),
    [actionError, setActionError] = useState("");
  async function launch(s: Scenario) {
    setPending(s.id);
    setActionError("");
    try {
      if (recorded) {
        const run = state.runs.find((r) => r.scenario === s.id);
        if (run) go(`runs/${run.id}`);
      } else {
        const run = await api.start(s.id);
        go(`runs/${run.id}`);
      }
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPending("");
    }
  }
  return (
    <>
      <Heading
        eyebrow="Controlled experiments"
        title="Scenario lab"
        description="Test how the pipeline handles duplicate, delayed, invalid, and interrupted input."
      />
      <div className="editorial-note">
        <FlaskConical size={21} />
        <div>
          <strong>Each scenario processes its own batch.</strong>
          <p>
            160 orders with a fixed random seed. Each scenario tests a specific
            condition. Reports rebuild from retained input; existing raw data is
            preserved.
          </p>
        </div>
      </div>
      {error && <ErrorNotice message={error} retry={reload} />}{" "}
      {actionError && <ErrorNotice message={actionError} />}{" "}
      {loading ? (
        <Loading />
      ) : (
        <div className="scenario-grid">
          {data?.map((s, index) => (
            <section className="scenario-card" key={s.id}>
              <div className="scenario-top">
                <span className="scenario-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Pill>{s.category}</Pill>
              </div>
              <h2>{s.name}</h2>
              <p>{s.description}</p>
              <div className="invariant">
                <span>EXPECTED RESULT</span>
                {s.invariant}
              </div>
              <div className="scenario-bottom">
                <span className="expected">
                  Expected <Badge status={s.outcome as Status} />
                </span>
                <Button
                  kind={index === 0 ? "primary" : "secondary"}
                  disabled={
                    !!pending ||
                    (recorded && !state.runs.some((r) => r.scenario === s.id))
                  }
                  onClick={() => void launch(s)}
                >
                  {pending === s.id ? (
                    <span className="spinner" />
                  ) : (
                    <Play size={14} />
                  )}{" "}
                  {recorded ? "Inspect recording" : "Run scenario"}
                </Button>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
function RunsPage({
  state,
  go,
}: {
  state: Overview;
  go: (path: string) => void;
}) {
  return (
    <>
      <Heading
        eyebrow="Execution history"
        title="Pipeline runs"
        description="Inspect completed, blocked, and failed runs, along with their inputs and processing steps."
        actions={
          <Button kind="primary" onClick={() => go("scenarios")}>
            <Play size={15} />
            New scenario
          </Button>
        }
      />
      <Panel
        title="Run ledger"
        caption={`${state.runs.length} most recent runs`}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Scenario</th>
                <th>Status</th>
                <th>Created (UTC)</th>
                <th className="numeric">Inputs</th>
                <th className="numeric">Elapsed</th>
                <th>
                  <span className="sr-only">Inspect</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="link mono"
                      onClick={() => go(`runs/${r.id}`)}
                    >
                      {short(r.id)}
                    </button>
                  </td>
                  <td>
                    {scenarioNames[r.scenario] ?? r.scenario}
                    {r.parent_id && (
                      <small className="block muted">
                        Retry of {short(r.parent_id)}
                      </small>
                    )}
                  </td>
                  <td>
                    <Badge status={r.status} />
                  </td>
                  <td className="nowrap muted">{date(r.created_at)}</td>
                  <td className="numeric">{number(r.input_count)}</td>
                  <td className="numeric">
                    {r.elapsed_ms === null
                      ? "Not recorded"
                      : `${(r.elapsed_ms / 1000).toFixed(2)}s`}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Inspect run ${r.id}`}
                      onClick={() => go(`runs/${r.id}`)}
                    >
                      <ArrowRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!state.runs.length && (
          <Empty
            title="No attempts recorded"
            detail="Run a scenario to create the first entry."
          />
        )}
      </Panel>
    </>
  );
}
function RunPage({
  id,
  go,
  onUpdate,
}: {
  id: string;
  go: (path: string) => void;
  onUpdate: () => void;
}) {
  const { data, error, loading, reload } = useLoad(
    () => api.run(id),
    [id],
    1200,
  );
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  async function action(kind: "retry" | "cancel") {
    setBusy(true);
    setActionError("");
    try {
      const run = await api[kind](id);
      onUpdate();
      if (kind === "retry") go(`runs/${run.id}`);
      else reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  if (error || !data)
    return <ErrorNotice message={error || "Run unavailable"} retry={reload} />;
  const { run, report } = data;
  const active = ["running", "queued"].includes(run.status);
  return (
    <>
      <button className="back-link" onClick={() => go("runs")}>
        <ChevronLeft size={16} />
        All pipeline runs
      </button>
      <Heading
        eyebrow={`Run ${short(id)}`}
        title={scenarioNames[run.scenario] ?? run.scenario}
        description={`Created ${date(run.created_at)}${run.parent_id ? ` · Retried from ${short(run.parent_id)}` : ""}`}
        actions={
          <>
            <Badge status={run.status} />
            {!recorded &&
              (active ? (
                <Button disabled={busy} onClick={() => void action("cancel")}>
                  <Square size={14} />
                  Cancel at checkpoint
                </Button>
              ) : (
                run.status !== "published" && (
                  <Button
                    kind="primary"
                    disabled={busy}
                    onClick={() => void action("retry")}
                  >
                    <RefreshCw size={14} />
                    Retry retained input
                  </Button>
                )
              ))}
          </>
        }
      />
      {actionError && <ErrorNotice message={actionError} />}
      {run.error && (
        <div
          className={`notice ${run.status === "blocked" ? "warning" : "danger"}`}
        >
          <TriangleAlert size={19} />
          <div>
            <strong>
              {run.status === "blocked"
                ? "Publication prevented"
                : "Run did not publish"}
            </strong>
            <p>{run.error}</p>
          </div>
        </div>
      )}
      {run.status === "published" && (
        <div className="notice success">
          <CheckCircle2 size={20} />
          <div>
            <strong>Complete snapshot published</strong>
            <p>
              Candidate checks passed before the publication pointer changed.
            </p>
          </div>
        </div>
      )}
      <div className="run-stats">
        <div>
          <span>Input events</span>
          <strong>{number(run.input_count)}</strong>
        </div>
        <div>
          <span>Duplicate deliveries</span>
          <strong>
            {report ? number(report.duplicate_count) : "Not available"}
          </strong>
        </div>
        <div>
          <span>Elapsed</span>
          <strong>
            {run.elapsed_ms === null
              ? "In progress"
              : `${(run.elapsed_ms / 1000).toFixed(2)}s`}
          </strong>
        </div>
        <div>
          <span>Transformation</span>
          <strong className="mono">
            {report?.transform_version ?? "Awaiting output"}
          </strong>
        </div>
      </div>
      <div className="two-column">
        <Panel title="Execution trace" caption="Durable stage checkpoints">
          <ol className="timeline">
            {run.steps.map((step, index) => (
              <li key={step.name}>
                <span className="timeline-icon">
                  <Check size={14} />
                </span>
                <div>
                  <strong>{step.name}</strong>
                  <p>{step.detail}</p>
                  <time>{date(step.at)}</time>
                </div>
                <span className="step-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </li>
            ))}
            {active && (
              <li>
                <span className="spinner" />
                <div>
                  <strong>Worker processing</strong>
                  <p>The next checkpoint will appear automatically.</p>
                </div>
              </li>
            )}
          </ol>
        </Panel>
        <Panel
          title="Candidate checks"
          caption="A completed computation can still fail publication"
        >
          {report ? (
            <Checks checks={report.checks} />
          ) : (
            <Empty
              title="Waiting for candidate outputs"
              detail="Checks appear after validation and SQL processing finish."
            />
          )}
        </Panel>
      </div>
      {report && (
        <>
          <Panel
            title="Candidate business totals"
            caption={
              run.status === "published"
                ? "This snapshot passed publication checks."
                : "Diagnostic values. This candidate is not published."
            }
          >
            <Metrics report={report} />
          </Panel>
          {report.exceptions.length > 0 && (
            <Panel
              title="Exceptions"
              caption="Original input is available for inspection"
            >
              <div className="exceptions">
                {report.exceptions.map((e, index) => (
                  <div className="exception" key={`${e.event_id}-${index}`}>
                    <div>
                      <Pill>{e.severity}</Pill>
                      <code>{e.code}</code>
                    </div>
                    <p>{e.message}</p>
                    <span className="muted">
                      Event {e.event_id}
                      {e.line ? ` · input item ${e.line}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <Panel
            title="Traceability"
            caption="Content hashes identify the retained input and the business result"
          >
            <dl className="definition-grid">
              <dt>Input SHA-256</dt>
              <dd>
                <code>{run.raw_hash}</code>
                <CopyButton value={run.raw_hash} />
              </dd>
              <dt>Business fingerprint</dt>
              <dd>
                <code>{report.fingerprint}</code>
                <CopyButton value={report.fingerprint} />
              </dd>
              <dt>Latest business event</dt>
              <dd>{date(report.event_time_max)}</dd>
              <dt>Latest source arrival</dt>
              <dd>{date(report.arrival_time_max)}</dd>
            </dl>
          </Panel>
        </>
      )}
    </>
  );
}
function ChecksPage({
  state,
  go,
}: {
  state: Overview;
  go: (path: string) => void;
}) {
  const report = state.report;
  return (
    <>
      <Heading
        eyebrow="Publication checks"
        title="Reconciliation"
        description="Compare source-ledger calculations with the published SQL results."
      />
      {!report ? (
        <Empty
          title="No published evidence yet"
          detail="Publish a baseline scenario first."
        />
      ) : (
        <>
          <div className="notice success">
            <ShieldCheck size={20} />
            <div>
              <strong>
                {report.checks.length} of {report.checks.length} publication
                checks passed
              </strong>
              <p>
                Applies to snapshot {short(report.run_id)}. Failed candidates
                are inspected in the run ledger.
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => go(`runs/${report.run_id}`)}
            >
              View source run <ArrowRight size={14} />
            </button>
          </div>
          <Panel
            title="Expected versus observed"
            caption="Exact integer cents for financial checks"
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Check</th>
                    <th className="numeric">Expected</th>
                    <th className="numeric">Observed</th>
                    <th className="numeric">Difference</th>
                    <th>Unit</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.checks.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                      </td>
                      <td className="numeric">{number(c.expected)}</td>
                      <td className="numeric">{number(c.observed)}</td>
                      <td className="numeric">{number(c.difference)}</td>
                      <td className="muted">{c.unit}</td>
                      <td>
                        <span className="inline-success">
                          <CheckCircle2 size={15} />
                          Passed
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="What these checks establish">
            <Checks checks={report.checks} />
          </Panel>
          <div className="editorial-note">
            <BookOpen size={20} />
            <div>
              <strong>Check coverage</strong>
              <p>
                SQL reconciliation is supplemented by hand-calculated fixtures,
                replay and permutation tests, and failure-boundary tests. The
                generated dataset represents a documented, single-currency
                business model.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
function OrdersPage({
  go,
  selected,
}: {
  go: (path: string) => void;
  selected?: string;
}) {
  const initial = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [search, setSearch] = useState(initial.get("q") ?? ""),
    [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useLoad(
    () => api.orders(search, offset),
    [search, offset],
  );
  return (
    <>
      <Heading
        eyebrow="Source to report"
        title="Record explorer"
        description="Follow an order through its accepted price, captured payment, refund, and stock movement."
      />
      <Panel
        title="Orders in the published snapshot"
        action={
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search orders or customers"
              value={search}
              placeholder="Search order or customer…"
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
                history.replaceState(
                  null,
                  "",
                  `#orders?q=${encodeURIComponent(e.target.value)}`,
                );
              }}
            />
          </label>
        }
      >
        {error ? (
          <ErrorNotice message={error} retry={reload} />
        ) : loading ? (
          <Loading />
        ) : (
          data && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th className="numeric">Booked</th>
                      <th className="numeric">Collected</th>
                      <th className="numeric">Refunded</th>
                      <th className="numeric">Net collections</th>
                      <th>
                        <span className="sr-only">Inspect</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((o) => (
                      <tr key={o.order_id}>
                        <td>
                          <button
                            className="link mono"
                            onClick={() => go(`orders/${o.order_id}`)}
                          >
                            {o.order_id}
                          </button>
                        </td>
                        <td className="muted">{o.customer_id}</td>
                        <td className="numeric">{money(o.booked_cents)}</td>
                        <td className="numeric">{money(o.captured_cents)}</td>
                        <td className="numeric">{money(o.refunded_cents)}</td>
                        <td className="numeric">
                          <strong>{money(o.net_cents)}</strong>
                        </td>
                        <td>
                          <button
                            aria-label={`Trace ${o.order_id}`}
                            className="icon-button"
                            onClick={() => go(`orders/${o.order_id}`)}
                          >
                            <ArrowRight size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.items.length && (
                <Empty
                  title="No matching orders"
                  detail={
                    search
                      ? "Try a different order or customer ID."
                      : "Publish a scenario to explore its records."
                  }
                />
              )}
              <div className="pagination">
                <span>
                  {data.total
                    ? `${offset + 1} to ${Math.min(offset + 15, data.total)} of ${number(data.total)} orders`
                    : "0 orders"}
                </span>
                <div>
                  <Button
                    onClick={() => setOffset((v) => Math.max(0, v - 15))}
                    disabled={offset === 0}
                  >
                    <ChevronLeft size={15} />
                    Previous
                  </Button>
                  <Button
                    onClick={() => setOffset((v) => v + 15)}
                    disabled={offset + 15 >= data.total}
                  >
                    Next
                    <ChevronRight size={15} />
                  </Button>
                </div>
              </div>
            </>
          )
        )}
      </Panel>
      {selected && <OrderDrawer id={selected} close={() => go("orders")} />}
    </>
  );
}
function OrderDrawer({ id, close }: { id: string; close: () => void }) {
  const { data, error, loading } = useLoad(() => api.order(id), [id]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    ref.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button, a, summary, input, [tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = old;
      prior?.focus();
    };
  }, [id]);
  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-title"
        tabIndex={-1}
        ref={ref}
      >
        <div className="drawer-heading">
          <div>
            <div className="eyebrow">Order trace</div>
            <h2 id="order-title">{id}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close order trace"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorNotice message={error} />
        ) : (
          data && (
            <>
              <p className="muted">
                {data.customer_id} · Snapshot{" "}
                {data.run_id && short(data.run_id)}
              </p>
              <div className="drawer-metrics">
                <div>
                  <span>Accepted value</span>
                  <strong>{money(data.booked_cents)}</strong>
                </div>
                <div>
                  <span>Net collections</span>
                  <strong>{money(data.net_cents)}</strong>
                </div>
              </div>
              <h3>Accepted line items</h3>
              {data.lines?.map((l) => (
                <div className="line-item" key={l.sku}>
                  <Box size={20} />
                  <div>
                    <strong>{l.product}</strong>
                    <p>
                      {l.sku} · {l.quantity} × {money(l.unit_price_cents)}
                    </p>
                    <small className="muted">
                      Product version: {l.product_event_id}
                    </small>
                  </div>
                </div>
              ))}
              <h3>Event lineage</h3>
              <ol className="timeline order-timeline">
                {data.events?.map((e) => (
                  <li key={e.event_id}>
                    <span className="timeline-icon">
                      <Check size={14} />
                    </span>
                    <div>
                      <strong>{e.event_type}</strong>
                      <p>Occurred {date(e.occurred_at)}</p>
                      <p>Arrived {date(e.ingested_at)}</p>
                      <details>
                        <summary>Inspect input · item {e.input_line}</summary>
                        <pre>{JSON.stringify(e, null, 2)}</pre>
                      </details>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )
        )}
      </div>
    </div>
  );
}
function ComparePage({ state }: { state: Overview }) {
  const published = state.runs.filter((r) => r.status === "published");
  const [before, setBefore] = useState(published.at(-1)?.id ?? ""),
    [after, setAfter] = useState(published[0]?.id ?? "");
  const { data, error, loading, reload } = useLoad(
    () =>
      before && after ? api.compare(before, after) : Promise.resolve(null),
    [before, after],
  );
  return (
    <>
      <Heading
        eyebrow="Versioned evidence"
        title="Snapshot comparison"
        description="Compare totals and fingerprints across two published snapshots."
      />
      {published.length < 2 ? (
        <Empty
          title="Publish two snapshots to compare"
          detail="Run a baseline batch, then a duplicate replay or late refund."
        />
      ) : (
        <>
          <div className="compare-controls">
            <label>
              Before
              <select
                aria-label="Before"
                value={before}
                onChange={(e) => setBefore(e.target.value)}
              >
                {published.map((r) => (
                  <option key={r.id} value={r.id}>
                    {scenarioNames[r.scenario]} · {short(r.id)}
                  </option>
                ))}
              </select>
            </label>
            <ArrowRight size={20} />
            <label>
              After
              <select
                aria-label="After"
                value={after}
                onChange={(e) => setAfter(e.target.value)}
              >
                {published.map((r) => (
                  <option key={r.id} value={r.id}>
                    {scenarioNames[r.scenario]} · {short(r.id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? (
            <ErrorNotice message={error} retry={reload} />
          ) : loading ? (
            <Loading />
          ) : (
            data && (
              <>
                <div
                  className={`notice ${data.same_business_result ? "success" : "info"}`}
                >
                  <GitCompareArrows size={20} />
                  <div>
                    <strong>
                      {data.same_business_result
                        ? "Identical business result"
                        : "Business results changed"}
                    </strong>
                    <p>
                      {data.same_business_result
                        ? "The totals, daily results, inventory, and order lines match."
                        : "The fingerprint differs. Compare totals below; inventory and historical order lines also contribute to it."}
                    </p>
                  </div>
                </div>
                <Panel title="Metric differences">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th className="numeric">Before</th>
                          <th className="numeric">After</th>
                          <th className="numeric">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.metrics.map((m) => (
                          <tr key={m.id}>
                            <td>{metricNames[m.id]}</td>
                            <td className="numeric">{money(m.before)}</td>
                            <td className="numeric">{money(m.after)}</td>
                            <td className="numeric">
                              <strong>
                                {m.difference > 0 ? "+" : ""}
                                {money(m.difference)}
                              </strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            )
          )}
        </>
      )}
    </>
  );
}
function EvidencePage() {
  const { data, error, loading, reload } = useLoad(api.benchmarks, []);
  return (
    <>
      <Heading
        eyebrow="Architecture and benchmarks"
        title="Engineering evidence"
        description="Review the processing steps, measured performance, and current limitations."
      />
      <Panel title="Processing and publication" caption="Current architecture">
        <div className="architecture">
          {[
            "Retained JSON input",
            "Strict contracts",
            "DuckDB SQL",
            "Reconciliation",
            "Immutable snapshot",
            "Pointer commit",
          ].map((label, i) => (
            <div key={label}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <strong>{label}</strong>
              {i < 5 && <ArrowRight size={16} />}
            </div>
          ))}
        </div>
        <div className="panel-footnote">
          SQLite stores durable run state. One writer processes candidates.
          FastAPI serves published evidence to React.
        </div>
      </Panel>
      <Panel
        title="Local benchmark results"
        caption="Fresh subprocess per repeat; synthetic input only"
      >
        {error ? (
          <ErrorNotice message={error} retry={reload} />
        ) : loading ? (
          <Loading />
        ) : data?.results.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Orders</th>
                    <th className="numeric">Events</th>
                    <th className="numeric">Elapsed</th>
                    <th className="numeric">Events / sec</th>
                    <th className="numeric">Peak RSS</th>
                    <th>Repeat</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((r, i) => (
                    <tr key={i}>
                      <td>{number(r.orders)}</td>
                      <td className="numeric">{number(r.events)}</td>
                      <td className="numeric">
                        {r.elapsed_seconds.toFixed(3)}s
                      </td>
                      <td className="numeric">{number(r.events_per_second)}</td>
                      <td className="numeric">{r.peak_rss_mib} MiB</td>
                      <td>{r.repeat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="method">
              <strong>Methodology</strong>
              <p>{data.method}</p>
              <code>
                {data.platform} · Python {data.python}
              </code>
            </div>
          </>
        ) : (
          <Empty
            title="No measurements recorded yet"
            detail="Run the benchmark command to record local timing and memory use."
          />
        )}
      </Panel>
      <div className="two-column">
        <Panel title="Supported in this release">
          <ul className="plain-list">
            <li>Strict event contracts and content-based replay detection</li>
            <li>Historical product attributes and integer-cent cash metrics</li>
            <li>Quarantine, prerequisites, and inventory checks</li>
            <li>Durable runs, cancellation, retry, and immutable snapshots</li>
            <li>Recorded public demo generated from actual runs</li>
          </ul>
        </Panel>
        <Panel title="Limitations">
          <ul className="plain-list">
            <li>Full batch rebuilds; incremental partitions are future work</li>
            <li>One local worker; no distributed orchestration</li>
            <li>USD, one warehouse, synthetic source data</li>
            <li>No public writable backend or multi-user authentication</li>
            <li>
              Backend runs locally; production workloads have not been tested
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

const nav = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "scenarios", name: "Scenario lab", icon: FlaskConical },
  { id: "runs", name: "Pipeline runs", icon: Activity },
  { id: "checks", name: "Reconciliation", icon: ShieldCheck },
  { id: "orders", name: "Record explorer", icon: Database },
  { id: "compare", name: "Compare snapshots", icon: GitCompareArrows },
  { id: "evidence", name: "Engineering evidence", icon: FileCheck2 },
];
export default function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || "overview"),
    [mobile, setMobile] = useState(false),
    [exported, setExported] = useState("");
  const [narrow, setNarrow] = useState(
    window.matchMedia("(max-width:760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width:760px)");
    const listener = () => setNarrow(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  const mainRef = useRef<HTMLElement>(null);
  const { data, error, loading, reload } = useLoad(api.overview, [], 2500);
  const go = useCallback((path: string) => {
    location.hash = path;
    setMobile(false);
  }, []);
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1) || "overview");
      setMobile(false);
      requestAnimationFrame(() => {
        mainRef.current?.querySelector<HTMLElement>("h1")?.focus();
      });
    };
    window.addEventListener("hashchange", change);
    if (recorded)
      bundle()
        .then((b) => setExported(b.exported_at))
        .catch(() => {});
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const [page, selected] = route.split("?")[0].split("/");
  return (
    <div className="app">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <aside
        inert={narrow && !mobile}
        className={`sidebar ${mobile ? "open" : ""}`}
      >
        <a className="brand" href="#overview" aria-label="Relay overview">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <strong>
            relay<span>.</span>
          </strong>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <Box size={18} />
          </span>
          <div>
            <strong>Retail operations</strong>
            <span>Reference workspace</span>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.slice(0, 6).map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              className={page === n.id ? "active" : ""}
              aria-current={page === n.id ? "page" : undefined}
              onClick={() => setMobile(false)}
            >
              <n.icon size={18} />
              {n.name}
              {page === n.id && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="nav-label second">PROJECT</div>
        <nav aria-label="Project navigation">
          <a
            href="#evidence"
            className={page === "evidence" ? "active" : ""}
            aria-current={page === "evidence" ? "page" : undefined}
          >
            <FileCheck2 size={18} />
            Engineering evidence
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <span className="status-dot" />
            {recorded ? "Recorded evidence" : "Local environment"}
          </div>
          <p>Local batch processing</p>
          <div className="version">
            <Terminal size={13} />
            Relay v0.1.0
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-toggle"
              aria-label="Toggle navigation"
              aria-expanded={mobile}
              onClick={() => setMobile((v) => !v)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span>{" "}
              <strong>
                {nav.find((n) => n.id === page)?.name ?? "Overview"}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="synthetic-label">Synthetic reference data</span>
            <span className="environment">
              <span className="status-dot" />
              {recorded ? "Recorded demo" : "Local execution"}
            </span>
          </div>
        </header>
        {recorded && (
          <div className="recorded-banner">
            <Clock3 size={14} />
            <strong>Recorded demo</strong>
            <span>
              Actual pipeline outputs · captured{" "}
              {exported ? date(exported) : "loading…"} · controls inspect saved
              evidence
            </span>
          </div>
        )}
        <main id="main-content" ref={mainRef} tabIndex={-1}>
          {error && data && (
            <div className="notice warning" role="status">
              <TriangleAlert size={18} />
              <div>
                <strong>Connection lost. Showing saved results.</strong>
                <p>{error}</p>
              </div>
              <button className="text-button" onClick={reload}>
                Reconnect
              </button>
            </div>
          )}
          {error && !data ? (
            <>
              <Heading
                eyebrow="Connection"
                title="The workspace is unavailable"
                description="Start the local API, or open an exported recorded demo."
              />
              <ErrorNotice message={error} retry={reload} />
            </>
          ) : loading || !data ? (
            <Loading />
          ) : page === "overview" ? (
            <OverviewPage state={data} go={go} />
          ) : page === "scenarios" ? (
            <ScenariosPage state={data} go={go} />
          ) : page === "runs" ? (
            selected ? (
              <RunPage key={selected} id={selected} go={go} onUpdate={reload} />
            ) : (
              <RunsPage state={data} go={go} />
            )
          ) : page === "checks" ? (
            <ChecksPage state={data} go={go} />
          ) : page === "orders" ? (
            <OrdersPage go={go} selected={selected} />
          ) : page === "compare" ? (
            <ComparePage state={data} />
          ) : page === "evidence" ? (
            <EvidencePage />
          ) : (
            <Empty
              title="Page not found"
              detail="Choose a workspace section from the navigation."
            />
          )}
        </main>
        <footer className="app-footer">
          <span>Relay / Order & inventory data platform</span>
          <span>Amounts in USD · All times UTC</span>
        </footer>
      </div>
    </div>
  );
}
