// Search pipeline: retrieve+rerank from Pinecone → optional grounded synthesis.

import { synthesize } from "./openrouter.ts";
import { search as pineconeSearch } from "./pinecone.ts";
import type { SearchBody, SearchResult } from "./types.ts";

export async function runSearch(body: SearchBody): Promise<SearchResult> {
  const query = body.query?.trim();
  if (!query) return { query: "", answer: null, sources: [] };

  const topK = Math.min(Math.max(body.topK ?? 8, 1), 20);
  const sources = await pineconeSearch(query, topK, body.filter);

  let answer: string | null = null;
  if (body.synthesize !== false && sources.length > 0) {
    answer = await synthesize(
      query,
      sources.map((s, i) => ({
        idx: i + 1,
        text: s.text,
        meta: `${s.authorName} in ${s.isDM ? "DM" : "#" + s.channelName} • ${s.timestamp}${
          s.sourceType === "attachment" ? " • file: " + s.attachmentName : ""
        }`,
        jumpLink: s.jumpLink,
      })),
    );
  }

  return { query, answer, sources };
}
