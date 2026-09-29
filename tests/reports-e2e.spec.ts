import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";

const root = resolve(process.cwd());
const executable = createRequire(join(root, "package.json"))(
  "electron",
) as string;
async function launch() {
  const directory = await mkdtemp(join(tmpdir(), "acadia-reports-native-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key),
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    executablePath: process.env.ACADIA_TEST_EXECUTABLE || executable,
    args: process.env.ACADIA_TEST_EXECUTABLE
      ? []
      : [join(root, "out/main/index.js")],
    cwd: root,
    env: { ...env, ACADIA_USER_DATA: join(directory, "profile") },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1100 });
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  return { directory, app, page };
}
async function seed(page: Page) {
  await page.evaluate(async () => {
    const { project } = await window.acadia!.newProject();
    const stamp = new Date().toISOString();
    project.title = "Pilot decision investigation";
    project.question = "Does the pilot improve reliability?";
    project.cards = [
      {
        id: crypto.randomUUID(),
        kind: "note",
        title: "Pilot trial findings",
        content:
          "The pilot improved reliability by 12%. A comparison group was used. Long-term costs remain unknown.",
        x: 0,
        y: 0,
        tags: [],
        status: "supported",
        createdAt: stamp,
        updatedAt: stamp,
      },
    ];
    await window.acadia!.save(project);
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.acadia!.researchState()).versions.filter(
            (v) => v.status === "ready",
          ).length,
      ),
    )
    .toBeGreaterThan(0);
}
async function stubSave(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, path);
}
async function selectText(page: Page, text: string) {
  await page.locator(".report-tiptap").evaluate((element, needle) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const index = (node.textContent || "").indexOf(needle);
      if (index < 0) continue;
      (element as HTMLElement).focus();
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw new Error(`Text not found: ${needle}`);
  }, text);
}

