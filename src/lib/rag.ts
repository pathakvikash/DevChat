import { prisma } from "@/lib/db";

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";

/**
 * Real semantic embedding via Ollama. Throws when Ollama is unreachable, the model isn't pulled, or the
 * request hangs past 8s: a made-up vector would sit in the KB next to real ones and rank as garbage.
 */
export async function embed(text: string): Promise<number[]> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new Error(`Embedding failed (${(err as Error).message}). Is Ollama running? Run \`ollama pull ${EMBED_MODEL}\`.`);
  }
  if (!res.ok) throw new Error(`Embedding failed: Ollama HTTP ${res.status}. Run \`ollama pull ${EMBED_MODEL}\`.`);
  const data = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new Error("Embedding failed: Ollama returned no embedding vector");
  }
  return data.embedding;
}

// Simple tokenizer - count words as tokens
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

// Chunk text into overlapping segments
export function chunkText(text: string, chunkSize = 512, overlap = 50): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const word of words) {
    const wordTokens = Math.ceil(word.length / 4);

    if (currentTokens + wordTokens > chunkSize && current.length > 0) {
      chunks.push(current.join(" "));
      // Keep overlap
      const overlapWords = Math.min(Math.ceil(overlap / 4), current.length);
      current = current.slice(-overlapWords);
      currentTokens = estimateTokens(current.join(" "));
    }

    current.push(word);
    currentTokens += wordTokens;
  }

  if (current.length > 0) {
    chunks.push(current.join(" "));
  }

  return chunks;
}

// Simple embedding function using sum of character codes
// In production, use OpenAI embeddings API
export function simpleEmbed(text: string): number[] {
  const embedding: number[] = new Array(384).fill(0);
  for (let i = 0; i < text.length; i++) {
    embedding[i % 384] += text.charCodeAt(i) / text.length;
  }
  return embedding.map((v) => v / 256);
}

// Cosine similarity
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export interface ScoredChunk {
  text: string;
  source: string;
  score: number;
}

/**
 * Parses a document's persisted chunk JSON and scores each chunk by cosine
 * similarity against a query embedding. Throws if `doc.chunks` isn't valid
 * JSON — callers decide whether to skip the document or surface an error.
 */
export function scoreDocumentChunks(
  doc: { filename: string; chunks: string },
  queryEmbedding: number[],
): ScoredChunk[] {
  const chunks: Array<{ text: string; embedding: number[] }> = JSON.parse(doc.chunks);
  const scored: ScoredChunk[] = [];
  chunks.forEach((chunk, i) => {
    if (!chunk.embedding || !Array.isArray(chunk.embedding)) return;
    scored.push({
      text: chunk.text,
      source: `${doc.filename}#chunk${i}`,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    });
  });
  return scored;
}


/** Top-k chunks of a knowledge base for a query, best first. Documents with malformed chunk data are skipped. */
export async function searchKb(kbId: string, query: string, k: number): Promise<{ docCount: number; chunks: ScoredChunk[] }> {
  const queryEmbedding = await embed(query);
  const documents = await prisma.document.findMany({ where: { kbId }, select: { id: true, filename: true, chunks: true } });
  const scored: ScoredChunk[] = [];
  for (const doc of documents) {
    try {
      scored.push(...scoreDocumentChunks(doc, queryEmbedding));
    } catch {
      // malformed chunk JSON
    }
  }
  return { docCount: documents.length, chunks: scored.sort((a, b) => b.score - a.score).slice(0, k) };
}
