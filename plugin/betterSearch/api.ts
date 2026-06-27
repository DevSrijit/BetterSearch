import type { PluginNative } from "@utils/types";

import { settings } from "./settings";

const Native = VencordNative.pluginHelpers.BetterSearch as PluginNative<typeof import("./native")>;

export interface IngestResult {
    received: number;
    ingested: number;
    skipped: number;
    records: number;
    errors: string[];
}

/** POST to the backend through the Electron main process (no CORS). */
export async function send<T = any>(path: string, payload: unknown): Promise<T> {
    const { backendUrl, apiToken } = settings.store;
    if (!backendUrl) throw new Error("BetterSearch: backend URL not set");
    const res = await Native.request(backendUrl, apiToken, path, payload);
    if (res.error) throw new Error("network: " + res.error);
    if (!res.ok) throw new Error(`backend ${res.status}: ${res.body || "error"}`);
    try {
        return JSON.parse(res.body) as T;
    } catch {
        return res.body as unknown as T;
    }
}
