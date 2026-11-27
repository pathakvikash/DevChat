import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { request, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "child_process";
import { createBridgeServer, main, type BridgeConfig } from "../../../scripts/bridge";
import { isLoopbackUrl, listLocalModels, loopbackUrlOrThrow } from "@/lib/bridge/localModels";

vi.mock("child_process", async (importOriginal) => ({ ...(await importOriginal<typeof import("child_process")>()), spawn: vi.fn() }));

const ORIGIN = "https://dev-chat-beta.vercel.app";
const TOKEN = "k".repeat(43);
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

let server: Server;
let port = 0;
let prompts: unknown[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
let cfg: BridgeConfig;

const model = () =>
  new MockLanguageModelV3({
    doStream: async (o: any) => {
      prompts.push(o.prompt);
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "t" });
            c.enqueue({ type: "text-delta", id: "t", delta: "Hi from local" });
            c.enqueue({ type: "text-end", id: "t" });
            c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } });
            c.close();
          },
        }),
      } as any;
    },
  });

beforeEach(async () => {
  prompts = [];
  vi.mocked(spawn).mockClear();
  fetchMock = vi.fn(async (url: string) => {
    if (url === "http://127.0.0.1:11434/api/tags") return json({ models: [{ name: "llama3:latest" }, { name: "qwen3:8b" }] });
    if (url === "http://127.0.0.1:1234/v1/models") return json({ data: [{ id: "my-model" }, { id: "text-embedding-nomic" }] });
    throw new Error(`unexpected ${url}`);
  });
  cfg = { token: TOKEN, origins: [ORIGIN], folders: [], maxMode: "ask", confirmShell: true, allowChatWideEdits: false };
  server = createBridgeServer(() => cfg, { log: () => {}, findBins: async () => new Set(["claude-code"]), localFetch: fetchMock as never, buildLocalModel: () => model() as never });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  server.closeAllConnections?.();
});

function call(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path, headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, ...(payload ? { "Content-Type": "application/json" } : {}) } },
      (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => resolve({ status: res.statusCode!, text }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}
const user = (text: string) => ({ id: "u1", role: "user", parts: [{ type: "text", text }] });
const deltas = (text: string) => text.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6))).filter((c) => c.type === "text-delta").map((c) => c.delta).join("");

describe("bridge local models", () => {
  it("lists ollama/ and lmstudio/ models next to Claude Code's, without embeddings, and caches the list", async () => {
    const r = await call("GET", "/models");
    const ids = JSON.parse(r.text).models.map((m: { id: string }) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["claude-code/default", "ollama/llama3:latest", "ollama/qwen3:8b", "lmstudio/my-model"]));
    expect(ids).not.toContain("lmstudio/text-embedding-nomic");
    const n = fetchMock.mock.calls.length;
    await call("GET", "/models");
    expect(fetchMock.mock.calls.length).toBe(n);
  });

  it("lists nothing (and no error) when Ollama and LM Studio are not running", async () => {
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await listLocalModels({ ollamaUrl: "http://127.0.0.1:11434", lmstudioUrl: "http://127.0.0.1:1234/v1" }, down as never)).toEqual([]);
    expect(await listLocalModels({ ollamaUrl: "http://127.0.0.1:11434", lmstudioUrl: "http://127.0.0.1:1234/v1" }, (async () => json({}, false)) as never)).toEqual([]);
  });

  it("streams a listed local model through the UI message stream, ignoring mode, folder and allowedTools, and spawns nothing", async () => {
    const r = await call("POST", "/chat", {
      messages: [user("Hi")],
      model: "ollama/llama3:latest",
      mode: "ask",
      folder: "/etc",
      allowedTools: ["Bash"],
      system: "be brief",
    });
    expect(r.status).toBe(200);
    expect(deltas(r.text)).toBe("Hi from local");
    expect(spawn).not.toHaveBeenCalled();
    expect(JSON.stringify(prompts[0])).toContain("be brief");
  });

  it("serves LM Studio the same way", async () => {
    const r = await call("POST", "/chat", { messages: [user("Hi")], model: "lmstudio/my-model" });
    expect(deltas(r.text)).toBe("Hi from local");
  });

  it("refuses a model id the daemon did not list", async () => {
    for (const m of ["ollama/not-installed", "lmstudio/text-embedding-nomic", "ollama/", "openai/gpt-4o", "gpt-4o"]) {
      expect((await call("POST", "/chat", { messages: [user("Hi")], model: m })).status).toBe(400);
    }
    expect(prompts).toHaveLength(0);
  });

  it("drops tool and file parts from the history (the local model has no tools)", async () => {
    await call("POST", "/chat", {
      messages: [
        user("Hi"),
        { id: "a0", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "Read", toolCallId: "t1", state: "output-available", input: {}, output: "secret" }, { type: "text", text: "earlier" }] },
        { id: "u2", role: "user", parts: [{ type: "file", url: "http://169.254.169.254/", mediaType: "text/plain" }, { type: "text", text: "next" }] },
      ],
      model: "ollama/llama3:latest",
    });
    const sent = JSON.stringify(prompts[0]);
    expect(sent).toContain("earlier");
    expect(sent).toContain("next");
    expect(sent).not.toContain("secret");
    expect(sent).not.toContain("169.254");
  });

  it("only accepts loopback hosts for the Ollama and LM Studio URLs", async () => {
    for (const ok of ["http://127.0.0.1:11434", "http://localhost:1234/v1", "http://[::1]:11434"]) expect(isLoopbackUrl(ok)).toBe(true);
    for (const bad of ["http://192.168.1.5:11434", "http://example.com", "http://127.0.0.1.evil.com", "http://user:pw@127.0.0.1", "file:///etc/passwd", "ftp://127.0.0.1", "nope"]) expect(isLoopbackUrl(bad)).toBe(false);
    expect(loopbackUrlOrThrow("--ollama-url", "http://127.0.0.1:9999/")).toBe("http://127.0.0.1:9999");
    expect(() => loopbackUrlOrThrow("--ollama-url", "http://10.0.0.2:11434")).toThrow(/127\.0\.0\.1/);
    // a URL that is not loopback is never fetched, even if it got into the config
    const spy = vi.fn(async () => json({ models: [{ name: "x" }] }));
    expect(await listLocalModels({ ollamaUrl: "http://10.0.0.2:11434", lmstudioUrl: "http://example.com/v1" }, spy as never)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("--ollama-url / --lmstudio-url are saved when loopback and refused otherwise", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-cfg-"));
    try {
      await main(["--print-token"], dir);
      await main(["--ollama-url", "http://127.0.0.1:12345", "--lmstudio-url", "http://localhost:4321/v1"], dir);
      const saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      expect(saved.ollamaUrl).toBe("http://127.0.0.1:12345");
      expect(saved.lmstudioUrl).toBe("http://localhost:4321/v1");
      await expect(main(["--ollama-url", "http://example.com:11434"], dir)).rejects.toThrow(/127\.0\.0\.1/);
      await expect(main(["--lmstudio-url", "http://192.168.0.9:1234/v1"], dir)).rejects.toThrow(/localhost/);
      expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).ollamaUrl).toBe("http://127.0.0.1:12345");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
