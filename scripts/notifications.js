// ===============================================
// NOTIFICATIONS.JS
// V.V.S Rotselaar – Meldingen
//
// Twee types:
//   1. Beschikbaarheidsherinnering (automatisch, per wedstrijd)
//   2. Admin-meldingen (Firestore: notificaties/{id})
//
// Banners stapelen in een gedeelde #notifStack container.
// Versie-mechanisme: dismiss-key = vvs_custom_{id}_v{versie}
//   → ophogen versie in admin reset automatisch alle dismissals.
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, getDoc, doc }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const DISMISSED_KEY  = 'vvs_notif_dismissed';
const CHECK_INTERVAL = 2 * 60 * 60 * 1000;  // Om de 2 uur opnieuw checken
const LAST_CHECK_KEY = 'vvs_notif_last_check';
const WINDOW_HOURS   = 72;
// Na hoeveel tijd de melding voor dezelfde wedstrijd opnieuw getoond wordt
// als beschikbaarheid nog steeds niet ingevuld is (2 uur).
const AV_REMIND_INTERVAL = 2 * 60 * 60 * 1000;

// Bijhouden welke UID het laatst gecheckt werd → bij login altijd direct checken
let _lastCheckedUid = null;

// ── Gedeelde stack container ──────────────────────────────────────────────────
function getStack() {
    let stack = document.getElementById('notifStack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'notifStack';
        document.body.appendChild(stack);
    }
    return stack;
}

// ── Dismiss helpers — beschikbaarheid ─────────────────────────────────────────
function isAvDismissed(matchId) {
    try {
        const map = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}');
        const ts  = map[matchId];
        // Beschouw als "gezien" gedurende AV_REMIND_INTERVAL (2 uur).
        // Na die tijd wordt de melding opnieuw getoond als beschikbaarheid
        // nog altijd niet ingevuld is.
        return ts && Date.now() - ts < AV_REMIND_INTERVAL;
    } catch (_) { return false; }
}

function avDismiss(matchId) {
    try {
        const map = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}');
        map[matchId] = Date.now();
        // Verwijder vermeldingen ouder dan 4 dagen (opruimen)
        Object.keys(map).forEach(k => { if (Date.now() - map[k] > 4 * 24 * 60 * 60 * 1000) delete map[k]; });
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(map));
    } catch (_) {}
}

// ── Dismiss helpers — admin meldingen ─────────────────────────────────────────
function customDismissKey(id, versie) { return `vvs_custom_${id}_v${versie}`; }
function isCustomDismissed(id, versie) {
    return localStorage.getItem(customDismissKey(id, versie)) === '1';
}
function customDismiss(id, versie) {
    try { localStorage.setItem(customDismissKey(id, versie), '1'); } catch (_) {}
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
function shouldCheck(uid) {
    // Altijd checken als de ingelogde user veranderd is (login/logout)
    if (uid !== _lastCheckedUid) return true;
    try { return Date.now() - parseInt(localStorage.getItem(LAST_CHECK_KEY + '_' + (uid || 'anon')) || '0') > CHECK_INTERVAL; }
    catch (_) { return true; }
}
function markChecked(uid) {
    _lastCheckedUid = uid;
    try { localStorage.setItem(LAST_CHECK_KEY + '_' + (uid || 'anon'), String(Date.now())); } catch (_) {}
}

// ── Banner factory ────────────────────────────────────────────────────────────
function makeBanner(id, html, onDismiss, autoHideMs = 15000) {
    const stack  = getStack();
    const banner = document.createElement('div');
    banner.className = 'notif-banner';
    banner.id = id;
    banner.innerHTML = html;
    stack.appendChild(banner);

    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('visible')));

    const closeBtn = banner.querySelector('.notif-banner-close');
    // collapse() verwijdert de banner én klapt hem in zodat er geen gat achterblijft
    function collapse() {
        banner.classList.remove('visible');
        banner.classList.add('collapsing');
        onDismiss?.();
        setTimeout(() => banner.remove(), 380);
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', collapse);
    }

    if (autoHideMs > 0) {
        setTimeout(() => {
            if (banner.isConnected) collapse();
        }, autoHideMs);
    }

    return banner;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. BESCHIKBAARHEIDS-BANNER
