// ===============================================
// ANNOUNCEMENT BANNER
// V.V.S Rotselaar
// Dynamisch announcement systeem met Firebase
// ===============================================

import { db } from './firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Default tekst als er niks in Firebase staat
const DEFAULT_ANNOUNCEMENT = "Bier van de maand: Primus";

// Laad announcement vanuit Firebase
async function loadAnnouncement() {
    try {
        const announcementRef = doc(db, 'settings', 'announcement');
        const announcementDoc = await getDoc(announcementRef);

        if (announcementDoc.exists() && announcementDoc.data().text) {
            const data = announcementDoc.data();
            displayAnnouncement(data.text, data.icon || null);
        } else {
            displayAnnouncement(DEFAULT_ANNOUNCEMENT, null);
        }
    } catch (_) {
        // Geen leesrechten of netwerk­fout — val stil terug op de default
        displayAnnouncement(DEFAULT_ANNOUNCEMENT, null);
    }
}

function buildIconHtml(icon) {
    if (!icon) {
        // Geen icoon ingesteld: gebruik de standaard afbeelding via CSS ::before
        return '';
    }
    // Afbeelding-pad (bevat / of .)
    if (icon.includes('/') || icon.includes('.')) {
        return `<img class="announcement-icon-img" src="${icon}" alt="" aria-hidden="true">`;
    }
    // Emoji
    return `<span class="announcement-icon-emoji" aria-hidden="true">${icon}</span>`;
}

function displayAnnouncement(text, icon) {
    const announcementContent = document.getElementById('announcementContent');
    if (!announcementContent) return;

    const iconHtml = buildIconHtml(icon);

    // 9 duplicaten voor naadloze oneindige scroll
    const items = Array(9).fill(null).map(() =>
        `<span class="announcement-item">${iconHtml}${text}</span>`
    ).join('');

    announcementContent.innerHTML = items;
}

// Start wanneer de pagina geladen is
document.addEventListener('DOMContentLoaded', () => {
    loadAnnouncement();
});

// Herlaad elke 5 minuten voor updates
setInterval(loadAnnouncement, 5 * 60 * 1000);


