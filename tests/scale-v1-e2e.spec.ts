import { _electron as electron, test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { cpus, totalmem, platform, release, arch } from "node:os";

test("records full desktop opening, search, and board interaction at the v1 scale", async () => {
  const profile = process.env.ACADIA_SCALE_PROFILE;
  test.skip(
    !profile,
    "Explicit synthetic scale profile required; not a reference-hardware approval.",
  );
  if (!isAbsolute(profile!)) throw new Error("Scale profile must be absolute.");
  const fixture = JSON.parse(
    await readFile(join(profile!, ".acadia-scale-fixture.json"), "utf8"),
  );
  expect(fixture).toMatchObject({
    synthetic: true,
    sources: 1000,
    passages: 100000,
    cards: 500,
  });
  const root = resolve(process.cwd());
  const executable = createRequire(join(root, "package.json"))(
    "electron",
  ) as string;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key),
    ),
  ) as Record<string, string>;
  const started = performance.now();
  const app = await electron.launch({
    executablePath: process.env.ACADIA_TEST_EXECUTABLE || executable,
    args: process.env.ACADIA_TEST_EXECUTABLE
      ? []
      : [join(root, "out/main/index.js")],
    cwd: root,
    env: { ...env, ACADIA_USER_DATA: profile! },
  });
  const results: Record<string, unknown> = {
    benchmarkVersion: 1,
    recordedAt: new Date().toISOString(),
    machine: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      totalMemoryBytes: totalmem(),
    },
    fixture,
    scope:
      "Synthetic isolated profile. Actual host measurements only; not 16 GB/SSD reference-machine or physical touch/display acceptance.",
  };
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
    ).toBeVisible();
    const node = page.locator('.react-flow__node[data-id="card-0"]');
    await expect(node).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    results.launchToUsableBoardMilliseconds = performance.now() - started;
    await page.setViewportSize({ width: 1600, height: 1000 });
    const sample = await page.evaluate(async () => {
      const workspace = await window.acadia!.load();
      if (workspace.project.cards.length !== 500)
        throw new Error("Wrong benchmark project");
      const exact: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        const page = await window.acadia!.searchSourcesPage("terminalneedle", {
          limit: 50,
        });
        exact.push(performance.now() - start);
        if (page.total !== 1)
          throw new Error("Terminal evidence was not found");
      }
      const start = performance.now();
      const common = await window.acadia!.searchSourcesPage("Cedar", {
        offset: 99950,
        limit: 50,
      });
      return {
        exactSearchMilliseconds: exact,
        commonSearchFinalPageMilliseconds: performance.now() - start,
        total: common.total,
        beforeX: workspace.project.cards.find((c) => c.id === "card-0")!.x,
      };
    });
    expect(sample.total).toBe(100000);
    results.search = sample;
    const frames = page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const gaps: number[] = [];
          let previous = performance.now();
          const end = previous + 1500;
          function tick(time: number) {
            gaps.push(time - previous);
            previous = time;
            if (time >= end) resolve(gaps);
            else requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        }),
    );
    const interactionStart = performance.now();
    await node.click();
    await node.focus();
    await node.press("ArrowRight");
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.load()).project.cards.find(
              (c) => c.id === "card-0",
            )!.x,
        ),
      )
      .toBe(sample.beforeX + 10);
    results.keyboardMoveToCommittedMilliseconds =
      performance.now() - interactionStart;
    const gaps = await frames;
    results.rendererFramesDuringInteraction = {
      count: gaps.length,
      maxGapMilliseconds: Math.max(...gaps),
      p95GapMilliseconds: [...gaps].sort((a, b) => a - b)[
        Math.floor(gaps.length * 0.95)
      ],
    };
    results.processes = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((metric) => ({
          type: metric.type,
          memory: metric.memory,
          cpu: metric.cpu,
        })),
    );
    await mkdir(resolve("test-results/scale-ui-v1"), { recursive: true });
    await page.screenshot({
      path: resolve("test-results/scale-ui-v1/board.png"),
    });
    results.outcome =
      "Functional checks passed. Compare raw measurements with the declared hardware budget; one sample is not a performance guarantee.";
  } finally {
    await app.close();
    await mkdir(resolve("test-results"), { recursive: true });
    await writeFile(
      resolve("test-results/scale-ui-v1.json"),
      JSON.stringify(results, null, 2) + "\n",
    );
  }
});
