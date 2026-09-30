import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
} from "electron";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { ResearchStore, validateResearchArchive } from "./research-store";
import { Ingestion } from "./ingestion";
import { ResearchService } from "./research-service";
import {
  exportReportMarkdown,
  outputHTML as reportHTML,
  exportReportDocx,
} from "./report-export";
import type {
  Citation,
  Inclusion,
  Passage,
  ResearchClaim,
  ResearchState,
  ResearchTask,
  SourceDetail,
  SourceRecord,
  SourceVersion,
} from "../shared/research";
import type {
  AISettings,
  ImportedAsset,
  OutputKind,
  Project,
  ResearchOutput,
  WorkspaceState,
} from "../shared/types";
import {
  createBlankProject,
  createDemoProject,
  validateProject,
} from "../shared/project";
import { resolveAIEndpoint } from "./analysis";
import {
  clampWindowBounds,
  DesktopStore,
  desktopMenuTemplate,
  setDesktopMenuEnabled,
  type WindowKind,
} from "./desktop";
import { listLocalModels, testAIConnection } from "./model-connection";
import type { DesktopCommand, DesktopState } from "../shared/desktop";
import {
  PEDIGREE_COLLECTIONS,
  validatePedigreeEntity,
  type PedigreeEntityKind,
} from "../shared/pedigree";
import type { ChallengeTarget } from "../shared/pedigree-analysis";
import { validateItemInsightTarget } from "../shared/item-insight";
import { validateBoardReference } from "../shared/board";
import { validateProjectPlanContext } from "../shared/project";
import { exportPmisFiles } from "../shared/pmis";
import { PLANNER_IMPORTER } from "./planner-importer";
import { citationIntegrity } from "../shared/report-pedigree";
import { buildPowerBiFiles } from "./powerbi-export";

import {
  MAX_ARCHIVE_BYTES,
  MAX_ASSET_BYTES,
  assetRecord,
  atomicWrite,
  externalURL,
  fileType,
  readJSON,
  safeAssetId,
  safeFileName,
  type AssetRecord,
} from "./storage";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "acadia-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
// Test runs can isolate all state without touching the user's research workspace.
if (process.env.ACADIA_USER_DATA && isAbsolute(process.env.ACADIA_USER_DATA))
  app.setPath("userData", process.env.ACADIA_USER_DATA);

let collector: BrowserWindow | null = null;
let releaser: BrowserWindow | null = null;
let currentProject: Project;
let currentProjectPath: string | undefined;
let settings: AISettings = {
  provider: "offline",
  endpoint: "http://127.0.0.1:11434",
  model: "llama3.2",
};
let assets: Record<string, AssetRecord> = {};
let storageRoot = "";
let mutationQueue: Promise<unknown> = Promise.resolve();
let generating = false;
let store: ResearchStore;
let ingestion: Ingestion;
let research: ResearchService;
let searchKey: string | undefined;
let desktop: DesktopStore;
const windowSavers = new Map<BrowserWindow, () => void>();

function assertProjectTransitionAllowed(): void {
  if (generating)
    throw new Error(
      "Wait for report generation to finish, or cancel it in the activity strip, before changing investigations.",
    );
}

function desktopState(): DesktopState {
  let reducedMotion = false;
  try {
    reducedMotion =
      systemPreferences.getAnimationSettings().prefersReducedMotion;
  } catch {}
  return {
    preferences: desktop.preferences,
    appearance: {
      platform:
        process.platform === "darwin" || process.platform === "win32"
          ? process.platform
          : "linux",
      theme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
      highContrast: nativeTheme.shouldUseHighContrastColors,
      reducedMotion,
    },
  };
}

function desktopChanged(): void {
  const state = desktopState();
  for (const window of [collector, releaser]) {
    if (!window || window.isDestroyed()) continue;
    window.setBackgroundColor(
      state.appearance.theme === "dark" ? "#111510" : "#f7f8f5",
    );
    window.webContents.send("acadia:desktop-changed", state);
  }
}

function sendDesktopCommand(command: DesktopCommand): void {
  // Presentation windows never acquire editing commands or a private workspace payload.
  if (
    !collector ||
    collector.isDestroyed() ||
    BrowserWindow.getFocusedWindow() !== collector
  )
    return;
  collector.webContents.send("acadia:command", command);
}

function refreshDesktopMenu(): void {
  const editable = Boolean(
    collector &&
    !collector.isDestroyed() &&
    BrowserWindow.getFocusedWindow() === collector,
  );
  const menu = Menu.getApplicationMenu();
  if (menu) setDesktopMenuEnabled(menu, editable);
}

function connectedWorkAreas() {
  const primary = screen.getPrimaryDisplay();
  return [
    primary,
    ...screen.getAllDisplays().filter((display) => display.id !== primary.id),
  ].map((display) => display.workArea);
}

function trackWindow(window: BrowserWindow, kind: WindowKind): void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (pending) clearTimeout(pending);
    pending = undefined;
    if (window.isDestroyed() || window.isMinimized()) return;
    void desktop
      .saveWindow(kind, {
        bounds: window.getNormalBounds(),
        maximized: window.isMaximized(),
      })
      .catch(() => undefined);
  };
  const schedule = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(save, 200);
  };
  windowSavers.set(window, save);
  window.on("move", schedule);
  window.on("resize", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  // A screen-sized first window may never emit move/resize. Save its actual
  // initial placement after showing, including a restored maximized state.
  window.once("show", schedule);
  window.on("close", save);
  window.on("focus", desktopChanged);
  window.on("focus", refreshDesktopMenu);
  window.on("blur", refreshDesktopMenu);
  window.once("closed", () => {
    if (pending) clearTimeout(pending);
    windowSavers.delete(window);
    refreshDesktopMenu();
  });
}

function recoverDisplayWindows(): void {
  for (const window of [collector, releaser]) {
    if (!window || window.isDestroyed()) continue;
    const previous = window.getNormalBounds();
    const bounds = clampWindowBounds(previous, connectedWorkAreas(), {
      width: window === collector ? 960 : 800,
      height: 700,
    });
    if (
      ["x", "y", "width", "height"].every(
        (key) =>
          previous[key as keyof typeof previous] ===
          bounds[key as keyof typeof bounds],
      )
    )
      continue;
    const restore = () => {
      if (window.isDestroyed()) return;
      const maximized = window.isMaximized();
      if (maximized) window.unmaximize();
      window.setMinimumSize(
        Math.min(window === collector ? 960 : 800, bounds.width),
        Math.min(700, bounds.height),
      );
      window.setBounds(bounds);
      if (maximized) window.maximize();
      windowSavers.get(window)?.();
    };
    if (window.isFullScreen()) {
      window.once("leave-full-screen", restore);
      window.setFullScreen(false);
    } else restore();
  }
}
const extracting = new Set<string>();
function researchChanged() {
  for (const win of [collector, releaser])
    if (win && !win.isDestroyed())
      win.webContents.send("acadia:research-changed");
}
function selectedRelease(project: Project) {
  const output = project.outputs.find(
    (entry) => entry.id === project.releasedOutputId,
  );
  const revision = output?.revisions?.find(
    (entry) => entry.id === output.releasedRevisionId,
  );
  return output && revision ? { output, revision } : undefined;
}

