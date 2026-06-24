// =====================================================
// VVS-LOGO.JS  –  V.V.S Rotselaar
// Laadt het actieve logo vanuit Firestore en past het
// toe in de header en apple-touch-icon.
//
// Firestore: settings/siteSettings
//   { activeLogo: 'default' | 'celebration' | 'custom',
//     customLogoUrl: '...' }
//
// Het favicon (browserblad-icoon) en het PWA-startscherm-
// icoon wijzigen NOOIT via dit script — die worden bepaald
// door de fysieke icon-bestanden en manifest.json.
// =====================================================

import { db } from './firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export const LOGO_OPTIONS = [
    {
        id:             'default',
        label:          'Standaard logo',
        src:            'assets/logo.png',
        appleTouchIcon: 'assets/icons/apple-touch-icon.png',
    },
    {
        id:             'celebration',
        label:          '🎉 Feestlogo',
        src:            'assets/icons/icon2-512.png',
        appleTouchIcon: 'assets/icons/apple-touch-icon2.png',
    },
];

// ── Init: laad actief logo bij elke paginaload ────────────────────────────────
(async function initLogo() {
    if (applyLogoFromCache()) return;
    try {
        const snap      = await getDoc(doc(db, 'settings', 'siteSettings'));
        const activeId  = snap.exists() ? (snap.data().activeLogo    || 'default') : 'default';
        const customUrl = snap.exists() ? (snap.data().customLogoUrl || '')        : '';
        applyLogo(activeId, customUrl);
    } catch (_) {}
})();

// ── Logo toepassen op de pagina ───────────────────────────────────────────────
export function applyLogo(logoId, customUrl = '') {
    let option = LOGO_OPTIONS.find(o => o.id === logoId);

    if (customUrl) {
        option = { id: 'custom', src: customUrl, appleTouchIcon: customUrl };
    }
    if (!option) option = LOGO_OPTIONS[0];

    document.querySelectorAll('.team-logo, #teamLogo').forEach(img => {
        img.src = option.src;
    });

    const atIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (atIcon) atIcon.href = option.appleTouchIcon;

    try {
        sessionStorage.setItem('vvs_active_logo', JSON.stringify({
            id: logoId, src: option.src,
            appleTouchIcon: option.appleTouchIcon,
            customUrl: customUrl || '', ts: Date.now(),
        }));
    } catch (_) {}
}

// ── Sessie-cache (voorkomt flikkeren bij navigeren) ───────────────────────────
export function applyLogoFromCache() {
    try {
        const raw = sessionStorage.getItem('vvs_active_logo');
        if (!raw) return false;
        const { src, appleTouchIcon, ts } = JSON.parse(raw);
        if (Date.now() - ts > 5 * 60 * 1000) return false;
        document.querySelectorAll('.team-logo, #teamLogo').forEach(img => { img.src = src; });
        const atIcon = document.querySelector('link[rel="apple-touch-icon"]');
        if (atIcon) atIcon.href = appleTouchIcon;
        return true;
    } catch (_) { return false; }
}