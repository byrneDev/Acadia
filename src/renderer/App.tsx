import { version as appVersion } from "../../package.json";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import acadiaIcon from "../../resources/branding/acadia-icon.png";
import acadiaLogo from "../../resources/branding/acadia-logo.png";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Download,
  FilePlus2,
  FileUp,
  FolderOpen,
  HelpCircle,
  Layers,
  Link2,
  Menu,
  MonitorUp,
  Maximize,
  Network,
  Plus,
  Redo2,
  Search,
  Settings2,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import type { Connection as FlowConnection } from "@xyflow/react";
import type {
  AISettings,
  CardKind,
  Connection,
  DisplayInfo,
  ImportedAsset,
  Project,
  ResearchCard,
  ResearchOutput,
} from "../shared/types";
import ResearchWorkspace, {
  useResearch,
  Jobs,
  SourceReader,
  ProjectLibrary,
  type ResearchView,
} from "./components/ResearchWorkspace";
import type { Citation, ProjectPrivacy } from "../shared/research";
import Collector from "./components/Collector";
import Releaser from "./components/Releaser";
import { cardIcons } from "./components/ResearchNode";
import {
  Modal,
  CardDialog,
  Inspector,
  ConnectionDialog,
  SettingsDialog,
  DisplayDialog,
} from "./components/Dialogs";
const api = () => window.acadia!;
const uid = () => crypto.randomUUID();
const kinds: CardKind[] = [
  "note",
  "question",
  "hypothesis",
  "link",
  "document",
  "image",
  "audio",
  "video",
];
export default function App() {
  const outputWindow = window.location.hash === "#releaser";
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<AISettings>({
    provider: "offline",
    endpoint: "",
    model: "",
  });
  const [tab, setTab] = useState<"collector" | "releaser">(
    outputWindow ? "releaser" : "collector",
  );
  const [researchView, setResearchView] = useState<ResearchView>("board");
  const research = useResearch(project?.id);
  const [reader, setReader] = useState<{
    sourceId: string;
    versionId?: string;
    passageId?: string;
  }>();
  const [library, setLibrary] = useState(false);
  const [areas, setAreas] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sidebar, setSidebar] = useState(true);
  const [saveStatus, setSaveStatus] = useState("Loading");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [dialog, setDialog] = useState<
    | "add"
    | "edit"
    | "settings"
    | "project"
    | "display"
    | "help"
    | "new"
    | "delete"
    | null
  >(null);
  const [edge, setEdge] = useState<Connection | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [focus, setFocus] = useState<{ id: string | null; key: number }>({
    id: null,
    key: 0,
  });
  const [history, setHistory] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [projectMenu, setProjectMenu] = useState(false);
  const latest = useRef<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const addPosition = useRef<{ x: number; y: number } | null>(null);
  const loaded = useRef(false);
  const savePromise = useRef<Promise<unknown>>(Promise.resolve());
  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
  }, []);
  useEffect(() => {
    api()
      .load()
      .then((s) => {
        latest.current = s.project;
        setProject(s.project);
        setSettings(s.settings);
        loaded.current = true;
        setSaveStatus("Saved locally");
      })
      .catch(fail);
    return api().onProjectChanged((p) => {
      if (outputWindow) {
        latest.current = p;
        setProject(p);
      }
    });
  }, [fail, outputWindow]);
  useEffect(() => {
    if (!project || !loaded.current || outputWindow) return;
    setSaveStatus("Saving…");
    const p = api().save(project);
    savePromise.current = p;
    p.then(() => {
      if (latest.current === project) setSaveStatus("Saved locally");
    }).catch((e) => {
      setSaveStatus("Save failed");
      fail(e);
    });
  }, [project, outputWindow, fail]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (outputWindow) return;
    return api().onBeforeClose(async () => {
      if (latest.current) await api().save(latest.current);
    });
  }, [outputWindow]);
  const change = useCallback((fn: (p: Project) => Project, record = true) => {
    const p = latest.current;
    if (!p) return;
    const next = fn(p);
    if (record) {
      setHistory((h) => [...h.slice(-39), p]);
      setFuture([]);
    }
    latest.current = next;
    setProject(next);
  }, []);
  const boardChange = useCallback(
    (fn: (p: Project) => Project) =>
      change((p) => ({ ...fn(p), updatedAt: new Date().toISOString() })),
    [change],
  );
  const undo = () => {
    const p = history.at(-1);
    if (!p || !latest.current) return;
    setFuture((f) => [latest.current!, ...f]);
    setHistory((h) => h.slice(0, -1));
    const next = {
      ...p,
      outputs: latest.current.outputs,
      updatedAt: new Date().toISOString(),
    };
    latest.current = next;
    setProject(next);
    setSelected(null);
  };
  const redo = () => {
    const p = future[0];
    if (!p || !latest.current) return;
    setHistory((h) => [...h, latest.current!]);
    setFuture((f) => f.slice(1));
    const next = {
      ...p,
      outputs: latest.current.outputs,
      updatedAt: new Date().toISOString(),
    };
    latest.current = next;
    setProject(next);
  };
  const addCard = useCallback(
    (values: Partial<ResearchCard>) => {
      const p = latest.current;
      if (!p) return;
      const now = new Date().toISOString();
      const n = p.cards.length;
      const card: ResearchCard = {
        id: uid(),
        kind: "note",
        title: "Untitled idea",
        content: "",
        x: addPosition.current?.x ?? (n % 3) * 340,
        y: addPosition.current?.y ?? Math.floor(n / 3) * 260,
        tags: [],
        status: "unreviewed",
        createdAt: now,
        updatedAt: now,
        ...values,
      };
      boardChange((p) => ({ ...p, cards: [...p.cards, card] }));
      setSelected(card.id);
      setFocus((f) => ({ id: card.id, key: f.key + 1 }));
      setDialog(null);
      addPosition.current = null;
    },
    [boardChange],
  );
  const addAssets = useCallback(
    (assets: ImportedAsset[]) => {
      if (!assets.length) return;
      const p = latest.current!;
      const now = new Date().toISOString();
      const cards = assets.map((a, i): ResearchCard => ({
        ...a,
        id: uid(),
        title: a.fileName.replace(/\.[^.]+$/, ""),
        x: ((p.cards.length + i) % 3) * 340,
        y: Math.floor((p.cards.length + i) / 3) * 260,
        tags: [],
        status: "unreviewed",
        createdAt: now,
        updatedAt: now,
      }));
      boardChange((p) => ({ ...p, cards: [...p.cards, ...cards] }));
      setFocus((f) => ({ id: cards[0].id, key: f.key + 1 }));
      setSelected(cards[0].id);
      setToast(
        `${cards.length} file${cards.length === 1 ? "" : "s"} collected`,
      );
      setDialog(null);
    },
    [boardChange],
  );
  const importFiles = useCallback(async () => {
    setBusy(true);
    const projectId = latest.current?.id;
    try {
      const assets = await api().importFiles();
      if (latest.current?.id === projectId) addAssets(assets);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [addAssets, fail]);
  const dropFiles = useCallback(
    async (files: File[]) => {
      setBusy(true);
      const projectId = latest.current?.id;
      try {
        const paths = files.map((f) => api().filePath(f));
        if (paths.some((p) => !p))
          throw new Error(
            "File drop is available in the desktop app. Use Import files in the browser preview.",
          );
        const assets = await api().importDropped(paths);
        if (latest.current?.id === projectId) addAssets(assets);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [addAssets, fail],
  );
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (
        outputWindow ||
        tab !== "collector" ||
        researchView !== "board" ||
        reader ||
        dialog ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement)?.tagName,
        )
      )
        return;
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      e.preventDefault();
      let url = "";
      try {
        const parsed = new URL(text);
        if (["http:", "https:"].includes(parsed.protocol)) url = text;
      } catch {}
      addCard({
        kind: url ? "link" : "note",
        title: url ? new URL(url).hostname : text.split("\n")[0].slice(0, 100),
        content: url ? "" : text.slice(0, 100000),
        ...(url ? { url } : {}),
      });
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [addCard, outputWindow, tab, dialog, researchView, reader]);
  const focusSource = (id: string) => {
    setResearchView("board");
    if (!project?.cards.some((c) => c.id === id)) {
      setToast(
        "This source has been removed from the current board. Its ID remains in the release.",
      );
      return;
    }
    setTab("collector");
    setSelected(id);
    setFocus((f) => ({ id, key: f.key + 1 }));
  };
  const connect = (c: FlowConnection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    if (
      project?.connections.some(
        (e) => e.source === c.source && e.target === c.target,
      )
    ) {
      setToast(
        "These items are already connected. Click the line to edit its meaning.",
      );
      return;
    }
    const connection: Connection = {
      id: uid(),
      source: c.source,
      target: c.target,
      relation: "relates to",
    };
    boardChange((p) => ({ ...p, connections: [...p.connections, connection] }));
    setEdge(connection);
  };
  const switchProject = async (id: string) => {
    setBusy(true);
    try {
      await savePromise.current;
      if (latest.current) await api().save(latest.current);
      const s = await api().switchProject(id);
      latest.current = s.project;
      setProject(s.project);
      setSettings(s.settings);
      setSelected(null);
      setHistory([]);
      setFuture([]);
      setLibrary(false);
      setResearchView("board");
      setReader(undefined);
      setTab("collector");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const openCitation = (c: Citation) => {
    if (c.legacyCardId && !c.passageId) focusSource(c.legacyCardId);
    else
      setReader({
        sourceId: c.sourceId,
        versionId: c.versionId,
        passageId: c.passageId,
      });
  };
  const newOrOpen = async (action: "new" | "open") => {
    setBusy(true);
    setProjectMenu(false);
    try {
      await savePromise.current;
      if (latest.current) await api().save(latest.current);
      const s =
        action === "new" ? await api().newProject() : await api().openProject();
      if (s) {
        latest.current = s.project;
        setProject(s.project);
        setSettings(s.settings);
        setSelected(null);
        setHistory([]);
        setFuture([]);
        setTab("collector");
        setToast(
          action === "new" ? "New research board created" : "Project opened",
        );
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };
  const exportProject = async () => {
    setBusy(true);
    setProjectMenu(false);
    try {
      const path = await api().exportProject(latest.current!);
      if (path) setToast("Portable project exported with its attachments");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const openDisplay = async () => {
    try {
      setDisplays(await api().getDisplays());
      setDialog("display");
    } catch (e) {
      fail(e);
    }
  };
  const selectedCard = project?.cards.find((c) => c.id === selected);
  const filtered = useMemo(
    () =>
      project?.cards.filter(
        (c) =>
          (filter === "all" || c.kind === filter) &&
          `${c.title} ${c.content} ${c.extraction || ""} ${c.tags.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ) || [],
    [project?.cards, search, filter],
  );
  const output = (o: ResearchOutput) => {
    if (latest.current?.id === project?.id)
      change((p) => ({ ...p, outputs: [o, ...p.outputs] }), false);
  };
  if (!project)
    return (
      <div className="loading-screen">
        <img
          className="acadia-logo loading-logo"
          src={acadiaLogo}
          alt="Acadia"
        />
        <p role={error ? "alert" : "status"}>
          {error || "Opening your research workspace…"}
        </p>
      </div>
    );
  return (
    <div className={`app ${outputWindow ? "output-display" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src={acadiaIcon} alt="Acadia app icon" />
          <div>
            <strong>ACADIA</strong>
            <small>RESEARCH & DISCOVERY</small>
          </div>
        </div>
        <div className="brand-motto">OF. FROM. AWAY FROM. CONCERNING.</div>
        <div className="topbar-actions">
          <span className="save-status">
            <span
              className={`pulse-dot ${saveStatus === "Save failed" ? "bad" : ""}`}
            />
            {outputWindow ? "RELEASER DISPLAY" : saveStatus}
          </span>
          {outputWindow && (
            <button
              className="icon-button"
              aria-label="Toggle fullscreen"
              onClick={() => api().fullscreen().catch(fail)}
            >
              <Maximize size={18} />
            </button>
          )}
          {!outputWindow && (
            <>
              <button
                className="icon-button"
                onClick={() => setDialog("help")}
                aria-label="Workspace guide"
              >
                <HelpCircle size={18} />
              </button>
              <button
                className="icon-button"
                onClick={() => setDialog("settings")}
                aria-label="Research engine settings"
              >
                <Settings2 size={18} />
              </button>
            </>
          )}
        </div>
      </header>
      <div className="workspace-bar">
        <div className="workspace-title">
          <span className="eyebrow">
            WORKSPACE / {project.id.slice(0, 8).toUpperCase()}
          </span>
          <div className="project-title-row">
            <button
              className="project-title"
              onClick={() => !outputWindow && setDialog("project")}
              title="Edit project title and research question"
            >
              {project.title}
            </button>
            {!outputWindow && (
              <div className="project-menu-anchor">
                <button
                  className="icon-button"
                  aria-label="Project menu"
                  onClick={() => setProjectMenu(!projectMenu)}
                >
                  <ChevronDown size={17} />
                </button>
                {projectMenu && (
                  <>
                    <button
                      className="menu-dismiss"
                      aria-label="Close project menu"
                      onClick={() => setProjectMenu(false)}
                    />
                    <div className="project-menu">
                      <button
                        onClick={() => {
                          setDialog("new");
                          setProjectMenu(false);
                        }}
                      >
                        <FilePlus2 size={16} />
                        New research board
                      </button>
                      <button
                        onClick={() => {
                          setLibrary(true);
                          setProjectMenu(false);
                        }}
                      >
                        <FolderOpen size={16} />
                        Project library
                      </button>
                      <button disabled={busy} onClick={() => newOrOpen("open")}>
                        <FolderOpen size={16} />
                        Import portable project
                      </button>
                      <button onClick={exportProject}>
                        <Download size={16} />
                        Export portable project
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div
          className="workspace-switch"
          role="tablist"
          aria-label="Workspace view"
        >
          {!outputWindow && (
            <button
              role="tab"
              aria-selected={tab === "collector"}
              className={tab === "collector" ? "active" : ""}
              onClick={() => setTab("collector")}
            >
              <Network size={17} />
              Collector<span>01</span>
            </button>
          )}
          <button
            role="tab"
            aria-selected={tab === "releaser"}
            className={tab === "releaser" ? "active" : ""}
            onClick={() => setTab("releaser")}
          >
            <Sparkles size={17} />
            Releaser<span>02</span>
          </button>
        </div>
        {!outputWindow && (
          <button className="button quiet display-button" onClick={openDisplay}>
            <MonitorUp size={16} />
            Open display
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <X size={17} />
          </button>
        </div>
      )}
      {tab === "collector" ? (
        <>
          <div className="collector-toolbar">
            <div className="collector-title">
              <button
                className="icon-button"
                onClick={() => setSidebar(!sidebar)}
                aria-label="Toggle source library"
              >
                <Menu size={18} />
              </button>
              <h1>THE COLLECTOR</h1>
              <span className="toolbar-description">
                Gather. Connect. Discover.
              </span>
            </div>
            <div className="toolbar-actions">
              <button
                className="icon-button"
                disabled={!history.length}
                onClick={undo}
                aria-label="Undo"
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                disabled={!future.length}
                onClick={redo}
                aria-label="Redo"
              >
                <Redo2 size={17} />
              </button>
              <span className="tool-divider" />
              <button
                className="button quiet"
                disabled={busy}
                onClick={importFiles}
              >
                <FileUp size={16} />
                Import files
              </button>
              <button
                className="button primary"
                onClick={() => {
                  addPosition.current = null;
                  setDialog("add");
                }}
              >
                <Plus size={17} />
                Add item
              </button>
            </div>
          </div>
          <nav className="collector-views" aria-label="Collector views">
            {(
              [
                "board",
                "sources",
                "evidence",
                "tasks",
                "inquiry",
                "discovery",
              ] as ResearchView[]
            ).map((v) => (
              <button
                key={v}
                className={researchView === v ? "active" : ""}
                onClick={() => setResearchView(v)}
              >
                {
                  {
                    board: "Board",
                    sources: "Sources",
                    evidence: "Evidence",
                    tasks: "Tasks",
                    inquiry: "Ask & analyze",
                    discovery: "Discover",
                  }[v]
                }
              </button>
            ))}
            <span className="privacy-chip">
              {project.privacy?.mode === "cloud"
                ? "CLOUD ANALYSIS"
                : "LOCAL ANALYSIS"}
            </span>
          </nav>
          {researchView === "board" ? (
            <main className="collector-layout">
              {sidebar && (
                <aside className="source-library">
                  <div className="library-heading">
                    <span className="eyebrow">SOURCE LIBRARY</span>
                    <span className="count-chip">{project.cards.length}</span>
                  </div>
                  <label className="library-search">
                    <Search size={15} />
                    <input
                      aria-label="Search research"
                      placeholder="Search your research…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        aria-label="Clear search"
                        onClick={() => setSearch("")}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </label>
                  <label className="sr-only" htmlFor="kind-filter">
                    Filter source type
                  </label>
                  <select
                    id="kind-filter"
                    className="kind-filter"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">All research items</option>
                    {kinds.map((k) => (
                      <option value={k} key={k}>
                        {k === "hypothesis"
                          ? "Hypotheses"
                          : k.charAt(0).toUpperCase() + k.slice(1) + "s"}{" "}
                        ({project.cards.filter((c) => c.kind === k).length})
                      </option>
                    ))}
                  </select>
                  <div className="library-items">
                    {filtered.map((c) => {
                      const Icon = cardIcons[c.kind];
                      return (
                        <button
                          className={`library-item ${selected === c.id ? "selected" : ""}`}
                          key={c.id}
                          onClick={() => focusSource(c.id)}
                        >
                          <Icon size={16} className={`kind-color-${c.kind}`} />
                          <span>
                            <strong>{c.title}</strong>
                            <small>
                              {c.kind} <span>·</span> {c.status}
                            </small>
                          </span>
                          <span className={`status-dot ${c.status}`} />
                        </button>
                      );
                    })}
                    {filtered.length === 0 && (
                      <p className="library-empty">
                        {search
                          ? "No matching research."
                          : "No items here yet."}
                      </p>
                    )}
                  </div>
                  <div className="library-bottom">
                    <span className="eyebrow">RESEARCH QUESTION</span>
                    <p>
                      {project.question || "What are you trying to understand?"}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setDialog("project")}
                    >
                      REFINE THE QUESTION <ArrowUpRight size={12} />
                    </button>
                  </div>
                </aside>
              )}
              <Collector
                project={project}
                selectedId={selected}
                onSelect={setSelected}
                onMove={(positions) =>
                  boardChange((p) => ({
                    ...p,
                    cards: p.cards.map((c) => {
                      const pos = positions.find((n) => n.id === c.id);
                      return pos ? { ...c, x: pos.x, y: pos.y } : c;
                    }),
                  }))
                }
                onConnect={connect}
                onEdge={setEdge}
                onAdd={(x, y) => {
                  addPosition.current =
                    x !== undefined && y !== undefined ? { x, y } : null;
                  setDialog("add");
                }}
                onDropFiles={dropFiles}
                focusId={focus.id}
                focusKey={focus.key}
                onAreas={() => setAreas(true)}
                onSaveView={(view) =>
                  boardChange((p) => ({
                    ...p,
                    views: [...(p.views || []), view],
                  }))
                }
              />
              {selectedCard && (
                <Inspector
                  card={selectedCard}
                  project={project}
                  connections={project.connections.filter(
                    (c) => c.source === selected || c.target === selected,
                  )}
                  onClose={() => setSelected(null)}
                  onEdit={() => setDialog("edit")}
                  onDelete={() => setDialog("delete")}
                  onChange={(v) =>
                    boardChange((p) => ({
                      ...p,
                      cards: p.cards.map((c) =>
                        c.id === selected
                          ? { ...c, ...v, updatedAt: new Date().toISOString() }
                          : c,
                      ),
                    }))
                  }
                  onSource={focusSource}
                  onConnection={setEdge}
                  onError={fail}
                />
              )}
            </main>
          ) : (
            <ResearchWorkspace
              key={project.id}
              project={project}
              research={research}
              view={researchView}
              onError={fail}
              onSource={(sourceId, versionId, passageId) =>
                setReader({ sourceId, versionId, passageId })
              }
              onCard={focusSource}
              onConnection={(connection) =>
                boardChange((p) => ({
                  ...p,
                  connections: p.connections.some(
                    (c) =>
                      c.source === connection.source &&
                      c.target === connection.target,
                  )
                    ? p.connections
                    : [...p.connections, connection],
                }))
              }
            />
          )}
        </>
      ) : (
        <main className="releaser-host">
          <Releaser
            project={project}
            settings={
              project.privacy?.provider
                ? { ...settings, ...project.privacy }
                : settings
            }
            onOutput={output}
            onUpdateOutput={(o) =>
              change(
                (p) => ({
                  ...p,
                  outputs: p.outputs.map((x) => (x.id === o.id ? o : x)),
                }),
                false,
              )
            }
            onRelease={(outputId, revisionId) =>
              change(
                (p) => ({
                  ...p,
                  releasedOutputId: outputId,
                  outputs: p.outputs.map((o) =>
                    o.id === outputId
                      ? { ...o, releasedRevisionId: revisionId }
                      : o,
                  ),
                }),
                false,
              )
            }
            onCitation={openCitation}
            onSettings={() => setDialog("settings")}
            readOnly={outputWindow}
            onSource={
              outputWindow
                ? (id) =>
                    setToast(
                      project.cards.find((c) => c.id === id)?.title ||
                        "Source removed from current board",
                    )
                : focusSource
            }
          />
        </main>
      )}
      {!outputWindow && <Jobs research={research} onError={fail} />}
      <footer className="statusbar">
        <span>
          <span className="pulse-dot" />
          {outputWindow ? "CONNECTED OUTPUT" : "LOCAL WORKSPACE"}
          <span className="footer-divider">/</span>
          {project.cards.length} ITEMS<span className="footer-divider">/</span>
          {project.connections.length} CONNECTIONS
        </span>
        <span>
          {settings.provider === "offline"
            ? "OFFLINE OUTLINE"
            : `${settings.provider.toUpperCase()} ENGINE`}
          <span className="footer-divider">/</span>ACADIA v{appVersion}
        </span>
      </footer>
      {busy && (
        <div className="busy-indicator" role="status">
          Working…
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {(dialog === "add" || dialog === "edit") && (
        <CardDialog
          initial={dialog === "edit" ? selectedCard : undefined}
          onClose={() => setDialog(null)}
          onImport={importFiles}
          onSave={(values) => {
            if (dialog === "edit") {
              boardChange((p) => ({
                ...p,
                cards: p.cards.map((c) =>
                  c.id === selected
                    ? { ...c, ...values, updatedAt: new Date().toISOString() }
                    : c,
                ),
              }));
              setDialog(null);
            } else addCard(values);
          }}
        />
      )}
      {edge && (
        <ConnectionDialog
          connection={edge}
          project={project}
          onClose={() => setEdge(null)}
          onDelete={() => {
            boardChange((p) => ({
              ...p,
              connections: p.connections.filter((c) => c.id !== edge.id),
            }));
            setEdge(null);
          }}
          onSave={(relation) => {
            boardChange((p) => ({
              ...p,
              connections: p.connections.map((c) =>
                c.id === edge.id ? { ...c, relation } : c,
              ),
            }));
            setEdge(null);
          }}
        />
      )}
      {dialog === "settings" && (
        <SettingsDialog
          settings={
            project.privacy?.provider
              ? { ...settings, ...project.privacy }
              : { provider: "offline", endpoint: "", model: "" }
          }
          privacy={project.privacy || { mode: "local" }}
          onPrivacy={(privacy) => boardChange((p) => ({ ...p, privacy }))}
          onClose={() => setDialog(null)}
          onSave={async (s) => {
            const saved = await api().saveSettings(s);
            setSettings(saved);
            boardChange((p) => ({
              ...p,
              privacy: {
                mode: p.privacy?.mode || "local",
                provider: saved.provider,
                endpoint: saved.endpoint,
                model: saved.model,
              },
            }));
            setToast("Research engine saved");
          }}
        />
      )}
      {dialog === "display" && (
        <DisplayDialog
          displays={displays}
          onClose={() => setDialog(null)}
          onOpen={(id) => {
            api()
              .openReleaser(id)
              .then(() => {
                setDialog(null);
                setToast("Releaser display opened");
              })
              .catch(fail);
          }}
        />
      )}
      {dialog === "project" && (
        <ProjectDialog
          project={project}
          onClose={() => setDialog(null)}
          onSave={(title, question) => {
            boardChange((p) => ({ ...p, title, question }));
            setDialog(null);
          }}
        />
      )}
      {dialog === "new" && (
        <Modal
          title="Start a new investigation"
          onClose={() => setDialog(null)}
        >
          <p>
            Your current investigation and attachments stay in the local project
            library. A recovery archive is also saved before switching.
          </p>
          <p className="muted">
            Use Project library to return to an investigation. Export a portable
            project to keep a copy elsewhere.
          </p>
          <div className="modal-actions">
            <button className="button quiet" onClick={exportProject}>
              <Download size={15} />
              Export current project
            </button>
            <button
              disabled={busy}
              className="button primary"
              onClick={() => newOrOpen("new")}
            >
              Create new board
            </button>
          </div>
        </Modal>
      )}
      {dialog === "delete" && selectedCard && (
        <Modal
          title="Remove this research item?"
          onClose={() => setDialog(null)}
        >
          <p>
            “{selectedCard.title}” and its{" "}
            {
              project.connections.filter(
                (c) => c.source === selected || c.target === selected,
              ).length
            }{" "}
            connections will be removed from this board. You can undo this
            change.
          </p>
          <div className="modal-actions">
            <button className="button quiet" onClick={() => setDialog(null)}>
              Keep item
            </button>
            <button
              className="button danger"
              onClick={() => {
                boardChange((p) => ({
                  ...p,
                  cards: p.cards.filter((c) => c.id !== selected),
                  connections: p.connections.filter(
                    (c) => c.source !== selected && c.target !== selected,
                  ),
                }));
                setSelected(null);
                setDialog(null);
              }}
            >
              Remove item
            </button>
          </div>
        </Modal>
      )}
      {library && (
        <ProjectLibrary
          currentId={project.id}
          onClose={() => setLibrary(false)}
          onSwitch={switchProject}
          onError={fail}
        />
      )}
      {reader && (
        <SourceReader
          {...reader}
          key={`${reader.sourceId}:${reader.versionId || ""}`}
          project={project}
          research={research}
          readOnly={outputWindow}
          onClose={() => setReader(undefined)}
          onError={fail}
          onBoard={(c) => {
            addCard(c);
            setReader(undefined);
            setResearchView("board");
            setTab("collector");
          }}
        />
      )}
      {areas && (
        <AreasDialog
          project={project}
          onClose={() => setAreas(false)}
          onSave={(groups) => {
            boardChange((p) => ({ ...p, groups }));
            setAreas(false);
          }}
        />
      )}
      {dialog === "help" && (
        <Modal
          title="From fragments to understanding"
          subtitle="One workspace. Two complementary ways of thinking."
          onClose={() => setDialog(null)}
          wide
        >
          <div className="guide-brand">
            <img
              className="acadia-logo guide-logo"
              src={acadiaLogo}
              alt="Acadia"
            />
          </div>
          <div className="guide-grid">
            <section>
              <Network size={25} />
              <h3>The Collector</h3>
              <p>
                Add notes, questions, hypotheses, and links. Import files or
                drop them onto the canvas. Paste text or a URL directly onto the
                board.
              </p>
              <p>
                Drag cards to arrange your thinking. Join the right handle of
                one card to the left handle of another. Click a connection to
                describe what it means.
              </p>
              <p>
                Use two fingers to pan, pinch to zoom, or enable the hand tool
                for a touchscreen. Fit board brings every card back into view.
              </p>
            </section>
            <section>
              <Sparkles size={25} />
              <h3>The Releaser</h3>
              <p>
                Turn your collected text into a hypothesis, research plan,
                whitepaper, gap analysis, or needs analysis. Follow source
                references back to the board.
              </p>
              <p>
                The offline engine organizes evidence without AI. Configure a
                local Ollama model or compatible API for AI synthesis. Review
                generated claims before use.
              </p>
              <p>
                Open display creates a separate output window for a second
                monitor. Export releases as Markdown or PDF.
              </p>
            </section>
          </div>
          <p className="settings-note">
            Sources stores complete document passages and dated website
            captures. Run local English OCR for scanned pages. Evidence
            distinguishes support from contradictions; Tasks track gaps. Approve
            each external search in Discover. Save a report revision and release
            it explicitly to show it on the second display. Export editable
            DOCX, PDF, or Markdown.
          </p>
          <div className="modal-actions">
            <button className="button primary" onClick={() => setDialog(null)}>
              Back to research
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ProjectDialog({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (title: string, question: string) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [question, setQuestion] = useState(project.question);
  return (
    <Modal title="Frame the investigation" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onSave(title.trim(), question.trim());
        }}
      >
        <label className="field">
          Project title
          <input
            required
            autoFocus
            maxLength={300}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          The research question
          <textarea
            rows={5}
            maxLength={10000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What do you want to understand, test, or build?"
          />
        </label>
        <div className="modal-actions">
          <button className="button primary" type="submit">
            Save project
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AreasDialog({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (groups: NonNullable<Project["groups"]>) => void;
}) {
  const [groups, setGroups] = useState(project.groups || []);
  const [title, setTitle] = useState("");
  const [cards, setCards] = useState<string[]>([]);
  return (
    <Modal title="Named research areas" onClose={onClose}>
      <p>Group related board items into visible areas.</p>
      {groups.map((g) => (
        <div className="research-inline" key={g.id}>
          <strong>
            {g.title} · {g.cardIds.length} items
          </strong>
          <button
            className="text-button"
            onClick={() => setGroups(groups.filter((x) => x.id !== g.id))}
          >
            Remove area
          </button>
        </div>
      ))}
      <label className="field">
        Area name
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <fieldset className="source-checklist">
        <legend>Board items</legend>
        {project.cards.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={cards.includes(c.id)}
              onChange={(e) =>
                setCards(
                  e.target.checked
                    ? [...cards, c.id]
                    : cards.filter((id) => id !== c.id),
                )
              }
            />
            {c.title}
          </label>
        ))}
      </fieldset>
      <div className="modal-actions">
        <button
          className="button quiet"
          disabled={!title.trim() || !cards.length}
          onClick={() => {
            setGroups([
              ...groups,
              {
                id: uid(),
                title: title.trim(),
                cardIds: cards,
                color: "#b8ff5a",
              },
            ]);
            setTitle("");
            setCards([]);
          }}
        >
          Add area
        </button>
        <button className="button primary" onClick={() => onSave(groups)}>
          Save areas
        </button>
      </div>
    </Modal>
  );
}
