import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AcadiaAPI, Project } from "../shared/types";
import type { DesktopCommand, DesktopState } from "../shared/desktop";

let beforeClose: (() => Promise<void>) | undefined;
ipcRenderer.on("acadia:before-close", async () => {
  let failure: string | undefined;
  try {
    await beforeClose?.();
  } catch (error) {
    failure =
      error instanceof Error
        ? error.message
        : "The latest changes could not be saved.";
  }
  // The acknowledged close can destroy this renderer before its reply arrives.
  void ipcRenderer.invoke("acadia:close-ready", failure).catch(() => undefined);
});

const api: AcadiaAPI = {
  addBoardReference: (reference) =>
    ipcRenderer.invoke("acadia:add-board-reference", reference),
  saveGap: (value) => ipcRenderer.invoke("acadia:save-gap", value),
  saveDecision: (value) => ipcRenderer.invoke("acadia:save-decision", value),
  pedigreeState: () => ipcRenderer.invoke("acadia:pedigree-state"),
  saveResearchBrief: (value) => ipcRenderer.invoke("acadia:save-brief", value),
  saveSourceAppraisal: (value) =>
    ipcRenderer.invoke("acadia:save-appraisal", value),
  saveOriginRelationship: (value) =>
    ipcRenderer.invoke("acadia:save-origin", value),
  saveFindingAssessment: (value) =>
    ipcRenderer.invoke("acadia:save-finding", value),
  saveAssumption: (value) =>
    ipcRenderer.invoke("acadia:save-assumption", value),
  saveMethod: (value) => ipcRenderer.invoke("acadia:save-method", value),
  saveReviewIssue: (value) =>
    ipcRenderer.invoke("acadia:save-review-issue", value),
  pedigreeRevisions: (kind, id) =>
    ipcRenderer.invoke("acadia:pedigree-revisions", kind, id),
  createPedigreeSnapshot: () =>
    ipcRenderer.invoke("acadia:create-pedigree-snapshot"),
  getPedigreeSnapshot: (id) =>
    ipcRenderer.invoke("acadia:get-pedigree-snapshot", id),
  challengeAnalysis: (target) =>
    ipcRenderer.invoke("acadia:challenge-analysis", target),
  assistMethod: (id) => ipcRenderer.invoke("acadia:assist-method", id),
  summarizeItem: (target) =>
    ipcRenderer.invoke("acadia:summarize-item", target),
  acceptItemInsight: (input) =>
    ipcRenderer.invoke("acadia:accept-item-insight", input),
  getDesktopState: () => ipcRenderer.invoke("acadia:desktop-state"),
  saveDesktopPreferences: (patch) =>
    ipcRenderer.invoke("acadia:save-desktop-preferences", patch),
  listLocalModels: (endpoint) =>
    ipcRenderer.invoke("acadia:list-local-models", endpoint),
  testAIConnection: (settings) =>
    ipcRenderer.invoke("acadia:test-ai-connection", settings),
  onDesktopChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopState) =>
      callback(state);
    ipcRenderer.on("acadia:desktop-changed", listener);
    return () => ipcRenderer.removeListener("acadia:desktop-changed", listener);
  },
  onCommand: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: DesktopCommand,
    ) => {
      const active = document.activeElement as HTMLElement | null;
      // Native text fields use Chromium's history. Rich editors receive the command
      // in the renderer so their own document history (including citations) is used.
      const nativeField = /^(INPUT|TEXTAREA|SELECT)$/.test(
        active?.tagName || "",
      );
      if ((command === "undo" || command === "redo") && nativeField) {
        void ipcRenderer
          .invoke("acadia:native-edit", command)
          .catch(() => undefined);
        return;
      }
      callback(command);
    };
    ipcRenderer.on("acadia:command", listener);
    return () => ipcRenderer.removeListener("acadia:command", listener);
  },
  listProjects: () => ipcRenderer.invoke("acadia:list-projects"),
  switchProject: (id) => ipcRenderer.invoke("acadia:switch-project", id),
  researchState: () => ipcRenderer.invoke("acadia:research-state"),
  getSource: (id, versionId) =>
    ipcRenderer.invoke("acadia:get-source", id, versionId),
  getPassage: (id) => ipcRenderer.invoke("acadia:get-passage", id),
  searchSources: (query) => ipcRenderer.invoke("acadia:search-sources", query),
  setSourcePolicy: (id, inclusion) =>
    ipcRenderer.invoke("acadia:set-source-policy", id, inclusion),
  setPassagePolicy: (id, inclusion) =>
    ipcRenderer.invoke("acadia:set-passage-policy", id, inclusion),
  captureUrl: (url) => ipcRenderer.invoke("acadia:capture-url", url),
  reprocessSource: (id, ocr) =>
    ipcRenderer.invoke("acadia:reprocess-source", id, ocr),
  cancelJob: (id) => ipcRenderer.invoke("acadia:cancel-job", id),
  saveClaim: (claim) => ipcRenderer.invoke("acadia:save-claim", claim),
  deleteClaim: (id) => ipcRenderer.invoke("acadia:delete-claim", id),
  saveTask: (task) => ipcRenderer.invoke("acadia:save-task", task),
  deleteTask: (id) => ipcRenderer.invoke("acadia:delete-task", id),
  ask: (question) => ipcRenderer.invoke("acadia:ask", question),
  suggestConnections: () => ipcRenderer.invoke("acadia:suggest-connections"),
  planDiscovery: (question, queries) =>
    ipcRenderer.invoke("acadia:plan-discovery", question, queries),
  approveDiscovery: (id) => ipcRenderer.invoke("acadia:approve-discovery", id),
  acceptDiscovery: (id) => ipcRenderer.invoke("acadia:accept-discovery", id),
  dismissDiscovery: (id) => ipcRenderer.invoke("acadia:dismiss-discovery", id),
  saveSearchKey: (key) => ipcRenderer.invoke("acadia:save-search-key", key),
  hasSearchKey: () => ipcRenderer.invoke("acadia:has-search-key"),
  reviseSection: (outputId, original, instructions) =>
    ipcRenderer.invoke(
      "acadia:revise-section",
      outputId,
      original,
      instructions,
    ),
  onResearchChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("acadia:research-changed", listener);
    return () =>
      ipcRenderer.removeListener("acadia:research-changed", listener);
  },
  load: () => ipcRenderer.invoke("acadia:load"),
  save: (project) => ipcRenderer.invoke("acadia:save", project),
  newProject: () => ipcRenderer.invoke("acadia:new-project"),
  openProject: () => ipcRenderer.invoke("acadia:open-project"),
  exportProject: (project) =>
    ipcRenderer.invoke("acadia:export-project", project),
  importFiles: () => ipcRenderer.invoke("acadia:import-files"),
  importDropped: (paths) => ipcRenderer.invoke("acadia:import-dropped", paths),
  filePath: (file) => webUtils.getPathForFile(file),
  assetURL: (id) => `acadia-asset://asset/${encodeURIComponent(id)}`,
  openExternal: (url) => ipcRenderer.invoke("acadia:open-external", url),
  openAsset: (id) => ipcRenderer.invoke("acadia:open-asset", id),
  getDisplays: () => ipcRenderer.invoke("acadia:displays"),
  openReleaser: (displayId) =>
    ipcRenderer.invoke("acadia:open-releaser", displayId),
  fullscreen: () => ipcRenderer.invoke("acadia:fullscreen"),
  saveSettings: (settings) =>
    ipcRenderer.invoke("acadia:save-settings", settings),
  generate: (project, kind, instructions, plan) =>
    ipcRenderer.invoke("acadia:generate", project, kind, instructions, plan),
  exportOutput: (output, format) =>
    ipcRenderer.invoke("acadia:export-output", output, format),
  exportProjectPlan: (output) =>
    ipcRenderer.invoke("acadia:export-project-plan", output),
  exportPowerBI: () => ipcRenderer.invoke("acadia:export-power-bi"),
  onBeforeClose: (callback) => {
    beforeClose = callback;
    return () => {
      if (beforeClose === callback) beforeClose = undefined;
    };
  },
  onProjectChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      project: Project,
    ): void => callback(project);
    ipcRenderer.on("acadia:project-changed", listener);
    return () => {
      ipcRenderer.removeListener("acadia:project-changed", listener);
    };
  },
};

contextBridge.exposeInMainWorld("acadia", api);
