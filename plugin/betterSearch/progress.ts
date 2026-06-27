// Tiny pub/sub store for backfill / catch-up progress, shared between the
// backfill engine and the live settings panel.

export type Phase = "idle" | "backfilling" | "catchup" | "done" | "error";

export interface BackfillProgress {
    phase: Phase;
    channelId?: string;
    channelName?: string;
    fetched: number;
    ingested: number;
    records: number;
    target: number;
    message?: string;
    updatedAt: number;
}

let state: BackfillProgress = {
    phase: "idle",
    fetched: 0,
    ingested: 0,
    records: 0,
    target: 0,
    updatedAt: Date.now(),
};

const listeners = new Set<() => void>();

export function getProgress(): BackfillProgress {
    return state;
}

export function setProgress(patch: Partial<BackfillProgress>): void {
    state = { ...state, ...patch, updatedAt: Date.now() };
    listeners.forEach(l => {
        try {
            l();
        } catch {
            /* ignore listener errors */
        }
    });
}

export function subscribeProgress(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
