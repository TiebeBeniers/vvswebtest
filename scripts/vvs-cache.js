// ===============================================
// VVS-CACHE.JS — Gedeelde cache module
// Gebruik: import { tcGet, tcSet, tcDel, tcClear } from './vvs-cache.js';
//
// Structuur in localStorage:
//   vvs_{key} → JSON { ts: timestamp, data: any }
//
// TTL constanten (milliseconden):
//   CACHE_TTL.short      5 min  — snel veranderende data
//   CACHE_TTL.medium    30 min  — wedstrijden, ranking
//   CACHE_TTL.long      60 min  — statistieken, sponsors
//   CACHE_TTL.day       24 uur  — sponsorlogos, galerij-volgorde
//   CACHE_TTL.permanent  ∞      — afgelopen wedstrijdtijdlijnen (immutable)
//
// Availability en real-time data (onSnapshot) worden NOOIT gecached.
// ===============================================

export const CACHE_TTL = {
    short:     5  * 60 * 1000,
    medium:   30  * 60 * 1000,
    long:     60  * 60 * 1000,
    day:      24  * 60 * 60 * 1000,
    permanent: Infinity,
    // Aliassen voor achterwaartse compatibiliteit met team.js
    recentMatches: 30 * 60 * 1000,
    nextMatch:     10 * 60 * 1000,
    teamStats:     60 * 60 * 1000,
    timeline:       7 * 24 * 60 * 60 * 1000,
};

// ── Refresh-detectie ──────────────────────────────────────────────────────────
// Bij een echte page refresh (F5) negeren we de cache zodat verse data geladen
// wordt. Werkt via sessionStorage zodat navigeren tussen pagina's de cache
// gewoon gebruikt.
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

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * Lees een gecachte waarde op.
 * @param {string} key    Sleutel (zonder 'vvs_' prefix)
 * @param {number} ttl    TTL in ms (gebruik CACHE_TTL.*). Infinity = permanent.
 * @param {boolean} [ignoreRefresh=false]  Sla refresh-check over (bv. voor sponsors).
 * @returns {any|null}    De gecachte data, of null als expired/afwezig.
 */
export function tcGet(key, ttl, ignoreRefresh = false) {
    if (!ignoreRefresh && PAGE_REFRESHED) return null;
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

/**
 * Sla een waarde op in de cache.
 * @param {string} key   Sleutel (zonder 'vvs_' prefix)
 * @param {any}    data  Te cachen data (JSON-serialiseerbaar)
 */
export function tcSet(key, data) {
    try {
        localStorage.setItem(`vvs_${key}`, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) { /* localStorage vol — geen probleem */ }
}

/**
 * Verwijder één cache-entry.
 * @param {string} key  Sleutel (zonder 'vvs_' prefix)
 */
export function tcDel(key) {
    try { localStorage.removeItem(`vvs_${key}`); } catch (_) {}
}

/**
 * Verwijder alle VVS cache-entries die overeenkomen met een prefix.
 * @param {string} [prefix='']  Optioneel — bv. 'recent_matches_' om team-caches te wissen.
 */
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