/** Build an audience payload from the released snapshot, never from mutable draft fields. */
function releasedProject(project: Project): Project {
  const release = selectedRelease(project);
  const heading = release?.revision.document.content?.find(
    (node) => node.type === "heading",
  );
  const title =
    heading?.content
      ?.map((node) => node.text || "")
      .join("")
      .trim() || "Released research";
  const timestamp = release?.revision.createdAt || project.createdAt;
  const outputs: ResearchOutput[] = release
    ? [
        {
          id: release.output.id,
          kind: release.output.kind,
          title,
          markdown: release.revision.markdown,
          document: release.revision.document,
          citations: release.revision.citations,
          deliveryPlan: release.revision.deliveryPlan,
          createdAt: release.revision.createdAt,
          provider: /offline/i.test(release.output.provider)
            ? "Offline evidence brief"
            : "AI-assisted research",
          sourceIds: [
            ...new Set(
              release.revision.citations
                .map((citation) => citation.sourceId)
                .filter(Boolean),
            ),
          ],
          boardUpdatedAt: release.revision.createdAt,
          releasedRevisionId: release.revision.id,
          revisions: [
            {
              id: release.revision.id,
              createdAt: release.revision.createdAt,
              document: release.revision.document,
              markdown: release.revision.markdown,
              citations: release.revision.citations,
              deliveryPlan: release.revision.deliveryPlan,
              note: "",
            },
          ],
        },
      ]
    : [];
  return {
    schemaVersion: 2,
    id: project.id,
    title: release ? title : "Acadia Releaser",
    question: "",
    cards: [],
    connections: [],
    outputs,
    ...(release ? { releasedOutputId: release.output.id } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function releasedCitations(): Citation[] {
  return (
    selectedRelease(currentProject)?.revision.citations.filter(
      (citation) =>
        citation.sourceId && citation.versionId && citation.passageId,
    ) || []
  );
}

/** Keep mutable card links, review policies, originals, errors, and snapshots private. */
function audienceSource(sourceId: string, versionId?: string): SourceDetail {
  const citations = releasedCitations().filter(
    (citation) => citation.sourceId === sourceId,
  );
  const selectedVersion = versionId || citations[0]?.versionId;
  const selectedCitations = citations.filter(
    (citation) => citation.versionId === selectedVersion,
  );
  if (!selectedVersion || !selectedCitations.length)
    throw new Error(
      "This source version is not included in the selected released revision.",
    );
  const detail = store.getSource(sourceId, selectedVersion);
  if (detail.source.projectId !== currentProject.id)
    throw new Error(
      "This source is not included in the selected released revision.",
    );
  const sourceCitation = selectedCitations[0];
  const allowedVersions = new Map(
    citations.map((citation) => [citation.versionId, citation]),
  );
  const versions: SourceVersion[] = detail.versions
    .filter((version) => allowedVersions.has(version.id))
    .map((version) => {
      const citation = allowedVersions.get(version.id)!;
      return {
        id: version.id,
        sourceId,
        hash: version.hash,
        acquiredAt: citation.acquiredAt,
        title: citation.sourceTitle,
        ...(citation.url ? { url: citation.url } : {}),
        status: version.status,
        method: version.method,
        totalUnits: version.totalUnits,
        processedUnits: version.processedUnits,
      };
    });
  const source: SourceRecord = {
    id: sourceId,
    projectId: currentProject.id,
    title: sourceCitation.sourceTitle,
    kind: detail.source.kind,
    ...(sourceCitation.url ? { url: sourceCitation.url } : {}),
    currentVersionId: selectedVersion,
    inclusion: "include",
    createdAt: sourceCitation.acquiredAt,
    updatedAt: sourceCitation.acquiredAt,
  };
  const allowedPassages = new Set(
    selectedCitations.map((citation) => citation.passageId),
  );
  const passages: Passage[] = detail.passages
    .filter((passage) => allowedPassages.has(passage.id))
    .map((passage) => ({ ...passage, inclusion: "include" }));
  return { source, versions, passages };
}

function audienceResearchState(): ResearchState {
  const details = [
    ...new Set(releasedCitations().map((citation) => citation.sourceId)),
  ].map((sourceId) => audienceSource(sourceId));
  return {
    sources: details.map((detail) => detail.source),
    versions: details.flatMap((detail) => detail.versions),
    claims: [],
    tasks: [],
    jobs: [],
    discoveries: [],
    runs: [],
  };
}

function audiencePassage(passageId: string): Passage {
  const citation = releasedCitations().find(
    (entry) => entry.passageId === passageId,
  );
  if (!citation)
    throw new Error(
      "This passage is not included in the selected released revision.",
    );
  const passage = audienceSource(
    citation.sourceId,
    citation.versionId,
  ).passages.find((entry) => entry.id === passageId);
  if (!passage) throw new Error("Released citation passage is unavailable.");
  return passage;
}

function startPendingExtractions(project: Project) {
  const state = store.state(project.id);
  for (const source of state.sources) {
    const version = state.versions.find(
      (v) => v.id === source.currentVersionId,
    );
    if (
      !source.derived &&
      source.assetId &&
      version?.status === "queued" &&
      !extracting.has(source.id) &&
      !state.jobs.some(
        (j) =>
          j.sourceId === source.id && ["queued", "running"].includes(j.status),
      )
    ) {
      extracting.add(source.id);
      try {
        ingestion.startFile(project.id, source.id);
      } finally {
        extracting.delete(source.id);
      }
    }
  }
}
let closing = false;
let quitRequested = false;
let collectorCloseAllowed = false;
let collectorCloseRequested = false;
const startupWarnings: string[] = [];
const RENDERER_FILE = join(__dirname, "../renderer/index.html");
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
const OUTPUT_KINDS: OutputKind[] = [
  "project-plan",
  "decision-brief",
  "hypothesis",
  "research-plan",
  "whitepaper",
  "gap-analysis",
  "needs-analysis",
];

function queued<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(operation);
  mutationQueue = next.catch(() => undefined);
  return next;
}

function publicSettings(): AISettings {
  return {
    provider: settings.provider,
    endpoint: settings.endpoint,
    model: settings.model,
  };
}

function canEncryptSecrets(): boolean {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" ||
      safeStorage.getSelectedStorageBackend() !== "basic_text")
  );
}

function state(outputOnly = false): WorkspaceState {
  if (outputOnly)
    return {
      project: releasedProject(currentProject),
      settings: { provider: "offline", endpoint: "", model: "" },
    };
  return {
    project: currentProject,
    settings: publicSettings(),
    projectPath: currentProjectPath,
  };
}

function assertSender(
  event: IpcMainInvokeEvent,
  collectorOnly = false,
): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    (window !== collector && window !== releaser) ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("This request did not come from an Acadia workspace.");
  }
  const page = new URL(event.senderFrame.url);
  page.hash = "";
  const expected = new URL(RENDERER_URL || pathToFileURL(RENDERER_FILE).href);
  expected.hash = "";
  if (page.href !== expected.href) throw new Error("Untrusted Acadia page.");
  if (collectorOnly && window !== collector)
    throw new Error("Use the Collector to change your research workspace.");
  return window;
}

function handle(
  channel: string,
  callback: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
  collectorOnly = false,
): void {
  ipcMain.handle(`acadia:${channel}`, async (event, ...args) => {
    assertSender(event, collectorOnly);
    return callback(event, ...args);
  });
}

