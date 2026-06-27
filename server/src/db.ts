// Local bookkeeping with Bun's built-in SQLite.
// Pinecone is the source of truth for vectors; this DB only tracks what we've
// already ingested (so re-running backfill doesn't re-spend write units or
// re-run vision extraction) and the per-channel backfill cursor.

import { Database } from "bun:sqlite";

const db = new Database("bettersearch.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS ingested (
    message_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    records INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS channel_cursor (
    channel_id TEXT PRIMARY KEY,
    oldest_backfilled TEXT,
    newest_seen TEXT,
    backfill_complete INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
`);

// Migration for DBs created before backfill_complete existed.
try {
  db.exec("ALTER TABLE channel_cursor ADD COLUMN backfill_complete INTEGER NOT NULL DEFAULT 0;");
} catch {
  // column already exists
}

const getStmt = db.query<{ content_hash: string }, [string]>(
  "SELECT content_hash FROM ingested WHERE message_id = ?",
);
const putStmt = db.query(
  `INSERT INTO ingested (message_id, content_hash, records, ingested_at)
   VALUES ($id, $hash, $records, $ts)
   ON CONFLICT(message_id) DO UPDATE SET
     content_hash = $hash, records = $records, ingested_at = $ts`,
);

/** Returns true if this message was already ingested with the same content hash. */
export function alreadyIngested(messageId: string, hash: string): boolean {
  const row = getStmt.get(messageId);
  return !!row && row.content_hash === hash;
}

export function markIngested(messageId: string, hash: string, records: number): void {
  putStmt.run({ $id: messageId, $hash: hash, $records: records, $ts: Date.now() });
}

const cursorPut = db.query(
  `INSERT INTO channel_cursor (channel_id, oldest_backfilled, newest_seen, updated_at)
   VALUES ($cid, $oldest, $newest, $ts)
   ON CONFLICT(channel_id) DO UPDATE SET
     oldest_backfilled = COALESCE($oldest, oldest_backfilled),
     newest_seen = COALESCE($newest, newest_seen),
     updated_at = $ts`,
);

export function updateCursor(
  channelId: string,
  opts: { oldest?: string; newest?: string },
): void {
  cursorPut.run({
    $cid: channelId,
    $oldest: opts.oldest ?? null,
    $newest: opts.newest ?? null,
    $ts: Date.now(),
  });
}

const cursorGet = db.query<
  { oldest_backfilled: string | null; newest_seen: string | null; backfill_complete: number },
  [string]
>("SELECT oldest_backfilled, newest_seen, backfill_complete FROM channel_cursor WHERE channel_id = ?");

export interface ChannelCursor {
  oldest: string | null;
  newest: string | null;
  complete: boolean;
}

/** Where ingestion left off for a channel — drives resume + live catch-up. */
export function getCursor(channelId: string): ChannelCursor {
  const row = cursorGet.get(channelId);
  return {
    oldest: row?.oldest_backfilled ?? null,
    newest: row?.newest_seen ?? null,
    complete: !!row?.backfill_complete,
  };
}

const completePut = db.query(
  `INSERT INTO channel_cursor (channel_id, backfill_complete, updated_at)
   VALUES ($cid, $c, $ts)
   ON CONFLICT(channel_id) DO UPDATE SET backfill_complete = $c, updated_at = $ts`,
);

/** Mark a channel as fully backfilled (reached the start of its history). */
export function setBackfillComplete(channelId: string, complete: boolean): void {
  completePut.run({ $cid: channelId, $c: complete ? 1 : 0, $ts: Date.now() });
}

export function stats(): { messages: number; records: number } {
  const row = db
    .query<{ c: number; r: number }, []>(
      "SELECT COUNT(*) AS c, COALESCE(SUM(records),0) AS r FROM ingested",
    )
    .get();
  return { messages: row?.c ?? 0, records: row?.r ?? 0 };
}
