import { useEffect, useId, useRef, useState } from "react";
import { Search, Monitor, Sun, Moon, Command } from "lucide-react";
import type {
  DesktopCommand,
  DesktopPreferences,
  DesktopState,
} from "../../shared/desktop";
import type { Project } from "../../shared/types";
import type { ResearchState, SearchHit } from "../../shared/research";
import { Modal } from "./Dialogs";

const media = (query: string) => window.matchMedia(query);
const fallback = (): DesktopState => ({
  preferences: { theme: "system", density: "comfortable" },
  appearance: {
    platform: navigator.platform.toLowerCase().includes("mac")
      ? "darwin"
      : navigator.platform.toLowerCase().includes("win")
        ? "win32"
        : "linux",
    theme: media("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    highContrast: media("(forced-colors: active)").matches,
    reducedMotion: media("(prefers-reduced-motion: reduce)").matches,
  },
});
export function useDesktop() {
  const [state, setState] = useState<DesktopState>(fallback);
  useEffect(() => {
    let alive = true;
    const update = (s: DesktopState) => {
      if (alive) setState(s);
    };
    window.acadia
      ?.getDesktopState?.()
      .then(update)
      .catch(() => {});
    const off = window.acadia?.onDesktopChanged?.(update);
    const theme = media("(prefers-color-scheme: dark)");
    const motion = media("(prefers-reduced-motion: reduce)");
    const changed = () =>
      setState((s) => ({
        ...s,
        appearance: {
          ...s.appearance,
          reducedMotion: motion.matches,
          theme:
            s.preferences.theme === "system"
              ? theme.matches
                ? "dark"
                : "light"
              : s.preferences.theme,
        },
      }));
    theme.addEventListener("change", changed);
    motion.addEventListener("change", changed);
    return () => {
      alive = false;
      off?.();
      theme.removeEventListener("change", changed);
      motion.removeEventListener("change", changed);
    };
  }, []);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = state.appearance.theme;
    el.dataset.platform = state.appearance.platform;
    el.dataset.density = state.preferences.density;
    el.dataset.reducedMotion = String(state.appearance.reducedMotion);
    el.dataset.highContrast = String(state.appearance.highContrast);
  }, [state]);
  const save = async (preferences: Partial<DesktopPreferences>) => {
    if (window.acadia?.saveDesktopPreferences)
      setState(await window.acadia.saveDesktopPreferences(preferences));
    else
      setState((s) => {
        const next = { ...s.preferences, ...preferences };
        return {
          ...s,
          preferences: next,
          appearance: {
            ...s.appearance,
            theme:
              next.theme === "system"
                ? media("(prefers-color-scheme: dark)").matches
                  ? "dark"
                  : "light"
                : next.theme,
          },
        };
      });
  };
  return { ...state, save };
}

