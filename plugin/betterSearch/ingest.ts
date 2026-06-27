import { ChannelStore } from "@webpack/common";

import { send, type IngestResult } from "./api";
import { settings } from "./settings";

/** Minimal shape of a raw Discord message (flux MESSAGE_CREATE or REST history). */
interface RawMessage {
    id: string;
    content?: string;
    channel_id?: string;
    timestamp?: string | number | Date;
    author?: { id?: string; username?: string; global_name?: string | null; bot?: boolean };
    attachments?: Array<{
        id: string;
        url: string;
        filename: string;
        content_type?: string;
        size?: number;
    }>;
}

interface NormalizedAttachment {
    id: string;
    url: string;
    filename: string;
    contentType?: string;
    size?: number;
}

export interface NormalizedMessage {
    id: string;
    guildId: string | null;
    channelId: string;
    channelName: string;
    authorId: string;
    authorName: string;
    content: string;
    timestamp: string;
    isDM: boolean;
    attachments: NormalizedAttachment[];
}

function channelName(channel: any, isDM: boolean): string {
    if (channel?.name) return channel.name;
    if (isDM && Array.isArray(channel?.rawRecipients) && channel.rawRecipients.length) {
        return channel.rawRecipients.map((r: any) => r.global_name || r.username).join(", ");
    }
    return isDM ? "Direct Message" : "channel";
}

/** Human-readable label for a channel id (e.g. "#ops" / "Alex" for a DM). */
export function channelLabel(channelId: string): string {
    const channel = ChannelStore.getChannel(channelId);
    const isDM = !channel?.guild_id;
    const name = channelName(channel, isDM);
    return isDM ? name : "#" + name;
}

function toISO(ts: RawMessage["timestamp"]): string {
    if (!ts) return new Date().toISOString();
    const d = new Date(ts as any);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Convert a raw Discord message into the backend's normalized shape. */
export function normalize(raw: RawMessage): NormalizedMessage | null {
    const channelId = raw.channel_id;
    if (!channelId || !raw.id) return null;

    // Skip Vencord's local "Clyde" bot replies (our own command output) — they
    // carry author id "1" and are ephemeral, so indexing them just pollutes search.
    if (raw.author?.id === "1") return null;

    const channel = ChannelStore.getChannel(channelId);
    const guildId: string | null = channel?.guild_id ?? null;
    const isDM = !guildId;

    const attachments: NormalizedAttachment[] = settings.store.ingestMedia
        ? (raw.attachments ?? []).map(a => ({
              id: a.id,
              url: a.url,
              filename: a.filename,
              contentType: a.content_type,
              size: a.size,
          }))
        : [];

    // Skip empty, content-less messages (e.g. joins, pins) with no attachments.
    if (!raw.content?.trim() && attachments.length === 0) return null;

    return {
        id: raw.id,
        guildId,
        channelId,
        channelName: channelName(channel, isDM),
        authorId: raw.author?.id ?? "0",
        authorName: raw.author?.global_name || raw.author?.username || "unknown",
        content: raw.content ?? "",
        timestamp: toISO(raw.timestamp),
        isDM,
        attachments,
    };
}

/** Send a batch of already-normalized messages to the backend. */
export function ingest(messages: NormalizedMessage[]): Promise<IngestResult> {
    return send<IngestResult>("/ingest", { messages });
}

/** Normalize + ingest a single raw message (used by the live flux listener). */
export async function ingestRaw(raw: RawMessage): Promise<void> {
    const n = normalize(raw);
    if (n) await ingest([n]);
}
