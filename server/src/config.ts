// Central config. Bun auto-loads `.env` from the cwd, so values are on process.env.

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required env var: ${name}`);
    console.error(`         Copy .env.example to server/.env and fill it in.`);
    process.exit(1);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.length > 0
    ? process.env[name]!
    : fallback;
}

export const config = {
  port: Number(optional("PORT", "8787")),

  // Pinecone
  pineconeApiKey: required("PINECONE_API_KEY"),
  pineconeIndex: optional("PINECONE_INDEX", "bettersearch"),
  pineconeCloud: optional("PINECONE_CLOUD", "aws"),
  pineconeRegion: optional("PINECONE_REGION", "us-east-1"),
  embedModel: optional("PINECONE_EMBED_MODEL", "llama-text-embed-v2"),
  rerankModel: optional("PINECONE_RERANK_MODEL", "bge-reranker-v2-m3"),

  // OpenRouter
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  openrouterBase: optional("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
  visionModel: optional("OPENROUTER_VISION_MODEL", "google/gemini-2.5-flash"),
  chatModel: optional("OPENROUTER_CHAT_MODEL", "google/gemini-2.5-flash"),

  // Access control — shared bearer secret for /ingest and /search.
  apiToken: required("BS_API_TOKEN"),

  // Ingestion tuning
  chunkChars: Number(optional("BS_CHUNK_CHARS", "1200")),
  chunkOverlap: Number(optional("BS_CHUNK_OVERLAP", "150")),
  maxAttachmentBytes: Number(optional("BS_MAX_ATTACHMENT_BYTES", String(20 * 1024 * 1024))),
} as const;
