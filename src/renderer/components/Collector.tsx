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
import ResearchNode, { type BoardNode } from "./ResearchNode";
const nodeTypes = {
  research: ResearchNode,
  area: ({ data }: { data: { title: string } }) => (
    <div className="board-area-label">{data.title}</div>
  ),
};
const relationColors: Record<string, string> = {
  supports: "#b8ff5a",
  contradicts: "#ff8570",
  "derived from": "#78c8cc",
  investigate: "#ffb000",
  "relates to": "#6f8559",
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
    focusId,
    focusKey,
  } = props;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [panMode, setPanMode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [zoom, setZoom] = useState(1);
  const {
    fitView,
    zoomIn,
    zoomOut,
    setCenter,
    screenToFlowPosition,
    getViewport,
    setViewport,
  } = useReactFlow();
  const activeProject = useRef(project.id);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setNodes([
      ...(project.groups || []).flatMap((group) => {
        const cards = project.cards.filter((c) => group.cardIds.includes(c.id));
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
        data: { card },
        selected: card.id === selectedId,
      })),
    ]);
  }, [project.cards, project.groups, selectedId, setNodes]);
  useEffect(() => {
    if (activeProject.current !== project.id) {
      activeProject.current = project.id;
      requestAnimationFrame(() => fitView({ padding: 0.18, duration: 300 }));
    }
  }, [project.id, fitView]);
  useEffect(() => {
    if (!focusId) return;
    const card = project.cards.find((c) => c.id === focusId);
    if (card) setCenter(card.x + 140, card.y + 105, { zoom: 1, duration: 350 });
  }, [focusId, focusKey]);
  const edges: Edge[] = useMemo(
    () =>
      project.connections.map((c) => ({
        id: c.id,
        source: c.source,
        target: c.target,
        label: c.relation,
        type: "default",
        style: { stroke: relationColors[c.relation], strokeWidth: 1.6 },
        labelStyle: {
          fill: relationColors[c.relation],
          fontSize: 10,
          fontFamily: "monospace",
        },
        labelBgStyle: { fill: "#0c1209", fillOpacity: 0.95 },
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
        onPaneClick={() => onSelect(null)}
        onEdgeClick={(_, e) => {
          const c = project.connections.find((c) => c.id === e.id);
          if (c) onEdge(c);
        }}
        onNodeDragStop={(_, __, moved) =>
          onMove(
            moved.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
          )
        }
        onMove={(_, v) => setZoom(v.zoom)}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
          onAdd(p.x, p.y);
        }}
        fitView
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
        <button onClick={props.onAreas}>Research areas</button>
        <select
          aria-label="Saved board views"
          defaultValue=""
          onChange={(e) => {
            const v = project.views?.find((v) => v.id === e.target.value);
            if (v)
              void setViewport(
                { x: v.x, y: v.y, zoom: v.zoom },
                { duration: 300 },
              );
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
          onClick={() => zoomOut()}
          aria-label="Zoom out"
        >
          <Minus size={17} />
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          className="icon-button"
          onClick={() => zoomIn()}
          aria-label="Zoom in"
        >
          <Plus size={17} />
        </button>
        <span className="tool-divider" />
        <button
          className="icon-button"
          onClick={() => fitView({ padding: 0.16, duration: 350 })}
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
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