export function AppearanceDialog({
  state,
  onSave,
  onClose,
}: {
  state: DesktopState;
  onSave: (p: Partial<DesktopPreferences>) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (p: Partial<DesktopPreferences>) => {
    setBusy(true);
    setError("");
    try {
      await onSave(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Appearance"
      subtitle="Make Acadia comfortable on this computer."
      onClose={onClose}
    >
      <fieldset className="appearance-picker" disabled={busy}>
        <legend>Color theme</legend>
        {(
          [
            ["system", Monitor, "System"],
            ["light", Sun, "Light"],
            ["dark", Moon, "Dark"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={state.preferences.theme === value}
            onClick={() => void save({ theme: value })}
          >
            <Icon size={23} />
            {label}
          </button>
        ))}
      </fieldset>
      <label className="field">
        Control size
        <select
          value={state.preferences.density}
          disabled={busy}
          onChange={(e) =>
            void save({
              density: e.target.value as DesktopPreferences["density"],
            })
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
          <option value="touch">Touch — larger targets</option>
        </select>
      </label>
      <p className="settings-note">
        System appearance follows your operating system. Motion and contrast
        preferences are respected. These settings stay on this computer.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export interface WorkspaceNavigation {
  tab: "collector" | "releaser";
  view: "board" | "brief" | "sources" | "evidence" | "methods" | "tasks" | "inquiry" | "discovery";
  selected: string | null;
  boardItems: boolean;
}
export function readNavigation(project: Project): WorkspaceNavigation {
  const defaults: WorkspaceNavigation = {
    tab: "collector",
    view: "board",
    selected: null,
    boardItems: false,
  };
  try {
    const s = JSON.parse(
      localStorage.getItem(`acadia-navigation:${project.id}`) || "null",
    );
    if (!s || typeof s !== "object") return defaults;
    return {
      tab: s.tab === "releaser" ? "releaser" : "collector",
      view: [
        "board",
        "sources",
        "evidence",
        "tasks",
        "inquiry",
        "discovery",
        "brief",
        "methods",
      ].includes(s.view)
        ? s.view
        : "board",
      selected: project.cards.some((c) => c.id === s.selected)
        ? s.selected
        : null,
      boardItems: s.boardItems === true,
    };
  } catch {
    return defaults;
  }
}
export function writeNavigation(projectId: string, value: WorkspaceNavigation) {
  try {
    localStorage.setItem(
      `acadia-navigation:${projectId}`,
      JSON.stringify(value),
    );
  } catch {
    /* UI preferences are optional; research saving uses the desktop store. */
  }
}
export function readWidth(
  name: string,
  initial: number,
  min: number,
  max: number,
) {
  try {
    const n = Number(localStorage.getItem(`acadia-pane:${name}`));
    return Number.isFinite(n) && n >= min && n <= max ? n : initial;
  } catch {
    return initial;
  }
}
export function ResizeHandle({
  label,
  value,
  min,
  max,
  reverse = false,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  reverse?: boolean;
  onChange: (n: number) => void;
  onCommit?: (n: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | undefined>(undefined);
  const latest = useRef(value);
  latest.current = value;
  const update = (n: number) => {
    latest.current = Math.max(min, Math.min(max, n));
    onChange(latest.current);
  };
  return (
    <div
      className="pane-resizer"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        update(
          e.key === "Home"
            ? min
            : e.key === "End"
              ? max
              : value +
                (e.key === "ArrowRight" ? 16 : -16) * (reverse ? -1 : 1),
        );
        onCommit?.(latest.current);
      }}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, width: value };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current)
          update(
            start.current.width +
              (e.clientX - start.current.x) * (reverse ? -1 : 1),
          );
      }}
      onPointerUp={() => {
        start.current = undefined;
        onCommit?.(latest.current);
      }}
      onPointerCancel={() => {
        start.current = undefined;
        onCommit?.(latest.current);
      }}
    />
  );
}

export const commandLabels: {
  id: DesktopCommand;
  label: string;
  hint?: string;
}[] = [
  { id: "new-project", label: "New investigation", hint: "⌘/Ctrl N" },
  { id: "project-library", label: "Project library" },
  { id: "open-project", label: "Import portable project" },
  { id: "export-project", label: "Export portable project" },
  { id: "import-files", label: "Import files", hint: "⌘/Ctrl ⇧I" },
  { id: "new-item", label: "Add board item" },
  { id: "search", label: "Search investigation", hint: "⌘/Ctrl F" },
  { id: "collector", label: "Go to Collector" },
  { id: "releaser", label: "Go to Releaser" },
  { id: "present", label: "Present released report" },
  { id: "settings", label: "Research engine settings" },
  { id: "appearance", label: "Appearance" },
  { id: "help", label: "Workspace guide" },
];
export function CommandPalette({
  onCommand,
  onClose,
}: {
  onCommand: (id: DesktopCommand) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const items = commandLabels.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const [index, setIndex] = useState(0);
  const listId = useId();
  const results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    results.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index, query]);
  return (
    <Modal title="Commands" onClose={onClose}>
      <label className="global-search-input">
        <Command size={18} />
        <input
          autoFocus
          data-autofocus
          aria-label="Find a command"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            items[index] ? `${listId}-${items[index].id}` : undefined
          }
          value={query}
          placeholder="What would you like to do?"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) =>
                Math.max(
                  0,
                  Math.min(
                    items.length - 1,
                    i + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (e.key === "Enter" && items[index]) {
              e.preventDefault();
              onClose();
              onCommand(items[index].id);
            }
          }}
        />
      </label>
      <div
        className="command-results"
        ref={results}
        id={listId}
        role="listbox"
        aria-label="Matching commands"
      >
        {items.map((c, i) => (
          <button
            key={c.id}
            id={`${listId}-${c.id}`}
            role="option"
            aria-selected={i === index}
            tabIndex={-1}
            className={i === index ? "highlighted" : ""}
            onClick={() => {
              onClose();
              onCommand(c.id);
            }}
          >
            <span>{c.label}</span>
            <kbd>{c.hint}</kbd>
          </button>
        ))}
        {!items.length && <p className="muted">No matching commands.</p>}
      </div>
    </Modal>
  );
}

