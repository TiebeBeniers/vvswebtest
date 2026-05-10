// ===============================================
// SPONSORS.JS
// V.V.S Rotselaar – Sponsorpagina
// Sponsors worden gecached in localStorage (24u TTL).
// Firestore wordt alleen bevraagd bij een cache-miss of
// wanneer de admin de cache ongeldig maakt via:
//   localStorage.removeItem('vvs_sponsors_cache')
// ===============================================

import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const CACHE_KEY = 'vvs_sponsors_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 uur

// ── Cache helpers ─────────────────────────────────────────────────────────────
function cacheGet() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL) {
            localStorage.removeItem(CACHE_KEY);
            return null;
        }
        return data;
    } catch (_) { return null; }
}

function cacheSet(data) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) { /* quota vol — geen probleem */ }
}

// ── Load & render ─────────────────────────────────────────────────────────────
async function loadSponsors() {
    const container = document.getElementById('sponsorsContainer');
    if (!container) return;

    // ── Cache check ────────────────────────────────────────────────────────────
    const cached = cacheGet();
    if (cached) {
        console.log('[cache] sponsors geladen uit localStorage');
        render(container, cached);
        return;
    }

    // ── Firestore fetch ────────────────────────────────────────────────────────
    try {
        const snap = await getDocs(
            query(collection(db, 'sponsors'), orderBy('volgorde', 'asc'))
        );

        const sponsors = [];
        snap.forEach(d => sponsors.push({ id: d.id, ...d.data() }));

        cacheSet(sponsors);
        render(container, sponsors);

    } catch (err) {
        console.error('Sponsors laden mislukt:', err);
        container.innerHTML =
            '<p style="text-align:center;color:var(--danger);padding:3rem 0;">Fout bij laden van sponsors.</p>';
    }
}

function render(container, sponsors) {
    if (!sponsors.length) {
        container.innerHTML =
            '<p style="text-align:center;color:var(--text-gray);padding:3rem 0;">Geen sponsors gevonden.</p>';
        return;
    }
    container.innerHTML = '';
    sponsors.forEach(s => container.appendChild(buildSponsorCard(s)));
}

// ── Card builder ──────────────────────────────────────────────────────────────
function buildSponsorCard(sponsor) {
    const card = document.createElement('div');
    card.className = 'sponsor-card';

    // Logo column
    const logoDiv = document.createElement('div');
    logoDiv.className = 'sponsor-logo';
    if (sponsor.website) {
        const a = document.createElement('a');
        a.href = sponsor.website;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        if (sponsor.afbeeldingNaam) {
            const img = document.createElement('img');
            img.src = 'assets/' + sponsor.afbeeldingNaam;
            img.alt = (sponsor.naam || '') + ' Logo';
            a.appendChild(img);
        }
        logoDiv.appendChild(a);
    } else if (sponsor.afbeeldingNaam) {
        const img = document.createElement('img');
        img.src = 'assets/' + sponsor.afbeeldingNaam;
        img.alt = (sponsor.naam || '') + ' Logo';
        logoDiv.appendChild(img);
    }

    // Info column
    const infoDiv = document.createElement('div');
    infoDiv.className = 'sponsor-info';

    const h3 = document.createElement('h3');
    h3.textContent = sponsor.naam || '';
    infoDiv.appendChild(h3);

    if (sponsor.beschrijving) {
        const p = document.createElement('p');
        p.textContent = sponsor.beschrijving;
        infoDiv.appendChild(p);
    }

    if (sponsor.website) {
        const a = document.createElement('a');
        a.href = sponsor.website;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'sponsor-link';
        a.textContent = sponsor.websiteLabel || 'Bezoek website →';
        infoDiv.appendChild(a);
    }

    card.appendChild(logoDiv);
    card.appendChild(infoDiv);
    return card;
}

loadSponsors();