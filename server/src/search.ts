// Search pipeline: retrieve+rerank → dedupe → synthesize → return ONLY the
// sources the answer actually relied on (citation-anchored relevance), plus a
// short list of other related matches for exploration.

import { config } from "./config.ts";
import { synthesize } from "./openrouter.ts";
import { search as pineconeSearch } from "./pinecone.ts";
import type { SearchBody, SearchResult, SearchSource } from "./types.ts";

/** Collapse multiple chunks of the same message/attachment into one best hit. */
function dedupe(sources: SearchSource[]): SearchSource[] {
  const best = new Map<string, SearchSource>();
  for (const s of sources) {
    const key = `${s.messageId}|${s.attachmentName ?? ""}`;
    const cur = best.get(key);
    if (!cur || s.score > cur.score) best.set(key, s);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

export async function runSearch(body: SearchBody): Promise<SearchResult> {
  const query = body.query?.trim();
  if (!query) return { query: "", answer: null, sources: [], related: [] };

  // Retrieve generously, rerank, then collapse duplicate chunks.
  // Always exclude our own "Clyde" bot replies (author id "1") from context.
  const excludeClyde = { authorId: { $ne: "1" } };
  const filter = body.filter ? { $and: [body.filter, excludeClyde] } : excludeClyde;
  const want = Math.min(Math.max(body.topK ?? 8, 1), 20);
  const raw = await pineconeSearch(query, Math.max(want, 15), filter);
  const deduped = dedupe(raw);

  // No LLM synthesis requested → return reranked hits above the relevance floor.
  if (body.synthesize === false) {
    const hits = deduped.filter((s) => s.score >= config.minScore).slice(0, want);
    return { query, answer: null, sources: hits, related: [] };
  }
  if (deduped.length === 0) {
    return { query, answer: "No matching messages were found.", sources: [], related: [] };
  }

  const { answer, citations } = await synthesize(
    query,
    deduped.map((s, i) => ({
      idx: i + 1,
      text: s.text,
      meta: `${s.authorName} in ${s.isDM ? "DM" : "#" + s.channelName} • ${s.timestamp}${
        s.sourceType === "attachment" ? " • file: " + s.attachmentName : ""
      }`,
      jumpLink: s.jumpLink,
    })),
  );

  // Used sources = those the answer cited, in order of first appearance.
  const order: number[] = [];
  for (const m of answer.matchAll(/\[(\d+)\]/g)) order.push(Number(m[1]));
  for (const c of citations) order.push(c);
  const usedOriginals = [...new Set(order)].filter((n) => n >= 1 && n <= deduped.length);

  // Remap [oldIdx] → [newIdx] so the answer's citations match the trimmed list.
  const remap = new Map<number, number>();
  usedOriginals.forEach((orig, i) => remap.set(orig, i + 1));
  const remappedAnswer = answer.replace(/\[(\d+)\]/g, (full, n) => {
    const mapped = remap.get(Number(n));
    return mapped ? `[${mapped}]` : "";
  });

  const sources = usedOriginals.map((orig) => deduped[orig - 1]!);

  // Everything else above the relevance floor, for an optional "related" view.
  const usedKeys = new Set(sources.map((s) => `${s.messageId}|${s.attachmentName ?? ""}`));
  const related = deduped
    .filter((s) => !usedKeys.has(`${s.messageId}|${s.attachmentName ?? ""}`))
    .filter((s) => s.score >= config.minScore)
    .slice(0, 5);

  return { query, answer: remappedAnswer.trim(), sources, related };
}
