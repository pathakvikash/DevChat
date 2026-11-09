"use client";

import "@xyflow/react/dist/base.css";
import "./canvas.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type OnConnectEnd,
} from "@xyflow/react";
import { LayoutGrid, Plus } from "lucide-react";
import { useToast } from "@/app/components/Toast";
import { CATALOG, type CardType } from "@/lib/workflows/catalog";
import { cardStatus, STATUS_META } from "./RunStatus";
import { connectionError, LAYOUT_DX, LAYOUT_DY, MAX_NODES, topoOrder, type CardRun, type RunState, type WorkflowGraph } from "@/lib/workflows/graph";
import AddCardMenu from "./AddCardMenu";
import CardNode, { type CardFlowNode } from "./CardNode";

const nodeTypes = { card: CardNode };
const FIT = { padding: 0.15, maxZoom: 1 };
type Point = { x: number; y: number };
export interface AddOptions {
  /** Connect the new card after this one. Without it, the editor puts it after the last card. */
  fromId?: string;
  position?: Point;
}

export interface CanvasProps {
  graph: WorkflowGraph;
  nodes: Record<string, CardRun>;
  runState?: RunState;
  selectedId: string | null;
  /** Card ids with a problem in their settings. */
  invalid: Set<string>;
  readOnly: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (type: CardType, opts?: AddOptions) => void;
  onMove: (positions: Record<string, Point>) => void;
  onConnect: (from: string, to: string) => void;
  onDisconnect: (from: string, to: string) => void;
  onDelete: (id: string) => void;
  onTidy: () => void;
}

/** A free spot to the right of `from`, stepping down past cards already there. */
function spotRightOf(graph: WorkflowGraph, fromId: string): Point {
  const src = graph.nodes.find((n) => n.id === fromId)?.ui.position ?? { x: 0, y: 0 };
  const taken = (p: Point) => graph.nodes.some((n) => Math.abs(n.ui.position.x - p.x) < LAYOUT_DX / 2 && Math.abs(n.ui.position.y - p.y) < LAYOUT_DY / 2);
  const spot = { x: src.x + LAYOUT_DX, y: src.y };
  while (taken(spot)) spot.y += LAYOUT_DY;
  return spot;
}

