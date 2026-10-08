import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function run(request: APIRequestContext, scenario: string) {
  const response = await request.post("/api/runs", {
    data: { scenario, orders: 160 },
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  expect(response.status()).toBe(202);
  const created = await response.json();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/runs/${created.id}`)).json()).run
          .status,
      { timeout: 20000 },
    )
    .not.toMatch(/queued|running/);
  return (await (await request.get(`/api/runs/${created.id}`)).json()).run;
}
let baseline: string;
test.beforeAll(async ({ request }) => {
  baseline = (await run(request, "baseline")).id;
  await run(request, "duplicates");
  await run(request, "conflict");
  await run(request, "interrupted");
  await run(request, "late_refund");
});

test("overview shows actual verified metrics and desktop layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Order and inventory reporting" }),
  ).toBeVisible();
  await expect(
    page.getByText("Last published snapshot verified"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Physical inventory" }),
  ).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
});

test("mobile overview has no document overflow and usable navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByText("Last published snapshot verified"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/overview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Scenario lab", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scenario lab", exact: true }),
  ).toBeVisible();
});

test("scenario executes real backend and interruption can be retried", async ({
  page,
}) => {
  await page.goto("/#scenarios");
  const card = page.locator(".scenario-card").filter({
    has: page.getByRole("heading", { name: "Interrupted publication" }),
  });
  await card.getByRole("button", { name: "Run scenario" }).click();
  await expect(page.getByText("Run did not publish")).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByText(
      "Injected interruption after snapshot completion, before publication pointer commit",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry retained input" }).click();
  await expect(page.getByText("Complete snapshot published")).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByRole("heading", { name: "Traceability" }),
  ).toBeVisible();
});

test("record search, detail lineage, keyboard dismissal", async ({ page }) => {
  await page.goto("/#orders");
  await page
    .getByRole("textbox", { name: "Search orders or customers" })
    .fill("ORD-10400");
  await expect(page.getByText("1 to 1 of 1 orders")).toBeVisible();
  await page.getByRole("button", { name: "ORD-10400", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Event lineage" }),
  ).toBeVisible();
  await dialog.getByText("Inspect input · item 9").click();
  await expect(dialog.locator("pre").first()).toContainText("order.accepted");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("comparison exposes baseline versus replay equality", async ({
  page,
  request,
}) => {
  const all = await (await request.get("/api/runs")).json();
  const duplicate = all.find(
    (r: { scenario: string; status: string }) =>
      r.scenario === "duplicates" && r.status === "published",
  );
  await page.goto("/#compare");
  await page.getByLabel("Before", { exact: true }).selectOption(baseline);
  await page.getByLabel("After", { exact: true }).selectOption(duplicate.id);
  await expect(
    page.getByText("Identical business result", { exact: true }),
  ).toBeVisible();
});

test("blocked run displays exceptions and preserves last valid snapshot", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/overview")).json();
  const bad = await run(request, "conflict");
  const after = await (await request.get("/api/overview")).json();
  expect(after.active_run.id).toBe(before.active_run.id);
  await page.goto(`/#runs/${bad.id}`);
  await expect(
    page.getByText("Publication prevented", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Exceptions", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({
    path: "test-results/blocked-run.png",
    fullPage: true,
  });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});

test("recorded demo works without backend requests", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/?demo=1#overview");
  await expect(
    page.getByText("Recorded demo", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Last published snapshot verified"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Scenario lab", exact: true }).click();
  const card = page
    .locator(".scenario-card")
    .filter({ has: page.getByRole("heading", { name: "Baseline batch" }) });
  await card.getByRole("button", { name: "Inspect recording" }).click();
  await expect(page.getByText("Complete snapshot published")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry retained input" }),
  ).toHaveCount(0);
});

test("overview retains loaded evidence when polling fails", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Last published snapshot verified"),
  ).toBeVisible();
  await page.route("**/api/overview", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Connection test failure" }),
    }),
  );
  await expect(
    page.getByText("Connection lost. Showing saved results."),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByRole("heading", { name: "Physical inventory" }),
  ).toBeVisible();
});

test("empty state offers an explicit first action", async ({
  page,
  request,
}) => {
  await page.route("**/api/overview", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "local",
        active_run: null,
        report: null,
        runs: [],
        orphan_snapshots: [],
      }),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "No published snapshot" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open scenario lab" }),
  ).toBeVisible();
  // API validation is checked independently of the mocked empty presentation.
  expect((await request.get("/api/health")).status()).toBe(200);
});

test("major screens have accessible contrast and usable structure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const route of [
    "scenarios",
    "runs",
    "checks",
    "orders",
    "compare",
    "evidence",
  ]) {
    await page.goto(`/#${route}`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations, route).toEqual([]);
    await page.screenshot({
      path: `test-results/${route}-desktop.png`,
      fullPage: true,
    });
  }
});
