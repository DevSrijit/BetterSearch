// Pinecone integrated-inference wrapper.
// We use an index bound to a hosted embedding model so we can upsert/search with
// RAW TEXT — Pinecone embeds server-side. No separate embedding API to manage.

import { Pinecone } from "@pinecone-database/pinecone";
import { config } from "./config.ts";
import type { UpsertRecord, SearchSource } from "./types.ts";

const pc = new Pinecone({ apiKey: config.pineconeApiKey });

let indexHostReady = false;

/** Create the integrated index if it doesn't exist yet. Idempotent. */
export async function ensureIndex(): Promise<void> {
  const existing = await pc.listIndexes();
  const found = existing.indexes?.some((i) => i.name === config.pineconeIndex);
  if (found) {
    indexHostReady = true;
    console.log(`[pinecone] index "${config.pineconeIndex}" exists`);
    return;
  }

  console.log(`[pinecone] creating integrated index "${config.pineconeIndex}" (${config.embedModel})…`);
  await pc.createIndexForModel({
    name: config.pineconeIndex,
    cloud: config.pineconeCloud as "aws" | "gcp" | "azure",
    region: config.pineconeRegion,
    embed: {
      model: config.embedModel,
      // The record field Pinecone embeds. Our records put the searchable text in `text`.
      fieldMap: { text: "text" },
    },
    waitUntilReady: true,
  });
  indexHostReady = true;
  console.log(`[pinecone] index ready`);
}

function index() {
  if (!indexHostReady) throw new Error("Pinecone index not initialized — call ensureIndex() first");
  return pc.index(config.pineconeIndex);
}

/** Upsert integrated records (raw text + flat metadata). Pinecone embeds the `text` field. */
export async function upsert(records: UpsertRecord[]): Promise<void> {
  if (records.length === 0) return;
  // upsertRecords takes a flat array; each record needs `id` + the model field + metadata.
  // Batch to stay well under request-size limits.
  const BATCH = 90;
  for (let i = 0; i < records.length; i += BATCH) {
    await index().upsertRecords(records.slice(i, i + BATCH) as any);
  }
}

const RETURN_FIELDS = [
  "text",
  "messageId",
  "channelId",
  "channelName",
  "guildId",
  "authorName",
  "timestamp",
  "isDM",
  "sourceType",
  "attachmentName",
  "jumpLink",
];

export async function search(
  query: string,
  topK: number,
  filter?: Record<string, unknown>,
): Promise<SearchSource[]> {
  const topN = Math.min(topK, 10);
  const res = await index().searchRecords({
    query: {
      topK: Math.max(topK, topN * 2),
      inputs: { text: query },
      ...(filter ? { filter } : {}),
    },
    rerank: {
      model: config.rerankModel,
      rankFields: ["text"],
      topN,
    },
    fields: RETURN_FIELDS,
  });

  return res.result.hits.map((hit) => {
    const f = hit.fields as Record<string, any>;
    const ts = typeof f.timestamp === "number" ? f.timestamp : Number(f.timestamp ?? 0);
    return {
      id: hit._id,
      score: hit._score,
      text: String(f.text ?? ""),
      messageId: String(f.messageId ?? ""),
      channelId: String(f.channelId ?? ""),
      channelName: String(f.channelName ?? ""),
      guildId: f.guildId ? String(f.guildId) : null,
      authorName: String(f.authorName ?? ""),
      timestamp: ts ? new Date(ts).toISOString() : "",
      isDM: Boolean(f.isDM),
      sourceType: (f.sourceType === "attachment" ? "attachment" : "message"),
      attachmentName: f.attachmentName ? String(f.attachmentName) : undefined,
      jumpLink: String(f.jumpLink ?? ""),
    } satisfies SearchSource;
  });
}
