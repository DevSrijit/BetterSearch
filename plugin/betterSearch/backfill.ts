import * as DataStore from "@api/DataStore";
import { ChannelStore, RestAPI, Toasts } from "@webpack/common";

import { cursor } from "./api";
import { channelLabel, ingest, normalize, type NormalizedMessage } from "./ingest";
import { setProgress } from "./progress";
import { settings } from "./settings";

const PAGE = 100;
const PAGE_DELAY_MS = 400; // be gentle with Discord's rate limiter
const MAX_CATCHUP_PAGES = 40;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function toast(message: string, type = Toasts.Type.MESSAGE) {
    Toasts.show({ id: Toasts.genId(), message, type });
}

// ---- Interrupted-job persistence (survives reloads / abrupt quits) ----------

const JOBS_KEY = "BetterSearch_backfillJobs";
interface Job {
    channelId: string;
    channelName: string;
    target: number;
}

async function getJobs(): Promise<Record<string, Job>> {
    return (await DataStore.get<Record<string, Job>>(JOBS_KEY)) ?? {};
}
async function putJob(job: Job): Promise<void> {
    const jobs = await getJobs();
    jobs[job.channelId] = job;
    await DataStore.set(JOBS_KEY, jobs);
}
async function clearJob(channelId: string): Promise<void> {
    const jobs = await getJobs();
    delete jobs[channelId];
    await DataStore.set(JOBS_KEY, jobs);
}

// ---- History fetch ----------------------------------------------------------

async function fetchPage(channelId: string, query: Record<string, any>): Promise<any[]> {
    const res = await RestAPI.get({ url: `/channels/${channelId}/messages`, query });
    return Array.isArray(res.body) ? res.body : [];
}

function ingestBatch(raw: any[]): Promise<{ ingested: number; records: number }> {
    const normalized = raw
        .map(m => normalize(m))
        .filter((m): m is NormalizedMessage => m !== null);
    if (!normalized.length) return Promise.resolve({ ingested: 0, records: 0 });
    return ingest(normalized).then(r => ({ ingested: r.ingested, records: r.records }));
}

// ---- Backward backfill (resumable) ------------------------------------------

/**
 * Page backwards through a channel's history and ingest each batch.
 * Resumable: position is checkpointed to the backend cursor after every page,
 * and the job is persisted so an abrupt quit auto-resumes on next start.
 */
export async function backfillChannel(
    channelId: string,
    target = settings.store.backfillLimit,
    opts: { resume?: boolean; silent?: boolean } = {},
): Promise<void> {
    const channelName = channelLabel(channelId);
    const cur = await cursor(channelId).catch(() => ({ oldest: null, newest: null, complete: false }));
    let before: string | undefined = opts.resume ? cur.oldest ?? undefined : undefined;

    let fetched = 0;
    let ingested = 0;
    let records = 0;

    await putJob({ channelId, channelName, target });
    setProgress({ phase: "backfilling", channelId, channelName, fetched, ingested, records, target, message: `Backfilling ${channelName}` });
    if (!opts.silent) toast(`BetterSearch: backfilling ${channelName} (up to ${target})…`);

    try {
        while (fetched < target) {
            const page = await fetchPage(channelId, {
                limit: Math.min(PAGE, target - fetched),
                ...(before ? { before } : {}),
            });
            if (page.length === 0) {
                await cursor(channelId, true).catch(() => {}); // reached start of channel
                break;
            }

            fetched += page.length;
            before = page[page.length - 1].id; // oldest in page → next cursor (checkpointed via ingest)

            const r = await ingestBatch(page);
            ingested += r.ingested;
            records += r.records;
            setProgress({ fetched, ingested, records });

            if (page.length < PAGE) {
                await cursor(channelId, true).catch(() => {}); // reached start of channel
                break;
            }
            await sleep(PAGE_DELAY_MS);
        }
        await clearJob(channelId);
        setProgress({ phase: "done", fetched, ingested, records, message: `Done: ${ingested} new from ${channelName}` });
        if (!opts.silent) {
            toast(`BetterSearch: done — ${ingested} new messages, ${records} records from ${channelName}.`, Toasts.Type.SUCCESS);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress({ phase: "error", message: `Backfill failed: ${msg}` });
        toast(`BetterSearch: backfill failed — ${msg}`, Toasts.Type.FAILURE);
        // leave the job persisted so it resumes next start
    }
}

// ---- Forward catch-up (missed live messages while offline) -------------------

/** Fetch and ingest messages newer than the last ingested one for a channel. */
export async function catchUpChannel(channelId: string): Promise<number> {
    const cur = await cursor(channelId).catch(() => null);
    if (!cur || !cur.newest) return 0; // nothing ingested here yet → nothing to catch up

    const channelName = channelLabel(channelId);
    let after = cur.newest;
    let total = 0;
    let pages = 0;
    setProgress({ phase: "catchup", channelId, channelName, fetched: 0, ingested: 0, records: 0, target: 0, message: `Catching up ${channelName}` });

    while (pages < MAX_CATCHUP_PAGES) {
        const page = await fetchPage(channelId, { after, limit: PAGE });
        if (page.length === 0) break;

        const maxId = page.reduce((m: string, x: any) => (BigInt(x.id) > BigInt(m) ? x.id : m), after);
        const r = await ingestBatch(page);
        total += r.ingested;
        setProgress({ ingested: total });

        if (maxId === after) break; // no forward progress
        after = maxId;
        pages++;
        if (page.length < PAGE) break;
        await sleep(PAGE_DELAY_MS);
    }
    if (total > 0) toast(`BetterSearch: caught up ${total} missed message(s) in ${channelName}.`, Toasts.Type.SUCCESS);
    return total;
}

// ---- Startup recovery -------------------------------------------------------

/**
 * On startup: resume any interrupted backfills, then catch up every allowlisted
 * channel on missed live messages. Runs sequentially to stay rate-limit friendly.
 */
export async function resumeAll(allowIds: string[]): Promise<void> {
    const jobs = await getJobs();

    for (const job of Object.values(jobs)) {
        await backfillChannel(job.channelId, job.target, { resume: true, silent: true });
    }

    for (const id of allowIds) {
        if (jobs[id]) continue; // just handled above
        if (!ChannelStore.getChannel(id)) continue; // guild id or unknown → skip
        await catchUpChannel(id);
    }

    setProgress({ phase: "idle", message: "Up to date" });
}
