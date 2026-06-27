/*
 * BetterSearch — ingest allowlisted Discord DMs & servers (messages + media)
 * into Pinecone for smart semantic / RAG search.
 */

import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    findOption,
    sendBotMessage,
} from "@api/Commands";
import definePlugin from "@utils/types";
import type { CommandArgument, CommandContext } from "@vencord/discord-types";
import { ChannelStore } from "@webpack/common";

import { send } from "./api";
import { addAllow, getAllowSet, isAllowed, removeAllow } from "./allowlist";
import { backfillChannel, resumeAll } from "./backfill";
import { ingestRaw } from "./ingest";
import { settings } from "./settings";

interface SearchSource {
    authorName: string;
    channelName: string;
    isDM: boolean;
    timestamp: string;
    sourceType: string;
    attachmentName?: string;
    jumpLink: string;
    text: string;
    score: number;
}

const reply = (channelId: string, content: string) => sendBotMessage(channelId, { content });

const guildOf = (channelId: string): string | null =>
    ChannelStore.getChannel(channelId)?.guild_id ?? null;

// ---- Subcommand handlers ----------------------------------------------------

function allowExec(ctx: CommandContext) {
    const id = ctx.channel.id;
    addAllow(id);
    reply(id, `✅ Now indexing this channel (\`${id}\`). New messages ingest live — run \`/bettersearch backfill\` to index its history.`);
}

function disallowExec(ctx: CommandContext) {
    const id = ctx.channel.id;
    removeAllow(id);
    reply(id, `🚫 Stopped indexing this channel (\`${id}\`). Already-indexed messages remain searchable.`);
}

function listExec(ctx: CommandContext) {
    const ids = [...getAllowSet()];
    reply(
        ctx.channel.id,
        ids.length
            ? `**Indexed channels/servers (${ids.length}):**\n${ids.map(i => "`" + i + "`").join(", ")}`
            : "Nothing is being indexed yet. Use `/bettersearch allow` in a channel or DM, or paste a server ID into the plugin's Allowlist setting.",
    );
}

async function statusExec(ctx: CommandContext) {
    const id = ctx.channel.id;
    const here = isAllowed(id, guildOf(id));
    try {
        const h = await send<any>("/health", {});
        reply(
            id,
            `**BetterSearch status**\n• Backend: \`${settings.store.backendUrl}\` ✅\n• Indexed: ${h.messages ?? "?"} messages / ${h.records ?? "?"} records\n• This channel: ${here ? "indexed ✅" : "not indexed"}\n• Live ingest: ${settings.store.liveIngest ? "on" : "off"}`,
        );
    } catch (err) {
        reply(id, `⚠️ Backend at \`${settings.store.backendUrl}\` unreachable: ${err instanceof Error ? err.message : err}\n(Start it: \`cd BetterSearch/server && bun run start\`)`);
    }
}

function backfillExec(opts: CommandArgument[], ctx: CommandContext) {
    const id = ctx.channel.id;
    const limit = findOption<number>(opts, "limit", settings.store.backfillLimit);
    if (!isAllowed(id, guildOf(id))) addAllow(id);
    reply(id, `⏳ Backfilling up to ${limit} messages here. Live progress shows in the plugin settings panel and toasts.`);
    backfillChannel(id, limit).catch(err => console.error("[BetterSearch] backfill failed:", err));
}

async function searchExec(opts: CommandArgument[], ctx: CommandContext) {
    const id = ctx.channel.id;
    const query = findOption<string>(opts, "query", "");
    if (!query) {
        reply(id, "Usage: `/bettersearch search query:<text>`");
        return;
    }
    try {
        const res = await send<{ answer: string | null; sources: SearchSource[]; related: SearchSource[]; }>("/search", {
            query,
            topK: 12,
            synthesize: true,
        });
        const cited = (res.sources || [])
            .map((s, i) => `**[${i + 1}]** ${s.authorName} · ${s.isDM ? "DM" : "#" + s.channelName}${s.sourceType === "attachment" ? " 📎 " + (s.attachmentName ?? "file") : ""} — [jump](${s.jumpLink})`)
            .join("\n");
        const extra = res.related?.length ? `\n\n_+${res.related.length} other related match(es)._` : "";
        reply(
            id,
            `🔎 **${query}**\n\n${res.answer ?? "_No answer._"}\n\n${cited || "_No confident sources._"}${extra}`,
        );
    } catch (err) {
        reply(id, `⚠️ Search failed: ${err instanceof Error ? err.message : err}`);
    }
}

// ---- Plugin -----------------------------------------------------------------

export default definePlugin({
    name: "BetterSearch",
    description:
        "Ingest allowlisted Discord DMs & servers (messages, images, PDFs, docs) into Pinecone for smart semantic & RAG search.",
    authors: [{ name: "Srijit", id: 0n }],
    settings,

    flux: {
        async MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic?: boolean; }) {
            if (optimistic || !settings.store.liveIngest) return;
            const channelId = message?.channel_id;
            if (!channelId) return;
            if (!isAllowed(channelId, guildOf(channelId))) return;
            try {
                await ingestRaw(message);
            } catch (err) {
                console.error("[BetterSearch] live ingest failed:", err);
            }
        },
    },

    commands: [
        {
            name: "bettersearch",
            description: "Manage BetterSearch indexing and run searches",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "allow", description: "Index this channel/DM (add to the allowlist)", type: ApplicationCommandOptionType.SUB_COMMAND, options: [] },
                { name: "disallow", description: "Stop indexing this channel/DM", type: ApplicationCommandOptionType.SUB_COMMAND, options: [] },
                { name: "list", description: "Show everything being indexed", type: ApplicationCommandOptionType.SUB_COMMAND, options: [] },
                { name: "status", description: "Backend connection + indexed counts", type: ApplicationCommandOptionType.SUB_COMMAND, options: [] },
                {
                    name: "backfill",
                    description: "Index this channel's past messages & media",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "limit",
                            description: "How many past messages to index (default from plugin settings)",
                            type: ApplicationCommandOptionType.INTEGER,
                            required: false,
                        },
                    ],
                },
                {
                    name: "search",
                    description: "Search your indexed history",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "query",
                            description: "What to search for",
                            type: ApplicationCommandOptionType.STRING,
                            required: true,
                        },
                    ],
                },
            ],
            execute(args: CommandArgument[], ctx: CommandContext) {
                // Subcommands arrive as args[0] = { name, options: [...] }.
                const sub = args[0]?.name;
                const opts = (args[0] as any)?.options ?? [];
                switch (sub) {
                    case "allow": return allowExec(ctx);
                    case "disallow": return disallowExec(ctx);
                    case "list": return listExec(ctx);
                    case "status": return statusExec(ctx);
                    case "backfill": return backfillExec(opts, ctx);
                    case "search": return searchExec(opts, ctx);
                    default: reply(ctx.channel.id, "Unknown subcommand.");
                }
            },
        },
    ],

    async start() {
        console.log("[BetterSearch] started. Backend:", settings.store.backendUrl);
        // Resume interrupted backfills + catch up missed live messages from downtime.
        try {
            await resumeAll([...getAllowSet()]);
        } catch (err) {
            console.error("[BetterSearch] resume/catch-up failed:", err);
        }
    },
});
