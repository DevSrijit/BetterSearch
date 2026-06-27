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
): Promise<string> {
  const res = await fetch(`${config.openrouterBase}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openrouterApiKey}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://github.com/bettersearch",
      "X-Title": "BetterSearch",
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2 }),
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

/** Synthesize a grounded answer from retrieved sources. */
export async function synthesize(
  query: string,
  context: { idx: number; text: string; meta: string; jumpLink: string }[],
): Promise<string> {
  if (context.length === 0) return "No matching messages were found.";
  const ctx = context
    .map((c) => `[${c.idx}] (${c.meta})\n${c.text}\nlink: ${c.jumpLink}`)
    .join("\n\n");

  return chatCompletion(config.chatModel, [
    {
      role: "system",
      content:
        "You are BetterSearch, answering questions over a team's Discord history " +
        "(messages, screenshots, PDFs, docs). Answer ONLY from the numbered sources. " +
        "Quote exact values for credentials, keys, URLs, and instructions. Cite sources " +
        "inline like [1], [2]. If the answer isn't in the sources, say so plainly. Be concise.",
    },
    { role: "user", content: `Question: ${query}\n\nSources:\n${ctx}` },
  ]);
}
