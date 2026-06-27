import { React } from "@webpack/common";

import { getProgress, subscribeProgress, type Phase } from "./progress";

const PHASE_LABEL: Record<Phase, string> = {
    idle: "Idle",
    backfilling: "Backfilling history",
    catchup: "Catching up",
    done: "Done",
    error: "Error",
};

const PHASE_COLOR: Record<Phase, string> = {
    idle: "var(--text-muted)",
    backfilling: "var(--text-brand)",
    catchup: "var(--text-brand)",
    done: "var(--text-positive)",
    error: "var(--text-danger)",
};

/** Live backfill / catch-up status, rendered inside the plugin settings. */
export function BackfillStatus() {
    const [, force] = React.useState(0);
    React.useEffect(() => subscribeProgress(() => force(n => n + 1)), []);

    const p = getProgress();
    const pct = p.target > 0 ? Math.min(100, Math.round((p.fetched / p.target) * 100)) : 0;
    const active = p.phase === "backfilling" || p.phase === "catchup";

    return (
        <div
            style={{
                border: "1px solid var(--background-modifier-accent)",
                borderRadius: 8,
                padding: "12px 14px",
                marginBottom: 8,
                background: "var(--background-secondary)",
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: PHASE_COLOR[p.phase] }}>
                    {PHASE_LABEL[p.phase]}
                </span>
                {p.channelName && (
                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{p.channelName}</span>
                )}
            </div>

            {p.message && (
                <div style={{ color: "var(--text-normal)", fontSize: 13, marginBottom: active ? 8 : 0 }}>
                    {p.message}
                </div>
            )}

            {active && p.target > 0 && (
                <div style={{ height: 6, borderRadius: 3, background: "var(--background-tertiary)", overflow: "hidden", marginBottom: 6 }}>
                    <div style={{ height: "100%", width: pct + "%", background: "var(--brand-500, #5865f2)", transition: "width .2s" }} />
                </div>
            )}

            {(active || p.phase === "done") && (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {p.fetched > 0 && <span>{p.fetched}{p.target ? `/${p.target}` : ""} fetched · </span>}
                    {p.ingested} new · {p.records} records indexed
                </div>
            )}
        </div>
    );
}
