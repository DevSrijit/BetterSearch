# BetterSearch — Vencord plugin

Install into a Vencord checkout as a **userplugin**.

## Install

```bash
# from the repo root
cp -r plugin/betterSearch <vencord>/src/userplugins/betterSearch
cd <vencord>
pnpm build && pnpm inject   # rebuild Vencord and (re)inject into Discord
```

Restart/reload Discord, open **Settings → Vencord → Plugins**, enable **BetterSearch**, and set:

- **Backend URL** — `http://localhost:8787` (default)
- **API token** — the `BS_API_TOKEN` from `server/.env`
- **Live ingest** — index new messages in allowlisted channels (default on)
- **Ingest media** — send attachments for text extraction (default on)

> Requires a Vencord install with userplugin support (i.e. built from source via `pnpm build`,
> not the prebuilt release). See https://docs.vencord.dev/installing/custom-plugins/.

## Files

| File | Role |
|---|---|
| `index.tsx` | `definePlugin`: settings, live `MESSAGE_CREATE` ingest, slash commands |
| `native.ts` | Runs in Electron **main**; does the actual backend HTTP (no CORS) |
| `api.ts` | Renderer-side typed wrapper over the native bridge |
| `ingest.ts` | Normalize a raw Discord message → backend shape; send it |
| `backfill.ts` | Page channel history via `RestAPI`, ingest in batches, toast progress |
| `allowlist.ts` | Add/remove/list allowlisted channel & guild IDs (stored in settings) |
| `settings.ts` | `definePluginSettings` |

## Commands

`/bettersearch <action>` — `allow`, `disallow`, `list`, `status`, `backfill [limit]`,
`search [query]`. See the root [README](../README.md#usage).

## Notes

- Only **allowlisted** channels/DMs are ever sent to the backend.
- Backfill is rate-limit friendly (100/page, short delay) and idempotent — re-running won't
  re-index or re-spend Pinecone write units on unchanged messages.
- The plugin sends Discord's signed CDN attachment URLs; the backend downloads and extracts them.
