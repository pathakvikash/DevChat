"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Plus, Trash2, Wrench, XCircle } from "lucide-react";
import ModelSelector from "@/app/components/conversation/ModelSelector";
import WorkingFolderPicker from "@/app/components/conversation/WorkingFolderPicker";
import type { ModelInfo } from "@/app/components/conversation/types";
import { AGENT_TOOL_CHOICES, hasToolConflict, isCliModelId, isCodexModelId, MCP_WARNING, MCP_WEB_WARNING, OUTPUT_FIELD_TYPES, type FieldSpec, type OutputField } from "@/lib/workflows/catalog";
import { FILTER_OP_LABELS, FILTER_OPS, type FilterOp, type FilterRule } from "@/lib/workflows/filterRules";
import FieldPicker, { typedBraces, type PickerRow } from "./FieldPicker";

const NEW_TABLE = "__new__";

export const NEEDS_TOOLS = "Needs a model that can use tools. Pick one with the wrench icon.";

export interface FieldEnv {
  rows: PickerRow[];
  /** "Preview: …" text for a template, or null for "Run once to see a preview". */
  preview: (template: string) => string | null;
  models: ModelInfo[];
  defaultModel: string;
  chats: { id: string; title: string }[];
  tables: { id: string; name: string }[];
  /** Makes a table with this name and returns its id, or null when it could not be made. */
  createTable: (name: string) => Promise<string | null>;
  readOnly: boolean;
  /** Why it is read-only: a narrow screen, or a past run's snapshot. */
  readOnlyReason?: "narrow" | "past";
  /** Some card before this one reaches the open web (for the MCP warning). */
  upstreamWeb?: boolean;
}

const inputClass = "focus-ring glass-input w-full rounded-[var(--glass-radius-md)] px-3 py-2 text-sm disabled:opacity-60";

function TemplateField({ spec, value, onChange, error, env, id }: { spec: FieldSpec; value: string; onChange: (v: string) => void; error?: string; env: FieldEnv; id: string }) {
  const [picking, setPicking] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  // Typing `{{` opens the picker; picking then replaces those two characters.
  const braces = useRef(false);
  const preview = value.includes("{{") ? env.preview(value) : null;
  // `{{item}}` is an error in a list field (it is where the items come from), so the picker does not offer it there.
  const listRows = spec.key === "list" || spec.key === "items" ? env.rows.filter((r) => r.group !== "This item") : env.rows;
  const insertButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    braces.current = false;
    setPicking(false);
  };
  // A click outside the picker closes it (the Insert field button toggles it itself).
  useEffect(() => {
    if (!picking) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!(t as Element).closest?.('[role="dialog"][aria-label="Insert field"]') && !insertButton.current?.contains(t)) close();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [picking]);

  function insert(path: string) {
    const at = caret.current ?? value.length;
    // Only swallow the `{{` that opened the picker if it is still right before the caret.
    const from = braces.current && at >= 2 && value.slice(at - 2, at) === "{{" ? at - 2 : at;
    onChange(`${value.slice(0, from)}{{${path}}}${value.slice(at)}`);
    braces.current = false;
    setPicking(false);
    requestAnimationFrame(() => area.current?.focus());
  }

  return (
    <div className="relative">
      <textarea
        id={id}
        ref={area}
        value={value}
        rows={spec.rows ?? 3}
        disabled={env.readOnly}
        onChange={(e) => {
          onChange(e.target.value);
          caret.current = e.target.selectionStart;
          if (String((e.nativeEvent as InputEvent).inputType).startsWith("insert") && typedBraces(e.target.value, e.target.selectionStart)) {
            braces.current = true;
            setPicking(true);
          }
        }}
        onSelect={(e) => (caret.current = e.currentTarget.selectionStart)}
        onBlur={(e) => (caret.current = e.currentTarget.selectionStart)}
        aria-invalid={!!error || undefined}
        className={`${inputClass} resize-y`}
      />
      {!env.readOnly && (
        <button type="button" ref={insertButton} onClick={() => {
          braces.current = false;
          setPicking((p) => !p);
        }} className="focus-ring glass-button mt-1 h-7 rounded-[var(--glass-radius-sm)] px-2 text-xs">
          Insert field
        </button>
      )}
      {picking && (
        <FieldPicker
          rows={listRows}
          onPick={insert}
          onClose={() => {
            close();
            requestAnimationFrame(() => area.current?.focus());
          }}
        />
      )}
      {value.includes("{{") && (
        <p className="mt-1 text-[11px] text-zinc-400">{preview === null ? "Run once to see a preview" : `Preview: ${preview}`}</p>
      )}
    </div>
  );
}