async function persistProject(
  project: Project,
  projectPath: string | null | undefined = currentProjectPath,
): Promise<void> {
  store.saveProject(project);
  store.activeProjectId = project.id;
  currentProject = store.getProject(project.id)!;
  currentProjectPath = projectPath ?? undefined;
  if (ingestion) startPendingExtractions(currentProject);
  for (const window of [collector, releaser]) {
    if (window && !window.isDestroyed())
      window.webContents.send(
        "acadia:project-changed",
        window === releaser ? releasedProject(currentProject) : currentProject,
      );
  }
  researchChanged();
}

function validateReportSave(project: Project): void {
  const previous = store.getProject(project.id);
  for (const output of project.outputs) {
    const old = previous?.outputs.find((o) => o.id === output.id);
    if (
      old?.revisions?.some(
        (prior) =>
          !output.revisions?.some((revision) => revision.id === prior.id),
      )
    )
      throw new Error(
        "This save omitted existing report revisions. Reload the current report before saving; saved history has been preserved.",
      );
    for (const revision of output.revisions || []) {
      const prior = old?.revisions?.find((r) => r.id === revision.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(revision))
        throw new Error(
          "Saved report revisions are immutable. Save a new revision for changes.",
        );
      if (
        revision.pedigreeSnapshotId &&
        store.getPedigreeSnapshot(revision.pedigreeSnapshotId).projectId !==
          project.id
      )
        throw new Error("Report pedigree belongs to another investigation.");
    }
    if (
      output.pedigreeSnapshotId &&
      store.getPedigreeSnapshot(output.pedigreeSnapshotId).projectId !==
        project.id
    )
      throw new Error("Analysis pedigree belongs to another investigation.");
  }
  const release = selectedRelease(project),
    prior = previous && selectedRelease(previous);
  if (
    release &&
    (!prior ||
      prior.revision.id !== release.revision.id ||
      prior.output.id !== release.output.id)
  ) {
    const frozen = {
      ...release.output,
      document: release.revision.document,
      markdown: release.revision.markdown,
      citations: release.revision.citations,
    };
    const errors = citationIntegrity(frozen, (id) => {
      try {
        const passage = store.getPassage(id);
        return store.getSource(passage.sourceId).source.projectId === project.id
          ? passage
          : undefined;
      } catch {
        return undefined;
      }
    });
    if (errors.length)
      throw new Error(
        `Cannot release a report with citation integrity errors. ${errors.join(" ")}`,
      );
    // Legacy archives may contain historical releases without pedigree. New releases
    // must deliberately freeze the current review context instead of inventing it.
    if (!release.revision.pedigreeSnapshotId)
      throw new Error(
        "Review and freeze the report pedigree before releasing this revision.",
      );
  }
}

async function persistAssets(next: Record<string, AssetRecord>): Promise<void> {
  await atomicWrite(join(storageRoot, "assets.json"), JSON.stringify(next));
  assets = next;
}

function validateSettings(value: unknown): AISettings {
  if (!value || typeof value !== "object")
    throw new Error("Invalid AI settings.");
  const next = value as AISettings;
  if (!["offline", "ollama", "compatible"].includes(next.provider))
    throw new Error("Choose a supported analysis provider.");
  if (
    typeof next.endpoint !== "string" ||
    next.endpoint.length > 2048 ||
    typeof next.model !== "string" ||
    next.model.length > 200
  ) {
    throw new Error("Invalid provider address or model.");
  }
  if (next.provider !== "offline") {
    resolveAIEndpoint(next);
    if (!next.model.trim())
      throw new Error("Enter your provider’s model name.");
  }
  if (
    next.apiKey !== undefined &&
    (typeof next.apiKey !== "string" ||
      next.apiKey.length > 8192 ||
      /[\r\n]/.test(next.apiKey))
  )
    throw new Error("Invalid API key.");
  let sameEndpoint = false;
  try {
    sameEndpoint =
      resolveAIEndpoint(next).href === resolveAIEndpoint(settings).href;
  } catch {
    /* No credentials are reused for an invalid address. */
  }
  const previousKey =
    next.provider === settings.provider && sameEndpoint
      ? settings.apiKey
      : undefined;
  return {
    provider: next.provider,
    endpoint: next.endpoint.trim(),
    model: next.model.trim(),
    apiKey: next.apiKey?.trim() || previousKey,
  };
}

async function saveSettings(next: AISettings): Promise<AISettings> {
  const persisted: Record<string, unknown> = {
    provider: next.provider,
    endpoint: next.endpoint,
    model: next.model,
  };
  if (next.apiKey && canEncryptSecrets()) {
    persisted.apiKeyEncrypted = safeStorage
      .encryptString(next.apiKey)
      .toString("base64");
  }
  await atomicWrite(
    join(storageRoot, "settings.json"),
    JSON.stringify(persisted, null, 2),
  );
  settings = next;
  return publicSettings();
}

async function initializeStorage(): Promise<void> {
  storageRoot = join(app.getPath("userData"), "workspace");
  await mkdir(join(storageRoot, "assets"), { recursive: true });
  await mkdir(join(storageRoot, "recovery"), { recursive: true });
  try {
    const existing = (await readJSON(join(storageRoot, "workspace.json"))) as
      { project?: unknown; projectPath?: unknown } | undefined;
    currentProject = existing
      ? validateProject(existing.project)
      : createDemoProject();
    currentProjectPath =
      typeof existing?.projectPath === "string"
        ? existing.projectPath
        : undefined;
  } catch {
    const recoveryPath = join(
      storageRoot,
      `workspace-recovery-${Date.now()}.json`,
    );
    await rename(join(storageRoot, "workspace.json"), recoveryPath).catch(
      () => undefined,
    );
    startupWarnings.push(
      `The last workspace could not be read. A recovery copy was kept at ${recoveryPath}. You can reopen an exported .acadia project.`,
    );
    currentProject = createDemoProject();
  }
  try {
    const existing = await readJSON(join(storageRoot, "assets.json"));
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      for (const [id, item] of Object.entries(existing)) {
        const record = item as AssetRecord;
        assets[safeAssetId(id)] = assetRecord(id, record.fileName, record.size);
      }
    }
  } catch {
    startupWarnings.push(
      "Some saved attachment records could not be read. Reopen an exported .acadia project to recover its attachments.",
    );
  }
  try {
    const existing = (await readJSON(join(storageRoot, "settings.json"))) as
      (AISettings & { apiKeyEncrypted?: string }) | undefined;
    if (existing) {
      settings = validateSettings(existing);
      if (existing.apiKeyEncrypted && canEncryptSecrets()) {
        settings.apiKey = safeStorage.decryptString(
          Buffer.from(existing.apiKeyEncrypted, "base64"),
        );
      }
    }
  } catch {
    startupWarnings.push(
      "Saved AI settings could not be read. Re-enter your provider settings if needed.",
    );
    settings = {
      provider: "offline",
      endpoint: "http://127.0.0.1:11434",
      model: "llama3.2",
    };
  }
  // Keep the complete legacy file and manifest before the first SQLite transaction.
  const databaseExists = await stat(join(storageRoot, "research.sqlite"))
    .then(() => true)
    .catch(() => false);
  if (!databaseExists) {
    const backup = join(storageRoot, "recovery", `migration-v1-${Date.now()}`);
    await mkdir(backup, { recursive: true });
    for (const file of ["workspace.json", "assets.json"]) {
      const contents = await readFile(join(storageRoot, file)).catch(
        () => undefined,
      );
      if (contents) await atomicWrite(join(backup, file), contents);
    }
  }
  store = new ResearchStore(storageRoot);
  const existingProject = store.activeProjectId
    ? store.getProject(store.activeProjectId)
    : undefined;
  if (existingProject) currentProject = existingProject;
  else
    store.transaction(() => {
      store.saveProject(currentProject);
      store.activeProjectId = currentProject.id;
    });
  ingestion = new Ingestion(
    store,
    storageRoot,
    (id) => assets[id],
    researchChanged,
  );
  research = new ResearchService(
    store,
    ingestion,
    () => ({ ...settings }),
    () => searchKey,
    researchChanged,
  );
  try {
    const saved = (await readJSON(
      join(storageRoot, "search-settings.json"),
    )) as { encrypted?: string } | undefined;
    if (saved?.encrypted && canEncryptSecrets())
      searchKey = safeStorage.decryptString(
        Buffer.from(saved.encrypted, "base64"),
      );
  } catch {
    startupWarnings.push(
      "Saved search connection could not be decrypted. Re-enter your Brave Search key.",
    );
  }
  await persistProject(currentProject);
}

