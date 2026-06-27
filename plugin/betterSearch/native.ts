/*
 * BetterSearch native helpers — these run in Vencord's Electron MAIN process
 * (Node), not the Discord renderer. That means no CORS / mixed-content issues
 * when calling the local backend, and we can fetch DM attachment bytes freely.
 *
 * The first argument (IpcMainInvokeEvent) is injected by Vencord and stripped
 * on the renderer side, so callers pass only the args after it.
 */

import type { IpcMainInvokeEvent } from "electron";

export interface NativeResponse {
    ok: boolean;
    status: number;
    /** Raw response body text (JSON-encoded for our endpoints). */
    body: string;
    error?: string;
}

export async function request(
    _: IpcMainInvokeEvent,
    backendUrl: string,
    token: string,
    path: string,
    payload: unknown,
): Promise<NativeResponse> {
    try {
        const res = await fetch(backendUrl.replace(/\/+$/, "") + path, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: "Bearer " + token,
            },
            body: JSON.stringify(payload),
        });
        return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            body: "",
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