/** A one-line template box with its own Insert field button, for a value inside a list (a rule, a column). */
function InlineTemplate({ label, placeholder, value, onChange, env, mono }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; env: FieldEnv; mono?: boolean }) {
  const [picking, setPicking] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const insertButton = useRef<HTMLButtonElement>(null);
  const caret = useRef<number | null>(null);
  // Typing `{{` opens the picker; picking then replaces those two characters.
  const braces = useRef(false);
  const close = () => {
    braces.current = false;
    setPicking(false);
  };
  useEffect(() => {
    if (!picking) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!(t as Element).closest?.('[role="dialog"][aria-label="Insert field"]') && !insertButton.current?.contains(t)) close();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [picking]);
  function insert(path: string) {
    const at = caret.current ?? value.length;
    const from = braces.current && at >= 2 && value.slice(at - 2, at) === "{{" ? at - 2 : at;
    onChange(`${value.slice(0, from)}{{${path}}}${value.slice(at)}`);
    close();
    requestAnimationFrame(() => box.current?.focus());
  }
  return (
    <div className="relative flex gap-1.5">
      <input
        ref={box}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        disabled={env.readOnly}
        onChange={(e) => {
          onChange(e.target.value);
          caret.current = e.target.selectionStart;
          if (String((e.nativeEvent as InputEvent).inputType).startsWith("insert") && typedBraces(e.target.value, e.target.selectionStart)) {
            braces.current = true;
            setPicking(true);
          }
        }}
        onSelect={(e) => (caret.current = e.currentTarget.selectionStart)}
        onBlur={(e) => (caret.current = e.currentTarget.selectionStart)}
        className={`${inputClass} min-w-0 flex-1 !px-2 !py-1 ${mono ? "font-mono" : ""}`}
      />
      {!env.readOnly && (
        <button type="button" ref={insertButton} aria-label={`Insert field into ${label.toLowerCase()}`} onClick={() => { braces.current = false; setPicking((x) => !x); }} className="focus-ring glass-button h-8 shrink-0 rounded-[var(--glass-radius-sm)] px-2 text-xs">
          Insert field
        </button>
      )}
      {picking && <FieldPicker rows={env.rows} onPick={insert} onClose={() => { close(); requestAnimationFrame(() => box.current?.focus()); }} />}
    </div>
  );
}