function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
}

function createWindow(isReleaser = false, displayId?: number): BrowserWindow {
  const display = screen
    .getAllDisplays()
    .find((entry) => entry.id === displayId);
  const kind = isReleaser ? "releaser" : "collector";
  const saved = display ? undefined : desktop.window(kind);
  const options = clampWindowBounds(
    saved?.bounds,
    display ? [display.workArea] : connectedWorkAreas(),
    { width: isReleaser ? 800 : 960, height: 700 },
  );
  const window = new BrowserWindow({
    ...options,
    minWidth: Math.min(isReleaser ? 800 : 960, options.width),
    minHeight: Math.min(700, options.height),
    title: isReleaser ? "Acadia — Releaser" : "Acadia — Collector",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111510" : "#f7f8f5",
    show: false,
    autoHideMenuBar: isReleaser,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      ...(isReleaser ? { partition: "acadia-releaser" } : {}),
    },
  });
  secureWindow(window);
  trackWindow(window, kind);
  const hash = isReleaser ? "releaser" : "";
  if (RENDERER_URL) {
    const url = new URL(RENDERER_URL);
    url.hash = hash;
    void window.loadURL(url.href);
  } else {
    void window.loadFile(RENDERER_FILE, { hash });
  }
  window.once("ready-to-show", () => {
    if (saved?.maximized) window.maximize();
    window.show();
  });
  if (isReleaser)
    window.on("closed", () => {
      if (releaser === window) releaser = null;
    });
  else {
    let rendererReady = false;
    collectorCloseAllowed = false;
    collectorCloseRequested = false;
    window.webContents.on("did-finish-load", () => {
      rendererReady = true;
    });
    window.webContents.on("render-process-gone", () => {
      rendererReady = false;
    });
    window.on("close", (event) => {
      if (collectorCloseAllowed || window.webContents.isDestroyed()) return;
      if (!rendererReady) {
        collectorCloseAllowed = true;
        if (quitRequested) setImmediate(() => app.quit());
        return;
      }
      event.preventDefault();
      if (collectorCloseRequested) return;
      collectorCloseRequested = true;
      window.webContents.send("acadia:before-close");
    });
    window.on("closed", () => {
      if (collector === window) collector = null;
    });
  }
  return window;
}

function registerAssetProtocol(): void {
  // A citation grants access to its released passages, not the original attachment.
  // A separate session prevents guessed asset URLs from bypassing the read IPC checks.
  session.fromPartition("acadia-releaser").protocol.handle(
    "acadia-asset",
    () =>
      new Response("Use the Collector to open original attachments.", {
        status: 403,
      }),
  );
  protocol.handle("acadia-asset", async (request) => {
    try {
      const url = new URL(request.url);
      if (
        url.hostname !== "asset" ||
        url.search ||
        url.hash ||
        !["GET", "HEAD"].includes(request.method)
      )
        return new Response("Not found", { status: 404 });
      const id = safeAssetId(url.pathname.slice(1));
      const asset = assets[id];
      if (!asset) return new Response("Attachment not found", { status: 404 });
      const response = await net.fetch(
        pathToFileURL(join(storageRoot, "assets", asset.storedName)).href,
        { method: request.method, headers: request.headers },
      );
      const headers = new Headers(response.headers);
      headers.set("Content-Type", asset.mimeType);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response("Attachment not available", { status: 404 });
    }
  });
}

async function importPaths(paths: unknown): Promise<ImportedAsset[]> {
  if (
    !Array.isArray(paths) ||
    paths.length > 100 ||
    paths.some((path) => typeof path !== "string" || !isAbsolute(path))
  ) {
    throw new Error("Choose up to 100 local research files at a time.");
  }
  const prepared = await Promise.all(
    paths.map(async (path: string) => {
      fileType(path);
      const info = await stat(path);
      if (!info.isFile()) throw new Error(`“${basename(path)}” is not a file.`);
      if (info.size > MAX_ASSET_BYTES)
        throw new Error(
          `“${basename(path)}” exceeds the 250 MB attachment limit.`,
        );
      return {
        path,
        record: assetRecord(randomUUID(), basename(path), info.size),
      };
    }),
  );
  if (
    prepared.reduce((size, entry) => size + entry.record.size, 0) >
    MAX_ARCHIVE_BYTES
  )
    throw new Error("Import up to 1 GB of attachments at a time.");
  const nextAssets = { ...assets };
  const imported: ImportedAsset[] = [];
  for (const { path, record } of prepared) {
    const destination = join(storageRoot, "assets", record.storedName);
    const contents = await readFile(path);
    if (contents.length > MAX_ASSET_BYTES)
      throw new Error(
        `“${record.fileName}” exceeds the 250 MB attachment limit.`,
      );
    record.size = contents.length;
    await atomicWrite(destination, contents);
    nextAssets[record.id] = record;

    imported.push({
      assetId: record.id,
      fileName: record.fileName,
      mimeType: record.mimeType,
      kind: fileType(record.fileName).kind,
      content: "",
      extraction: "",
    });
  }
  await persistAssets(nextAssets);
  return imported;
}

