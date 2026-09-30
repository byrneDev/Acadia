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
  Files,
  ListChecks,
  CheckSquare,
  MessageCircle,
  Globe,
  GitBranch,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
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
import { emptyPedigreeState } from "../shared/pedigree";
import type { BoardReference } from "../shared/board";
import type { Passage } from "../shared/research";
import { usePedigree } from "./components/pedigree-state";
import { BoardMappingProvider } from "./components/BoardMappingContext";
import { BoardItemPicker } from "./components/BoardItemPicker";
import { ResearchFlowWorkspace } from "./components/ResearchFlowWorkspace";
import { presentBoardCard, boardLabels } from "./components/boardPresentation";
import { LinkedItemInspector } from "./components/LinkedItemInspector";
import type { ItemInsightTarget } from "../shared/item-insight";
import { ItemInsightDialog } from "./components/ItemInsightDialog";
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
import {
  AppearanceDialog,
  CommandPalette,
  InvestigationSearch,
  ResizeHandle,
  readNavigation,
  writeNavigation,
  readWidth,
  useDesktop,
} from "./components/DesktopUI";
import type { DesktopCommand } from "../shared/desktop";
import { PedigreeWorkspace } from "./components/PedigreeWorkspace";
import { MethodsWorkspace } from "./components/MethodsWorkspace";
const viewLabels = {
  brief: "Research brief",
  board: "Board",
  sources: "Sources",
  evidence: "Evidence",
  methods: "Methods",
  tasks: "Tasks",
  inquiry: "Ask & analyze",
  discovery: "Discover",
  flow: "Gaps & decisions",
};
const viewIcons = {
  brief: BookOpen,
  board: Network,
  sources: Files,
  evidence: ListChecks,
  methods: Layers,
  tasks: CheckSquare,
  inquiry: MessageCircle,
  discovery: Globe,
  flow: GitBranch,
};
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
  const [insightTarget, setInsightTarget] = useState<ItemInsightTarget>();
  const openItemInsight = useCallback(
    (id: string) => setInsightTarget({ kind: "card", id }),
    [],
  );
  const [methodRequest, setMethodRequest] = useState<{
    id: string;
    key: number;
  }>();
  const outputWindow = window.location.hash === "#releaser";
  const desktop = useDesktop();
  const [navigationOpen, setNavigationOpen] = useState(() => {
    try {
      return localStorage.getItem("acadia-navigation-open") !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("acadia-navigation-open", String(navigationOpen));
    } catch {}
  }, [navigationOpen]);
  const [navigationWidth, setNavigationWidth] = useState(() =>
    readWidth("navigation", 210, 170, 290),
  );
  const [readerWidth, setReaderWidth] = useState(() =>
    readWidth("reader", 400, 310, 650),
  );
  const [globalSearch, setGlobalSearch] = useState(false);
  const [palette, setPalette] = useState(false);
  const [reportRequest, setReportRequest] = useState<{
    id: string;
    key: number;
  }>();
  const [newReportRequest, setNewReportRequest] = useState(0);
  const [newDeliveryPlanRequest, setNewDeliveryPlanRequest] = useState(0);
  const [taskRequest, setTaskRequest] = useState<{ id: string; key: number }>();
  const [assumptionRequest, setAssumptionRequest] = useState<{
    id: string;
    key: number;
  }>();
  const [flowRequest, setFlowRequest] = useState<{
    kind: "gap" | "decision";
    id?: string;
    key: number;
  }>();
  const [claimRequest, setClaimRequest] = useState<{
    id: string;
    key: number;
  }>();
  const commandRef = useRef<(command: DesktopCommand) => void>(() => {});
  const paneStyle = {
    "--navigation-width": `${navigationWidth}px`,
    "--reader-width": `${readerWidth}px`,
  } as React.CSSProperties;
  const storeWidth = (name: string, value: number) => {
    try {
      localStorage.setItem(`acadia-pane:${name}`, String(value));
    } catch {}
  };
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
  const { state: pedigree } = usePedigree(
    project?.id || "",
    Boolean(project && !outputWindow),
  );
  const [boardPassages, setBoardPassages] = useState<
    Record<string, Passage | null>
  >({});
  const passageRefs = JSON.stringify(
    project?.cards
      .filter((card) => card.boardReference?.kind === "passage")
      .map((card) => card.boardReference) || [],
  );
  useEffect(() => {
    let alive = true;
    setBoardPassages({});
    if (!project || outputWindow) return;
    const ids = [
      ...new Set(
        project.cards
          .filter((card) => card.boardReference?.kind === "passage")
          .map((card) => card.boardReference!.id),
      ),
    ];
    void Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await api().getPassage(id)] as const;
        } catch {
          return [id, null] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setBoardPassages(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [project?.id, passageRefs, research.versions, outputWindow]);
  const presentations = useMemo(
    () =>
      Object.fromEntries(
        (project?.cards || []).map((card) => [
          card.id,
          presentBoardCard(card, project!, research, pedigree, boardPassages),
        ]),
      ),
    [project, research, pedigree, boardPassages],
  );
  const boardProject = useMemo(
    () =>
      project
        ? {
            ...project,
            cards: project.cards.map((card) => presentations[card.id].card),
          }
        : null,
    [project, presentations],
  );
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
  const [sidebar, setSidebar] = useState(false);
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
    | "appearance"
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
  const restoreNavigation = (p: Project) => {
    if (outputWindow) return;
    setInsightTarget(undefined);
    setMethodRequest(undefined);
    setClaimRequest(undefined);
    setTaskRequest(undefined);
    setAssumptionRequest(undefined);
    setFlowRequest(undefined);
    setReportRequest(undefined);
    setNewReportRequest(0);
    setNewDeliveryPlanRequest(0);
    const state = readNavigation(p);
    setTab(state.tab);
    setResearchView(state.view);
    setSelected(state.selected);
    setSidebar(state.boardItems);
    setSearch("");
    setFilter("all");
    setFocus((f) => ({ id: null, key: f.key + 1 }));
  };
  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
  }, []);
  useEffect(() => {
    api()
      .load()
      .then((s) => {
        latest.current = s.project;
        setProject(s.project);
        restoreNavigation(s.project);
        setSettings(s.settings);
        loaded.current = true;
        setSaveStatus("Saved locally");
      })
      .catch(fail);
    return api().onProjectChanged((p) => {
      if (outputWindow) {
        const previous = latest.current;
        const releaseKey = (value: Project | null) =>
          value
            ? `${value.id}:${value.releasedOutputId || ""}:${value.outputs.find((o) => o.id === value.releasedOutputId)?.releasedRevisionId || ""}`
            : "";
        if (releaseKey(previous) !== releaseKey(p)) setReader(undefined);
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
    if (project && loaded.current && !outputWindow)
      writeNavigation(project.id, {
        tab,
        view: researchView,
        selected,
        boardItems: sidebar,
      });
  }, [project?.id, tab, researchView, selected, sidebar, outputWindow]);
  useEffect(() => {
    const off = api().onCommand?.((command) => commandRef.current(command));
    const keys = (event: KeyboardEvent) => {
      if (outputWindow || event.defaultPrevented) return;
      const editing = (event.target as HTMLElement)?.closest(
        "input,textarea,select,[contenteditable=true]",
      );
      const modal = document.querySelector("dialog[open]");
      const mod =
        desktop.appearance.platform === "darwin"
          ? event.metaKey
          : event.ctrlKey;
      let command: DesktopCommand | undefined;
      if (mod && !event.altKey && event.key.toLowerCase() === "k" && !modal)
        command = "command-palette";
      else if (
        mod &&
        !event.altKey &&
        event.key.toLowerCase() === "f" &&
        !modal
      )
        command = "search";
      else if (!editing && !modal && mod && event.key.toLowerCase() === "z")
        command = event.shiftKey ? "redo" : "undo";
      else if (!editing && !modal && mod && event.key.toLowerCase() === "y")
        command = "redo";
      else if (
        !editing &&
        !modal &&
        (event.key === "Delete" ||
          event.key === "BackSpace" ||
          event.key === "Backspace")
      )
        command = "delete";
      if (command) {
        event.preventDefault();
        commandRef.current(command);
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      off?.();
      window.removeEventListener("keydown", keys);
    };
  }, [outputWindow, desktop.appearance.platform]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (outputWindow) return;
    return api().onBeforeClose(async () => {
      window.dispatchEvent(new Event("acadia:flush-report"));
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
      releasedOutputId: latest.current.releasedOutputId,
      privacy: latest.current.privacy,
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
      releasedOutputId: latest.current.releasedOutputId,
      privacy: latest.current.privacy,
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
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
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
    setReader(undefined);
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
  const addBoardReference = async (
    reference: BoardReference,
    options?: { tags: string[] },
  ) => {
    const originalId = project?.id;
    if (!originalId || outputWindow)
      throw new Error("Open an editable investigation first.");
    window.dispatchEvent(new Event("acadia:flush-report"));
    await savePromise.current;
    if (latest.current?.id !== originalId)
      throw new Error(
        "The active investigation changed. Reopen its records to add them.",
      );
    await api().save(latest.current);
    if (latest.current?.id !== originalId)
      throw new Error("The active investigation changed before placement.");
    const result = await api().addBoardReference(reference);
    if (latest.current?.id !== originalId)
      throw new Error(
        "The card was saved in its original investigation. Open that investigation to view it.",
      );
    const card = result.project.cards.find(
      (entry) => entry.id === result.cardId,
    )!;
    if (!latest.current.cards.some((entry) => entry.id === result.cardId)) {
      const placed = {
        ...card,
        ...(addPosition.current || {}),
        ...(options?.tags
          ? { tags: [...new Set([...card.tags, ...options.tags])].slice(0, 20) }
          : {}),
      };
      boardChange((current) => ({
        ...current,
        schemaVersion: result.project.schemaVersion,
        cards: [...current.cards, placed],
      }));
    }
    addPosition.current = null;
    setDialog(null);
    setReader(undefined);
    setTab("collector");
    setResearchView("board");
    setSelected(result.cardId);
    setFocus((value) => ({ id: result.cardId, key: value.key + 1 }));
    setToast("Linked research item is on the board.");
  };
  const openBoardRecord = (reference: BoardReference) => {
    if (
      Object.values(presentations).some(
        (item) =>
          item.unavailable &&
          item.reference?.kind === reference.kind &&
          item.reference.id === reference.id &&
          item.reference.versionId === reference.versionId,
      )
    ) {
      setToast(
        "This linked record is unavailable. Its board placement remains saved.",
      );
      return;
    }
    setDialog(null);
    setReader(undefined);
    setTab("collector");
    const key = Date.now(),
      { kind, id } = reference;
    if (kind === "source")
      setReader({ sourceId: id, versionId: reference.versionId });
    else if (kind === "passage") {
      const originalId = project?.id;
      void api()
        .getPassage(id)
        .then((passage) => {
          if (latest.current?.id === originalId)
            setReader({
              sourceId: passage.sourceId,
              versionId: reference.versionId,
              passageId: id,
            });
        })
        .catch(fail);
    } else if (kind === "brief") setResearchView("brief");
    else if (kind === "claim" || kind === "review") {
      setResearchView("evidence");
      setClaimRequest({ id, key });
    } else if (kind === "assumption") {
      setResearchView("evidence");
      setAssumptionRequest({ id, key });
    } else if (kind === "task") {
      setResearchView("tasks");
      setTaskRequest({ id, key });
    } else if (kind === "method") {
      setResearchView("methods");
      setMethodRequest({ id, key });
    } else if (kind === "gap" || kind === "decision") {
      setResearchView("flow");
      setFlowRequest({ kind, id, key });
    } else {
      setTab("releaser");
      setReportRequest({ id, key });
    }
  };
  const createBoardRecord = (
    kind:
      | "brief"
      | "claim"
      | "assumption"
      | "task"
      | "gap"
      | "decision"
      | "report"
      | "delivery-plan",
  ) => {
    setDialog(null);
    setReader(undefined);
    setTab("collector");
    const key = Date.now();
    if (kind === "brief") setResearchView("brief");
    else if (kind === "claim") {
      setResearchView("evidence");
      setClaimRequest({ id: "new", key });
    } else if (kind === "assumption") {
      setResearchView("evidence");
      setAssumptionRequest({ id: "new", key });
    } else if (kind === "task") {
      setResearchView("tasks");
      setTaskRequest({ id: "new", key });
    } else if (kind === "gap" || kind === "decision") {
      setResearchView("flow");
      setFlowRequest({ kind, key });
    } else {
      setTab("releaser");
      if (kind === "report") setNewReportRequest(key);
      else setNewDeliveryPlanRequest(key);
    }
    setToast("Save the record, then choose Add to board to place it.");
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
    window.dispatchEvent(new Event("acadia:flush-report"));
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
      setReader(undefined);
      restoreNavigation(s.project);
    } catch (e) {
      setLibrary(false);
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
    window.dispatchEvent(new Event("acadia:flush-report"));
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
        setReader(undefined);
        restoreNavigation(s.project);
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
    window.dispatchEvent(new Event("acadia:flush-report"));
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
  const exportPowerBI = async () => {
    window.dispatchEvent(new Event("acadia:flush-report"));
    setBusy(true);
    setProjectMenu(false);
    try {
      await api().save(latest.current!);
      if (await api().exportPowerBI())
        setToast(
          "Power BI tables exported with a data dictionary and relationship guide.",
        );
    } catch (error) {
      fail(error);
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
  const selectedCard = boardProject?.cards.find((c) => c.id === selected);
  const selectedPresentation = selected ? presentations[selected] : undefined;
  const filtered = useMemo(
    () =>
      boardProject?.cards.filter(
        (c) =>
          (filter === "all" ||
            (presentations[c.id]?.reference
              ? presentations[c.id].reference!.kind === filter
              : c.kind === filter)) &&
          `${c.title} ${c.content} ${c.extraction || ""} ${c.tags.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ) || [],
    [boardProject?.cards, presentations, search, filter],
  );
  const output = (o: ResearchOutput) => {
    if (latest.current?.id === project?.id) {
      change((p) => ({ ...p, outputs: [o, ...p.outputs] }), false);
      setToast("Draft ready in Releaser.");
    }
  };
  commandRef.current = (command) => {
    if (outputWindow) return;
    const editing = document.activeElement?.closest(
      "input,textarea,select,[contenteditable=true]",
    );
    if (["undo", "redo", "delete"].includes(command)) {
      if (document.querySelector("dialog[open]")) return;
      if (editing) {
        window.dispatchEvent(
          new CustomEvent("acadia:editor-command", { detail: command }),
        );
        return;
      }
      if (tab !== "collector" || researchView !== "board") return;
      const focus = document.activeElement;
      const boardFocused = focus?.closest(
        ".collector-layout, .collector-toolbar",
      );
      if (
        !boardFocused &&
        !(focus === document.body && !reader && !projectMenu)
      )
        return;
      if (command === "undo" && history.length) undo();
      if (command === "redo" && future.length) redo();
      if (command === "delete" && selectedCard) setDialog("delete");
      return;
    }
    if (document.querySelector("dialog[open]")) return;
    switch (command) {
      case "new-project":
        setDialog("new");
        break;
      case "open-project":
        if (!busy) void newOrOpen("open");
        break;
      case "project-library":
        setLibrary(true);
        break;
      case "export-project":
        if (!busy) void exportProject();
        break;
      case "import-files":
        if (!busy) void importFiles();
        break;
      case "new-item":
        setTab("collector");
        setResearchView("board");
        addPosition.current = null;
        setDialog("add");
        break;
      case "search":
        setGlobalSearch(true);
        break;
      case "command-palette":
        setPalette(true);
        break;
      case "settings":
        setDialog("settings");
        break;
      case "appearance":
        setDialog("appearance");
        break;
      case "collector":
        setTab("collector");
        break;
      case "releaser":
        setTab("releaser");
        break;
      case "present":
        void openDisplay();
        break;
      case "help":
        setDialog("help");
        break;
    }
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
    <BoardMappingProvider
      value={
        outputWindow
          ? undefined
          : { addToBoard: addBoardReference, openRecord: openBoardRecord }
      }
    >
      <div
        className={`app desktop-app ${outputWindow ? "output-display" : ""}`}
      >
        <div className="desktop-layout" style={paneStyle}>
          {!outputWindow && navigationOpen && (
            <>
              <aside
                className="app-navigation"
                aria-label="Workspace navigation"
              >
                <div className="navigation-brand">
                  <img src={acadiaIcon} alt="Acadia app icon" />
                  <strong>Acadia</strong>
                  <button
                    className="icon-button"
                    aria-label="Hide navigation"
                    onClick={() => setNavigationOpen(false)}
                  >
                    <PanelLeftClose size={17} />
                  </button>
                </div>
                <div className="navigation-project">
                  <button
                    className="project-switcher"
                    onClick={() => setLibrary(true)}
                    title={project.title}
                  >
                    <FolderOpen size={17} />
                    <span>
                      {project.title}
                      <small>Project library</small>
                    </span>
                  </button>
                  <div className="project-menu-anchor">
                    <button
                      className="icon-button"
                      aria-label="Project menu"
                      onClick={() => setProjectMenu(!projectMenu)}
                    >
                      <ChevronDown size={16} />
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
                          <button
                            disabled={busy}
                            onClick={() => newOrOpen("open")}
                          >
                            <FolderOpen size={16} />
                            Import portable project
                          </button>
                          <button onClick={exportProject}>
                            <Download size={16} />
                            Export portable project
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void exportPowerBI()}
                          >
                            <Download size={16} />
                            Export data for Power BI
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <nav className="navigation-views" aria-label="Research views">
                  <div
                    className="workspace-switch"
                    role="tablist"
                    aria-label="Workspace view"
                    aria-orientation="vertical"
                    onKeyDown={(e) => {
                      if (
                        !["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)
                      )
                        return;
                      e.preventDefault();
                      const next =
                        e.key === "Home"
                          ? "collector"
                          : e.key === "End"
                            ? "releaser"
                            : tab === "collector"
                              ? "releaser"
                              : "collector";
                      setTab(next);
                      document.getElementById(`${next}-tab`)?.focus();
                    }}
                  >
                    <button
                      id="collector-tab"
                      role="tab"
                      aria-selected={tab === "collector"}
                      aria-controls="workspace-content"
                      tabIndex={tab === "collector" ? 0 : -1}
                      className={tab === "collector" ? "active" : ""}
                      onClick={() => setTab("collector")}
                    >
                      <Network size={17} />
                      Collector
                    </button>
                    <button
                      id="releaser-tab"
                      role="tab"
                      aria-selected={tab === "releaser"}
                      aria-controls="workspace-content"
                      tabIndex={tab === "releaser" ? 0 : -1}
                      className={tab === "releaser" ? "active" : ""}
                      onClick={() => setTab("releaser")}
                    >
                      <Sparkles size={17} />
                      Releaser
                    </button>
                  </div>
                  <div className="navigation-section-label">
                    {tab === "collector"
                      ? "Investigation"
                      : "Writing & release"}
                  </div>
                  {tab === "collector" ? (
                    (Object.keys(viewLabels) as ResearchView[]).map((v) => {
                      const Icon = viewIcons[v];
                      return (
                        <button
                          key={v}
                          className={`navigation-link ${researchView === v ? "active" : ""}`}
                          aria-current={researchView === v ? "page" : undefined}
                          onClick={() => setResearchView(v)}
                        >
                          <Icon size={17} />
                          {viewLabels[v]}
                        </button>
                      );
                    })
                  ) : (
                    <>
                      <button
                        className="navigation-link active"
                        onClick={() => setTab("releaser")}
                      >
                        <BookOpen size={17} />
                        Reports
                      </button>
                      <button
                        className="navigation-link"
                        onClick={() => setNewReportRequest((n) => n + 1)}
                      >
                        <FilePlus2 size={17} />
                        Create report
                      </button>
                      <button className="navigation-link" onClick={openDisplay}>
                        <MonitorUp size={17} />
                        Present release
                      </button>
                    </>
                  )}
                </nav>
                <div className="navigation-utilities">
                  <button
                    className="navigation-engine"
                    aria-label="Research engine settings"
                    onClick={() => setDialog("settings")}
                  >
                    <span className="engine-indicator" />
                    <span>
                      <strong>
                        {project.privacy?.provider === "offline" ||
                        !project.privacy?.provider
                          ? "Offline evidence"
                          : project.privacy?.mode === "cloud"
                            ? "AI · Server or cloud"
                            : "AI · This computer"}
                      </strong>
                      <small>{project.privacy?.model || "No AI model"}</small>
                    </span>
                    <Settings2 size={16} />
                  </button>
                  <div className="navigation-utility-row">
                    <button
                      className="icon-button"
                      aria-label="Appearance"
                      title="Appearance"
                      onClick={() => setDialog("appearance")}
                    >
                      <Palette size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Commands"
                      title="Commands"
                      onClick={() => setPalette(true)}
                    >
                      <Command size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Workspace guide"
                      title="Workspace guide"
                      onClick={() => setDialog("help")}
                    >
                      <HelpCircle size={17} />
                    </button>
                  </div>
                </div>
              </aside>
              <ResizeHandle
                label="Navigation width"
                value={navigationWidth}
                min={170}
                max={290}
                onChange={setNavigationWidth}
                onCommit={(n) => storeWidth("navigation", n)}
              />
            </>
          )}
          <div className="desktop-workspace">
            <header className="desktop-toolbar">
              {!outputWindow && !navigationOpen && (
                <button
                  className="icon-button"
                  aria-label="Show navigation"
                  onClick={() => setNavigationOpen(true)}
                >
                  <PanelLeftOpen size={18} />
                </button>
              )}
              <div className="desktop-project-heading">
                <button
                  className="project-title"
                  title="Edit project title and research question"
                  onClick={() => !outputWindow && setDialog("project")}
                >
                  {project.title}
                </button>
                <span title={project.question}>
                  {outputWindow
                    ? "Released report · Audience display"
                    : project.question || "Define your research question"}
                </span>
              </div>
              {!outputWindow && (
                <>
                  <button
                    className="button quiet workspace-search-button"
                    aria-label="Search investigation"
                    onClick={() => setGlobalSearch(true)}
                  >
                    <Search size={16} />
                    <span>Search</span>
                    <kbd>
                      {desktop.appearance.platform === "darwin" ? "⌘" : "Ctrl"}{" "}
                      F
                    </kbd>
                  </button>
                  <button
                    className="button quiet display-button"
                    aria-label="Open display"
                    title="Present a released report"
                    onClick={openDisplay}
                  >
                    <MonitorUp size={16} />
                    <span>Present</span>
                  </button>
                </>
              )}
              {outputWindow && (
                <button
                  className="icon-button"
                  aria-label="Toggle fullscreen"
                  onClick={() => api().fullscreen().catch(fail)}
                >
                  <Maximize size={18} />
                </button>
              )}
            </header>
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
            <div
              className={`workspace-content-row ${reader ? "has-reader" : ""}`}
            >
              <div
                className="workspace-primary"
                id="workspace-content"
                role="tabpanel"
                aria-labelledby={outputWindow ? undefined : `${tab}-tab`}
              >
                {tab === "collector" ? (
                  <>
                    <div className="collector-toolbar">
                      <div className="collector-title">
                        {researchView === "board" && (
                          <button
                            className={`icon-button ${sidebar ? "active" : ""}`}
                            onClick={() => setSidebar(!sidebar)}
                            aria-label="Toggle board items"
                            title="Board items"
                          >
                            <Menu size={18} />
                          </button>
                        )}
                        <h1
                          aria-label={
                            researchView === "board"
                              ? "THE COLLECTOR"
                              : undefined
                          }
                        >
                          {viewLabels[researchView]}
                        </h1>
                      </div>
                      <div className="toolbar-actions">
                        {researchView === "board" && (
                          <>
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
                          </>
                        )}
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
                    {researchView === "board" ? (
                      <main className="collector-layout">
                        {sidebar && (
                          <aside className="source-library">
                            <div className="library-heading">
                              <span className="eyebrow">BOARD ITEMS</span>
                              <span className="count-chip">
                                {project.cards.length}
                              </span>
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
                                    : k.charAt(0).toUpperCase() +
                                      k.slice(1) +
                                      "s"}{" "}
                                  (
                                  {
                                    project.cards.filter(
                                      (c) =>
                                        c.kind === k &&
                                        !presentations[c.id]?.reference,
                                    ).length
                                  }
                                  )
                                </option>
                              ))}
                              {Object.entries(boardLabels).map(
                                ([kind, label]) => (
                                  <option key={`linked-${kind}`} value={kind}>
                                    {label} (
                                    {
                                      Object.values(presentations).filter(
                                        (item) => item.reference?.kind === kind,
                                      ).length
                                    }
                                    )
                                  </option>
                                ),
                              )}
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
                                    <Icon
                                      size={16}
                                      className={`kind-color-${c.kind}`}
                                    />
                                    <span>
                                      <strong>{c.title}</strong>
                                      <small>
                                        {presentations[c.id]?.label || c.kind}{" "}
                                        <span>·</span>{" "}
                                        {presentations[c.id]?.status ||
                                          c.status}
                                      </small>
                                    </span>
                                    <span
                                      className={`status-dot ${c.status}`}
                                    />
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
                                {project.question ||
                                  "What are you trying to understand?"}
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
                          project={boardProject!}
                          presentations={presentations}
                          onOpen={(id) => {
                            const ref = presentations[id]?.reference;
                            if (ref) openBoardRecord(ref);
                          }}
                          selectedId={selected}
                          onSelect={setSelected}
                          onMove={(positions) =>
                            boardChange((p) => ({
                              ...p,
                              cards: p.cards.map((c) => {
                                const pos = positions.find(
                                  (n) => n.id === c.id,
                                );
                                return pos ? { ...c, x: pos.x, y: pos.y } : c;
                              }),
                            }))
                          }
                          onConnect={connect}
                          onEdge={setEdge}
                          onAdd={(x, y) => {
                            addPosition.current =
                              x !== undefined && y !== undefined
                                ? { x, y }
                                : null;
                            setDialog("add");
                          }}
                          onDropFiles={dropFiles}
                          onSummarize={openItemInsight}
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
                        {selectedCard && selectedPresentation?.reference ? (
                          <LinkedItemInspector
                            item={selectedPresentation}
                            project={boardProject!}
                            onClose={() => setSelected(null)}
                            onOpen={() =>
                              openBoardRecord(selectedPresentation.reference!)
                            }
                            onRemove={() => setDialog("delete")}
                            onConnection={setEdge}
                            onCard={focusSource}
                            onSummarize={() => openItemInsight(selectedCard.id)}
                          />
                        ) : (
                          selectedCard && (
                            <Inspector
                              card={selectedCard}
                              project={project}
                              connections={project.connections.filter(
                                (c) =>
                                  c.source === selected ||
                                  c.target === selected,
                              )}
                              onClose={() => setSelected(null)}
                              onEdit={() => setDialog("edit")}
                              onReadSource={
                                research.sources.some(
                                  (source) =>
                                    source.cardId === selectedCard.id ||
                                    source.id === selectedCard.sourceId,
                                )
                                  ? () => {
                                      const source = research.sources.find(
                                        (entry) =>
                                          entry.cardId === selectedCard.id ||
                                          entry.id === selectedCard.sourceId,
                                      );
                                      if (source)
                                        openBoardRecord({
                                          kind: "source",
                                          id: source.id,
                                        });
                                    }
                                  : undefined
                              }
                              onDelete={() => setDialog("delete")}
                              onChange={(v) =>
                                boardChange((p) => ({
                                  ...p,
                                  cards: p.cards.map((c) =>
                                    c.id === selected
                                      ? {
                                          ...c,
                                          ...v,
                                          updatedAt: new Date().toISOString(),
                                        }
                                      : c,
                                  ),
                                }))
                              }
                              onSource={focusSource}
                              onSummarize={() =>
                                openItemInsight(selectedCard.id)
                              }
                              reviewerClaims={research.claims.filter(
                                (claim) =>
                                  claim.itemReview &&
                                  ((claim.itemReview.target.kind === "card" &&
                                    claim.itemReview.target.id ===
                                      selectedCard.id) ||
                                    Boolean(
                                      claim.itemReview.sourceId &&
                                      research.sources.some(
                                        (source) =>
                                          source.id ===
                                            claim.itemReview!.sourceId &&
                                          (source.id ===
                                            selectedCard.sourceId ||
                                            source.cardId === selectedCard.id),
                                      ),
                                    )),
                              )}
                              onCitation={openCitation}
                              reviewerSourceVersion={
                                research.sources.find(
                                  (source) =>
                                    source.id === selectedCard.sourceId ||
                                    source.cardId === selectedCard.id,
                                )?.currentVersionId
                              }
                              onEvidence={(id) => {
                                setResearchView("evidence");
                                setClaimRequest({ id, key: Date.now() });
                              }}
                              onMethod={(id) => {
                                setMethodRequest({ id, key: Date.now() });
                                setResearchView("methods");
                              }}
                              onConnection={setEdge}
                              onError={fail}
                            />
                          )
                        )}
                      </main>
                    ) : researchView === "brief" ? (
                      research && (
                        <PedigreeWorkspace
                          key={project.id}
                          project={project}
                          research={research}
                          onQuestionSaved={(question) =>
                            latest.current?.id === project.id &&
                            change((p) => ({ ...p, question }), false)
                          }
                          onError={fail}
                          onSource={(sourceId, versionId, passageId) =>
                            setReader({ sourceId, versionId, passageId })
                          }
                        />
                      )
                    ) : researchView === "flow" ? (
                      <ResearchFlowWorkspace
                        key={project.id}
                        project={project}
                        research={research}
                        onError={fail}
                        request={flowRequest}
                        onRequestHandled={() => setFlowRequest(undefined)}
                        onAddToBoard={addBoardReference}
                        onSource={(sourceId, versionId, passageId) =>
                          setReader({ sourceId, versionId, passageId })
                        }
                      />
                    ) : researchView === "methods" ? (
                      research && (
                        <MethodsWorkspace
                          key={project.id}
                          project={project}
                          research={research}
                          onError={fail}
                          requestedMethod={methodRequest}
                          onMethodRequestHandled={() =>
                            setMethodRequest(undefined)
                          }
                          onSource={(sourceId, versionId, passageId) =>
                            setReader({ sourceId, versionId, passageId })
                          }
                          onBoard={(method) => {
                            void addBoardReference({
                              kind: "method",
                              id: method.id,
                            }).catch(fail);
                          }}
                        />
                      )
                    ) : (
                      <ResearchWorkspace
                        requestedTask={taskRequest}
                        onTaskRequestHandled={() => setTaskRequest(undefined)}
                        requestedAssumption={assumptionRequest}
                        onAssumptionRequestHandled={() =>
                          setAssumptionRequest(undefined)
                        }
                        requestedClaim={claimRequest}
                        onClaimRequestHandled={() => setClaimRequest(undefined)}
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
                      key={project.id}
                      onRequestHandled={() => {
                        setNewReportRequest(0);
                        setNewDeliveryPlanRequest(0);
                        setReportRequest(undefined);
                      }}
                      requestNewReport={newReportRequest}
                      requestNewDeliveryPlan={newDeliveryPlanRequest}
                      requestedReport={reportRequest}
                      research={research}
                      project={project}
                      settings={
                        project.privacy?.provider
                          ? { ...settings, ...project.privacy }
                          : settings
                      }
                      onOutput={output}
                      onUpdateOutput={(o) =>
                        change(
                          (p) =>
                            p.id !== project.id
                              ? p
                              : {
                                  ...p,
                                  outputs: p.outputs.map((x) =>
                                    x.id === o.id ? o : x,
                                  ),
                                },
                          false,
                        )
                      }
                      onRelease={(outputId, revisionId) =>
                        change(
                          (p) =>
                            p.id !== project.id
                              ? p
                              : {
                                  ...p,
                                  releasedOutputId: outputId,
                                  outputs: p.outputs.map((o) =>
                                    o.id === outputId
                                      ? { ...o, releasedRevisionId: revisionId }
                                      : o,
                                  ),
                                },
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
              </div>
              {reader && (
                <>
                  <ResizeHandle
                    label="Source reader width"
                    value={readerWidth}
                    min={310}
                    max={650}
                    reverse
                    onChange={setReaderWidth}
                    onCommit={(n) => storeWidth("reader", n)}
                  />
                  <div className="source-reader-dock">
                    <SourceReader
                      embedded
                      {...reader}
                      key={`${reader.sourceId}:${reader.versionId || ""}`}
                      project={project}
                      research={research}
                      readOnly={outputWindow}
                      onClose={() => setReader(undefined)}
                      onSummarize={
                        outputWindow
                          ? undefined
                          : (sourceId, versionId) =>
                              setInsightTarget({
                                kind: "source",
                                id: sourceId,
                                versionId,
                              })
                      }
                      onNavigate={(sourceId, versionId, passageId) =>
                        setReader({ sourceId, versionId, passageId })
                      }
                      onError={fail}
                      onBoard={(c) => {
                        addCard(c);
                        setReader(undefined);
                        setResearchView("board");
                        setTab("collector");
                      }}
                    />
                  </div>
                </>
              )}
            </div>
            {!outputWindow && <Jobs research={research} onError={fail} />}
            <footer className="statusbar">
              <span>
                <span className="pulse-dot" />
                {outputWindow ? "Released output" : saveStatus}
                <span className="footer-divider">/</span>
                {project.cards.length} ITEMS
                <span className="footer-divider">/</span>
                {project.connections.length} CONNECTIONS
              </span>
              <span>
                {(project.privacy?.provider || "offline") === "offline"
                  ? "OFFLINE OUTLINE"
                  : `${project.privacy!.provider!.toUpperCase()} ENGINE`}
                <span className="footer-divider">/</span>ACADIA v{appVersion}
              </span>
            </footer>
          </div>
        </div>
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
        {dialog === "appearance" && (
          <AppearanceDialog
            state={desktop}
            onSave={desktop.save}
            onClose={() => setDialog(null)}
          />
        )}
        {palette && (
          <CommandPalette
            onClose={() => setPalette(false)}
            onCommand={(command) => {
              setPalette(false);
              setTimeout(() => commandRef.current(command), 0);
            }}
          />
        )}
        {globalSearch && (
          <InvestigationSearch
            project={boardProject!}
            research={research}
            pedigree={pedigree}
            onRecord={openBoardRecord}
            onClose={() => setGlobalSearch(false)}
            onCard={focusSource}
            onPassage={(p) =>
              setReader({
                sourceId: p.sourceId,
                versionId: p.versionId,
                passageId: p.id,
              })
            }
            onReport={(id) => {
              setTab("releaser");
              setReportRequest({ id, key: Date.now() });
            }}
            onEvidence={(id) => {
              setReader(undefined);
              setTab("collector");
              setResearchView("evidence");
              setClaimRequest({ id, key: Date.now() });
            }}
          />
        )}
        {dialog === "add" && !outputWindow && (
          <BoardItemPicker
            key={project.id}
            project={project}
            research={research}
            pedigree={pedigree || emptyPedigreeState()}
            onClose={() => setDialog(null)}
            onAddReference={addBoardReference}
            onAddBasic={addCard}
            onImport={() => {
              void importFiles();
            }}
            onCreateRecord={createBoardRecord}
          />
        )}
        {dialog === "edit" &&
          selectedCard &&
          !selectedPresentation?.reference && (
            <CardDialog
              initial={selectedCard}
              onClose={() => setDialog(null)}
              onImport={importFiles}
              onSaveMethod={async () => {}}
              onSave={(values) => {
                boardChange((current) => ({
                  ...current,
                  cards: current.cards.map((card) =>
                    card.id === selected
                      ? {
                          ...card,
                          ...values,
                          updatedAt: new Date().toISOString(),
                        }
                      : card,
                  ),
                }));
                setDialog(null);
              }}
            />
          )}
        {!outputWindow && insightTarget && (
          <ItemInsightDialog
            key={`${project.id}:${insightTarget.kind}:${insightTarget.id}:${insightTarget.versionId || ""}`}
            project={project}
            research={research}
            target={insightTarget}
            beforeRun={async () => {
              const projectId = project.id;
              window.dispatchEvent(new Event("acadia:flush-report"));
              await savePromise.current;
              if (latest.current?.id !== projectId)
                throw new Error(
                  "The active investigation changed. Reopen the item to summarize it.",
                );
              await api().save(latest.current);
              if (latest.current?.id !== projectId)
                throw new Error(
                  "The active investigation changed. Reopen the item to summarize it.",
                );
            }}
            onClose={() => setInsightTarget(undefined)}
            onCitation={(citation) => {
              setInsightTarget(undefined);
              openCitation(citation);
            }}
            onSettings={() => {
              setInsightTarget(undefined);
              setDialog("settings");
            }}
            onEvidence={(id) => {
              setInsightTarget(undefined);
              setReader(undefined);
              setTab("collector");
              setResearchView("evidence");
              setClaimRequest({ id, key: Date.now() });
            }}
          />
        )}
        {edge && (
          <ConnectionDialog
            connection={edge}
            project={boardProject!}
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
            onPrivacy={(privacy) =>
              change(
                (p) =>
                  p.id === project.id
                    ? { ...p, privacy, updatedAt: new Date().toISOString() }
                    : p,
                false,
              )
            }
            onClose={() => setDialog(null)}
            onSave={async (s) => {
              const saved = await api().saveSettings(s);
              if (latest.current?.id !== project.id) return;
              setSettings(saved);
              change(
                (p) =>
                  p.id !== project.id
                    ? p
                    : {
                        ...p,
                        privacy: {
                          mode: p.privacy?.mode || "local",
                          provider: saved.provider,
                          endpoint: saved.endpoint,
                          model: saved.model,
                        },
                      },
                false,
              );
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
              Your current investigation and attachments stay in the local
              project library. A recovery archive is also saved before
              switching.
            </p>
            <p className="muted">
              Use Project library to return to an investigation. Export a
              portable project to keep a copy elsewhere.
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
            {selectedPresentation?.reference && (
              <p className="subtle-note">
                The underlying research record and its history will remain
                saved.
              </p>
            )}
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
                  drop them onto the canvas. Paste text or a URL directly onto
                  the board.
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
                  Present creates a separate output window for a second monitor.
                  Export releases as Markdown, DOCX, or PDF.
                </p>
              </section>
            </div>
            <p className="settings-note">
              Sources stores complete document passages and dated website
              captures. Run local English OCR for scanned pages. Evidence
              distinguishes support from contradictions; Tasks track gaps.
              Approve each external search in Discover. Save a report revision
              and release it explicitly to show it on the second display. Export
              editable DOCX, PDF, or Markdown.
            </p>
            <div className="modal-actions">
              <button
                className="button primary"
                onClick={() => setDialog(null)}
              >
                Back to research
              </button>
            </div>
          </Modal>
        )}
      </div>
    </BoardMappingProvider>
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
            data-autofocus
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
