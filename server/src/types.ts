// Shared types for the BetterSearch backend.
// These mirror the normalized shape the Vencord plugin sends.

export interface Attachment {
  /** Discord attachment id (stable). */
  id: string;
  /** Signed Discord CDN url (the plugin forwards it as-is). */
  url: string;
  filename: string;
  /** e.g. "image/png", "application/pdf"; may be empty — we sniff the extension as a fallback. */
  contentType?: string;
  size?: number;
}

/** A single Discord message as normalized by the plugin. */
export interface NormalizedMessage {
  id: string;
  guildId: string | null;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  isDM: boolean;
  attachments: Attachment[];
}

export interface IngestBody {
  messages: NormalizedMessage[];
}

export interface IngestResult {
  received: number;
  ingested: number;
  skipped: number;
  records: number;
  errors: string[];
}

export interface SearchBody {
  query: string;
  topK?: number;
  /** Optional Pinecone metadata filter, e.g. { channelId: { $eq: "123" } }. */
  filter?: Record<string, unknown>;
  /** When false, skip LLM synthesis and just return ranked sources. */
  synthesize?: boolean;
}

export interface SearchSource {
  id: string;
  score: number;
  text: string;
  messageId: string;
  channelId: string;
  channelName: string;
  guildId: string | null;
  authorName: string;
  timestamp: string;
  isDM: boolean;
  sourceType: "message" | "attachment";
  attachmentName?: string;
  jumpLink: string;
}

export interface SearchResult {
  query: string;
  answer: string | null;
  /** Sources the answer actually cited (renumbered to match the answer). */
  sources: SearchSource[];
  /** Other above-threshold matches, for optional exploration. */
  related: SearchSource[];
}

/** A record ready to upsert via Pinecone integrated inference. */
export interface UpsertRecord {
  id: string;
  /** The field Pinecone embeds (matches fieldMap in pinecone.ts). */
  text: string;
  messageId: string;
  channelId: string;
  channelName: string;
  guildId: string;
  authorId: string;
  authorName: string;
  timestamp: number;
  isDM: boolean;
  sourceType: "message" | "attachment";
  attachmentName: string;
  jumpLink: string;
}