async function openArchive(path: string): Promise<WorkspaceState> {
  assertProjectTransitionAllowed();
  const info = await stat(path);
  if (info.size > MAX_ARCHIVE_BYTES)
    throw new Error("This project exceeds the 1 GB portable-project limit.");
  const zip = new AdmZip(path);
  const entries = zip.getEntries();
  const names = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (
      names.has(name) ||
      !(
        name === "project.json" ||
        name === "assets.json" ||
        name === "research.json" ||
        /^assets\/[0-9a-f-]+$/i.test(name)
      )
    )
      throw new Error("The project archive contains unexpected entries.");
    names.add(name);
    total += entry.header.size;
    if (
      entry.header.size > MAX_ASSET_BYTES ||
      total > MAX_ARCHIVE_BYTES ||
      names.size > 5003
    )
      throw new Error("The expanded project is too large.");
  }
  const projectEntry = zip.getEntry("project.json");
  const manifestEntry = zip.getEntry("assets.json");
  if (
    !projectEntry ||
    !manifestEntry ||
    projectEntry.header.size > 50 * 1024 * 1024 ||
    manifestEntry.header.size > 5 * 1024 * 1024
  )
    throw new Error("This is not a valid Acadia portable project.");
  const project = validateProject(
    JSON.parse(projectEntry.getData().toString("utf8")),
  );
  const researchEntry = zip.getEntry("research.json");
  const archivedResearch = researchEntry
    ? validateResearchArchive(
        JSON.parse(researchEntry.getData().toString("utf8")),
        project.id,
        undefined,
        project.cards,
      )
    : undefined;
  if (project.schemaVersion >= 2 && !archivedResearch)
    throw new Error("Portable projects require their research records.");
  if (
    project.schemaVersion >= 3 &&
    archivedResearch?.schemaVersion !== project.schemaVersion
  )
    throw new Error(
      "The project and research archive versions must match; version 4 requires the updated Acadia research board.",
    );
  const manifest = JSON.parse(
    manifestEntry.getData().toString("utf8"),
  ) as unknown;
  if (!Array.isArray(manifest) || manifest.length > 5000)
    throw new Error("The attachment manifest is invalid.");
  const originals = new Map<string, AssetRecord>();
  for (const item of manifest) {
    if (!item || typeof item !== "object")
      throw new Error("The attachment manifest is invalid.");
    const original = assetRecord(item.id, item.fileName, item.size);
    if (originals.has(original.id))
      throw new Error(
        "The attachment manifest contains duplicate identifiers.",
      );
    const entry = zip.getEntry(`assets/${original.id}`);
    if (!entry || entry.header.size !== original.size)
      throw new Error(
        `The project is missing attachment “${original.fileName}”.`,
      );
    originals.set(original.id, original);
  }
  for (const card of project.cards) {
    if (card.assetId && !originals.has(card.assetId))
      throw new Error(
        `The project is missing the attachment for “${card.title}”.`,
      );
  }
  if (archivedResearch)
    for (const id of [
      ...archivedResearch.sources.map((s) => s.assetId),
      ...archivedResearch.versions.map((v) => v.assetId),
    ])
      if (id && !originals.has(id))
        throw new Error("Archive is missing a historical source attachment.");
  const nextAssets = { ...assets };
  const remapped = new Map<string, AssetRecord>();
  for (const original of originals.values()) {
    const record = assetRecord(randomUUID(), original.fileName, original.size);
    const contents = zip.getEntry(`assets/${original.id}`)!.getData();
    if (contents.length !== record.size)
      throw new Error("An attachment failed its size check.");
    if (archivedResearch) {
      const hash = createHash("sha256").update(contents).digest("hex");
      for (const version of archivedResearch.versions.filter(
        (v) =>
          v.assetId === original.id && ["native", "ocr"].includes(v.method),
      ))
        if (version.hash !== hash)
          throw new Error(
            "Source attachment failed its recorded content hash check.",
          );
    }
    await atomicWrite(join(storageRoot, "assets", record.storedName), contents);
    nextAssets[record.id] = record;
    remapped.set(original.id, record);
  }
  for (const card of project.cards) {
    if (!card.assetId) continue;
    const record = remapped.get(card.assetId)!;
    card.assetId = record.id;
    card.mimeType = record.mimeType;
    card.fileName = record.fileName;
  }
  if (archivedResearch) {
    for (const source of archivedResearch.sources)
      if (source.assetId) source.assetId = remapped.get(source.assetId)!.id;
    for (const version of archivedResearch.versions)
      if (version.assetId) version.assetId = remapped.get(version.assetId)!.id;
  }
  await createRecovery();
  const replaced = store.getProject(project.id);
  if (replaced && replaced.id !== currentProject.id)
    await atomicWrite(
      join(
        storageRoot,
        "recovery",
        `${safeFileName(replaced.title)}-before-import-${Date.now()}.acadia`,
      ),
      await portableArchive(replaced),
    );
  await persistAssets(nextAssets);
  store.transaction(() => {
    store.importResearch(
      project.id,
      archivedResearch || {
        schemaVersion: 2,
        sources: [],
        versions: [],
        passages: [],
        claims: [],
        tasks: [],
        jobs: [],
        discoveries: [],
        runs: [],
      },
      { replace: true, projectCards: project.cards },
    );
    store.saveProject(project);
  });
  await persistProject(project, path);
  return state();
}

