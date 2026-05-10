// ===============================================
// PRIVACY.JS
// V.V.S Rotselaar
// Laadt de privacyverklaring-inhoud dynamisch
// vanuit Firestore (settings/privacy).
// Valt terug op de hard-coded inhoud in
// #privacyFallback als er geen data is.
// ===============================================

import { db } from './firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const dynEl  = document.getElementById('privacyDynamic');
const fbEl   = document.getElementById('privacyFallback');
const dateEl = document.getElementById('privacyLastUpdated');

// Laadspinner tonen zolang we wachten op Firestore
if (dynEl) {
    dynEl.innerHTML = `
        <div style="text-align:center;padding:3rem;color:#888;">
            <div style="
                display:inline-block;width:28px;height:28px;
                border:3px solid #ddd;border-top-color:#0047AB;
                border-radius:50%;animation:priv-spin 0.8s linear infinite;">
            </div>
            <p style="margin-top:0.75rem;">Laden&hellip;</p>
        </div>`;
}

// CSS-animatie voor de spinner (eenmalig injecteren)
if (!document.getElementById('privacySpinStyle')) {
    const style = document.createElement('style');
    style.id = 'privacySpinStyle';
    style.textContent = '@keyframes priv-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
}

async function loadPrivacy() {
    try {
        const snap = await getDoc(doc(db, 'settings', 'privacy'));

        if (snap.exists() && snap.data().sections?.length) {
            const { sections, lastUpdated } = snap.data();

            // Datum bijwerken
            if (dateEl) {
                dateEl.textContent = lastUpdated
                    ? `Laatst bijgewerkt: ${lastUpdated}`
                    : '';
            }

            // Secties renderen — exact gelijk aan de admin3 preview-stijlen
            dynEl.innerHTML = sections
                .map(s => `
                    <div class="privacy-section">
                        ${s.title ? `<h3 class="privacy-section-title">${s.title}</h3>` : ''}
                        <div class="privacy-body">${s.body || ''}</div>
                    </div>`)
                .join('');

            return; // Gelukt — fallback niet nodig
        }
    } catch (err) {
        console.warn('Privacy: Firestore laden mislukt —', err.message);
    }

    // Fallback: verberg loader, toon hard-coded inhoud
    if (dynEl)  dynEl.innerHTML = '';
    if (fbEl)   fbEl.style.display = '';
    if (dateEl) dateEl.textContent = 'Laatst bijgewerkt: 8 maart 2026';
}

loadPrivacy();
