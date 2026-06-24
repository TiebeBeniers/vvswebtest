import { db } from './firebase-config.js';
import { tcGet, tcSet, CACHE_TTL, PAGE_REFRESHED } from './vvs-cache.js';
import { collection, getDocs, query, orderBy }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


// ── Load gallery ──────────────────────────────────────────────────────────────
function renderGalerij(grid, items) {
    grid.innerHTML = '';
    if (!items || !items.length) {
        grid.innerHTML = '<p style="text-align:center;color:var(--text-gray);padding:3rem 0;grid-column:1/-1;">Geen foto\'s gevonden.</p>';
        return;
    }
    items.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'gallery-item' + (item.grootte && item.grootte !== 'normal' ? ' ' + item.grootte : '');
        const img = document.createElement('img');
        img.src     = 'assets/galerij/' + item.bestandsnaam;
        img.alt     = 'VVS Rotselaar foto ' + (idx + 1);
        img.loading = 'lazy';
        div.appendChild(img);
        div.addEventListener('click', () => openLightbox(img.src));
        grid.appendChild(div);
    });
}

async function loadGalerij() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;

    // Cache: 7 dagen. Toon stale data direct, vernieuw bij refresh.
    const cached = tcGet('galerij', CACHE_TTL.static);
    if (cached && !PAGE_REFRESHED) {
        renderGalerij(grid, cached);
        return;
    }
    if (cached) renderGalerij(grid, cached); // toon stale tijdens refresh-fetch

    try {
        const snap = await getDocs(
            query(collection(db, 'galerij'), orderBy('volgorde', 'asc'))
        );
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        tcSet('galerij', items);
        renderGalerij(grid, items);
    } catch (err) {
        console.error('Galerij laden mislukt:', err);
        if (!cached) grid.innerHTML = '<p style="text-align:center;color:var(--danger);padding:3rem 0;grid-column:1/-1;">Fout bij laden van galerij.</p>';
    }
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function openLightbox(src) {
    const lightbox    = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = src;
    lightbox.classList.add('active');
}

document.getElementById('lightboxClose')?.addEventListener('click', () => {
    document.getElementById('lightbox')?.classList.remove('active');
});

document.getElementById('lightbox')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox')) {
        document.getElementById('lightbox').classList.remove('active');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.getElementById('lightbox')?.classList.remove('active');
});

loadGalerij();