function Flow(props: CanvasProps) {
  const { graph, nodes, runState, selectedId, invalid, readOnly, onSelect, onAdd, onMove, onConnect, onDisconnect, onDelete, onTidy } = props;
  const { toast } = useToast();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const root = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [drag, setDrag] = useState<Record<string, Point>>({});
  // React Flow measures each card; a controlled flow has to hand the sizes back or every update un-measures (and hides) its cards.
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [edgeSel, setEdgeSel] = useState<string | null>(null);
  // The catalog popover: from the + button (at the button), or from dropping a connector on empty canvas (at the drop point).
  const [menu, setMenu] = useState<{ fromId?: string; at?: Point & { flow: Point } } | null>(null);
  const canAdd = graph.nodes.length < MAX_NODES;

  const rfNodes = useMemo(() => {
    const order = topoOrder(graph);
    const ordered = [...order, ...graph.nodes.filter((n) => !order.includes(n))];
    return ordered.map(
      (node): CardFlowNode => ({
        id: node.id,
        type: "card",
        position: drag[node.id] ?? node.ui.position,
        measured: sizes[node.id],
        selected: node.id === selectedId,
        draggable: !readOnly,
        connectable: !readOnly,
        deletable: false,
        ariaLabel: `${node.ui.label}, ${CATALOG[node.type].label}, ${STATUS_META[cardStatus(nodes[node.id], runState)].label}`,
        data: { node, card: nodes[node.id], runState, invalid: invalid.has(node.id), readOnly, onOpen: onSelect },
      }),
    );
  }, [graph, nodes, runState, selectedId, invalid, readOnly, drag, sizes, onSelect]);

  const rfEdges = useMemo(
    () =>
      graph.nodes.flatMap((n) =>
        n.fromIds.map(
          (from): Edge => ({
            id: `${from}->${n.id}`,
            source: from,
            target: n.id,
            type: "smoothstep",
            selected: `${from}->${n.id}` === edgeSel,
            animated: runState === "running" && cardStatus(nodes[n.id], runState) === "running",
            deletable: !readOnly,
            ariaLabel: `Connection from ${graph.nodes.find((m) => m.id === from)?.ui.label ?? from} to ${n.ui.label}`,
          }),
        ),
      ),
    [graph, nodes, runState, edgeSel, readOnly],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const done: Record<string, Point> = {};
      const measured: Record<string, { width: number; height: number }> = {};
      for (const c of changes) {
        if (c.type === "dimensions" && c.dimensions) measured[c.id] = c.dimensions;
        else if (c.type === "select" && c.selected) {
          setEdgeSel(null);
          onSelect(c.id);
        } else if (c.type === "position" && c.position && !readOnly) {
          if (c.dragging === false) done[c.id] = c.position;
          else setDrag((d) => ({ ...d, [c.id]: c.position! }));
        }
      }
      if (Object.keys(measured).length > 0) setSizes((z) => ({ ...z, ...measured }));
      if (Object.keys(done).length > 0) {
        setDrag((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !(id in done))));
        onMove(done);
      }
    },
    [onSelect, onMove, readOnly],
  );

  const connect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      const err = connectionError(graph, c.source, c.target);
      if (err) toast(err, "error");
      else onConnect(c.source, c.target);
    },
    [graph, onConnect, toast],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || state.toNode || !state.fromNode || state.fromHandle?.type !== "source" || readOnly) return;
      if (!canAdd) return toast(`A workflow can have at most ${MAX_NODES} cards`, "error");
      const p = "changedTouches" in event ? event.changedTouches[0] : event;
      const box = root.current?.getBoundingClientRect();
      if (!box) return;
      // Keep the popover (18rem wide, about 22rem tall) inside the canvas.
      const x = Math.max(8, Math.min(p.clientX - box.left, box.width - 296));
      const y = Math.max(8, Math.min(p.clientY - box.top, box.height - 360));
      setMenu({ fromId: state.fromNode.id, at: { x, y, flow: screenToFlowPosition({ x: p.clientX, y: p.clientY }) } });
    },
    [canAdd, readOnly, screenToFlowPosition, toast],
  );

  // A new card scrolls into view.
  const refit = useRef(false);
  useEffect(() => {
    if (!refit.current) return;
    refit.current = false;
    requestAnimationFrame(() => void fitView({ ...FIT, duration: 200 }));
  }, [graph.nodes.length, fitView]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    requestAnimationFrame(() => (addButton.current ?? root.current)?.focus());
  }, []);

  function add(type: CardType) {
    refit.current = true;
    if (menu?.at) onAdd(type, { fromId: menu.fromId, position: { x: Math.round(menu.at.flow.x / 20) * 20, y: Math.round(menu.at.flow.y / 20) * 20 } });
    else if (selectedId) onAdd(type, { fromId: selectedId, position: spotRightOf(graph, selectedId) });
    else onAdd(type);
    setMenu(null);
  }

  // After a delete (or a dismissed confirm) the focus goes back to a card, not to the page.
  function remove(id: string) {
    onDelete(id);
    requestAnimationFrame(() => (root.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`) ?? root.current?.querySelector<HTMLElement>(".react-flow__node"))?.focus());
  }

  // Delete or Backspace on a card (or a picked connector) removes it, unless the focus is in a field.
  function onKeyDown(e: React.KeyboardEvent) {
    if (readOnly || (e.key !== "Delete" && e.key !== "Backspace")) return;
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, [contenteditable=true], .react-flow__panel, [role=dialog]")) return;
    e.preventDefault();
    const focused = el.closest(".react-flow__node")?.getAttribute("data-id");
    if (focused) remove(focused);
    else if (edgeSel) {
      const [from, to] = edgeSel.split("->");
      setEdgeSel(null);
      onDisconnect(from, to);
    } else if (selectedId) remove(selectedId);
  }

  return (
    <div ref={root} role="region" aria-label="Workflow canvas" tabIndex={-1} onKeyDown={onKeyDown} className="absolute inset-0 outline-none">
      <ReactFlow
        className="devchat-flow"
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={connect}
        onConnectEnd={onConnectEnd}
        onEdgeClick={(_, e) => {
          root.current?.focus(); // so Delete reaches the canvas
          setEdgeSel(e.id);
          onSelect(null);
        }}
        onPaneClick={() => {
          setEdgeSel(null);
          onSelect(null);
        }}
        selectNodesOnDrag={false}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesFocusable={false}
        deleteKeyCode={null}
        snapToGrid
        snapGrid={[20, 20]}
        fitView
        fitViewOptions={FIT}
        minZoom={0.4}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--glass-border)" />
        <Controls showInteractive={false} fitViewOptions={FIT} />
        {!readOnly && (
          <Panel position="top-left" className="flex gap-2">
            <button
              type="button"
              ref={addButton}
              onClick={() => (!canAdd ? undefined : menu && !menu.at ? closeMenu() : setMenu({}))}
              aria-disabled={!canAdd || undefined}
              title={canAdd ? "Add card" : `A workflow can have at most ${MAX_NODES} cards`}
              aria-haspopup="dialog"
              aria-expanded={!!menu && !menu.at}
              className="focus-ring glass-button inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium aria-disabled:opacity-60"
            >
              <Plus size={14} aria-hidden="true" /> Add card
            </button>
            <button
              type="button"
              onClick={() => {
                onTidy();
                requestAnimationFrame(() => void fitView({ ...FIT, duration: 200 }));
              }}
              title="Lays cards out by run order. Cards run left to right."
              className="focus-ring glass-button inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm"
            >
              <LayoutGrid size={14} aria-hidden="true" /> Tidy up
            </button>
          </Panel>
        )}
      </ReactFlow>
      {menu && (
        <div className="absolute z-50" style={menu.at ? { left: Math.max(8, menu.at.x), top: Math.max(8, menu.at.y) } : { left: 16, top: 56 }}>
          <AddCardMenu onPick={add} onClose={closeMenu} anchor={addButton} />
        </div>
      )}
    </div>
  );
}

/** The canvas (phase 4): cards as nodes, connectors as edges. The list view is its accessible twin. */
export default function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
