// Attachment → text extraction (the "multimodal" step happens here).
// Images go through an OpenRouter vision model; pdf/docx/text are parsed locally.

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { config } from "./config.ts";
import { vision } from "./openrouter.ts";
import type { Attachment } from "./types.ts";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic)$/i;
const PDF_EXT = /\.pdf$/i;
const DOCX_EXT = /\.docx$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|ya?ml|log|ini|env|conf|xml|html?)$/i;
const IMAGE_MIME = /^image\//i;

function classify(att: Attachment): "image" | "pdf" | "docx" | "text" | "skip" {
  const ct = (att.contentType ?? "").toLowerCase();
  const name = att.filename ?? "";
  if (IMAGE_MIME.test(ct) || IMAGE_EXT.test(name)) return "image";
  if (ct.includes("pdf") || PDF_EXT.test(name)) return "pdf";
  if (DOCX_EXT.test(name) || ct.includes("officedocument.wordprocessing")) return "docx";
  if (ct.startsWith("text/") || ct.includes("json") || TEXT_EXT.test(name)) return "text";
  return "skip";
}

async function download(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[extract] download failed ${res.status} for ${url}`);
    return null;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > config.maxAttachmentBytes) {
    console.warn(`[extract] skipping oversized attachment (${buf.byteLength} bytes)`);
    return null;
  }
  return { bytes: buf, mime: res.headers.get("content-type") ?? "" };
}

/**
 * Extract searchable text from one attachment. Returns null when nothing useful
 * could be extracted (so the caller can skip creating an empty record).
 */
export async function extractAttachmentText(att: Attachment): Promise<string | null> {
  const kind = classify(att);
  if (kind === "skip") return null;

  try {
    const dl = await download(att.url);
    if (!dl) return null;

    switch (kind) {
      case "image": {
        const mime = att.contentType || dl.mime || "image/png";
        const b64 = Buffer.from(dl.bytes).toString("base64");
        const text = await vision(`data:${mime};base64,${b64}`);
        return text?.trim() || null;
      }
      case "pdf": {
        const pdf = await getDocumentProxy(dl.bytes);
        const { text } = await extractText(pdf, { mergePages: true });
        const merged = Array.isArray(text) ? text.join("\n") : text;
        return merged?.trim() || null;
      }
      case "docx": {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(dl.bytes) });
        return value?.trim() || null;
      }
      case "text": {
        return new TextDecoder().decode(dl.bytes).trim() || null;
      }
    }
  } catch (err) {
    console.warn(`[extract] failed on ${att.filename}:`, err instanceof Error ? err.message : err);
    return null;
  }
  return null;
}