function OutputFields({ value, onChange, readOnly }: { value: OutputField[]; onChange: (v: OutputField[]) => void; readOnly: boolean }) {
  const set = (i: number, patch: Partial<OutputField>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-2">
      {value.map((f, i) => (
        <div key={i} className="glass-card space-y-1.5 rounded-[var(--glass-radius-md)] p-2">
          <div className="flex gap-1.5">
            <input aria-label="Field name" placeholder="name" value={f.name} disabled={readOnly} onChange={(e) => set(i, { name: e.target.value })} className={`${inputClass} !px-2 !py-1 font-mono`} />
            <select aria-label="Field type" value={f.type} disabled={readOnly} onChange={(e) => set(i, { type: e.target.value as OutputField["type"] })} className={`${inputClass} !w-28 !px-2 !py-1`}>
              {OUTPUT_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {!readOnly && (
              <button type="button" aria-label={`Remove field ${f.name || i + 1}`} title="Remove field" onClick={() => onChange(value.filter((_, j) => j !== i))} className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-400 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]">
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {f.type === "choice" && (
            <input aria-label="Options, comma separated" placeholder="options, comma separated" value={(f.options ?? []).join(", ")} disabled={readOnly} onChange={(e) => set(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} className={`${inputClass} !px-2 !py-1`} />
          )}
          <input aria-label="Field description" placeholder="description" value={f.description} disabled={readOnly} onChange={(e) => set(i, { description: e.target.value })} className={`${inputClass} !px-2 !py-1`} />
        </div>
      ))}
      {!readOnly && (
        <button type="button" onClick={() => onChange([...value, { name: "", type: "text", description: "" }])} className="focus-ring glass-button inline-flex h-8 items-center gap-1 rounded-[var(--glass-radius-md)] px-3 text-sm">
          <Plus size={14} /> Add field
        </button>
      )}
    </div>
  );
}

interface McpServerRow {
  id: string;
  name: string;
  enabled: boolean;
}
type McpToolRow = { id: string; server: string; tool: string };

/** The user's MCP servers (and, when asked, each enabled server's tools as `mcp_<server>_<tool>` ids). */
function useMcp(withTools: boolean) {
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [tools, setTools] = useState<McpToolRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await fetch("/api/mcp/servers");
        if (!res.ok) throw new Error("servers");
        const list = (await res.json()) as McpServerRow[];
        if (stop) return;
        setServers(list);
        if (withTools) {
          const found = await Promise.all(
            list
              .filter((s) => s.enabled)
              .map(async (s) => {
                const r = await fetch(`/api/mcp/servers/${s.id}/tools`).catch(() => null);
                const body = r?.ok ? ((await r.json()) as { tools?: { name: string }[] }) : { tools: [] };
                return (body.tools ?? []).map((t) => ({ id: `mcp_${s.name}_${t.name}`, server: s.name, tool: t.name }));
              }),
          );
          if (!stop) setTools(found.flat());
        }
        if (!stop) setState("ready");
      } catch {
        if (!stop) setState("error");
      }
    })();
    return () => {
      stop = true;
    };
  }, [withTools]);
  return { servers, tools, state };
}

