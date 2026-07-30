"use client";

import type { SlashCommand } from "@/lib/commands";
import { runWebSearch, formatWebSearchResults } from "./webSearch";

export interface RunCommandCtx {
  conversationId: string;
  conversation: { model?: string } | null;
  sendMessage: (msg: { parts: Array<{ type: "text"; text: string }> }) => Promise<void>;
  setMessages: (fn: (prev: any[]) => any[]) => void;
  setConversation: (fn: (prev: any) => any) => void;
  setGoalPanelOpen: (v: boolean) => void;
  setGoalKickoff: (v: { objective: string; nonce: number }) => void;
  setIsCompressing: (v: boolean) => void;
  setArtifactPanelOpen: (v: boolean) => void;
  setScratchpadOpen: (v: boolean) => void;
  setModelSettingsOpen: (v: boolean) => void;
  toast: (msg: string, type: "success" | "error" | "info") => void;
  refreshConversationAndMessages: () => Promise<void>;
}

export async function runCommandAction(
  cmd: SlashCommand,
  arg: string,
  ctx: RunCommandCtx,
): Promise<void> {
  switch (cmd.action) {
    case "goal":
      ctx.setGoalPanelOpen(true);
      ctx.setGoalKickoff({ objective: arg, nonce: Date.now() });
      break;
    case "search": {
      const query = arg.slice(0, 300);
      let text = arg;
      try {
        const results = await runWebSearch(query);
        if (results.length > 0) {
          const formatted = formatWebSearchResults(results);
          text = `[Web Search Results for "${query}"]\n${formatted}\n\n---\n\nUsing the results above, answer: ${arg}`;
        }
      } catch (e) {
        console.error("[/search] web search failed:", e);
      }
      await ctx.sendMessage({ parts: [{ type: "text", text }] });
      break;
    }
    case "compress":
      ctx.setIsCompressing(true);
      try {
        const res = await fetch(`/api/conversations/${ctx.conversationId}/compress`, { method: "POST" });
        if (!res.ok) throw new Error("compress failed");
        await ctx.refreshConversationAndMessages();
        ctx.toast("Conversation compressed", "success");
      } catch {
        ctx.toast("Failed to compress conversation", "error");
      } finally {
        ctx.setIsCompressing(false);
      }
      break;
    case "title":
      try {
        const res = await fetch(`/api/conversations/${ctx.conversationId}/generate-title`, { method: "POST" });
        if (!res.ok) throw new Error("title failed");
        const data = await res.json();
        if (data?.title) {
          ctx.setConversation((prev: any) => (prev ? { ...prev, title: data.title } : prev));
          window.dispatchEvent(new CustomEvent("vas:title-updated", { detail: { id: ctx.conversationId, title: data.title } }));
        }
        ctx.toast("Title generated", "success");
      } catch {
        ctx.toast("Failed to generate title", "error");
      }
      break;
    case "remember": {
      const key = arg.trim().toLowerCase().split(/\s+/).slice(0, 4).join("_").replace(/[^a-z0-9_]/g, "").slice(0, 60) || `note_${Date.now()}`;
      try {
        const res = await fetch(`/api/memory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value: arg.trim(), category: "context" }),
        });
        if (!res.ok) throw new Error("remember failed");
        ctx.toast(`Remembered: ${key}`, "success");
      } catch {
        ctx.toast("Failed to save memory", "error");
      }
      break;
    }
    case "search-memory": {
      try {
        const res = await fetch(`/api/memory/search?q=${encodeURIComponent(arg.trim())}`);
        if (res.ok) {
          const results = await res.json();
          if (results.length === 0) {
            ctx.toast("No matching memories found", "info");
            break;
          }
          const lines = results.map((m: any) => `- **${m.key}** (${m.category}): ${m.value}`);
          ctx.setMessages((prev: any[]) => [
            ...prev,
            {
              id: `mem-search-${Date.now()}`,
              role: "assistant",
              parts: [{ type: "text", text: `**Memory search results for "${arg.trim()}"**\n\n${lines.join("\n")}` }],
            },
          ]);
        }
      } catch {
        ctx.toast("Failed to search memory", "error");
      }
      break;
    }
    case "consolidate":
      ctx.toast("Consolidating memory…", "info");
      try {
        const res = await fetch(`/api/memory/consolidate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: ctx.conversationId, model: ctx.conversation?.model }),
        });
        const data = await res.json();
        ctx.toast(`Memory updated: ${data.applied ?? 0} change(s), ${data.pruned ?? 0} pruned`, "success");
      } catch {
        ctx.toast("Failed to consolidate memory", "error");
      }
      break;
    case "artifacts":
      ctx.setArtifactPanelOpen(true);
      break;
    case "scratchpad":
      ctx.setScratchpadOpen(true);
      break;
    case "settings":
      ctx.setModelSettingsOpen(true);
      break;
    default:
      ctx.toast(`Unknown command: /${cmd.name}`, "error");
  }
}
