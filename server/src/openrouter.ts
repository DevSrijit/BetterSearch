// OpenRouter calls: vision (image → text) and chat (RAG synthesis).

import { config } from "./config.ts";

const VISION_PROMPT =
  "You are transcribing an image from a work chat so it can be searched later. " +
  "Output ALL text visible in the image verbatim (messages, code, terminal output, " +
  "config, tables). Pay special attention to credentials, passwords, API keys, tokens, " +
  "URLs, usernames, 2FA codes, and step-by-step instructions — reproduce them exactly. " +
  "After the verbatim text, add a one-line description of what the image shows. " +
  "If the image has no meaningful text, just briefly describe it.";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  maxTokens = 1024,
  jsonMode = false,
): Promise<string> {
  const res = await fetch(`${config.openrouterBase}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openrouterApiKey}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://github.com/bettersearch",
      "X-Title": "BetterSearch",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      // Zero Data Retention: only route to ZDR + non-data-collecting providers.
      ...(config.zdrOnly
        ? {
            provider: {
              zdr: true,
              data_collection: "deny",
              ...(jsonMode ? { require_parameters: true } : {}),
            },
          }
        : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${model} ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Transcribe/describe an image. `dataUrl` is a base64 data: URL. */
export async function vision(dataUrl: string): Promise<string> {
  return chatCompletion(config.visionModel, [
    {
      role: "user",
      content: [
        { type: "text", text: VISION_PROMPT },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ]);
}

export interface Synthesis {
  answer: string;
  /** 1-based source numbers that DIRECTLY support the answer (precision over recall). */
  citations: number[];
}

/**
 * Synthesize a grounded answer and report exactly which sources it relied on.
 * The caller shows only the cited sources, so relevance is tied to the answer
 * rather than to raw semantic similarity.
 */
export async function synthesize(
  query: string,
  context: { idx: number; text: string; meta: string; jumpLink: string }[],
): Promise<Synthesis> {
  if (context.length === 0) return { answer: "No matching messages were found.", citations: [] };
  const ctx = context
    .map((c) => `[${c.idx}] (${c.meta})\n${c.text}`)
    .join("\n\n");

  const raw = await chatCompletion(
    config.chatModel,
    [
      {
        role: "system",
        content:
          "You are BetterSearch, answering questions over a team's Discord history " +
          "(messages, screenshots, PDFs, docs). Answer ONLY from the numbered sources. " +
          "Quote exact values for credentials, keys, URLs, file names, and instructions. " +
          "Cite inline like [1], [2].\n" +
          "CRITICAL — relevance: in `citations`, list ONLY the source numbers that DIRECTLY " +
          "contain the answer. Do NOT include sources that are merely topically similar. " +
          "For 'find the file/attachment/message' questions, cite the single exact source that " +
          "is the file/message, not other mentions of it. Fewer, correct citations beat many. " +
          "If the answer is not in the sources, set answer to say so and citations to [].\n" +
          'Respond with JSON: {"answer": string, "citations": number[]}.',
      },
      { role: "user", content: `Question: ${query}\n\nSources:\n${ctx}` },
    ],
    1024,
    true,
  );

  // Parse structured output; fall back to regex over inline [n] markers.
  let answer = raw;
  let citations: number[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.answer === "string") answer = parsed.answer;
    if (Array.isArray(parsed.citations)) {
      citations = parsed.citations.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
    }
  } catch {
    // not JSON — leave answer as-is, citations derived below
  }
  if (citations.length === 0) {
    citations = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  }
  return { answer, citations };
}
