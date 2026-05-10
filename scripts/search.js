// ===============================================
// SEARCH.JS — Globale zoekfunctie
// V.V.S Rotselaar
//
// Zoekt in: leden (users), wedstrijden (matches), evenementen
// Wordt geladen op elke pagina via de header.
// Firestore-data wordt gecached via vvs-cache.js.
// ===============================================

import { db, auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { tcGet, tcSet, CACHE_TTL } from './vvs-cache.js';
import { collection, getDocs, query, orderBy }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Track auth state so search knows what's allowed
let searchCurrentUser = null;
onAuthStateChanged(auth, (user) => { searchCurrentUser = user; });

// ── DOM refs ──────────────────────────────────────────────────────────────────
const searchBtn     = document.getElementById('globalSearchBtn');
const searchOverlay = document.getElementById('searchOverlay');
const searchInput   = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const searchClose   = document.getElementById('searchClose');

if (!searchBtn || !searchOverlay) {
    // Element niet gevonden — stille exit (pagina heeft geen search UI)
    // Dit kan voorkomen op pagina's zonder header.js
}

// ── State ──────────────────────────────────────────────────────────────────────
let searchData = { users: [], matches: [], evenementen: [] };
let dataLoaded = false;
let searchTimer = null;

// ── Open / close ──────────────────────────────────────────────────────────────
function openSearch() {
    if (!searchOverlay) return;
    searchOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    searchInput?.focus();
    if (!dataLoaded) loadSearchData();
}

function closeSearch() {
    if (!searchOverlay) return;
    searchOverlay.classList.remove('active');
    document.body.style.overflow = '';
    if (searchInput) searchInput.value = '';
    if (searchResults) searchResults.innerHTML = '';
}

searchBtn?.addEventListener('click', openSearch);
searchClose?.addEventListener('click', closeSearch);

searchOverlay?.addEventListener('click', (e) => {
    if (e.target === searchOverlay) closeSearch();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
    // Sneltoets: Ctrl+K of Cmd+K opent zoeken
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchOverlay?.classList.contains('active') ? closeSearch() : openSearch();
    }
});

// ── Load data (gecached) ──────────────────────────────────────────────────────
// Wedstrijden en evenementen zijn publiek leesbaar voor iedereen.
// Leden zijn enkel zichtbaar voor ingelogde gebruikers.
async function loadSearchData() {
    showSearchStatus('⏳ Laden…');

    let loadedSomething = false;

    // Leden — publiek leesbaar (iedereen mag zoeken)
    try {
        let users = tcGet('search_users', CACHE_TTL.medium);
        if (!users) {
            const snap = await getDocs(collection(db, 'users'));
            users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            tcSet('search_users', users);
        }
        searchData.users = users;
        loadedSomething = true;
    } catch (e) {
        console.warn('Leden laden mislukt:', e.message);
        searchData.users = [];
    }

    // Wedstrijden — publiek leesbaar
    try {
        let matches = tcGet('search_matches', CACHE_TTL.medium);
        if (!matches) {
            const snap = await getDocs(query(collection(db, 'matches'), orderBy('datum', 'desc')));
            matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            tcSet('search_matches', matches);
        }
        searchData.matches = matches;
        loadedSomething = true;
    } catch (e) {
        console.warn('Wedstrijden laden mislukt:', e.message);
        searchData.matches = [];
    }

    // Evenementen — publiek leesbaar
    try {
        let evenementen = tcGet('search_evenementen', CACHE_TTL.medium);
        if (!evenementen) {
            const snap = await getDocs(collection(db, 'evenementen'));
            evenementen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            tcSet('search_evenementen', evenementen);
        }
        searchData.evenementen = evenementen;
        loadedSomething = true;
    } catch (e) {
        console.warn('Evenementen laden mislukt:', e.message);
        searchData.evenementen = [];
    }

    if (!loadedSomething) {
        showSearchStatus('❌ Laden mislukt. Vernieuw de pagina.');
        return;
    }

    dataLoaded = true;
    showSearchStatus('Typ om te zoeken in leden, wedstrijden en evenementen…');

    // Als er al een query was getypt, voer hem nu uit
    if (searchInput?.value.trim().length >= 2) doSearch(searchInput.value.trim());
}

// ── Search ────────────────────────────────────────────────────────────────────
searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) {
        showSearchStatus('Typ minstens 2 tekens…');
        return;
    }
    // Fix mobiel: data laden als overlay geopend werd via mobileSearchBtn
    // (die openSearchOverlay() aanroept in header.js zonder loadSearchData())
    if (!dataLoaded) {
        loadSearchData();   // laadt data en voert de zoekopdracht daarna zelf uit
        return;
    }
    searchTimer = setTimeout(() => doSearch(q), 220);
});