async function portableArchive(project: Project): Promise<Buffer> {
  const zip = new AdmZip();
  const manifest: AssetRecord[] = [];
  const records = store.exportResearch(project.id);
  let total = 0;
  for (const id of new Set(
    [
      ...project.cards.map((card) => card.assetId),
      ...records.sources.map((source) => source.assetId),
      ...records.versions.map((version) => version.assetId),
    ].filter((id): id is string => Boolean(id)),
  )) {
    const asset = assets[safeAssetId(id)];
    if (!asset)
      throw new Error(
        "An attachment is missing. Reimport it before exporting or switching projects.",
      );
    total += asset.size;
    if (total > MAX_ARCHIVE_BYTES - 50 * 1024 * 1024)
      throw new Error(
        "This project exceeds the 1 GB portable-project limit. Split large media into separate projects.",
      );
    const contents = await readFile(
      join(storageRoot, "assets", asset.storedName),
    );
    zip.addFile(`assets/${id}`, contents);
    manifest.push(asset);
  }
  zip.addFile("research.json", Buffer.from(JSON.stringify(records)));
  zip.addFile(
    "project.json",
    Buffer.from(JSON.stringify({ ...project, schemaVersion: 4 }, null, 2)),
  );
  zip.addFile("assets.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  return zip.toBuffer();
}

async function createRecovery(): Promise<void> {
  if (
    !currentProject.cards.length &&
    !currentProject.outputs.length &&
    !currentProject.question
  )
    return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(
    storageRoot,
    "recovery",
    `${safeFileName(currentProject.title)}-${timestamp}.acadia`,
  );
  await atomicWrite(path, await portableArchive(currentProject));
}

function validateOutput(value: unknown): ResearchOutput {
  if (!value || typeof value !== "object")
    throw new Error("Choose a research output to export.");
  const output = value as ResearchOutput;
  if (
    typeof output.title !== "string" ||
    !output.title.trim() ||
    output.title.length > 1000 ||
    typeof output.markdown !== "string" ||
    output.markdown.length > 2_000_000
  )
    throw new Error("Invalid research output.");
  return output;
}

function registerIPC(): void {
  handle("desktop-state", () => desktopState());
  handle(
    "save-desktop-preferences",
    async (_event, patch) => {
      await desktop.savePreferences(patch);
      nativeTheme.themeSource = desktop.preferences.theme;
      desktopChanged();
      return desktopState();
    },
    true,
  );
  handle(
    "native-edit",
    (event, command) => {
      const contents = assertSender(event, true).webContents;
      if (command === "undo") contents.undo();
      else if (command === "redo") contents.redo();
      else throw new Error("Unsupported native edit command.");
    },
    true,
  );
  handle(
    "list-local-models",
    (_event, endpoint) => listLocalModels(endpoint),
    true,
  );
  handle(
    "test-ai-connection",
    (_event, input) => testAIConnection(validateSettings(input)),
    true,
  );
  handle("load", (event) =>
    state(BrowserWindow.fromWebContents(event.sender) === releaser),
  );
  const id = (value: unknown) => {
    if (
      typeof value !== "string" ||
      value.length > 200 ||
      !/^[a-zA-Z0-9_-]+$/.test(value)
    )
      throw new Error("Invalid research identifier.");
    return value;
  };
  const text = (value: unknown, max = 20000) => {
    if (typeof value !== "string" || value.length > max)
      throw new Error("Invalid research text.");
    return value;
  };
  const ownSource = (value: unknown) => {
    const source = store.getSource(id(value)).source;
    if (source.projectId !== currentProject.id)
      throw new Error("Source belongs to another investigation.");
    return source;
  };
  const ownPassage = (value: unknown) => {
    const p = store.getPassage(id(value));
    ownSource(p.sourceId);
    return p;
  };
  const changeResearch = (fn: () => unknown) => {
    const value = fn();
    researchChanged();
    return value;
  };
  handle("pedigree-state", () => store.pedigreeState(currentProject.id), true);
  const pedigreeWriters = {
    brief: (v: any) => store.saveBrief(v),
    appraisal: (v: any) => store.saveAppraisal(v),
    origin: (v: any) => store.saveOrigin(v),
    finding: (v: any) => store.saveFinding(v),
    assumption: (v: any) => store.saveAssumption(v),
    method: (v: any) => store.saveMethod(v),
    issue: (v: any) => store.saveReviewIssue(v),
    gap: (v: any) => store.saveGap(v),
    decision: (v: any) => store.saveDecision(v),
  };
  for (const kind of Object.keys(pedigreeWriters) as PedigreeEntityKind[])
    handle(
      kind === "issue" ? "save-review-issue" : `save-${kind}`,
      (_event, input) => {
        const value = validatePedigreeEntity(kind, input, currentProject.id);
        return changeResearch(() => pedigreeWriters[kind](value));
      },
      true,
    );
  handle(
    "pedigree-revisions",
    (_event, kind, value) => {
      if (!Object.hasOwn(PEDIGREE_COLLECTIONS, kind))
        throw new Error("Invalid pedigree record type.");
      const revisions = store.getPedigreeRevisions(
        kind as PedigreeEntityKind,
        id(value),
      );
      if (revisions.some((r) => r.projectId !== currentProject.id))
        throw new Error("Record belongs to another investigation.");
      return revisions;
    },
    true,
  );
  handle(
    "create-pedigree-snapshot",
    () => store.createPedigreeSnapshot(currentProject.id),
    true,
  );
  handle(
    "get-pedigree-snapshot",
    (_event, value) => {
      const snapshot = store.getPedigreeSnapshot(id(value));
      if (snapshot.projectId !== currentProject.id)
        throw new Error("Snapshot belongs to another investigation.");
      return snapshot;
    },
    true,
  );
  handle(
    "challenge-analysis",
    (_event, input) => {
      if (!input || !["finding", "method", "report"].includes(input.kind))
        throw new Error("Choose a finding, method, or report to challenge.");
      const target: ChallengeTarget = { kind: input.kind, id: id(input.id) };
      return research.challenge(currentProject, target);
    },
    true,
  );
  handle(
    "assist-method",
    (_event, value) => research.assistMethod(currentProject, id(value)),
    true,
  );
  handle(
    "summarize-item",
    (_event, input: unknown) => {
      const target = validateItemInsightTarget(input);
      const projectId = currentProject.id;
      return queued(async () => {
        if (currentProject.id !== projectId)
          throw new Error("Project changed before the item summary started.");
        return research.summarizeItem(currentProject, target);
      });
    },
    true,
  );
  handle(
    "add-board-reference",
    (_event, input: unknown) => {
      const reference = validateBoardReference(input),
        projectId = currentProject.id;
      return queued(async () => {
        if (currentProject.id !== projectId)
          throw new Error("Project changed before the board item was placed.");
        const result = store.addBoardReference(currentProject, reference);
        await persistProject(result.project);
        return { project: currentProject, cardId: result.cardId };
      });
    },
    true,
  );
  handle(
    "accept-item-insight",
    (_event, input: unknown) => {
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Choose a completed item summary to review.");
      const value = input as Record<string, unknown>;
      const request = {
        runId: id(value.runId),
        notes: text(value.notes, 30_000),
      };
      const projectId = currentProject.id;
      return queued(async () => {
        if (currentProject.id !== projectId)
          throw new Error("Project changed before the item review was saved.");
        const claim = await research.acceptItemInsight(currentProject, request);
        researchChanged();
        return claim;
      });
    },
    true,
  );
  handle("list-projects", () => store.listProjects(), true);
  handle(
    "switch-project",
    (_event, value) =>
      queued(async () => {
        assertProjectTransitionAllowed();
        const project = store.getProject(id(value));
        if (!project) throw new Error("Project not found.");
        await persistProject(project, null);
        return state();
      }),
    true,
  );
  handle("research-state", (event) =>
    BrowserWindow.fromWebContents(event.sender) === releaser
      ? audienceResearchState()
      : store.state(currentProject.id),
  );
  handle("get-source", (event, value, version) => {
    const sourceId = id(value),
      versionId = version === undefined ? undefined : id(version);
    if (BrowserWindow.fromWebContents(event.sender) === releaser)
      return audienceSource(sourceId, versionId);
    ownSource(sourceId);
    return store.getSource(sourceId, versionId);
  });
  handle("get-passage", (event, value) =>
    BrowserWindow.fromWebContents(event.sender) === releaser
      ? audiencePassage(id(value))
      : ownPassage(value),
  );
  handle(
    "search-sources",
    (_event, query) => store.search(currentProject.id, text(query, 10000), 200),
    true,
  );
  handle(
    "set-source-policy",
    (_event, value, policy) => {
      ownSource(value);
      return changeResearch(() =>
        store.setSourcePolicy(id(value), policy as Inclusion),
      );
    },
    true,
  );
  handle(
    "set-passage-policy",
    (_event, value, policy) => {
      ownPassage(value);
      return changeResearch(() =>
        store.setPassagePolicy(id(value), policy as Inclusion),
      );
    },
    true,
  );
  handle(
    "capture-url",
    (_event, url) => ingestion.startCapture(currentProject.id, text(url, 2048)),
    true,
  );
  handle(
    "reprocess-source",
    (_event, value, ocr) => {
      const source = ownSource(value);
      if (source.kind === "web" && source.url && !source.assetId)
        return ingestion.startCapture(currentProject.id, source.url, source.id);
      return ingestion.startFile(currentProject.id, source.id, ocr === true);
    },
    true,
  );
  handle(
    "cancel-job",
    (_event, value) => {
      const job = store.getJob(id(value));
      if (!job || job.projectId !== currentProject.id)
        throw new Error("Job not found in this project.");
      ingestion.cancelJob(job.id);
      research.cancelJob(job.id);
    },
    true,
  );
  handle(
    "save-claim",
    (_event, value) => {
      const candidate = value as ResearchClaim;
      if (!candidate || candidate.projectId !== currentProject.id)
        throw new Error("Invalid claim project.");
      text(candidate.title);
      text(candidate.question);
      text(candidate.alternatives);
      text(candidate.limitations);
      if (!Array.isArray(candidate.links) || candidate.links.length > 10000)
        throw new Error("Invalid evidence links.");
      const existing = store
        .state(currentProject.id)
        .claims.find((claim) => claim.id === candidate.id);
      const historicalReviewedCard =
        existing?.itemReview && existing.cardId === candidate.cardId;
      if (
        candidate.cardId &&
        !currentProject.cards.some((c) => c.id === candidate.cardId) &&
        !historicalReviewedCard
      )
        throw new Error("Missing claim board item.");
      return changeResearch(() => store.saveClaim(candidate));
    },
    true,
  );
  handle(
    "delete-claim",
    (_event, value) => {
      if (
        !store.state(currentProject.id).claims.some((c) => c.id === id(value))
      )
        throw new Error("Claim not found.");
      return changeResearch(() => store.deleteClaim(id(value)));
    },
    true,
  );
  handle(
    "save-task",
    (_event, value) => {
      const task = value as ResearchTask;
      if (!task || task.projectId !== currentProject.id)
        throw new Error("Invalid task project.");
      text(task.title);
      text(task.question);
      text(task.criterion);
      if (!Array.isArray(task.sourceIds))
        throw new Error("Invalid task sources.");
      task.sourceIds.forEach(ownSource);
      const pedigree = store.pedigreeState(currentProject.id);
      if (
        task.assumptionId &&
        !pedigree.assumptions.some((a) => a.id === task.assumptionId)
      )
        throw new Error("Missing linked assumption.");
      if (
        task.methodId &&
        !pedigree.methods.some((m) => m.id === task.methodId)
      )
        throw new Error("Missing linked method.");
      if (
        task.claimId &&
        !store
          .state(currentProject.id)
          .claims.some((c) => c.id === task.claimId)
      )
        throw new Error("Missing linked claim.");
      return changeResearch(() => store.saveTask(task));
    },
    true,
  );
  handle(
    "delete-task",
    (_event, value) => {
      if (!store.state(currentProject.id).tasks.some((t) => t.id === id(value)))
        throw new Error("Task not found.");
      return changeResearch(() => store.deleteTask(id(value)));
    },
    true,
  );
  handle(
    "ask",
    (_event, question) => research.ask(currentProject, text(question)),
    true,
  );
  handle(
    "suggest-connections",
    () => research.suggestConnections(currentProject),
    true,
  );
  handle(
    "plan-discovery",
    (_event, question, queries) =>
      research.planDiscovery(currentProject, text(question), queries),
    true,
  );
  handle(
    "approve-discovery",
    (_event, value) => research.approveDiscovery(currentProject, id(value)),
    true,
  );
  handle(
    "accept-discovery",
    (_event, value) => research.acceptDiscovery(currentProject, id(value)),
    true,
  );
  handle(
    "dismiss-discovery",
    (_event, value) => research.dismissDiscovery(currentProject, id(value)),
    true,
  );
  handle(
    "save-search-key",
    async (_event, value) => {
      const key = text(value, 8192).trim();
      if (/[\r\n]/.test(key)) throw new Error("Invalid search API key.");
      if (key && !canEncryptSecrets())
        throw new Error("Secure credential storage is unavailable.");
      await atomicWrite(
        join(storageRoot, "search-settings.json"),
        JSON.stringify(
          key
            ? { encrypted: safeStorage.encryptString(key).toString("base64") }
            : {},
        ),
      );
      searchKey = key || undefined;
    },
    true,
  );
  handle("has-search-key", () => Boolean(searchKey), true);
  handle(
    "revise-section",
    (_event, outputId, original, instructions) =>
      research.reviseSection(
        currentProject,
        id(outputId),
        text(original, 500000),
        text(instructions),
      ),
    true,
  );

  handle(
    "close-ready",
    async (event, error?: unknown) => {
      if (!collectorCloseRequested) return;
      collectorCloseRequested = false;
      if (error) {
        quitRequested = false;
        await dialog.showMessageBox(assertSender(event, true), {
          type: "error",
          title: "Workspace not saved",
          message: "Acadia kept the workspace open because saving failed.",
          detail:
            typeof error === "string"
              ? error.slice(0, 2000)
              : "Please try saving again.",
        });
        return;
      }
      await mutationQueue;
      collectorCloseAllowed = true;
      if (quitRequested) app.quit();
      else collector?.close();
    },
    true,
  );
  handle(
    "save",
    (_event, input: unknown) =>
      queued(async () => {
        const project = validateProject(input);
        if (project.id !== currentProject.id)
          throw new Error(
            "This workspace has changed. Reload the current project before saving.",
          );
        for (const card of project.cards)
          if (card.assetId && !assets[safeAssetId(card.assetId)])
            throw new Error(
              `The attachment for “${card.title}” is unavailable.`,
            );
        validateReportSave(project);
        await persistProject(project);
        return { savedAt: new Date().toISOString() };
      }),
    true,
  );
  handle(
    "new-project",
    () =>
      queued(async () => {
        assertProjectTransitionAllowed();
        await createRecovery();
        const project = createBlankProject();
        await persistProject(project, null);
        return state();
      }),
    true,
  );
  handle(
    "open-project",
    async (event) => {
      assertProjectTransitionAllowed();
      const result = await dialog.showOpenDialog(assertSender(event, true), {
        title: "Open Acadia project or recover a previous board",
        defaultPath: join(storageRoot, "recovery"),
        properties: ["openFile"],
        filters: [{ name: "Acadia research projects", extensions: ["acadia"] }],
      });
      return result.canceled || !result.filePaths[0]
        ? null
        : queued(() => openArchive(result.filePaths[0]));
    },
    true,
  );
  handle(
    "export-project",
    async (event, input: unknown) => {
      const project = validateProject(input);
      const result = await dialog.showSaveDialog(assertSender(event, true), {
        title: "Export portable research project",
        defaultPath: `${safeFileName(project.title)}.acadia`,
        filters: [{ name: "Acadia research project", extensions: ["acadia"] }],
      });
      if (result.canceled || !result.filePath) return null;
      return queued(async () => {
        if (project.id !== currentProject.id)
          throw new Error("Project changed before export.");
        validateReportSave(project);
        await persistProject(project);
        await atomicWrite(
          result.filePath!,
          await portableArchive(currentProject),
        );
        return result.filePath;
      });
    },
    true,
  );
  handle(
    "import-files",
    async (event) => {
      const result = await dialog.showOpenDialog(assertSender(event, true), {
        title: "Collect research files",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Research sources",
            extensions: [
              "pdf",
              "docx",
              "txt",
              "md",
              "csv",
              "tsv",
              "json",
              "rtf",
              "xlsx",
              "pptx",
              "doc",
              "xls",
              "ppt",
              "odt",
              "ods",
              "odp",
              "png",
              "jpg",
              "jpeg",
              "webp",
              "gif",
              "avif",
              "bmp",
              "tif",
              "tiff",
              "svg",
              "mp3",
              "wav",
              "ogg",
              "m4a",
              "aac",
              "flac",
              "mp4",
              "webm",
              "mov",
              "m4v",
            ],
          },
        ],
      });
      return result.canceled ? [] : queued(() => importPaths(result.filePaths));
    },
    true,
  );
  handle(
    "import-dropped",
    (_event, paths: unknown) => queued(() => importPaths(paths)),
    true,
  );
  handle("open-external", (_event, url: unknown) =>
    shell.openExternal(externalURL(url)),
  );
  handle(
    "open-asset",
    async (_event, id: unknown) => {
      const asset = assets[safeAssetId(id)];
      if (!asset) throw new Error("This attachment is not available.");
      if (extname(asset.fileName).toLowerCase() === ".svg")
        throw new Error(
          "SVG images can be previewed on the Collector. Export the project to access the original.",
        );
      // External editors receive a viewing copy, preserving captured source evidence.
      const extension = extname(asset.fileName).toLowerCase();
      const viewPath = join(
        storageRoot,
        "viewing-copies",
        asset.id,
        `${safeFileName(basename(asset.fileName, extname(asset.fileName)))}${extension}`,
      );
      await atomicWrite(
        viewPath,
        await readFile(join(storageRoot, "assets", asset.storedName)),
      );
      const error = await shell.openPath(viewPath);
      if (error) throw new Error(error);
    },
    true,
  );
  handle("displays", () =>
    screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label:
        display.label ||
        `Display ${index + 1} (${display.size.width} × ${display.size.height})`,
      primary: display.id === screen.getPrimaryDisplay().id,
    })),
  );
  handle(
    "open-releaser",
    (_event, displayId?: unknown) => {
      if (
        displayId !== undefined &&
        (typeof displayId !== "number" ||
          !screen.getAllDisplays().some((entry) => entry.id === displayId))
      )
        throw new Error("That display is no longer connected.");
      if (releaser && !releaser.isDestroyed()) {
        const display = screen
          .getAllDisplays()
          .find((entry) => entry.id === displayId);
        if (display) {
          releaser.setFullScreen(false);
          releaser.setBounds({
            x: display.workArea.x,
            y: display.workArea.y,
            width: display.workArea.width,
            height: display.workArea.height,
          });
        }
        releaser.show();
        releaser.focus();
      } else releaser = createWindow(true, displayId as number | undefined);
    },
    true,
  );
  handle("fullscreen", (event) => {
    const window = assertSender(event);
    window.setFullScreen(!window.isFullScreen());
  });
  handle(
    "save-settings",
    (_event, input: unknown) =>
      queued(() => saveSettings(validateSettings(input))),
    true,
  );
  handle(
    "generate",
    async (
      _event,
      input: unknown,
      kind: unknown,
      instructions: unknown,
      planInput: unknown,
    ) => {
      const project = validateProject(input);
      if (!OUTPUT_KINDS.includes(kind as OutputKind))
        throw new Error("Choose a supported research output.");
      if (typeof instructions !== "string" || instructions.length > 20_000)
        throw new Error("Keep analysis instructions under 20,000 characters.");
      if (generating) throw new Error("An analysis is already in progress.");
      generating = true;
      try {
        if (project.id !== currentProject.id)
          throw new Error("Project changed before analysis.");
        await queued(() => {
          if (project.id !== currentProject.id)
            throw new Error("Project changed before analysis.");
          validateReportSave(project);
          return persistProject(project);
        });
        return await research.analyze(
          currentProject,
          kind as OutputKind,
          instructions,
          planInput === undefined
            ? undefined
            : validateProjectPlanContext(planInput),
        );
      } finally {
        generating = false;
      }
    },
    true,
  );
  handle("export-output", async (event, value: unknown, format: unknown) => {
    const output = validateOutput(value);
    if (!["md", "pdf", "docx"].includes(format as string))
      throw new Error("Choose Markdown, DOCX, or PDF.");
    const result = await dialog.showSaveDialog(assertSender(event), {
      title: "Export research output",
      defaultPath: `${safeFileName(output.title)}.${format}`,
      filters: [
        {
          name:
            format === "md"
              ? "Markdown document"
              : format === "docx"
                ? "Editable Word document"
                : "PDF document",
          extensions: [format as string],
        },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    if (format === "md")
      await atomicWrite(result.filePath, exportReportMarkdown(output));
    else if (format === "docx")
      await atomicWrite(result.filePath, await exportReportDocx(output));
    else {
      const printer = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          javascript: false,
        },
      });
      secureWindow(printer);
      try {
        await printer.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(reportHTML(output))}`,
        );
        const buffer = await printer.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
        });
        await atomicWrite(result.filePath, buffer);
      } finally {
        printer.destroy();
      }
    }
    return result.filePath;
  });
  handle(
    "export-project-plan",
    async (event, value: unknown) => {
      const output = validateOutput(value);
      if (!output.deliveryPlan)
        throw new Error(
          "Prepare and review the work packages before exporting to a PMIS.",
        );
      const files = exportPmisFiles(output.deliveryPlan);
      const result = await dialog.showSaveDialog(assertSender(event, true), {
        title: "Export PMIS handoff",
        defaultPath: `${safeFileName(output.title)}-PMIS.zip`,
        filters: [{ name: "PMIS import package", extensions: ["zip"] }],
      });
      if (result.canceled || !result.filePath) return null;
      const zip = new AdmZip();
      for (const [name, contents] of Object.entries(files))
        zip.addFile(name, Buffer.from(contents));
      zip.addFile("Import-Planner.ps1", Buffer.from(PLANNER_IMPORTER));
      zip.addFile(
        "research-report.md",
        Buffer.from(exportReportMarkdown(output)),
      );
      await atomicWrite(result.filePath, zip.toBuffer());
      return result.filePath;
    },
    true,
  );
  handle(
    "export-power-bi",
    async (event) => {
      const project = currentProject;
      const records = store.exportResearch(project.id);
      const files = buildPowerBiFiles(
        project,
        store.state(project.id),
        store.pedigreeState(project.id),
        records.passages,
      );
      const result = await dialog.showSaveDialog(assertSender(event, true), {
        title: "Export research data for Power BI",
        defaultPath: `${safeFileName(project.title)}-PowerBI.zip`,
        filters: [{ name: "Power BI data package", extensions: ["zip"] }],
      });
      if (result.canceled || !result.filePath) return null;
      const zip = new AdmZip();
      for (const [name, value] of Object.entries(files))
        zip.addFile(name, Buffer.from(value));
      await atomicWrite(result.filePath, zip.toBuffer());
      return result.filePath;
    },
    true,
  );
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (collector) {
      if (collector.isMinimized()) collector.restore();
      collector.show();
      collector.focus();
    } else if (app.isReady()) collector = createWindow();
  });
  app
    .whenReady()
    .then(async () => {
      app.setName("Acadia");
      desktop = new DesktopStore(app.getPath("userData"));
      await desktop.load();
      nativeTheme.themeSource = desktop.preferences.theme;
      nativeTheme.on("updated", desktopChanged);
      app.on("accessibility-support-changed", desktopChanged);
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(
          desktopMenuTemplate(
            desktopState().appearance.platform,
            sendDesktopCommand,
          ),
        ),
      );
      await initializeStorage();
      registerAssetProtocol();
      registerIPC();
      collector = createWindow();
      screen.on("display-removed", recoverDisplayWindows);
      screen.on("display-metrics-changed", recoverDisplayWindows);
      if (startupWarnings.length)
        void dialog.showMessageBox(collector, {
          type: "warning",
          title: "Workspace recovery",
          message: "Acadia recovered your workspace",
          detail: startupWarnings.join("\n\n"),
        });
      app.on("activate", () => {
        if (!collector) collector = createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Acadia could not start",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    quitRequested = true;
    if (collector && !collector.isDestroyed() && !collectorCloseAllowed) {
      collector.close();
      return;
    }
    closing = true;
    for (const save of windowSavers.values()) save();
    void Promise.allSettled([mutationQueue, desktop?.flush()]).finally(() =>
      app.quit(),
    );
  });
}
