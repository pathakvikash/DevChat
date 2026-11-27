import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { BRIDGE_PROTOCOL, BRIDGE_ORIGIN, VERCEL_FOLDERS_REFUSED, HOST_TOOLS_REFUSED } from "@/lib/bridge/constants";
import { bridgeProblemText, bridgeStatus, buildBridgeBody, buildSavePayload, routeTurn, serverHostToolsMissing } from "@/lib/bridge/client";
import { bridgeTurnSchema } from "@/lib/chat/saveBridgeTurn";
import { BRIDGE_PORT } from "@/lib/bridge/protocol";

const answer = (body: unknown, ok = true) => ({ kind: "response" as const, ok, body });

describe("bridgeStatus", () => {
  it("is unpaired without a token, whatever the probe says", () => {
    expect(bridgeStatus(false, answer({ protocol: BRIDGE_PROTOCOL, version: "1" })).status).toBe("unpaired");
  });
  it("is ready for a matching protocol with a version", () => {
    expect(bridgeStatus(true, answer({ protocol: BRIDGE_PROTOCOL, version: "0.1.0", claude: true }))).toMatchObject({ status: "ready", version: "0.1.0" });
  });
  it("is unpaired when the bridge answers without a version (it did not accept the token)", () => {
    expect(bridgeStatus(true, answer({ protocol: BRIDGE_PROTOCOL })).status).toBe("unpaired");
  });
  it("is mismatch when the protocol differs, and says which", () => {
    const h = bridgeStatus(true, answer({ protocol: BRIDGE_PROTOCOL + 1, version: "9" }));
    expect(h).toMatchObject({ status: "mismatch", protocol: BRIDGE_PROTOCOL + 1 });
    expect(bridgeProblemText("mismatch", h.protocol)).toBe(`Bridge is version ${BRIDGE_PROTOCOL + 1}, this Orrery needs ${BRIDGE_PROTOCOL}: git pull, then npm run bridge`);
  });
  it("is offline for a network error, an error status or a non-bridge body", () => {
    expect(bridgeStatus(true, { kind: "rejected", errorName: "TypeError" }).status).toBe("offline");
    expect(bridgeStatus(true, answer({ error: "x" }, false)).status).toBe("offline");
    expect(bridgeStatus(true, answer("<html>")).status).toBe("offline");
  });
  it("is blocked when the browser refused it (permission denied, Safari on https)", () => {
    expect(bridgeStatus(true, { kind: "rejected", errorName: "TypeError", permissionDenied: true }).status).toBe("blocked");
    expect(bridgeStatus(true, { kind: "rejected", errorName: "TypeError", safariOnHttps: true }).status).toBe("blocked");
    expect(bridgeStatus(true, { kind: "rejected", errorName: "NotAllowedError" }).status).toBe("blocked");
  });
  it("is no-claude (not ready) when the bridge says Claude Code is missing", () => {
    expect(bridgeStatus(true, answer({ protocol: BRIDGE_PROTOCOL, version: "0.1.0", claude: false })).status).toBe("no-claude");
    expect(bridgeProblemText("no-claude")).toBe("Claude Code is not installed on this computer (or not on PATH)");
    expect(routeTurn({ model: "claude-code/sonnet", noHostTools: true, status: "no-claude" })).toEqual({ to: "blocked", status: "no-claude" });
  });
  it("has the agreed failure texts", () => {
    expect(bridgeProblemText("offline")).toBe("Start the bridge on this computer: npm run bridge");
    expect(bridgeProblemText("blocked")).toBe("Your browser blocked access to this computer. Allow local network access for this site, or use Chrome or Firefox");
    expect(bridgeProblemText("ready")).toBeNull();
  });
});