function McpServerSelect({ id, value, onChange, readOnly }: { id: string; value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const { servers, state } = useMcp(false);
  return (
    <select id={id} value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">{state === "loading" ? "Loading…" : state === "error" ? "Couldn't load servers" : "Pick a server…"}</option>
      {servers.filter((s) => s.enabled || s.id === value).map((s) => (
        <option key={s.id} value={s.id}>{s.name}{s.enabled ? "" : " (off)"}</option>
      ))}
      {value && state === "ready" && !servers.some((s) => s.id === value) && <option value={value}>Unknown server</option>}
      {value && state !== "ready" && <option value={value}>{state === "loading" ? "Loading…" : "Saved server"}</option>}
    </select>
  );
}

/** The tools of one server, from the tools route. The saved name always stays in the list. */
function McpToolSelect({ id, serverId, value, onChange, readOnly }: { id: string; serverId: string; value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const [loaded, setLoaded] = useState<{ serverId: string; names: string[] | null } | null>(null);
  useEffect(() => {
    if (!serverId) return;
    let stop = false;
    fetch(`/api/mcp/servers/${serverId}/tools`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("tools"))))
      .then((b: { tools?: { name: string }[] }) => !stop && setLoaded({ serverId, names: (b.tools ?? []).map((t) => t.name) }))
      .catch(() => !stop && setLoaded({ serverId, names: null }));
    return () => {
      stop = true;
    };
  }, [serverId]);
  const mine = loaded?.serverId === serverId ? loaded : null;
  const status = !serverId ? "Pick a server first" : !mine ? "Loading…" : mine.names === null ? "Couldn't load tools" : "Pick a tool…";
  return (
    <select id={id} value={value} disabled={readOnly || !serverId} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">{status}</option>
      {(mine?.names ?? []).map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
      {value && !(mine?.names ?? []).includes(value) && <option value={value}>{value}</option>}
    </select>
  );
}

function McpToolChoices({ labelledBy, value, other, folder, onChange, readOnly, disabled, upstreamWeb }: { labelledBy: string; value: string[]; other: string[]; folder: boolean; onChange: (v: string[]) => void; readOnly: boolean; disabled: boolean; upstreamWeb: boolean }) {
  const { tools, state } = useMcp(true);
  const known = new Set(tools.map((t) => t.id));
  const rows = [...tools, ...value.filter((v) => !known.has(v)).map((id) => ({ id, server: "", tool: `${id} (not available now)` }))];
  const webOn = other.includes("fetchUrl") || other.includes("webSearch");
  return (
    <div role="group" aria-labelledby={labelledBy} className="space-y-1">
      <p className="text-[11px] text-zinc-400">{MCP_WARNING}</p>
      {value.length > 0 && upstreamWeb && (
        <p className="flex items-start gap-1.5 text-[11px] text-zinc-300">
          <AlertTriangle size={12} className="mt-px shrink-0 text-amber-400" aria-hidden="true" />
          <span>
            <span className="font-medium">Warning:</span> {MCP_WEB_WARNING}
          </span>
        </p>
      )}
      {(webOn || folder) && value.length === 0 && <p className="text-[11px] text-zinc-400">MCP tools can&apos;t be mixed with web tools or a working folder on one card, so a web page can&apos;t make it send your data out.</p>}
      {state === "loading" && <p className="text-[11px] text-zinc-400">Loading tools…</p>}
      {state === "error" && <p className="text-[11px] text-zinc-300">Couldn&apos;t load your MCP servers.</p>}
      {state === "ready" && rows.length === 0 && <p className="text-[11px] text-zinc-400">No MCP tools. Turn on a server in Settings first.</p>}
      {rows.map((t) => (
        <label key={t.id} className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={value.includes(t.id)}
            disabled={readOnly || disabled || (!value.includes(t.id) && (hasToolConflict(other, [...value, t.id]) || webOn || folder))}
            onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((x) => x !== t.id))}
            className="h-4 w-4"
          />
          <Wrench size={12} className="text-zinc-500" aria-hidden="true" />
          <span className="min-w-0 truncate">{t.server ? `${t.server}: ${t.tool}` : t.tool}</span>
        </label>
      ))}
    </div>
  );
}