test("editable report tables export with evidence bibliography to Markdown, DOCX and native PDF", async ({}, testInfo) => {
  const { app, page, directory } = await launch();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await seed(page);
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await page
      .getByRole("button", { name: "Build evidence brief", exact: true })
      .click();
    await expect(page.locator(".report-tiptap")).toContainText("12%");
    await page.locator(".report-tiptap").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Acceptance matrix");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Table", exact: true }).click();
    const rows = page.locator(".report-tiptap table tr");
    await expect(rows).toHaveCount(3);
    for (const [row, values] of [
      ["Scenario", "Finding", "Next step"],
      ["Pilot", "12% improvement", "Check long-term costs"],
      ["Control", "Independent comparison", "Review methods"],
    ].entries()) {
      for (const [column, value] of values.entries()) {
        await rows.nth(row).locator("th,td").nth(column).click();
        await page.keyboard.type(value);
      }
    }
    await page
      .getByRole("button", { name: "Save revision", exact: true })
      .click();
    await expect(page.locator(".release-messages")).toContainText(
      "Revision saved",
    );
    const markdownPath = join(directory, "pilot.md");
    await stubSave(app, markdownPath);
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    await expect
      .poll(() => readFile(markdownPath, "utf8").catch(() => ""))
      .toContain("| Pilot | 12% improvement | Check long-term costs |");
    const markdown = await readFile(markdownPath, "utf8");
    expect(markdown).toContain("## Bibliography");
    expect(markdown).toContain("Pilot trial findings");
    expect(markdown).toContain("Source version");
    const docxPath = join(directory, "pilot.docx");
    await stubSave(app, docxPath);
    await page.getByRole("button", { name: "DOCX", exact: true }).click();
    await expect
      .poll(() =>
        readFile(docxPath)
          .then((buffer) => buffer.length)
          .catch(() => 0),
      )
      .toBeGreaterThan(1000);
    const xml = new AdmZip(await readFile(docxPath)).readAsText(
      "word/document.xml",
    );
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("12% improvement");
    expect(xml).toContain("Bibliography");
    expect(xml).toContain("Pilot trial findings");
    expect(xml).toContain("Source version");
    const pdfPath = join(directory, "pilot.pdf");
    await stubSave(app, pdfPath);
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    await expect
      .poll(() =>
        readFile(pdfPath)
          .then((buffer) => buffer.length)
          .catch(() => 0),
      )
      .toBeGreaterThan(1000);
    const parser = new PDFParse({ data: await readFile(pdfPath) });
    try {
      const pdf = await parser.getText();
      expect(pdf.text).toContain("12% improvement");
      expect(pdf.text).toContain("Check long-term costs");
      expect(pdf.text).toContain("Bibliography");
      expect(pdf.text).toContain("Pilot trial findings");
    } finally {
      await parser.destroy();
    }
    await page.screenshot({
      path: testInfo.outputPath("report-editor.png"),
      fullPage: true,
    });
    await testInfo.attach("Pilot report PDF", {
      path: pdfPath,
      contentType: "application/pdf",
    });
    await testInfo.attach("Pilot report DOCX", {
      path: docxPath,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("AI section proposals preserve surrounding citations and reject stale replacements", async ({}, testInfo) => {
  let server: Server | undefined;
  const requests: unknown[] = [];
  const { app, page, directory } = await launch();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const input = JSON.parse(
        body.messages.find(
          (message: { role: string }) => message.role === "user",
        ).content,
      );
      requests.push(input);
      const source = input.source_passages[0];
      const content = JSON.stringify({
        markdown: `Revised conclusion supported by the pilot [${source.label}].`,
        citations: [
          {
            label: source.label,
            passageId: source.passageId,
            quote: "The pilot improved reliability by 12%.",
          },
        ],
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: { content } }));
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No local test model port");
    await seed(page);
    await page.evaluate(async (port) => {
      const { project } = await window.acadia!.load();
      const state = await window.acadia!.researchState();
      const source = state.sources[0];
      const detail = await window.acadia!.getSource(source.id);
      const passage = detail.passages[0];
      const version = detail.versions.find((v) => v.id === passage.versionId)!;
      const citation = {
        id: crypto.randomUUID(),
        label: "1",
        sourceId: source.id,
        versionId: passage.versionId,
        passageId: passage.id,
        sourceTitle: source.title,
        locator: passage.locator,
        quote: passage.text,
        acquiredAt: version.acquiredAt,
        verified: true,
      };
      const atom = {
        type: "citation",
        attrs: { citationId: citation.id, label: "1" },
      };
      project.privacy = {
        mode: "local",
        provider: "ollama",
        endpoint: `http://127.0.0.1:${port}`,
        model: "local-test-model",
      };
      await window.acadia!.saveSettings({
        provider: "ollama",
        endpoint: `http://127.0.0.1:${port}`,
        model: "local-test-model",
      });
      project.outputs = [
        {
          id: crypto.randomUUID(),
          kind: "decision-brief",
          title: "Pilot section review",
          createdAt: new Date().toISOString(),
          provider: "Offline",
          sourceIds: [source.id],
          boardUpdatedAt: project.updatedAt,
          citations: [citation],
          markdown: "Before [1].\n\nOriginal conclusion.\n\nAfter [1].",
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Before " },
                  atom,
                  { type: "text", text: "." },
                ],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: "Original conclusion." }],
              },
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "After " },
                  atom,
                  { type: "text", text: "." },
                ],
              },
            ],
          },
        },
      ];
      await window.acadia!.save(project);
    }, address.port);
    await page.reload();
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await expect(page.locator(".report-tiptap")).toContainText(
      "Original conclusion.",
    );
    const originalDocument = await page.evaluate(
      async () => (await window.acadia!.load()).project.outputs[0].document!,
    );
    await page
      .getByText("AI revision of selected text", { exact: true })
      .click();
    await selectText(page, "Original conclusion.");
    await page
      .getByRole("textbox", { name: "Section revision instructions" })
      .fill("Explain this conclusion using the trial evidence.");
    await page
      .getByRole("button", { name: "Propose revision", exact: true })
      .click();
    await expect(page.locator(".report-proposal")).toBeVisible();
    await expect(page.locator(".report-tiptap")).toContainText(
      "Original conclusion.",
    );
    await page
      .getByRole("button", { name: "Apply to selected text", exact: true })
      .click();
    await expect(page.locator(".report-tiptap")).toContainText(
      "Revised conclusion supported by the pilot",
    );
    await expect
      .poll(() =>
        page.evaluate(async () =>
          JSON.stringify(
            (await window.acadia!.load()).project.outputs[0].document,
          ),
        ),
      )
      .toContain("Revised conclusion");
    const revised = await page.evaluate(
      async () => (await window.acadia!.load()).project.outputs[0].document!,
    );
    expect(revised.content![0]).toEqual(originalDocument.content![0]);
    expect(revised.content![2]).toEqual(originalDocument.content![2]);
    await expect(
      page.locator(".report-tiptap [data-acadia-citation]"),
    ).toHaveCount(3);
    await selectText(page, "Revised conclusion supported by the pilot");
    await page
      .getByRole("button", { name: "Propose revision", exact: true })
      .click();
    await expect(page.locator(".report-proposal")).toBeVisible();
    await page.locator(".report-tiptap").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Private new finding.");
    await page
      .getByRole("button", { name: "Apply to selected text", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "report changed while the revision was prepared",
    );
    await expect(page.locator(".report-tiptap")).toContainText(
      "Private new finding.",
    );
    expect(requests).toHaveLength(2);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("section-proposal.png"),
      fullPage: true,
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

test("reports can use saved sources after every board card is removed", async () => {
  const { app, page, directory } = await launch();
  try {
    await seed(page);
    await page.evaluate(async () => {
      const { project } = await window.acadia!.load();
      project.cards = [];
      project.connections = [];
      await window.acadia!.save(project);
    });
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.acadia!.researchState()).sources.length,
        ),
      )
      .toBeGreaterThan(0);
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await expect(
      page.getByRole("button", { name: "Build evidence brief", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Build evidence brief", exact: true })
      .click();
    await expect(page.locator(".report-tiptap")).toContainText("12%");
    await expect(page.locator(".release-bibliography")).toContainText(
      "Pilot trial findings",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed generation identifies the retained report and hides IPC error wrappers", async () => {
  const { app, page, directory } = await launch();
  try {
    await seed(page);
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await page
      .getByRole("button", { name: "Build evidence brief", exact: true })
      .click();
    await expect(page.locator(".report-tiptap")).toContainText("12%");
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.acadia!.load()).project.outputs.length,
        ),
      )
      .toBe(1);
    const original = await page.evaluate(
      async () => (await window.acadia!.load()).project.outputs,
    );
    const originalText = await page.locator(".report-tiptap").innerText();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("acadia:generate");
      ipcMain.handle("acadia:generate", () => {
        throw new Error(
          "Grounding check failed: reference [2] has no verified source quotation.",
        );
      });
    });
    await page
      .getByRole("button", { name: "Build evidence brief", exact: true })
      .click();
    const failure = page.locator("#release-generation-error");
    await expect(failure).toHaveAttribute("role", "alert");
    await expect(failure).toContainText(
      "Generation failed — previous report still shown.",
    );
    await expect(failure).toContainText(
      "reference [2] has no verified source quotation",
    );
    await expect(failure).toContainText("No new draft was saved");
    await expect(failure).not.toContainText("Error invoking remote method");
    await expect(page.locator(".release-document-kicker")).toContainText(
      "PREVIOUS REPORT · GENERATION FAILED",
    );
    expect(await page.locator(".report-tiptap").innerText()).toBe(originalText);
    expect(
      await page.evaluate(
        async () => (await window.acadia!.load()).project.outputs,
      ),
    ).toEqual(original);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
