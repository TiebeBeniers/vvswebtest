// ===============================================
// GALERIJ.JS
// V.V.S Rotselaar – Galerijpagina
// Firestore: galerij/{id} → { bestandsnaam, grootte, volgorde }
// grootte: 'normal' | 'wide' | 'tall' | 'large'
// ===============================================

import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


// ── Load gallery ──────────────────────────────────────────────────────────────
async function loadGalerij() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;

    try {
        const snap = await getDocs(
            query(collection(db, 'galerij'), orderBy('volgorde', 'asc'))
        );

        grid.innerHTML = '';

        if (snap.empty) {
            grid.innerHTML = '<p style="text-align:center;color:var(--text-gray);padding:3rem 0;grid-column:1/-1;">Geen foto\'s gevonden.</p>';
            return;
        }

        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));

        items.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'gallery-item' + (item.grootte && item.grootte !== 'normal' ? ' ' + item.grootte : '');

            const img = document.createElement('img');
            img.src   = 'assets/galerij/' + item.bestandsnaam;
            img.alt   = 'VVS Rotselaar foto ' + (idx + 1);
            img.loading = 'lazy';
            div.appendChild(img);

            div.addEventListener('click', () => openLightbox(img.src));
            grid.appendChild(div);
        });

    } catch (err) {
        console.error('Galerij laden mislukt:', err);
        const grid = document.getElementById('galleryGrid');
        if (grid) grid.innerHTML = '<p style="text-align:center;color:var(--danger);padding:3rem 0;grid-column:1/-1;">Fout bij laden van galerij.</p>';
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
