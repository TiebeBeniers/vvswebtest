// ===============================================
// SPONSOR-SCROLLER.JS  v2
// Naadloze sponsor-logo scroller — JS-gedreven
// zodat er nooit een zichtbare reset-sprong is.
// ===============================================

import { db } from './firebase-config.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

async function initSponsorScroller() {
    const wrapper = document.getElementById('sponsorScroller');
    const track   = document.getElementById('sponsorScrollerTrack');
    if (!wrapper || !track) return;

    try {
        const snap = await getDocs(collection(db, 'sponsors'));
        if (snap.empty) return;

        const sponsors = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(s => s.afbeeldingNaam)
            .sort((a, b) => (a.volgorde ?? 999) - (b.volgorde ?? 999));

        if (sponsors.length === 0) return;

        function buildItems() {
            return sponsors.map(s => {
                const item = document.createElement(s.website ? 'a' : 'div');
                item.className = 'sps-item';
                if (s.website) {
                    item.href   = s.website;
                    item.target = '_blank';
                    item.rel    = 'noopener noreferrer';
                }
                item.setAttribute('aria-label', s.naam || 'Sponsor');
                const img = document.createElement('img');
                img.src     = 'assets/' + s.afbeeldingNaam;
                img.alt     = s.naam || '';
                img.loading = 'lazy';
                img.onerror = () => { item.style.display = 'none'; };
                item.appendChild(img);
                return item;
            });
        }

        // Drie identieke sets → ruim genoeg voor elk scherm
        for (let i = 0; i < 3; i++) {
            buildItems().forEach(el => track.appendChild(el));
        }

        wrapper.style.display = 'block';

        // Wacht tot afbeeldingen geladen zijn voor correcte breedte-meting
        await Promise.allSettled(
            [...track.querySelectorAll('img')].map(img =>
                img.complete
                    ? Promise.resolve()
                    : new Promise(r => { img.onload = r; img.onerror = r; })
            )
        );

        // ── JS requestAnimationFrame lus ──────────────────────────────────────
        // Scrolt continu; zodra we één set-breedte voorbij zijn resetten we
        // de offset door eenvoudig één set-breedte af te trekken.
        // Omdat de sets identiek zijn is de positie visueel onveranderd → geen sprong.

        const PX_PER_S = 55;   // scrollsnelheid (pixels/seconde)
        let offset   = 0;
        let lastTime = null;
        let paused   = false;

        function oneSetWidth() {
            // Gedeeld door 3 want we hebben 3 kopieën
            return track.scrollWidth / 3;
        }

        function tick(ts) {
            if (!lastTime) lastTime = ts;
            const dt = (ts - lastTime) / 1800;   // seconden
            lastTime = ts;

            if (!paused) {
                offset += PX_PER_S * dt;
                const setW = oneSetWidth();
                if (setW > 0 && offset >= setW) {
                    offset -= setW;   // naadloze lus — visueel identieke positie
                }
                track.style.transform = `translateX(-${offset}px)`;
            }

            requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);

        // Pauzeer bij hover
        const viewport = wrapper.querySelector('.sps-viewport');
        viewport.addEventListener('mouseenter', () => { paused = true; });
        viewport.addEventListener('mouseleave', () => {
            paused   = false;
            lastTime = null;   // reset dt zodat er geen schok is na lange hover
        });

        // Stop als tabblad niet zichtbaar (batterijbesparing)
        document.addEventListener('visibilitychange', () => {
            paused   = document.hidden;
            lastTime = null;
        });

    } catch (err) {
        console.warn('Sponsor scroller fout:', err);
    }
}

initSponsorScroller();
