import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public root is a self-contained evidence walkthrough", async ({
  page,
  request,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/"))
      apiRequests.push(r.url());
  });
  const b = await (await request.get("/demo.json")).json();
  await page.goto("/");
  await expect(
    page.getByText("Recorded demo", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Last published snapshot verified"),
  ).toBeVisible();
  // Brief holds intentionally make the generated silent walkthrough readable.
  await page.waitForTimeout(2500);
  await page
    .getByRole("link", { name: "Compare snapshots", exact: true })
    .click();
  const baseline = b.overview.runs.find((r: any) => r.scenario === "baseline");
  const replay = b.overview.runs.find((r: any) => r.scenario === "duplicates");
  await page.getByLabel("Before", { exact: true }).selectOption(baseline.id);
  await page.getByLabel("After", { exact: true }).selectOption(replay.id);
  await expect(
    page.getByText("Identical business result", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(2500);
  const conflict = b.overview.runs.find((r: any) => r.scenario === "conflict");
  await page.goto(`/#runs/${conflict.id}`);
  await expect(
    page.getByText("Publication prevented", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(2500);
  const failed = b.overview.runs.find(
    (r: any) => r.scenario === "interrupted" && r.status === "failed",
  );
  const recovered = b.overview.runs.find((r: any) => r.parent_id === failed.id);
  expect(recovered.status).toBe("published");
  await page.goto(`/#runs/${failed.id}`);
  await expect(page.getByText("Run did not publish")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry retained input" }),
  ).toHaveCount(0);
  await page.waitForTimeout(2500);
  await page.goto(`/#runs/${recovered.id}`);
  await expect(page.getByText("Complete snapshot published")).toBeVisible();
  await page.waitForTimeout(2500);
  await page.goto("/#orders");
  await page
    .getByRole("textbox", { name: "Search orders or customers" })
    .fill("ORD-10400");
  await page.getByRole("button", { name: "ORD-10400", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Event lineage" }),
  ).toBeVisible();
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.goto("/#evidence");
  await expect(
    page.getByRole("heading", { name: "Local benchmark results" }),
  ).toBeVisible();
  await page.waitForTimeout(2500);
  expect(apiRequests).toEqual([]);
});

test("public root remains accessible on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?demo=0"); // public build must stay recorded even with this query
  await expect(
    page.getByText("Last published snapshot verified"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
});