/** Rows of name and value. Controlled by the card's saved args, so it needs `key={card id}` above it to reset on another card. */
function ArgsField({ labelledBy, value, onChange, readOnly }: { labelledBy: string; value: Record<string, string>; onChange: (v: Record<string, string>) => void; readOnly: boolean }) {
  // Rows keep their order and half-typed names while editing; the card only gets a valid object.
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value));
  const keys = rows.map(([k]) => k.trim()).filter(Boolean);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  const save = (next: [string, string][]) => {
    setRows(next);
    const names = next.map(([k]) => k.trim()).filter(Boolean);
    if (new Set(names).size === names.length) onChange(Object.fromEntries(next.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])));
  };
  return (
    <div role="group" aria-labelledby={labelledBy} className="space-y-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-1.5">
          <input aria-label="Argument name" placeholder="name" value={k} disabled={readOnly} onChange={(e) => save(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} className={`${inputClass} !w-28 !px-2 !py-1 font-mono`} />
          <input aria-label="Argument value" placeholder="value" value={v} disabled={readOnly} onChange={(e) => save(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} className={`${inputClass} !px-2 !py-1`} />
          {!readOnly && (
            <button type="button" aria-label={`Remove argument ${k || i + 1}`} onClick={() => save(rows.filter((_, j) => j !== i))} className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-400 hover:bg-[var(--glass-bg-hover)]">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {dup && (
        <p role="alert" className="text-xs text-zinc-300">
          Two arguments are called &quot;{dup}&quot;. Rename one; nothing is saved until the names differ.
        </p>
      )}
      {!readOnly && (
        <button type="button" onClick={() => setRows([...rows, ["", ""]])} className="focus-ring glass-button inline-flex h-8 items-center gap-1 rounded-[var(--glass-radius-md)] px-3 text-sm">
          <Plus size={14} /> Add argument
        </button>
      )}
    </div>
  );
}

/** Rows of two text boxes (and for rules a choice between): the shared shape of the Filter rules and Save to table columns. */
function RowsEditor<T extends object>({ rows, onChange, blank, readOnly, addLabel, render }: { rows: T[]; onChange: (v: T[]) => void; blank: T; readOnly: boolean; addLabel: string; render: (row: T, set: (patch: Partial<T>) => void) => React.ReactNode }) {
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="glass-card space-y-1.5 rounded-[var(--glass-radius-md)] p-2">
          {render(row, (patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))))}
          {!readOnly && (
            <button type="button" aria-label={`Remove row ${i + 1}`} title="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="focus-ring inline-flex h-8 items-center gap-1 rounded-[var(--glass-radius-sm)] px-2 text-xs text-zinc-400 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]">
              <Trash2 size={12} aria-hidden="true" /> Remove
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" onClick={() => onChange([...rows, blank])} className="focus-ring glass-button inline-flex h-8 items-center gap-1 rounded-[var(--glass-radius-md)] px-3 text-sm">
          <Plus size={14} aria-hidden="true" /> {addLabel}
        </button>
      )}
    </div>
  );
}

