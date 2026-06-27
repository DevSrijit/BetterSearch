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
import { ChannelStore } from "@webpack/common";

import { send } from "./api";
import { addAllow, getAllowSet, isAllowed, removeAllow } from "./allowlist";
import { backfillChannel } from "./backfill";
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

function reply(channelId: string, content: string) {
    sendBotMessage(channelId, { content });
}

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
            const channel = ChannelStore.getChannel(channelId);
            const guildId = channel?.guild_id ?? null;
            if (!isAllowed(channelId, guildId)) return;
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
            description: "Manage BetterSearch ingestion and run searches",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "action",
                    description: "What to do",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                    choices: [
                        { name: "allow (ingest this channel)", value: "allow", label: "allow" },
                        { name: "disallow (stop ingesting this channel)", value: "disallow", label: "disallow" },
                        { name: "list (show allowlist)", value: "list", label: "list" },
                        { name: "status", value: "status", label: "status" },
                        { name: "backfill (index this channel's history)", value: "backfill", label: "backfill" },
                        { name: "search", value: "search", label: "search" },
                    ],
                },
                {
                    name: "query",
                    description: "Search query (for action: search)",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                },
                {
                    name: "limit",
                    description: "Max messages to backfill (default 1000)",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: false,
                },
            ],
            async execute(args, ctx) {
                const action = findOption<string>(args, "action", "status");
                const channelId = ctx.channel.id;
                const channel = ChannelStore.getChannel(channelId);
                const guildId = channel?.guild_id ?? null;

                switch (action) {
                    case "allow": {
                        addAllow(channelId);
                        reply(
                            channelId,
                            `✅ Allowlisted this channel (\`${channelId}\`). New messages will be ingested. Run \`/bettersearch backfill\` to index history.`,
                        );
                        return;
                    }
                    case "disallow": {
                        removeAllow(channelId);
                        reply(channelId, `🚫 Removed this channel (\`${channelId}\`) from the allowlist.`);
                        return;
                    }
                    case "list": {
                        const ids = [...getAllowSet()];
                        reply(
                            channelId,
                            ids.length
                                ? `**Allowlisted IDs (${ids.length}):**\n${ids.map(i => "`" + i + "`").join(", ")}`
                                : "Allowlist is empty. Use `/bettersearch allow` in a channel or DM.",
                        );
                        return;
                    }
                    case "status": {
                        const allowed = isAllowed(channelId, guildId);
                        try {
                            const health = await send<any>("/health", {});
                            reply(
                                channelId,
                                `**BetterSearch status**\n• Backend: \`${settings.store.backendUrl}\` ✅\n• Indexed: ${health.messages ?? "?"} messages / ${health.records ?? "?"} records\n• This channel: ${allowed ? "allowlisted ✅" : "not allowlisted"}\n• Live ingest: ${settings.store.liveIngest ? "on" : "off"}`,
                            );
                        } catch (err) {
                            reply(
                                channelId,
                                `⚠️ Could not reach backend at \`${settings.store.backendUrl}\`: ${err instanceof Error ? err.message : err}\nThis channel: ${allowed ? "allowlisted" : "not allowlisted"}.`,
                            );
                        }
                        return;
                    }
                    case "backfill": {
                        if (!isAllowed(channelId, guildId)) addAllow(channelId);
                        const limit = findOption<number>(args, "limit", 1000);
                        reply(channelId, `⏳ Backfilling up to ${limit} messages from this channel. Progress shows in toasts.`);
                        // Fire-and-forget; long-running with its own toast progress.
                        backfillChannel(channelId, limit).catch(err =>
                            console.error("[BetterSearch] backfill failed:", err),
                        );
                        return;
                    }
                    case "search": {
                        const query = findOption<string>(args, "query", "");
                        if (!query) {
                            reply(channelId, "Provide a query: `/bettersearch search query:<text>`");
                            return;
                        }
                        try {
                            const res = await send<{ answer: string | null; sources: SearchSource[] }>("/search", {
                                query,
                                topK: 8,
                                synthesize: true,
                            });
                            const top = (res.sources || [])
                                .slice(0, 5)
                                .map((s, i) => `**[${i + 1}]** ${s.authorName} · ${s.isDM ? "DM" : "#" + s.channelName} — [jump](${s.jumpLink})`)
                                .join("\n");
                            reply(
                                channelId,
                                `🔎 **${query}**\n\n${res.answer ?? "_No answer synthesized._"}\n\n${top || "_No sources._"}`,
                            );
                        } catch (err) {
                            reply(channelId, `⚠️ Search failed: ${err instanceof Error ? err.message : err}`);
                        }
                        return;
                    }
                    default:
                        reply(channelId, "Unknown action.");
                }
            },
        },
    ],

    start() {
        console.log("[BetterSearch] started. Backend:", settings.store.backendUrl);
    },
});
