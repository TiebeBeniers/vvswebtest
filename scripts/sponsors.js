// ===============================================
// SPONSORS.JS  v2
// Cache: CACHE_TTL.static (7 dagen) met SWR
// Sponsors veranderen nauwelijks — 7 dagen is veilig.
// Admin kan cache wissen via: tcClear('sponsors')
// ===============================================

import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { tcSwr, CACHE_TTL } from './vvs-cache.js';

async function loadSponsors() {
    const container = document.getElementById('sponsorsContainer');
    if (!container) return;

    try {
        await tcSwr(
            'sponsors',
            CACHE_TTL.static,
            async () => {
                const snap = await getDocs(
                    query(collection(db, 'sponsors'), orderBy('volgorde', 'asc'))
                );
                const sponsors = [];
                snap.forEach(d => sponsors.push({ id: d.id, ...d.data() }));
                return sponsors;
            },
            (sponsors) => render(container, sponsors)
        );
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

function buildSponsorCard(sponsor) {
    const card = document.createElement('div');
    card.className = 'sponsor-card';

    const logoDiv = document.createElement('div');
    logoDiv.className = 'sponsor-logo';
    if (sponsor.website) {
        const a = document.createElement('a');
        a.href = sponsor.website; a.target = '_blank'; a.rel = 'noopener noreferrer';
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
        a.href = sponsor.website; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'sponsor-link';
        a.textContent = sponsor.websiteLabel || 'Bezoek website →';
        infoDiv.appendChild(a);
    }

    card.appendChild(logoDiv);
    card.appendChild(infoDiv);
    return card;
}

loadSponsors();