/** One settings field of a card, built from the catalog's field spec. */
export default function ConfigField({ spec, config, onChange, error, env }: { spec: FieldSpec; config: Record<string, unknown>; onChange: (key: string, value: unknown) => void; error?: string; env: FieldEnv }) {
  const id = useId();
  const value = config[spec.key];
  const set = (v: unknown) => onChange(spec.key, v);
  const cardModel = String(config.model || env.defaultModel);
  const modelHasTools = env.models.find((m) => m.id === cardModel)?.supportsTools !== false;
  const webOn = ((config.tools as string[]) ?? []).some((t) => t === "fetchUrl" || t === "webSearch");
  const mcpOn = ((config.mcpTools as string[]) ?? []).length > 0;
  const folderOn = !!config.folder && isCliModelId(cardModel);
  // A folder and edits only mean something to a command-line model.
  if ((spec.kind === "folder" || spec.kind === "allowEdits") && !isCliModelId(cardModel)) return null;

  let control: React.ReactNode;
  switch (spec.kind) {
    case "template":
      control = <TemplateField id={id} spec={spec} value={String(value ?? "")} onChange={set} error={error} env={env} />;
      break;
    case "text":
    case "number":
      control = <input id={id} type={spec.kind === "number" ? "number" : "text"} value={String(value ?? "")} disabled={env.readOnly} onChange={(e) => set(spec.kind === "number" ? Number(e.target.value) : e.target.value)} className={inputClass} />;
      break;
    case "textarea":
      control = <textarea id={id} rows={spec.rows ?? 3} value={String(value ?? "")} disabled={env.readOnly} onChange={(e) => set(e.target.value)} className={`${inputClass} resize-y`} />;
      break;
    case "select":
      control = (
        <select id={id} value={String(value ?? "")} disabled={env.readOnly} onChange={(e) => set(e.target.value)} className={inputClass}>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
      break;
    case "perItem":
      control = (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={value === true} disabled={env.readOnly} onChange={(e) => set(e.target.checked)} className="h-4 w-4" />
          Run once per item
        </label>
      );
      break;
    case "model":
      control = (
        <div className="flex items-center gap-2">
          <ModelSelector currentModel={String(value || env.defaultModel)} onModelChange={set} disabled={env.readOnly} size="sm" exclude={(m) => isCodexModelId(m.id)} />
          {!!value && !env.readOnly && (
            <button type="button" onClick={() => set("")} className="focus-ring glass-button h-7 rounded-[var(--glass-radius-sm)] px-2 text-xs">
              Use default
            </button>
          )}
        </div>
      );
      break;
    case "tools": {
      const chosen = new Set((value as string[]) ?? []);
      control = (
        <div role="group" aria-label="Tools" aria-disabled={!modelHasTools || undefined} className={`space-y-1 ${modelHasTools ? "" : "opacity-60"}`}>
          {!modelHasTools && <p className="text-[11px] text-zinc-400">{NEEDS_TOOLS}</p>}
          {(chosen.has("searchChats") || chosen.has("readChat") || chosen.has("fetchUrl") || chosen.has("webSearch")) && <p className="text-[11px] text-zinc-400">Chat-reading tools and web tools can&apos;t be on the same card, so a web page can&apos;t make it send your chats out.</p>}
          {(mcpOn || folderOn) && <p className="text-[11px] text-zinc-400">Web tools are off while this card has MCP tools or a working folder, so a web page can&apos;t make it send your data out.</p>}
          {AGENT_TOOL_CHOICES.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={chosen.has(t.id)}
                disabled={env.readOnly || !modelHasTools || (!chosen.has(t.id) && (hasToolConflict([...chosen, t.id], config.mcpTools) || ((t.id === "fetchUrl" || t.id === "webSearch") && (mcpOn || folderOn))))}
                onChange={(e) => set(e.target.checked ? [...chosen, t.id] : [...chosen].filter((x) => x !== t.id))}
                className="h-4 w-4"
              />
              <Wrench size={12} className="text-zinc-500" aria-hidden="true" />
              {t.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    case "mcpTools":
      control = <McpToolChoices labelledBy={`${id}-l`} value={(value as string[]) ?? []} other={(config.tools as string[]) ?? []} folder={folderOn} onChange={set} readOnly={env.readOnly} disabled={!modelHasTools} upstreamWeb={!!env.upstreamWeb} />;
      break;
    case "mcpServer":
      control = <McpServerSelect id={id} value={String(value ?? "")} onChange={set} readOnly={env.readOnly} />;
      break;
    case "mcpToolName":
      control = <McpToolSelect id={id} serverId={String(config.serverId ?? "")} value={String(value ?? "")} onChange={set} readOnly={env.readOnly} />;
      break;
    case "args":
      control = <ArgsField labelledBy={`${id}-l`} value={(value as Record<string, string>) ?? {}} onChange={set} readOnly={env.readOnly} />;
      break;
    case "folder":
      control = (
        <div className="space-y-1">
          <WorkingFolderPicker
            label={spec.label}
            hint={!value && (webOn || mcpOn) ? "Turn off the web tools and MCP tools on this card to pick a folder" : "The folder this command-line model can read in this card. Its own web tools are off in workflows."}
            value={String(value ?? "") || null}
            onChange={(f) => set(f ?? "")}
            disabled={env.readOnly || (!value && (webOn || mcpOn))}
          />
          {!value && (webOn || mcpOn) && <p className="text-[11px] text-zinc-400">A folder can&apos;t be mixed with web tools or MCP tools on one card, so a web page can&apos;t make it send your files out.</p>}
        </div>
      );
      break;
    case "allowEdits":
      control = (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={value === true} disabled={env.readOnly || !config.folder} onChange={(e) => set(e.target.checked)} className="h-4 w-4" />
          Allow edits in the folder
        </label>
      );
      break;
    case "outputFields":
      control = <OutputFields value={(value as OutputField[]) ?? []} onChange={set} readOnly={env.readOnly} />;
      break;
    case "toggle":
      control = (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={value !== false} disabled={env.readOnly} onChange={(e) => set(e.target.checked)} className="h-4 w-4" />
          {spec.label}
        </label>
      );
      break;
    case "table":
      control = (
        <select
          id={id}
          value={String(value ?? "")}
          disabled={env.readOnly}
          onChange={async (e) => {
            if (e.target.value !== NEW_TABLE) return set(e.target.value);
            const name = window.prompt("Name for the new table");
            if (!name?.trim()) return;
            const made = await env.createTable(name.trim());
            if (made) set(made);
          }}
          className={inputClass}
        >
          <option value="">Pick a table…</option>
          {!!value && !env.tables.some((t) => t.id === value) && <option value={String(value)}>Table not found</option>}
          {env.tables.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
          {!env.readOnly && <option value={NEW_TABLE}>New table…</option>}
        </select>
      );
      break;
    case "rules":
      control = (
        <RowsEditor<FilterRule>
          rows={(value as FilterRule[]) ?? []}
          onChange={set}
          blank={{ field: "", op: "eq", value: "" }}
          readOnly={env.readOnly}
          addLabel="Add rule"
          render={(r, patch) => (
            <>
              <InlineTemplate label="Rule field" placeholder="{{item.score}}" value={r.field} onChange={(v) => patch({ field: v })} env={env} mono />
              <select aria-label="Rule test" value={r.op} disabled={env.readOnly} onChange={(e) => patch({ op: e.target.value as FilterOp })} className={`${inputClass} !px-2 !py-1`}>
                {FILTER_OPS.map((o) => (
                  <option key={o} value={o}>{FILTER_OP_LABELS[o]}</option>
                ))}
              </select>
              {r.op !== "empty" && r.op !== "notEmpty" && (
                <InlineTemplate label="Rule value" placeholder="value" value={r.value} onChange={(v) => patch({ value: v })} env={env} />
              )}
            </>
          )}
        />
      );
      break;
    case "columnMap":
      control = (
        <RowsEditor<{ column: string; value: string }>
          rows={(value as { column: string; value: string }[]) ?? []}
          onChange={set}
          blank={{ column: "", value: "" }}
          readOnly={env.readOnly}
          addLabel="Add column"
          render={(r, patch) => (
            <>
              <input aria-label="Column name" placeholder="column" value={r.column} disabled={env.readOnly} onChange={(e) => patch({ column: e.target.value })} className={`${inputClass} !px-2 !py-1`} />
              <InlineTemplate label="Column value" placeholder="{{item.title}}" value={r.value} onChange={(v) => patch({ value: v })} env={env} mono />
            </>
          )}
        />
      );
      break;
    case "chat":
      control = (
        <select id={id} value={String(value || "new")} disabled={env.readOnly} onChange={(e) => set(e.target.value)} className={inputClass}>
          <option value="new">A new chat each run</option>
          {env.chats.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      );
      break;
  }

  const labelled = spec.kind !== "perItem" && spec.kind !== "allowEdits" && spec.kind !== "toggle";
  // Groups name themselves from this text; a <label for> needs one control to point at.
  const grouped = spec.kind === "mcpTools" || spec.kind === "args" || spec.kind === "folder";
  return (
    <div className="space-y-1">
      {labelled &&
        (grouped ? (
          <span id={`${id}-l`} className="block text-xs font-medium text-zinc-300">
            {spec.label}
          </span>
        ) : (
          <label htmlFor={id} className="block text-xs font-medium text-zinc-300">
            {spec.label}
          </label>
        ))}
      {control}
      {spec.help && <p className="text-[11px] text-zinc-400">{spec.help}</p>}
      {error && (
        <p className="flex items-start gap-1.5 text-xs text-zinc-300">
          <XCircle size={14} className="mt-px shrink-0 text-red-400" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
