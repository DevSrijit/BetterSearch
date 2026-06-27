// BetterSearch backend — Bun.serve HTTP API + static web UI.

import { config } from "./config.ts";
import { ensureIndex } from "./pinecone.ts";
import { ingestMessages } from "./ingest.ts";
import { runSearch } from "./search.ts";
import { stats } from "./db.ts";
import type { IngestBody, SearchBody } from "./types.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function authorized(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : h;
  return token === config.apiToken;
}

const WEB_PAGE = Bun.file(new URL("./web/index.html", import.meta.url));

await ensureIndex();

const server = Bun.serve({
  port: config.port,
  idleTimeout: 120, // vision extraction on big backfills can be slow
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Static web UI
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(WEB_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Health/stats — accepts GET (browser) or POST (plugin native bridge).
    if (url.pathname === "/health") {
      return json({ ok: true, index: config.pineconeIndex, ...stats() });
    }

    // Authenticated endpoints
    if (url.pathname === "/ingest" && req.method === "POST") {
      if (!authorized(req)) return json({ error: "unauthorized" }, 401);
      let body: IngestBody;
      try {
        body = (await req.json()) as IngestBody;
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!Array.isArray(body?.messages)) return json({ error: "messages[] required" }, 400);
      const result = await ingestMessages(body.messages);
      return json(result);
    }

    if (url.pathname === "/search" && req.method === "POST") {
      if (!authorized(req)) return json({ error: "unauthorized" }, 401);
      let body: SearchBody;
      try {
        body = (await req.json()) as SearchBody;
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!body?.query) return json({ error: "query required" }, 400);
      const result = await runSearch(body);
      return json(result);
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`[bettersearch] listening on http://localhost:${server.port}`);
console.log(`[bettersearch] web UI:  http://localhost:${server.port}/`);