// ── Team → pagina mapping ─────────────────────────────────────────────────────
function teamToPage(team) {
    const map = { veteranen: 'veteranen.html', zaterdag: 'zaterdag.html', zondag: 'zondag.html' };
    return map[(team || '').toLowerCase()] || null;
}

function doSearch(q) {
    const lower = q.toLowerCase();
    const results = [];

    // Leden — klikbaar naar speler.html?uid=...
    searchData.users
        .filter(u => {
            return (u.naam || '').toLowerCase().includes(lower)
                || (u.email || '').toLowerCase().includes(lower)
                || (u.categorie || '').toLowerCase().includes(lower);
        })
        .slice(0, 5)
        .forEach(u => results.push({
            type:    'lid',
            icon:    '👤',
            title:   u.naam || u.email,
            sub:     `${u.categorie || ''}${u.rol === 'admin' ? ' · Admin' : ''}`,
            href:    u.uid ? `speler.html?uid=${u.uid}` : null,
        }));

    // Wedstrijden — live → live.html, anders → teampage
    searchData.matches
        .filter(m => {
            return (m.thuisploeg  || '').toLowerCase().includes(lower)
                || (m.uitploeg    || '').toLowerCase().includes(lower)
                || (m.locatie     || '').toLowerCase().includes(lower)
                || (m.datum       || '').includes(lower)
                || (m.team        || '').toLowerCase().includes(lower);
        })
        .slice(0, 5)
        .forEach(m => {
            const datum = m.datum ? new Date(m.datum + 'T12:00').toLocaleDateString('nl-BE') : '';
            const score = m.status === 'finished'
                ? ` (${m.scoreThuis ?? '-'} - ${m.scoreUit ?? '-'})`
                : '';
            const isLive = m.status === 'live' || m.status === 'rust';
            results.push({
                type:  'wedstrijd',
                icon:  '⚽',
                title: `${m.thuisploeg} — ${m.uitploeg}${score}`,
                sub:   `${datum}${m.locatie ? ' · ' + m.locatie : ''} · ${m.team || ''}`,
                href:  isLive ? 'live.html' : teamToPage(m.team),
                badge: m.status === 'live' ? 'LIVE' : (m.status === 'rust' ? 'RUST' : ''),
            });
        });

    // Evenementen
    searchData.evenementen
        .filter(ev => {
            return (ev.titel     || '').toLowerCase().includes(lower)
                || (ev.locatie   || '').toLowerCase().includes(lower)
                || (ev.beschrijving || '').toLowerCase().includes(lower);
        })
        .slice(0, 4)
        .forEach(ev => {
            const datum = ev.datum ? new Date(ev.datum + 'T12:00').toLocaleDateString('nl-BE') : '';
            results.push({
                type:  'evenement',
                icon:  '📅',
                title: ev.titel,
                sub:   `${datum}${ev.locatie ? ' · ' + ev.locatie : ''}`,
                href:  'evenementen.html',
            });
        });

    renderResults(results, q);
}

function renderResults(results, q) {
    if (!searchResults) return;

    if (results.length === 0) {
        searchResults.innerHTML = `<div class="sr-empty">Geen resultaten voor "<strong>${esc(q)}</strong>"</div>`;
        return;
    }

    const grouped = { lid: [], wedstrijd: [], evenement: [] };
    results.forEach(r => grouped[r.type]?.push(r));

    const labels = { lid: 'Leden', wedstrijd: 'Wedstrijden', evenement: 'Evenementen' };
    let html = '';

    for (const [type, items] of Object.entries(grouped)) {
        if (!items.length) continue;
        html += `<div class="sr-group-label">${labels[type]}</div>`;
        items.forEach(item => {
            const badgeHtml = item.badge ? `<span class="sr-live-badge">${item.badge}</span>` : '';
            const tag = item.href ? 'a' : 'div';
            const href = item.href ? `href="${item.href}"` : '';
            html += `
                <${tag} class="sr-item" ${href}>
                    <span class="sr-icon">${item.icon}</span>
                    <span class="sr-text">
                        <span class="sr-title">${highlight(esc(item.title), q)}</span>
                        ${badgeHtml}
                        ${item.sub ? `<span class="sr-sub">${esc(item.sub)}</span>` : ''}
                    </span>
                    ${item.href ? '<span class="sr-arrow">›</span>' : ''}
                </${tag}>`;
        });
    }

    searchResults.innerHTML = html;

    // Sluit overlay bij klik op result-link
    searchResults.querySelectorAll('a.sr-item').forEach(a =>
        a.addEventListener('click', closeSearch));
}

function showSearchStatus(msg) {
    if (searchResults) searchResults.innerHTML = `<div class="sr-status">${msg}</div>`;
}

function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlight(escapedText, q) {
    const idx = escapedText.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapedText;
    return escapedText.slice(0, idx)
        + `<mark class="sr-mark">${escapedText.slice(idx, idx + q.length)}</mark>`
        + escapedText.slice(idx + q.length);
}
