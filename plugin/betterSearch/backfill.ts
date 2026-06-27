import { RestAPI, Toasts } from "@webpack/common";

import { ingest, normalize, type NormalizedMessage } from "./ingest";

const PAGE = 100;
const PAGE_DELAY_MS = 400; // be gentle with Discord's rate limiter

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function toast(message: string, type: number = Toasts.Type.MESSAGE) {
    Toasts.show({ id: Toasts.genId(), message, type });
}

export interface BackfillStats {
    pages: number;
    fetched: number;
    ingested: number;
    records: number;
}

/**
 * Page backwards through a channel's history and ingest each batch.
 * `limit` caps the total number of messages fetched.
 */
export async function backfillChannel(channelId: string, limit = 1000): Promise<BackfillStats> {
    const stats: BackfillStats = { pages: 0, fetched: 0, ingested: 0, records: 0 };
    let before: string | undefined;

    toast(`BetterSearch: backfilling up to ${limit} messages…`);

    while (stats.fetched < limit) {
        let body: any[];
        try {
            const res = await RestAPI.get({
                url: `/channels/${channelId}/messages`,
                query: { limit: Math.min(PAGE, limit - stats.fetched), ...(before ? { before } : {}) },
            });
            body = res.body as any[];
        } catch (err) {
            toast(`BetterSearch: history fetch failed — ${err instanceof Error ? err.message : err}`, Toasts.Type.FAILURE);
            break;
        }

        if (!Array.isArray(body) || body.length === 0) break;

        stats.pages++;
        stats.fetched += body.length;
        before = body[body.length - 1].id; // oldest in this page → next page's cursor

        const normalized = body
            .map(m => normalize(m))
            .filter((m): m is NormalizedMessage => m !== null);

        if (normalized.length) {
            try {
                const result = await ingest(normalized);
                stats.ingested += result.ingested;
                stats.records += result.records;
            } catch (err) {
                toast(`BetterSearch: ingest failed — ${err instanceof Error ? err.message : err}`, Toasts.Type.FAILURE);
                break;
            }
        }

        toast(`BetterSearch: ${stats.fetched} fetched · ${stats.ingested} new · ${stats.records} records`);
        if (body.length < PAGE) break; // reached the start of the channel
        await sleep(PAGE_DELAY_MS);
    }

    toast(
        `BetterSearch: done — ${stats.ingested} new messages, ${stats.records} records indexed.`,
        Toasts.Type.SUCCESS,
    );
    return stats;
}
