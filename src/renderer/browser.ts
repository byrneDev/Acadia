import {
  createBlankProject,
  createDemoProject,
  validateProject,
} from "../shared/project";
import { createOfflineOutput } from "../shared/offline";
import type { AISettings, ImportedAsset, Project } from "../shared/types";
// Development-only browser adapter. The packaged desktop app always uses its isolated preload.
if (!window.acadia) {
  const key = "acadia-preview-v1";
  let current: Project;
  try {
    current = validateProject(JSON.parse(localStorage.getItem(key) || "null"));
  } catch {
    current = createDemoProject();
  }
  let settings: AISettings = { provider: "offline", endpoint: "", model: "" };
  const channel = new BroadcastChannel("acadia-preview");
  const listeners = new Set<(p: Project) => void>();
  channel.onmessage = (e) => {
    try {
      current = validateProject(e.data);
      listeners.forEach((fn) => fn(current));
    } catch {}
  };
  const assets = new Map<string, string>();
  const save = (project: Project) => {
    validateProject(project);
    localStorage.setItem(key, JSON.stringify(project));
    current = project;
    channel.postMessage(project);
  };
  const download = (name: string, body: Blob) => {
    const url = URL.createObjectURL(body);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  };
  const pick = (accept: string, multiple = false): Promise<File[]> =>
    new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.multiple = multiple;
      input.onchange = () => resolve(Array.from(input.files || []));
      input.oncancel = () => resolve([]);
      input.click();
    });
  const desktopOnly = async (): Promise<never> => {
    throw new Error(
      "This research feature requires the Acadia desktop app. The browser preview does not provide persistent source storage, document processing, web discovery, or model connections.",
    );
  };
  window.acadia = {
    listProjects: async () => [
      {
        id: current.id,
        title: current.title,
        question: current.question,
        updatedAt: current.updatedAt,
        cardCount: current.cards.length,
        sourceCount: 0,
      },
    ],
    switchProject: async (id) => {
      if (id !== current.id) return desktopOnly();
      return { project: current, settings };
    },
    researchState: async () => ({
      sources: [],
      versions: [],
      claims: [],
      tasks: [],
      jobs: [],
      discoveries: [],
      runs: [],
    }),
    getSource: desktopOnly,
    getPassage: desktopOnly,
    searchSources: desktopOnly,
    setSourcePolicy: desktopOnly,
    setPassagePolicy: desktopOnly,
    captureUrl: desktopOnly,
    reprocessSource: desktopOnly,
    cancelJob: desktopOnly,
    saveClaim: desktopOnly,
    deleteClaim: desktopOnly,
    saveTask: desktopOnly,
    deleteTask: desktopOnly,
    ask: desktopOnly,
    suggestConnections: desktopOnly,
    planDiscovery: desktopOnly,
    approveDiscovery: desktopOnly,
    acceptDiscovery: desktopOnly,
    dismissDiscovery: desktopOnly,
    saveSearchKey: desktopOnly,
    hasSearchKey: async () => false,
    reviseSection: desktopOnly,
    onResearchChanged: () => () => {},
    load: async () => ({ project: current, settings }),
    save: async (p) => {
      save(p);
      return { savedAt: new Date().toISOString() };
    },
    newProject: async () => {
      localStorage.setItem(
        `${key}-recovery-${current.id}`,
        JSON.stringify(current),
      );
      current = createBlankProject();
      save(current);
      return { project: current, settings };
    },
    openProject: async () => {
      const [file] = await pick(".json");
      if (!file) return null;
      const p = validateProject(JSON.parse(await file.text()));
      save(p);
      return { project: p, settings };
    },
    exportProject: async (p) =>
      download(
        "Acadia-preview.json",
        new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }),
      ),
    importFiles: async () => {
      const files = await pick("", true);
      return Promise.all(
        files.map(async (file): Promise<ImportedAsset> => {
          if (file.size > 10_000_000)
            throw new Error(
              "Browser preview supports imports up to 10 MB. Use the desktop app for larger files.",
            );
          const assetId = crypto.randomUUID();
          assets.set(assetId, URL.createObjectURL(file));
          const text =
            /^text\//.test(file.type) ||
            /\.(md|txt|json|csv)$/i.test(file.name);
          const kind = file.type.startsWith("image/")
            ? "image"
            : file.type.startsWith("audio/")
              ? "audio"
              : file.type.startsWith("video/")
                ? "video"
                : "document";
          return {
            assetId,
            fileName: file.name,
            mimeType: file.type,
            kind,
            content: text ? (await file.text()).slice(0, 100000) : "",
            extraction: text
              ? "Text imported."
              : "Browser preview: media is session-only. Desktop app stores attachments and extracts PDF/DOCX.",
          };
        }),
      );
    },
    importDropped: async () => {
      throw new Error("Use Import files in this browser preview.");
    },
    filePath: () => "",
    assetURL: (id) => assets.get(id) || "",
    openExternal: async (url) => {
      if (!/^https?:\/\//i.test(url))
        throw new Error("Only web links are supported.");
      window.open(url, "_blank", "noopener,noreferrer");
    },
    openAsset: async (id) => {
      const url = assets.get(id);
      if (!url)
        throw new Error(
          "Re-import this attachment or use the desktop app for persistent assets.",
        );
      window.open(url, "_blank", "noopener");
    },
    getDisplays: async () => [
      { id: 0, label: "Browser output window", primary: true },
    ],
    openReleaser: async () => {
      window.open(
        `${window.location.pathname}#releaser`,
        "acadia-releaser",
        "width=1280,height=900",
      );
    },
    fullscreen: async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    },
    saveSettings: async (s) => {
      if (s.provider !== "offline")
        throw new Error(
          "Configure AI in the desktop app, where credentials stay outside the renderer.",
        );
      settings = s;
      return settings;
    },
    generate: async (p, k, i) => createOfflineOutput(p, k, i),
    exportOutput: async (o, format) => {
      if (format !== "md")
        throw new Error(
          `${format.toUpperCase()} export is available in the desktop app.`,
        );
      return download(
        `${o.kind}.md`,
        new Blob([o.markdown], { type: "text/markdown" }),
      );
    },
    onProjectChanged: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onBeforeClose: () => () => {},
  };
}