// ══════════════════════════════════════════════════════════════════════════════

function showAvailabilityBanner(matches) {
    document.getElementById('notifAvailability')?.remove();

    const TEAM_PAGES  = { zaterdag: 'zaterdag.html', zondag: 'zondag.html', veteranen: 'veteranen.html' };
    const TEAM_LABELS = { zaterdag: 'Zaterdag', zondag: 'Zondag', veteranen: 'Veteranen' };

    const matchCards = matches.map(m => {
        const dt      = new Date(`${m.datum}T${m.uur || '00:00'}`);
        const dag     = dt.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
        const uur     = m.uur || '';
        const pagina  = TEAM_PAGES[m.team] || 'index.html';
        const ploeg   = TEAM_LABELS[m.team] || m.team || '';
        const uren    = Math.round((dt - Date.now()) / 3_600_000);
        const urgency = uren <= 24 ? '🔴' : '🟡';
        return `
            <div class="notif-match-card">
                <div class="notif-match-top">
                    <span class="notif-urgency">${urgency}</span>
                    <span class="notif-match-teams">${m.thuisploeg} – ${m.uitploeg}</span>
                </div>
                <div class="notif-match-meta">
                    <span class="notif-meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        ${dag}
                    </span>
                    ${uur ? `<span class="notif-meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        ${uur}
                    </span>` : ''}
                    <span class="notif-meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                        ${ploeg}
                    </span>
                </div>
                <a class="notif-match-btn" href="${pagina}#nextMatchSection">Beschikbaarheid invullen →</a>
            </div>`;
    }).join('');

    const html = `
        <div class="notif-banner-header">
            <div class="notif-banner-title-row">
                <span class="notif-banner-icon">🔔</span>
                <span class="notif-banner-title">Beschikbaarheid nog niet ingevuld</span>
                <button class="notif-banner-close" title="Sluiten">✕</button>
            </div>
            <p class="notif-banner-text">Je hebt binnenkort een wedstrijd, vul je beschikbaarheid in.</p>
            <div class="notif-banner-matches">${matchCards}</div>
        </div>`;

    makeBanner('notifAvailability', html, () => matches.forEach(m => avDismiss(m.id)), 6000);
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. ADMIN-MELDING BANNERS
// ══════════════════════════════════════════════════════════════════════════════

const TYPE_META = {
    info:    { icon: 'ℹ️',  color: '#0047AB' },
    warning: { icon: '⚠️',  color: '#FFC107' },
    success: { icon: '✅',  color: '#28A745' },
};

function showCustomBanner(m) {
    const bannerId = `notifCustom_${m.id}`;
    document.getElementById(bannerId)?.remove();

    const meta = TYPE_META[m.type] || TYPE_META.info;

    // Gebruik de opgeslagen kleur (valt terug op meta-kleur van het type)
    const accentKleur = m.kleur || meta.color;
    // Duur: 0 = oneindig → 0ms in makeBanner; anders seconden → ms
    const autoHideMs  = (m.duur && m.duur > 0) ? m.duur * 1000 : 0;

    const html = `
        <div class="notif-banner-header notif-custom" style="--notif-accent:${accentKleur};border-top-color:${accentKleur}">
            <div class="notif-banner-title-row">
                <span class="notif-banner-icon">${meta.icon}</span>
                <span class="notif-banner-title">${escHtml(m.titel)}</span>
                <button class="notif-banner-close" title="Sluiten">✕</button>
            </div>
            <p class="notif-banner-text notif-text-center">${escHtml(m.tekst)}</p>
        </div>`;

    makeBanner(bannerId, html, () => customDismiss(m.id, m.versie ?? 1), autoHideMs);
}

function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════════════════════
// HOOFDLOGICA
// ══════════════════════════════════════════════════════════════════════════════

async function checkAvailability(user, team) {
    const now       = new Date();
    const cutoff    = new Date(now.getTime() + WINDOW_HOURS * 3_600_000);
    const todayStr  = now.toISOString().slice(0, 10);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    try {
        const snap = await getDocs(query(
            collection(db, 'matches'),
            where('team',   '==', team),
            where('status', '==', 'planned'),
            where('datum',  '>=', todayStr),
            where('datum',  '<=', cutoffStr)
        ));

        if (snap.empty) return;

        const missing = [];
        for (const d of snap.docs) {
            const m  = { id: d.id, ...d.data() };
            const dt = new Date(`${m.datum}T${m.uur || '00:00'}`);
            if (dt <= now || dt > cutoff) continue;
            if (isAvDismissed(m.id)) continue;
            const avSnap = await getDoc(doc(db, 'matches', m.id, 'availability', user.uid));
            if (!avSnap.exists()) missing.push(m);
        }

        if (missing.length > 0) showAvailabilityBanner(missing);
    } catch (err) {
        console.warn('Beschikbaarheidscheck mislukt:', err);
    }
}

async function checkCustomNotifications(user, ploegen) {
    // ploegen is een array van strings, bv. ['zaterdag', 'zondag']
    const today = new Date().toISOString().slice(0, 10);

    try {
        const snap = await getDocs(
            query(collection(db, 'notificaties'), where('actief', '==', true))
        );

        snap.forEach(d => {
            const m = { id: d.id, ...d.data() };

            // Datumperiode check
            if (m.vanDatum  && today < m.vanDatum)  return;
            if (m.totDatum  && today > m.totDatum)  return;

            // Doelgroep check
            const dg = m.doelgroep || 'iedereen';
            if (dg === 'ingelogd' && !user) return;
            // Ploeg-specifieke check: de speler moet in die ploeg zitten
            if (dg === 'zaterdag'  && !ploegen.includes('zaterdag'))  return;
            if (dg === 'zondag'    && !ploegen.includes('zondag'))    return;
            if (dg === 'veteranen' && !ploegen.includes('veteranen')) return;
            // 'iedereen' → altijd tonen

            // Al gedismissed voor deze versie?
            if (isCustomDismissed(m.id, m.versie ?? 1)) return;

            showCustomBanner(m);
        });
    } catch (err) {
        console.warn('Custom meldingen check mislukt:', err);
    }
}

async function runChecks(user) {
    const uid = user?.uid || null;
    if (!shouldCheck(uid)) return;
    markChecked(uid);

    // Haal gebruikersprofiel op (enkel nodig als ingelogd)
    let ploegen = [];
    if (user) {
        try {
            const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
            if (!snap.empty) {
                const data = snap.docs[0].data();
                // Ondersteun zowel het nieuwe ploegen-array als het oude categorie-veld
                if (Array.isArray(data.ploegen) && data.ploegen.length > 0) {
                    ploegen = data.ploegen;
                } else if (data.categorie) {
                    ploegen = [data.categorie];
                }
            }
        } catch (_) {}
    }

    // Beide checks parallel uitvoeren
    const tasks = [checkCustomNotifications(user, ploegen)];

    // Beschikbaarheidscheck voor elke ploeg van de speler (behalve bestuurslid)
    const spelersploegen = ploegen.filter(t => t !== 'bestuurslid');
    if (user && spelersploegen.length > 0) {
        spelersploegen.forEach(team => tasks.push(checkAvailability(user, team)));
    }

    await Promise.allSettled(tasks);
}

// ── Auth listener ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    if (user) {
        setTimeout(() => runChecks(user), 2000);
    } else {
        // Niet ingelogd: wel custom meldingen checken voor doelgroep "iedereen"
        setTimeout(() => runChecks(null), 2000);
        // Verwijder beschikbaarheids-banner bij uitloggen
        document.getElementById('notifAvailability')?.remove();
    }
});
