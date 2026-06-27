import { settings } from "./settings";

/** The set of allowlisted channel and guild IDs. */
export function getAllowSet(): Set<string> {
    return new Set(
        settings.store.allowlist
            .split(",")
            .map(s => s.trim())
            .filter(Boolean),
    );
}

function save(set: Set<string>) {
    settings.store.allowlist = [...set].join(",");
}

/** A channel is allowed if it (or its parent guild) is on the list. */
export function isAllowed(channelId: string, guildId: string | null): boolean {
    const set = getAllowSet();
    return set.has(channelId) || (!!guildId && set.has(guildId));
}

export function addAllow(id: string): void {
    const set = getAllowSet();
    set.add(id);
    save(set);
}

export function removeAllow(id: string): void {
    const set = getAllowSet();
    set.delete(id);
    save(set);
}
