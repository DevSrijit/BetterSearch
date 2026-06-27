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
| `index.tsx` | `definePlugin`: settings, live `MESSAGE_CREATE` ingest, `/bettersearch` subcommands, startup resume/catch-up |
| `native.ts` | Runs in Electron **main**; does the actual backend HTTP (no CORS) |
| `api.ts` | Renderer-side typed wrapper over the native bridge (`send`, `cursor`) |
| `ingest.ts` | Normalize a raw Discord message → backend shape; send it |
| `backfill.ts` | Resumable backward backfill + forward catch-up via `RestAPI`, checkpointed to the cursor |
| `progress.ts` | Tiny pub/sub store for backfill/catch-up progress |
| `BackfillStatus.tsx` | Live progress panel rendered inside the plugin settings |
| `allowlist.ts` | Add/remove/list allowlisted channel & guild IDs (stored in settings) |
| `settings.ts` | `definePluginSettings` (incl. default backfill limit + status panel) |

## Commands

Each is a **subcommand** with only its own options: `/bettersearch allow`, `disallow`, `list`,
`status`, `backfill [limit]`, `search <query>`. See the root [README](../README.md#usage).

## Notes

- Only **allowlisted** channels/DMs are ever sent to the backend.
- Backfill is rate-limit friendly (100/page, short delay), **idempotent** (content-hash dedup), and
  **resumable** — checkpointed per page and persisted, so abrupt quits auto-resume on next launch.
- On startup the plugin **catches up** missed live messages in allowlisted channels.
- The plugin sends Discord's signed CDN attachment URLs; the backend downloads and extracts them.
