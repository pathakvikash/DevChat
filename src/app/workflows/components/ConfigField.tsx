"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2, Wrench, XCircle } from "lucide-react";
import ModelSelector from "@/app/components/conversation/ModelSelector";
import type { ModelInfo } from "@/app/components/conversation/types";
import { AGENT_TOOL_CHOICES, hasToolConflict, OUTPUT_FIELD_TYPES, type FieldSpec, type OutputField } from "@/lib/workflows/catalog";
import FieldPicker, { typedBraces, type PickerRow } from "./FieldPicker";

export const NEEDS_TOOLS = "Needs a model that can use tools. Pick one with the wrench icon.";

export interface FieldEnv {
  rows: PickerRow[];
  /** "Preview: …" text for a template, or null for "Run once to see a preview". */
  preview: (template: string) => string | null;
  models: ModelInfo[];
  defaultModel: string;
  chats: { id: string; title: string }[];
  readOnly: boolean;
  /** Why it is read-only: a narrow screen, or a past run's snapshot. */
  readOnlyReason?: "narrow" | "past";
}

const inputClass = "focus-ring glass-input w-full rounded-[var(--glass-radius-md)] px-3 py-2 text-sm disabled:opacity-60";

function TemplateField({ spec, value, onChange, error, env, id }: { spec: FieldSpec; value: string; onChange: (v: string) => void; error?: string; env: FieldEnv; id: string }) {
  const [picking, setPicking] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  // Typing `{{` opens the picker; picking then replaces those two characters.
  const braces = useRef(false);
  const preview = value.includes("{{") ? env.preview(value) : null;
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
          rows={env.rows}
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

/** One settings field of a card, built from the catalog's field spec. */
export default function ConfigField({ spec, config, onChange, error, env }: { spec: FieldSpec; config: Record<string, unknown>; onChange: (key: string, value: unknown) => void; error?: string; env: FieldEnv }) {
  const id = useId();
  const value = config[spec.key];
  const set = (v: unknown) => onChange(spec.key, v);
  const cardModel = String(config.model || env.defaultModel);
  const modelHasTools = env.models.find((m) => m.id === cardModel)?.supportsTools !== false;

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
          <ModelSelector currentModel={String(value || env.defaultModel)} onModelChange={set} disabled={env.readOnly} size="sm" />
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
          {AGENT_TOOL_CHOICES.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={chosen.has(t.id)}
                disabled={env.readOnly || !modelHasTools || (!chosen.has(t.id) && hasToolConflict([...chosen, t.id]))}
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
    case "outputFields":
      control = <OutputFields value={(value as OutputField[]) ?? []} onChange={set} readOnly={env.readOnly} />;
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

  const labelled = spec.kind !== "perItem";
  return (
    <div className="space-y-1">
      {labelled && (
        <label htmlFor={id} className="block text-xs font-medium text-zinc-300">
          {spec.label}
        </label>
      )}
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
