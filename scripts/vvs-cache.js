// ===============================================
// VVS-CACHE.JS  v2 — Gedeelde cache module
// Strategie:
//   • Refresh (F5) → cache genegeerd, verse Firestore-data
//   • Navigeren    → cache gebruikt indien geldig
//   • Stale-while-revalidate (tcSwr): toon gecachte data
//     onmiddellijk én haal op de achtergrond verse data
//     op zonder zichtbare vertraging
//
// TTL per type:
//   static    7 d  — galerij, sponsors, privacy, AV
//   event     6 h  — evenementen (max paar keer/maand)
//   medium   30 m  — kalender, volgende wedstrijd
//   match    10 m  — ranking, live context
//   profile  10 m  — spelersprofiel, statistieken
//   short     5 m  — snel veranderend
//   permanent ∞    — afgelopen wedstrijdtijdlijnen (immutable)
// ===============================================

export const CACHE_TTL = {
    static:    7 * 24 * 60 * 60 * 1000,
    event:     6 * 60 * 60 * 1000,
    medium:   30 * 60 * 1000,
    match:    10 * 60 * 1000,
    profile:  10 * 60 * 1000,
    short:     5 * 60 * 1000,
    permanent: Infinity,
    // Backwards-compat
    recentMatches: 30 * 60 * 1000,
    nextMatch:     10 * 60 * 1000,
    teamStats:     60 * 60 * 1000,
    timeline:       7 * 24 * 60 * 60 * 1000,
    long:     60 * 60 * 1000,
    day:      24 * 60 * 60 * 1000,
};

// F5/Ctrl+R → negeer cache; gewone navigatie → gebruik cache
export const PAGE_REFRESHED = (() => {
    try {
        const nav = performance.getEntriesByType?.('navigation')?.[0];
        if (nav?.type === 'reload') {
            if (!sessionStorage.getItem('vvs_refreshed')) {
                sessionStorage.setItem('vvs_refreshed', '1');
                return true;
            }
        } else {
            sessionStorage.removeItem('vvs_refreshed');
        }
    } catch (_) {}
    return false;
})();

// ── Core: get / set / del / clear ─────────────────────────────────────────────

export function tcGet(key, ttl, bypassRefresh = false) {
    if (!bypassRefresh && PAGE_REFRESHED) return null;
    try {
        const raw = localStorage.getItem(`vvs_${key}`);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (ttl !== Infinity && Date.now() - ts > ttl) {
            localStorage.removeItem(`vvs_${key}`);
            return null;
        }
        return data;
    } catch (_) { return null; }
}

export function tcSet(key, data) {
    try {
        localStorage.setItem(`vvs_${key}`, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) {
        _evictOldest();
        try {
            localStorage.setItem(`vvs_${key}`, JSON.stringify({ ts: Date.now(), data }));
        } catch (_) {}
    }
}

export function tcDel(key) {
    try { localStorage.removeItem(`vvs_${key}`); } catch (_) {}
}

export function tcClear(prefix = '') {
    try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith(`vvs_${prefix}`)) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
    } catch (_) {}
}

// ── Stale-While-Revalidate ────────────────────────────────────────────────────
// • Cache vers     → toon, geen fetch
// • Cache verlopen → toon stale, vernieuw op achtergrond
// • Geen cache     → wacht op fetch, render dan
// • Refresh (F5)   → sla refresh-check over: haal altijd verse data op,
//                    maar toon wel direct de stale data als startpunt
export async function tcSwr(key, ttl, fetchFn, onData) {
    const rawEntry = (() => {
        try { return JSON.parse(localStorage.getItem(`vvs_${key}`) || 'null'); }
        catch (_) { return null; }
    })();

    const hasCached  = rawEntry !== null;
    const isExpired  = !hasCached || PAGE_REFRESHED || (Date.now() - rawEntry.ts > ttl);

    if (hasCached && !isExpired) {
        // Cache vers — geen extra read nodig
        onData(rawEntry.data, true);
        return;
    }

    if (hasCached && isExpired) {
        // Toon stale data onmiddellijk (geen wachttijd voor de gebruiker)
        onData(rawEntry.data, true);
        // Vernieuw stil op de achtergrond
        try {
            const fresh = await fetchFn();
            tcSet(key, fresh);
            onData(fresh, false); // herrender met verse data
        } catch (_) {} // gebruiker ziet stale data — geen probleem
        return;
    }

    // Geen cache: eerste bezoek of refresh zonder stale data
    const fresh = await fetchFn();
    tcSet(key, fresh);
    onData(fresh, false);
}

// ── Intern: evict bij quota-overschrijding ─────────────────────────────────────
function _evictOldest() {
    try {
        const entries = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k?.startsWith('vvs_')) continue;
            try {
                const { ts } = JSON.parse(localStorage.getItem(k));
                entries.push({ k, ts });
            } catch (_) { entries.push({ k, ts: 0 }); }
        }
        entries.sort((a, b) => a.ts - b.ts).slice(0, 3).forEach(e => localStorage.removeItem(e.k));
    } catch (_) {}
}