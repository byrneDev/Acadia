import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection as FlowConnection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Plus, Minus, Scan, Hand, Maximize, X, Link2 } from "lucide-react";
import type { Connection, Project, ResearchCard } from "../../shared/types";
import ResearchNode from "./ResearchNode";
import type { BoardPresentation } from "./boardPresentation";
import {
  readBoardViewport,
  saveBoardViewport,
  type BoardViewport,
} from "./workspaceViewState";
import "./Collector.css";
const lastFocused = new Map<string, string>();
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
const nodeTypes = {
  research: ResearchNode,
  area: ({ data }: { data: { title: string } }) => (
    <div className="board-area-label">{data.title}</div>
  ),
};
const relationColors: Record<string, string> = {
  supports: "var(--connection-supports, var(--phosphor))",
  contradicts: "var(--connection-contradicts, var(--danger))",
  "derived from": "var(--connection-derived, var(--text))",
  investigate: "var(--connection-investigate, var(--amber))",
  "relates to": "var(--connection-related, var(--muted))",
  informs: "var(--phosphor)",
  "identifies gap": "var(--amber)",
  addresses: "var(--phosphor)",
  "depends on": "var(--text)",
  produces: "var(--phosphor)",
};
interface Props {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (positions: { id: string; x: number; y: number }[]) => void;
  onConnect: (c: FlowConnection) => void;
  onEdge: (c: Connection) => void;
  onAdd: (x?: number, y?: number) => void;
  onDropFiles: (files: File[]) => void;
  onSummarize?: (id: string) => void;
  onOpen?: (id: string) => void;
  presentations?: Record<string, BoardPresentation>;
  focusId: string | null;
  focusKey: number;
  onAreas: () => void;
  onSaveView: (view: NonNullable<Project["views"]>[number]) => void;
}
function Board(props: Props) {
  const {
    project,
    selectedId,
    onSelect,
    onMove,
    onConnect,
    onEdge,
    onAdd,
    onDropFiles,
    onSummarize,
    onOpen,
    presentations,
    focusId,
    focusKey,
  } = props;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [panMode, setPanMode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [initialViewport] = useState(() => readBoardViewport(project.id));
  const [zoom, setZoom] = useState(initialViewport?.zoom || 1);
  const viewport = useRef<BoardViewport | undefined>(initialViewport);
  const reducedMotion = useReducedMotion();
  const duration = reducedMotion ? 0 : 220;
  const [context, setContext] = useState<{
    x: number;
    y: number;
    flowX: number;
    flowY: number;
    cardId?: string;
  }>();
  const [connectFrom, setConnectFrom] = useState("");
  const [connectTo, setConnectTo] = useState("");
  const contextRef = useRef<HTMLDivElement>(null);
  const connectionTarget = useRef<HTMLSelectElement>(null);
  const {
    fitView,
    zoomIn,
    zoomOut,
    setCenter,
    screenToFlowPosition,
    getViewport,
    setViewport,
  } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      if (viewport.current) saveBoardViewport(project.id, viewport.current);
    },
    [project.id],
  );
  useEffect(() => {
    if (context)
      contextRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [context]);
  useEffect(() => {
    if (connectFrom) connectionTarget.current?.focus();
  }, [connectFrom]);
  function openContext(
    event: { preventDefault: () => void; clientX: number; clientY: number },
    cardId?: string,
  ) {
    event.preventDefault();
    const bounds = wrapper.current!.getBoundingClientRect();
    const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (cardId) onSelect(cardId);
    setContext({
      x: Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 230)),
      y: Math.max(8, Math.min(event.clientY - bounds.top, bounds.height - 160)),
      flowX: p.x,
      flowY: p.y,
      cardId,
    });
  }
  function beginConnection(id: string) {
    setConnectFrom(id);
    setConnectTo("");
    setContext(undefined);
  }
  useEffect(() => {
    setNodes((currentNodes) => {
      const existingNodes = new Map(
        currentNodes.map((node) => [node.id, node]),
      );
      const nextNodes: Node[] = [
        ...(project.groups || []).flatMap((group) => {
          const cards = project.cards.filter((c) =>
            group.cardIds.includes(c.id),
          );
          if (!cards.length) return [];
          const x = Math.min(...cards.map((c) => c.x)) - 30,
            y = Math.min(...cards.map((c) => c.y)) - 65;
          return [
            {
              id: `area-${group.id}`,
              type: "area",
              position: { x, y },
              data: { title: group.title },
              draggable: false,
              selectable: false,
              connectable: false,
              zIndex: -1,
              style: {
                width: Math.max(...cards.map((c) => c.x)) - x + 310,
                height: Math.max(...cards.map((c) => c.y)) - y + 260,
                background: "#b8ff5a06",
                border: `1px dashed ${group.color}`,
                borderRadius: 12,
                pointerEvents: "none" as const,
              },
            },
          ];
        }),
        ...project.cards.map((card) => ({
          id: card.id,
          type: "research",
          position: { x: card.x, y: card.y },
          data: {
            card,
            onSummarize,
            onOpen,
            presentation: presentations?.[card.id],
          },
          selected: card.id === selectedId,
        })),
      ];
      // Keep React Flow's measurements when research data or selection changes.
      // Replacing unchanged-size nodes without them can leave the board hidden
      // while a ResizeObserver has no new size change to report.
      return nextNodes.map((node) => {
        const existing = existingNodes.get(node.id);
        return existing?.type === node.type ? { ...existing, ...node } : node;
      });
    });
  }, [
    project.cards,
    project.groups,
    selectedId,
    setNodes,
    onSummarize,
    onOpen,
    presentations,
  ]);
  useEffect(() => {
    if (!focusId) return;
    const focusToken = `${focusId}:${focusKey}`;
    if (lastFocused.get(project.id) === focusToken) return;
    const card = project.cards.find((c) => c.id === focusId);
    if (card) {
      lastFocused.set(project.id, focusToken);
      void setCenter(card.x + 140, card.y + 105, { zoom: 1, duration });
    }
  }, [focusId, focusKey]);
  const edges: Edge[] = useMemo(
    () =>
      project.connections.map((c) => ({
        id: c.id,
        source: c.source,
        target: c.target,
        label: c.relation,
        type: "default",
        className: `connection-${c.relation.replaceAll(" ", "-")}`,
        style: { stroke: relationColors[c.relation], strokeWidth: 1.6 },
        labelStyle: {
          fill: "var(--text)",
          fontSize: 10,
          fontFamily: "var(--font-ui)",
        },
        labelBgStyle: { fill: "var(--panel)", fillOpacity: 0.98 },
        labelBgPadding: [7, 4] as [number, number],
        labelBgBorderRadius: 3,
        markerEnd: {
          type: "arrowclosed" as never,
          color: relationColors[c.relation],
          width: 14,
          height: 14,
        },
      })),
    [project.connections],
  );
  const drop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length)
        onDropFiles(Array.from(e.dataTransfer.files));
    },
    [onDropFiles],
  );
  return (
    <div
      className={`board ${dragOver ? "is-dropping" : ""}`}
      ref={wrapper}
      tabIndex={0}
      onPointerDownCapture={(e) => {
        if (e.button !== 0) return;
        const interactive = (e.target as HTMLElement).closest(
          "input,textarea,select,button,a,[contenteditable=true],[tabindex]",
        );
        if (!interactive || interactive === e.currentTarget)
          e.currentTarget.focus({ preventScroll: true });
      }}
      aria-label="Research board. F fits the board. C connects the selected item. Shift F10 opens board actions."
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (
          target.closest(
            "input, textarea, select, [contenteditable=true], [role=menu], .board-connection-form",
          ) ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey
        )
          return;
        if (e.key === "Escape") {
          setContext(undefined);
          setConnectFrom("");
          return;
        }
        if (e.shiftKey && e.key === "F10") {
          const bounds = wrapper.current!.getBoundingClientRect();
          openContext(
            {
              preventDefault: () => e.preventDefault(),
              clientX: bounds.left + bounds.width / 2,
              clientY: bounds.top + bounds.height / 2,
            },
            selectedId || undefined,
          );
        } else if (e.key.toLowerCase() === "f") {
          e.preventDefault();
          void fitView({ padding: 0.16, duration });
        } else if (e.key.toLowerCase() === "c" && selectedId) {
          e.preventDefault();
          beginConnection(selectedId);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as HTMLElement))
          setDragOver(false);
      }}
      onDrop={drop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => {
          if (n.type === "research") onSelect(n.id);
        }}
        onNodeDoubleClick={(_, node) => {
          const item = presentations?.[node.id];
          if (item?.reference && !item.unavailable) onOpen?.(node.id);
        }}
        onPaneClick={() => {
          onSelect(null);
          setContext(undefined);
        }}
        onNodeContextMenu={(e, n) => {
          if (n.type === "research") openContext(e, n.id);
        }}
        onEdgeClick={(_, e) => {
          const c = project.connections.find((c) => c.id === e.id);
          if (c) onEdge(c);
        }}
        onNodeDragStop={(_, __, moved) =>
          onMove(
            moved.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
          )
        }
        onMove={(_, v) => {
          viewport.current = v;
          setZoom((z) =>
            Math.round(z * 100) === Math.round(v.zoom * 100) ? z : v.zoom,
          );
        }}
        onMoveEnd={(_, v) => {
          viewport.current = v;
          saveBoardViewport(project.id, v);
        }}
        onPaneContextMenu={(e) => openContext(e)}
        defaultViewport={initialViewport}
        fitView={!initialViewport}
        fitViewOptions={{ padding: 0.17, maxZoom: 0.95 }}
        minZoom={0.12}
        maxZoom={2.5}
        deleteKeyCode={null}
        nodesDraggable={!panMode}
        panOnDrag={panMode ? [0, 1, 2] : [1, 2]}
        selectionOnDrag={!panMode}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        connectionRadius={32}
        snapToGrid
        snapGrid={[10, 10]}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.1}
          color="#2d3b22"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            n.type === "area"
              ? "transparent"
              : (n.data.card as ResearchCard).kind === "question"
                ? "#ffb000"
                : (n.data.card as ResearchCard).kind === "hypothesis"
                  ? "#78c8cc"
                  : "#75964d"
          }
          maskColor="rgba(5,8,4,.75)"
          ariaLabel="Research board overview"
        />
      </ReactFlow>
      <div className="board-areas">
        <button
          disabled={!selectedId}
          onClick={() => selectedId && beginConnection(selectedId)}
          title="Connect the selected item (C)"
        >
          <Link2 size={14} /> Connect item
        </button>
        <button onClick={props.onAreas}>Research areas</button>
        <select
          aria-label="Saved board views"
          defaultValue=""
          onChange={(e) => {
            const v = project.views?.find((v) => v.id === e.target.value);
            if (v)
              void setViewport({ x: v.x, y: v.y, zoom: v.zoom }, { duration });
            e.target.value = "";
          }}
        >
          <option value="">Saved views</option>
          {project.views?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            props.onSaveView({
              id: crypto.randomUUID(),
              title: `View ${(project.views?.length || 0) + 1}`,
              ...getViewport(),
            })
          }
        >
          Save this view
        </button>
      </div>
      <div className="board-label">
        <span className="pulse-dot" /> LIVE RESEARCH MAP{" "}
        <span>
          / {project.cards.length.toString().padStart(2, "0")} OBJECTS
        </span>
      </div>
      <div className="board-hint">
        {panMode
          ? "Drag the board to explore"
          : "Drag cards · connect side handles · pinch to zoom"}
      </div>
      <div className="canvas-controls">
        <button
          className={`icon-button ${panMode ? "active" : ""}`}
          onClick={() => setPanMode(!panMode)}
          title="Toggle pan mode"
          aria-label="Toggle pan mode"
        >
          <Hand size={18} />
        </button>
        <span className="tool-divider" />
        <button
          className="icon-button"
          onClick={() => zoomOut({ duration })}
          aria-label="Zoom out"
        >
          <Minus size={17} />
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          className="icon-button"
          onClick={() => zoomIn({ duration })}
          aria-label="Zoom in"
        >
          <Plus size={17} />
        </button>
        <span className="tool-divider" />
        <button
          className="icon-button"
          onClick={() => fitView({ padding: 0.16, duration })}
          aria-label="Fit research board"
        >
          <Scan size={18} />
        </button>
        <button
          className="icon-button"
          onClick={() => window.acadia!.fullscreen()}
          aria-label="Toggle fullscreen"
        >
          <Maximize size={17} />
        </button>
      </div>
      {context && (
        <>
          <button
            className="board-context-dismiss"
            aria-label="Close board actions"
            onClick={() => {
              setContext(undefined);
              wrapper.current?.focus();
            }}
          />
          <div
            className="board-context-menu"
            ref={contextRef}
            role="menu"
            aria-label="Board actions"
            style={{ left: context.x, top: context.y }}
            onKeyDown={(e) => {
              const items = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
              );
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (e.key === "Escape" || e.key === "Tab") {
                setContext(undefined);
                if (e.key === "Escape") {
                  e.preventDefault();
                  wrapper.current?.focus();
                }
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : (index +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length;
                items[next]?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                onAdd(context.flowX, context.flowY);
                setContext(undefined);
              }}
            >
              Add item here
            </button>
            {context.cardId && (
              <button
                role="menuitem"
                onClick={() => beginConnection(context.cardId!)}
              >
                Connect this item…
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                void fitView({ padding: 0.16, duration });
                setContext(undefined);
              }}
            >
              Fit board
            </button>
            <button
              role="menuitem"
              onClick={() => {
                props.onAreas();
                setContext(undefined);
              }}
            >
              Research areas
            </button>
          </div>
        </>
      )}
      {connectFrom && (
        <form
          className="board-connection-form"
          aria-label="Connect board items"
          onSubmit={(e) => {
            e.preventDefault();
            if (!connectTo) return;
            onConnect({
              source: connectFrom,
              target: connectTo,
              sourceHandle: null,
              targetHandle: null,
            });
            setConnectFrom("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setConnectFrom("");
              wrapper.current?.focus();
            }
          }}
        >
          <div>
            <strong>Connect item</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Cancel connection"
              onClick={() => {
                setConnectFrom("");
                wrapper.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          <p>{project.cards.find((c) => c.id === connectFrom)?.title}</p>
          <label>
            Connect to
            <select
              ref={connectionTarget}
              aria-label="Connect to"
              required
              value={connectTo}
              onChange={(e) => setConnectTo(e.target.value)}
            >
              <option value="">Choose a board item</option>
              {project.cards
                .filter((c) => c.id !== connectFrom)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
          </label>
          <button className="button primary" disabled={!connectTo}>
            Connect items
          </button>
        </form>
      )}
      {project.cards.length === 0 && (
        <div className="board-empty">
          <div className="empty-orbit">
            <Link2 size={28} />
          </div>
          <p className="eyebrow">EVERY CONNECTION STARTS SOMEWHERE</p>
          <h2>Give your curiosity a place.</h2>
          <p>
            Add an idea, drop in a document, or paste a link.
            <br />
            Connect the pieces as your research takes shape.
          </p>
          <button className="button primary" onClick={() => onAdd()}>
            <Plus size={16} /> Add your first item
          </button>
        </div>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <Plus size={36} />
          <strong>Drop into the Collector</strong>
          <span>Documents, images, audio, and video</span>
        </div>
      )}
    </div>
  );
}
export default function Collector(props: Props) {
  return (
    <ReactFlowProvider key={props.project.id}>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
