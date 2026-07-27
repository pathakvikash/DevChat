import { prisma } from "./db";

interface Chunk {
  text: string;
  embedding: number[];
  index: number;
}

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";

/**
 * Real semantic embedding via Ollama. Falls back to the deterministic
 * char-code embedding if Ollama is unreachable, the model isn't pulled,
 * or the request hangs past the 8s timeout — keeps retrieval working
 * (poorly) instead of stalling the whole chat.
 */
export async function embed(text: string): Promise<number[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
    const data = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      throw new Error("Ollama returned no embedding vector");
    }
    return data.embedding;
  } catch (err) {
    console.warn(
      `[rag] Falling back to simpleEmbed (${(err as Error).message}). Run \`ollama pull ${EMBED_MODEL}\` for real semantic retrieval.`
    );
    return simpleEmbed(text);
  }
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

// Retrieve relevant chunks from knowledge base
export async function retrieveChunks(
  kbId: string,
  query: string,
  topK = 5
): Promise<string> {
  try {
    const documents = await prisma.document.findMany({
      where: { kbId },
    });

    const queryEmbedding = await embed(query);
    const allChunks: Array<{ text: string; score: number }> = [];

    for (const doc of documents) {
      let chunks: Chunk[];
      try {
        chunks = JSON.parse(doc.chunks) as Chunk[];
      } catch {
        continue;
      }
      for (const chunk of chunks) {
        const score = cosineSimilarity(queryEmbedding, chunk.embedding);
        allChunks.push({ text: chunk.text, score });
      }
    }

    // Sort by score and get top K
    const topChunks = allChunks.sort((a, b) => b.score - a.score).slice(0, topK);

    return topChunks.map((c) => c.text).join("\n\n---\n\n");
  } catch (error) {
    console.error("Failed to retrieve chunks:", error);
    return "";
  }
}