describe("routeTurn", () => {
  const deployed = serverHostToolsMissing({ hostTools: true, reason: VERCEL_FOLDERS_REFUSED });
  it("reads the server's folder answer", () => {
    expect(deployed).toBe(true);
    expect(serverHostToolsMissing({ hostTools: false, reason: HOST_TOOLS_REFUSED })).toBe(true);
    expect(serverHostToolsMissing({ hostTools: true, reason: null })).toBe(false);
    expect(serverHostToolsMissing(null)).toBeNull();
  });
  it("goes to the bridge for a claude-code model on a deployment with the bridge ready", () => {
    expect(routeTurn({ model: "claude-code/sonnet", noHostTools: true, status: "ready" })).toEqual({ to: "bridge" });
  });
  it("never sends a claude-code model to the server while the server's answer is unknown (it would answer with another model)", () => {
    expect(routeTurn({ model: "claude-code/sonnet", noHostTools: null, status: "ready" })).toEqual({ to: "blocked", status: "ready" });
    expect(routeTurn({ model: "claude-code/sonnet", noHostTools: null, status: "offline" })).toEqual({ to: "blocked", status: "offline" });
    expect(routeTurn({ model: "mock/echo", noHostTools: null, status: "offline" })).toEqual({ to: "server" });
  });
  it("keeps the server path when Orrery runs locally or for other models", () => {
    expect(routeTurn({ model: "claude-code/sonnet", noHostTools: false, status: "ready" })).toEqual({ to: "server" });
    expect(routeTurn({ model: "mock/echo", noHostTools: true, status: "ready" })).toEqual({ to: "server" });
    expect(routeTurn({ model: "anthropic/claude-opus-5-5", noHostTools: true, status: "offline" })).toEqual({ to: "server" });
  });
  it("blocks (never falls back to another model) when the bridge is not ready", () => {
    for (const status of ["unpaired", "offline", "mismatch", "blocked"] as const) {
      expect(routeTurn({ model: "claude-code/sonnet", noHostTools: true, status })).toEqual({ to: "blocked", status });
    }
  });
});

describe("buildBridgeBody", () => {
  it("matches the daemon's /chat fields and drops what it would reject", () => {
    const body = buildBridgeBody({
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }], extra: 1 } as never, { role: "compression", parts: [] }],
      conversationId: "c1",
      model: "claude-code/sonnet",
      mode: "weird",
      allowedTools: ["Edit", 5],
      folder: null,
      effort: "turbo",
      system: "",
    });
    expect(body).toEqual({
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      conversationId: "c1",
      model: "claude-code/sonnet",
      mode: "chat",
      allowedTools: ["Edit"],
    });
  });
  it("sends folder, effort and system when set", () => {
    const body = buildBridgeBody({ messages: [], conversationId: "c", model: "m", mode: "ask", folder: "/a", effort: "high", system: "s" });
    expect(body).toMatchObject({ mode: "ask", folder: "/a", effort: "high", system: "s" });
  });
});

describe("buildSavePayload", () => {
  const user = { id: "u-1", role: "user", parts: [{ type: "text", text: "hello" }, { type: "file", url: "data:x" }] };
  const tool = { type: "dynamic-tool", toolName: "Edit", toolCallId: "toolu_1", state: "approval-requested", providerExecuted: true, input: { file_path: "/a" }, approval: { id: "cli-toolu_1" } };
  const assistant = {
    id: "a-1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "thinking", state: "done" },
      { type: "text", text: "Done.", state: "done" },
      tool,
      { type: "dynamic-tool", toolName: "presentPlan", toolCallId: "x", state: "input-available" }, // Orrery's own card name: dropped
      { type: "data-compressing", data: {} },
      { type: "source-url", url: "x" },
    ],
  };
  const base = { model: "claude-code/sonnet", continuing: false, savedUserIds: new Set<string>() };

  it("passes the real saveBridgeTurn schema and keeps only allowed parts", () => {
    const p = buildSavePayload({ ...base, messages: [user, assistant] })!;
    expect(bridgeTurnSchema.safeParse(p).success).toBe(true);
    expect(p.assistant.parts.map((x) => x.type)).toEqual(["step-start", "reasoning", "text", "dynamic-tool"]);
    expect(p.user).toEqual({ id: "u-1", text: "hello", parts: [{ type: "text", text: "hello" }] });
    expect(p.continuing).toBeUndefined();
  });
  it("marks an approval resume as continuing and leaves out a user message that was already saved", () => {
    const p = buildSavePayload({ ...base, continuing: true, savedUserIds: new Set(["u-1"]), messages: [user, assistant] })!;
    expect(bridgeTurnSchema.safeParse(p).success).toBe(true);
    expect(p).toMatchObject({ continuing: true, assistant: { id: "a-1" } });
    expect(p.user).toBeUndefined();
  });
  it("saves nothing when the last message is not an assistant reply with a savable part", () => {
    expect(buildSavePayload({ ...base, messages: [user] })).toBeNull();
    expect(buildSavePayload({ ...base, messages: [user, { id: "a", role: "assistant", parts: [{ type: "data-x" }] }] })).toBeNull();
  });
});

describe("constants", () => {
  it("agree with the daemon", () => {
    expect(BRIDGE_PORT).toBe(47321);
    expect(BRIDGE_ORIGIN).toBe("http://127.0.0.1:47321");
  });
});
