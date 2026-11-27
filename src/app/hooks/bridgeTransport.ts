"use client";

import { DefaultChatTransport, type ChatTransport, type UIMessage } from "ai";
import { BRIDGE_ORIGIN } from "@/lib/bridge/constants";
import { buildBridgeBody, bridgeProblemText, routeTurn, serverHostToolsMissing } from "@/lib/bridge/client";
import { bridgeSnapshot, checkBridge, getBridgeFolder, readBridgeToken } from "@/app/hooks/useBridge";
import { foldersSnapshot, refetch as loadFolders } from "@/app/hooks/useFolders";

/** What the chat knows when a request goes out (the transport body ref in useChatTransport). */
export type RequestContext = {
  model?: string;
  systemPrompt?: string;
  reasoningEffort?: string | null;
  mode?: string;
  allowedTools?: string[];
};

/** A turn that went to the bridge: `useChat`'s onFinish reads it to save the turn. */
export type BridgeTurn = { model: string; continuing: boolean };

/**
 * One transport for useChat that picks the server or the local bridge per send. The server path is the existing
 * transport, untouched; the bridge path streams from the daemon on 127.0.0.1. Routing rule: `routeTurn` in lib/bridge/client.
 */
export function createRoutingTransport(opts: {
  server: ChatTransport<UIMessage>;
  getContext: () => RequestContext;
  onBridgeTurn: (turn: BridgeTurn) => void;
}): ChatTransport<UIMessage> {
  const bridge = new DefaultChatTransport<UIMessage>({
    api: `${BRIDGE_ORIGIN}/chat`,
    headers: () => ({ Authorization: `Bearer ${readBridgeToken() ?? ""}` }),
    // targetAddressSpace is not in the DOM typings: Chrome's opt-in for a public page to reach loopback.
    fetch: (input, init) => fetch(input, { ...init, targetAddressSpace: "loopback" } as RequestInit),
    prepareSendMessagesRequest: ({ id, messages }) => {
      const ctx = opts.getContext();
      // A folder is sent only while the bridge still lists it, so a removed one cannot be sent from stale storage.
      const picked = getBridgeFolder(id);
      const folder = picked && bridgeSnapshot().folders.some((f) => f.path === picked) ? picked : null;
      return {
        body: buildBridgeBody({
          messages,
          conversationId: id,
          model: ctx.model ?? "",
          mode: ctx.mode,
          allowedTools: ctx.allowedTools,
          folder,
          effort: ctx.reasoningEffort,
          system: ctx.systemPrompt,
        }),
      };
    },
  });

  return {
    async sendMessages(options) {
      const model = opts.getContext().model;
      // Anything but a claude-code/ model goes straight to the server, as before.
      if (!model?.startsWith("claude-code/")) return opts.server.sendMessages(options);

      if (!foldersSnapshot().loaded) await loadFolders();
      const noHostTools = serverHostToolsMissing(foldersSnapshot().data);
      if (noHostTools !== true) return opts.server.sendMessages(options);

      await checkBridge(5_000);
      const s = bridgeSnapshot();
      const route = routeTurn({ model, noHostTools, status: s.status });
      if (route.to === "blocked") throw new Error(bridgeProblemText(route.status, s.protocol) ?? "The local bridge is not ready.");
      if (route.to === "server") return opts.server.sendMessages(options);

      // A resume after an approval ends with the assistant message: the same row is rewritten when saved.
      opts.onBridgeTurn({ model, continuing: options.messages.at(-1)?.role === "assistant" });
      return bridge.sendMessages(options);
    },
    reconnectToStream: (options) => opts.server.reconnectToStream(options),
  };
}