export function InvestigationSearch({
  project,
  research,
  onCard,
  onPassage,
  onReport,
  onEvidence,
  onClose,
}: {
  project: Project;
  research: ResearchState;
  onCard: (id: string) => void;
  onPassage: (p: SearchHit) => void;
  onReport: (id: string) => void;
  onEvidence: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setHits([]);
    setError("");
    setBusy(false);
    if (query.trim().length < 2 || !["all", "sources"].includes(scope)) return;
    setBusy(true);
    const timer = setTimeout(() => {
      window
        .acadia!.searchSources(query)
        .then((h) => {
          if (alive) setHits(h);
        })
        .catch((e) => {
          if (alive) setError(String(e));
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, scope, project.id]);
  const q = query.toLowerCase().trim();
  const match = (text: string) =>
    q.length >= 2 && text.toLowerCase().includes(q);
  const cards = ["all", "board"].includes(scope)
    ? project.cards.filter((c) => match(`${c.title} ${c.content}`)).slice(0, 20)
    : [];
  const reports = ["all", "reports"].includes(scope)
    ? project.outputs
        .filter((o) => match(`${o.title} ${o.markdown}`))
        .slice(0, 10)
    : [];
  const claims = ["all", "evidence"].includes(scope)
    ? research.claims.filter((c) => match(c.title)).slice(0, 15)
    : [];
  const choose = (f: () => void) => {
    onClose();
    f();
  };
  return (
    <Modal
      title="Search investigation"
      subtitle={project.title}
      onClose={onClose}
      wide
    >
      <div className="search-controls">
        <label className="global-search-input">
          <Search size={18} />
          <input
            autoFocus
            data-autofocus
            aria-label="Search all research"
            placeholder="Search notes, passages, evidence, reports…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Search scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="all">All research</option>
          <option value="board">Board items</option>
          <option value="sources">Source passages</option>
          <option value="evidence">Evidence</option>
          <option value="reports">Reports</option>
        </select>
      </div>
      <div className="search-results">
        {cards.map((c) => (
          <button key={c.id} onClick={() => choose(() => onCard(c.id))}>
            <small>Board · {c.kind}</small>
            <strong>{c.title}</strong>
            <span>{c.content.slice(0, 160)}</span>
          </button>
        ))}
        {hits.slice(0, 30).map((p) => (
          <button key={p.id} onClick={() => choose(() => onPassage(p))}>
            <small>Source passage · {p.locator}</small>
            <strong>{p.sourceTitle}</strong>
            <span>{p.text.slice(0, 220)}</span>
          </button>
        ))}
        {claims.map((c) => (
          <button key={c.id} onClick={() => choose(() => onEvidence(c.id))}>
            <small>Evidence claim</small>
            <strong>{c.title}</strong>
          </button>
        ))}
        {reports.map((o) => (
          <button key={o.id} onClick={() => choose(() => onReport(o.id))}>
            <small>Report</small>
            <strong>{o.title}</strong>
          </button>
        ))}
        <p role="status" className="muted">
          {q.length < 2
            ? "Enter at least two characters. Search stays within this investigation."
            : busy
              ? "Searching saved passages…"
              : !cards.length &&
                  !hits.length &&
                  !claims.length &&
                  !reports.length
                ? "No matching research."
                : "Source results open the saved passage."}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
