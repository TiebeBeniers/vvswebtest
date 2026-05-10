import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, getDocs, doc, setDoc, deleteDoc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

let currentUser = null;

// ── Auth ──────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const ll = document.getElementById('loginLink');
    if (ll) ll.textContent = user ? 'PROFIEL' : 'LOGIN';
    document.querySelectorAll('.inschrijf-btn-wrap').forEach(w => updateInschrijfButton(w));
});

// ── Load evenementen ──────────────────────────────────────────────────
async function loadEvenementen() {
    const featuredEl = document.getElementById('featuredEvenement');
    const upcomingEl = document.getElementById('upcomingEvenementen');
    const noEvents   = document.getElementById('noEvenementen');

    try {
        const snap = await getDocs(collection(db, 'evenementen'));
        if (snap.empty) { featuredEl.style.display = 'none'; noEvents.style.display = 'block'; return; }

        const now  = new Date();
        const list = [];
        snap.forEach(d => {
            const data = d.data();
            const dt   = new Date(data.datum + 'T' + data.tijd);
            if (dt > now) list.push({ id: d.id, ...data, dateTime: dt });
        });

        if (list.length === 0) { featuredEl.style.display = 'none'; noEvents.style.display = 'block'; return; }

        // Altijd chronologisch sorteren
        list.sort((a, b) => a.dateTime - b.dateTime);

        // Split: uitgelicht (pinned) vs gewoon
        const pinned  = list.filter(e => e.pinned === true);
        const regular = list.filter(e => !e.pinned);

        // Geen uitgelicht: toon het eerstvolgende als enkel featured card
        if (pinned.length === 0 && regular.length > 0) {
            pinned.push(regular.shift());
        }

        featuredEl.innerHTML = '';
        featuredEl.classList.remove('loading');

        if (pinned.length === 1) {
            // Enkel: groot split-layout
            featuredEl.appendChild(buildFeaturedCard(pinned[0], false));
        } else {
            // Meerdere: responsive grid
            const grid = document.createElement('div');
            grid.className = 'uitgelicht-grid';
            pinned.forEach(ev => grid.appendChild(buildFeaturedCard(ev, true)));
            featuredEl.appendChild(grid);
        }

        upcomingEl.innerHTML = '';
        regular.forEach(ev => upcomingEl.appendChild(buildSmallCard(ev)));

        document.querySelectorAll('.inschrijf-btn-wrap').forEach(w => updateInschrijfButton(w));

    } catch (err) {
        console.error(err);
        featuredEl.innerHTML = '<p class="error">Fout bij laden van evenementen.</p>';
    }
}

// ── Card builders ─────────────────────────────────────────────────────
function buildFeaturedCard(ev, isGrid = false) {
    const wrap = document.createElement('div');
    // isGrid: compact card in multi-uitgelicht grid; else: full-width split layout
    wrap.className = isGrid ? 'featured-evenement featured-evenement--grid' : 'featured-evenement';

    const dateFmt = ev.dateTime.toLocaleDateString('nl-BE', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const imgHtml  = ev.afbeeldingNaam
        ? '<div class="evenement-image"><img src="assets/' + ev.afbeeldingNaam + '" alt="' + htmlEsc(ev.titel) + '"></div>'
        : '';
    const linkHtml = ev.link
        ? '<a href="' + ev.link + '" target="_blank" rel="noopener noreferrer" class="evenement-link">Meer info &rarr;</a>'
        : '';

    const content = document.createElement('div');
    content.className = 'featured-evenement-content';
    content.innerHTML =
        '<h2>' + htmlEsc(ev.titel) + '</h2>' +
        '<div class="evenement-meta">' +
            '<div class="meta-item">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
                dateFmt +
            '</div>' +
            '<div class="meta-item">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                htmlEsc(ev.tijd) +
            '</div>' +
            '<div class="meta-item">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                htmlEsc(ev.locatie) +
            '</div>' +
        '</div>' +
        '<p class="evenement-beschrijving">' + htmlEsc(ev.beschrijving) + '</p>' +
        linkHtml;

    if (ev.inschrijvingenAan) content.appendChild(buildInschrijfWrap(ev));

    wrap.innerHTML = imgHtml;
    wrap.appendChild(content);
    return wrap;
}

function buildSmallCard(ev) {
    const card = document.createElement('div');
    card.className = 'evenement-card disabled';

    const dateFmt  = ev.dateTime.toLocaleDateString('nl-BE');
    const imgHtml  = ev.afbeeldingNaam
        ? '<img src="assets/' + ev.afbeeldingNaam + '" alt="' + htmlEsc(ev.titel) + '">'
        : '<div class="evenement-placeholder"></div>';
    const preview  = ev.beschrijving
        ? (ev.beschrijving.length > 100 ? ev.beschrijving.substring(0, 100) + '...' : ev.beschrijving)
        : '';

    const content = document.createElement('div');
    content.className = 'evenement-card-content';
    content.innerHTML =
        '<h3>' + htmlEsc(ev.titel) + '</h3>' +
        '<p class="evenement-date">' + dateFmt + ' om ' + htmlEsc(ev.tijd) + '</p>' +
        '<p class="evenement-location">' + htmlEsc(ev.locatie) + '</p>' +
        '<p class="evenement-preview">' + htmlEsc(preview) + '</p>';

    if (ev.inschrijvingenAan) content.appendChild(buildInschrijfWrap(ev));

    card.innerHTML = '<div class="evenement-card-image">' + imgHtml + '</div>';
    card.appendChild(content);
    return card;
}

function buildInschrijfWrap(ev) {
    const wrap = document.createElement('div');
    wrap.className = 'inschrijf-btn-wrap';
    wrap.dataset.evenementId = ev.id;
    wrap.dataset.max = ev.maxDeelnemers || '';
    wrap.dataset.extraVelden = JSON.stringify(ev.extraVelden || []);
    wrap.dataset.inschrijfBeschrijving = ev.inschrijfBeschrijving || '';
    wrap.dataset.extraWijzigbaar = ev.extraWijzigbaar ? 'true' : 'false';
    const btn = document.createElement('button');
    btn.className   = 'inschrijf-btn';
    btn.disabled    = true;
    btn.textContent = 'Laden...';
    wrap.appendChild(btn);
    return wrap;
}

function htmlEsc(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Inschrijvingen ────────────────────────────────────────────────────
async function updateInschrijfButton(wrap) {
    const btn         = wrap.querySelector('.inschrijf-btn');
    const evenementId = wrap.dataset.evenementId;
    const maxD        = parseInt(wrap.dataset.max) || null;
    if (!btn) return;

    if (!currentUser) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.disabled      = true;
    btn.textContent   = 'Laden...';

    try {
        const myRef  = doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid);
        const mySnap = await getDoc(myRef);
        const isIn   = mySnap.exists();

        const allSnap = await getDocs(collection(db, 'evenementen', evenementId, 'inschrijvingen'));
        const total   = allSnap.size;
        const vol     = maxD && total >= maxD && !isIn;

        btn.onclick = null;

        // Verwijder altijd een eventuele btn-row van een vorige toestand en
        // zorg dat btn terug een directe child van wrap is.
        const existingRow = wrap.querySelector('.inschrijf-btn-row');
        if (existingRow) {
            wrap.insertBefore(btn, existingRow); // btn uit de row halen
            existingRow.remove();
        }

        if (isIn) {
            const extraVelden = JSON.parse(wrap.dataset.extraVelden || '[]');
            const heeftWijzigbareVelden = extraVelden.some(v => v.wijzigbaar);

            // Bouw een flex-rij met ingeschreven-knop (+ evt. extra-knop)
            const row = document.createElement('div');
            row.className = 'inschrijf-btn-row';

            btn.textContent = '\u2705 Ingeschreven';
            btn.className   = 'inschrijf-btn ingeschreven';
            btn.style.flex  = '';
            btn.disabled    = false;
            btn.onclick     = () => handleUitschrijven(wrap);

            row.appendChild(btn);

            if (heeftWijzigbareVelden) {
                const extraBtn = document.createElement('button');
                extraBtn.className   = 'inschrijf-extra-btn';
                extraBtn.textContent = 'Extra\'s';
                extraBtn.onclick     = () => openBewerkExtrasPopup(wrap);
                row.appendChild(extraBtn);
            }

            wrap.appendChild(row);
        } else if (vol) {
            btn.textContent = 'Volzet (' + total + '/' + maxD + ')';
            btn.className   = 'inschrijf-btn volzet';
            btn.disabled    = true;
        } else {
            btn.textContent = 'Inschrijven';
            btn.className   = 'inschrijf-btn';
            btn.disabled    = false;
            btn.onclick     = () => openInschrijfPopup(wrap);
        }
    } catch (e) {
        btn.textContent = 'Fout bij laden';
        btn.disabled    = true;
        console.error(e);
    }
}

// ── Popup helpers ─────────────────────────────────────────────────────
function getOrCreateModal() {
    let modal = document.getElementById('inschrijfPopupModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'inschrijfPopupModal';
        modal.className = 'inschrijf-popup-overlay';
        document.body.appendChild(modal);
    }
    return modal;
}

function buildVeldenHtml(extraVelden, bestaandeAntwoorden = []) {
    if (!extraVelden.length) return '';
    return `
        <div class="inschrijf-popup-extra-sectie">
            <div class="inschrijf-popup-extra-header">
                <span>Extra personen meebrengen</span>
                <span class="inschrijf-popup-optioneel">optioneel</span>
            </div>
            ${extraVelden.map(v => {
                const bestaand = bestaandeAntwoorden.find(a => a.veldId === v.id);
                const waarde = bestaand ? (parseInt(bestaand.waarde) || 0) : 0;
                return `
                <div class="inschrijf-popup-veld">
                    <div class="inschrijf-popup-veld-header">
                        <label>${htmlEsc(v.label)}</label>
                        ${v.pricePerUnit > 0
                            ? `<span class="inschrijf-prijs-hint">€${Number(v.pricePerUnit).toFixed(2)} p.p.</span>`
                            : `<span class="inschrijf-prijs-hint gratis">gratis</span>`}
                    </div>
                    ${v.toelichting ? `<small>${htmlEsc(v.toelichting)}</small>` : ''}
                    <div class="inschrijf-aantal-control">
                        <button type="button" class="aantal-minus" data-target="inp_${v.id}">−</button>
                        <input type="number" id="inp_${v.id}" class="inschrijf-popup-input"
                            data-veld-id="${v.id}" data-prijs="${v.pricePerUnit || 0}"
                            min="0" value="${waarde}">
                        <button type="button" class="aantal-plus" data-target="inp_${v.id}">+</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
}

function clampPositiveInt(inp) {
    const val = parseInt(inp.value);
    inp.value = (isNaN(val) || val < 0) ? 0 : Math.floor(val);
}

function bindVeldControls(modal) {
    modal.querySelectorAll('.aantal-minus, .aantal-plus').forEach(btn => {
        btn.addEventListener('click', () => {
            const inp = modal.querySelector('#' + btn.dataset.target);
            if (!inp) return;
            const delta = btn.classList.contains('aantal-plus') ? 1 : -1;
            inp.value = Math.max(0, (parseInt(inp.value) || 0) + delta);
            inp.dispatchEvent(new Event('input'));
        });
    });
    // Enforce positive integers on manual input
    modal.querySelectorAll('.inschrijf-popup-input').forEach(inp => {
        inp.addEventListener('blur', () => clampPositiveInt(inp));
        inp.addEventListener('keydown', (e) => {
            if (e.key === '-' || e.key === '.' || e.key === ',') e.preventDefault();
        });
    });
}

function updateSamenvatting(modal, extraVelden, isBewerken = false) {
    const totalDiv = modal.querySelector('#inschrijfPopupSamenvatting');
    const kostenDiv = modal.querySelector('#inschrijfPopupKosten');
    let totaalExtra = 0;
    let totaalKosten = 0;

    modal.querySelectorAll('.inschrijf-popup-input').forEach(inp => {
        const aantal = parseInt(inp.value) || 0;
        const prijs  = parseFloat(inp.dataset.prijs) || 0;
        totaalExtra += aantal;
        totaalKosten += aantal * prijs;
    });

    if (totalDiv) {
        if (totaalExtra === 0) {
            totalDiv.textContent = isBewerken ? 'Geen extra personen' : 'Alleen jezelf — geen extra personen';
            totalDiv.className = 'inschrijf-popup-samenvatting neutraal';
        } else {
            totalDiv.textContent = `Jezelf + ${totaalExtra} extra persoon${totaalExtra > 1 ? 'en' : ''} = ${totaalExtra + 1} personen in totaal`;
            totalDiv.className = 'inschrijf-popup-samenvatting actief';
        }
    }

    if (kostenDiv) {
        if (totaalKosten > 0) {
            kostenDiv.style.display = 'block';
            kostenDiv.textContent = `Te betalen voor extra personen: €${totaalKosten.toFixed(2)}`;
        } else {
            kostenDiv.style.display = 'none';
        }
    }
}

// ── Inschrijven popup ──────────────────────────────────────────────────
function openInschrijfPopup(wrap) {
    const evenementId     = wrap.dataset.evenementId;
    const extraVelden     = JSON.parse(wrap.dataset.extraVelden || '[]');
    const inschrijfBeschr = wrap.dataset.inschrijfBeschrijving || '';
    const modal = getOrCreateModal();
    const veldenHtml = extraVelden.length ? buildVeldenHtml(extraVelden) : '';

    modal.innerHTML = `
        <div class="inschrijf-popup-card">
            <h3>Inschrijven</h3>
            ${inschrijfBeschr ? `<p class="inschrijf-popup-beschrijving">${htmlEsc(inschrijfBeschr)}</p>` : ''}
            <div class="inschrijf-popup-jijzelf">
                <span class="inschrijf-popup-check">✓</span>
                <span>Jij schrijft jezelf in</span>
            </div>
            ${veldenHtml}
            ${veldenHtml ? `<div id="inschrijfPopupSamenvatting" class="inschrijf-popup-samenvatting neutraal">Alleen jezelf — geen extra personen</div>` : ''}
            <div id="inschrijfPopupKosten" class="inschrijf-popup-kosten" style="display:none;"></div>
            <div id="inschrijfPopupStatus"></div>
            <div class="inschrijf-popup-actions">
                <button class="inschrijf-popup-btn confirm" id="inschrijfPopupConfirm">Bevestigen</button>
                <button class="inschrijf-popup-btn cancel" id="inschrijfPopupCancel">Annuleren</button>
            </div>
        </div>`;

    modal.style.display = 'flex';
    bindVeldControls(modal);
    modal.querySelectorAll('.inschrijf-popup-input').forEach(inp =>
        inp.addEventListener('input', () => updateSamenvatting(modal, extraVelden))
    );
    modal.querySelector('#inschrijfPopupCancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };

    modal.querySelector('#inschrijfPopupConfirm').onclick = async () => {
        const confirmBtn = modal.querySelector('#inschrijfPopupConfirm');
        const statusDiv  = modal.querySelector('#inschrijfPopupStatus');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Bezig...';
        statusDiv.textContent = '';

        const extraAntwoorden = [];
        modal.querySelectorAll('.inschrijf-popup-input').forEach(inp => {
            extraAntwoorden.push({ veldId: inp.dataset.veldId, waarde: inp.value || '0' });
        });

        try {
            let naam = currentUser.displayName || currentUser.email;
            try {
                const usersSnap = await getDocs(collection(db, 'users'));
                usersSnap.forEach(d => {
                    if (d.data().uid === currentUser.uid && d.data().naam) naam = d.data().naam;
                });
            } catch (_) {}

            await setDoc(doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid), {
                uid: currentUser.uid, naam, email: currentUser.email,
                extraAntwoorden,
                ingeschrevenOp: new Date()
            });

            modal.style.display = 'none';
            await updateInschrijfButton(wrap);
        } catch (e) {
            statusDiv.textContent = 'Fout: ' + e.message;
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Bevestigen';
        }
    };
}

// ── Extra's bewerken popup (na inschrijving) ───────────────────────────
async function openBewerkExtrasPopup(wrap) {
    const evenementId = wrap.dataset.evenementId;
    const extraVelden = JSON.parse(wrap.dataset.extraVelden || '[]');
    const modal       = getOrCreateModal();

    modal.innerHTML = `<div class="inschrijf-popup-card"><p>Laden...</p></div>`;
    modal.style.display = 'flex';

    // Haal bestaande antwoorden op
    let bestaandeAntwoorden = [];
    try {
        const snap = await getDoc(doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid));
        if (snap.exists()) bestaandeAntwoorden = snap.data().extraAntwoorden || [];
    } catch (_) {}

    // Only show velden that are marked as wijzigbaar
    const wijzigbareVelden = extraVelden.filter(v => v.wijzigbaar);
    const veldenHtml = buildVeldenHtml(wijzigbareVelden, bestaandeAntwoorden);

    modal.innerHTML = `
        <div class="inschrijf-popup-card">
            <h3>Extra personen aanpassen</h3>
            <p class="inschrijf-popup-beschrijving" style="margin-bottom:1rem;">
                Je bent al ingeschreven. Pas hier het aantal extra personen aan.
            </p>
            ${veldenHtml}
            <div id="inschrijfPopupSamenvatting" class="inschrijf-popup-samenvatting neutraal">Laden...</div>
            <div id="inschrijfPopupKosten" class="inschrijf-popup-kosten" style="display:none;"></div>
            <div id="inschrijfPopupStatus"></div>
            <div class="inschrijf-popup-actions">
                <button class="inschrijf-popup-btn confirm" id="inschrijfPopupConfirm">Opslaan</button>
                <button class="inschrijf-popup-btn cancel" id="inschrijfPopupCancel">Annuleren</button>
            </div>
        </div>`;

    modal.style.display = 'flex';
    bindVeldControls(modal);
    modal.querySelectorAll('.inschrijf-popup-input').forEach(inp =>
        inp.addEventListener('input', () => updateSamenvatting(modal, extraVelden, true))
    );
    updateSamenvatting(modal, extraVelden, true);

    modal.querySelector('#inschrijfPopupCancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };

    modal.querySelector('#inschrijfPopupConfirm').onclick = async () => {
        const confirmBtn = modal.querySelector('#inschrijfPopupConfirm');
        const statusDiv  = modal.querySelector('#inschrijfPopupStatus');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Bezig...';
        statusDiv.textContent = '';

        const extraAntwoorden = [];
        modal.querySelectorAll('.inschrijf-popup-input').forEach(inp => {
            extraAntwoorden.push({ veldId: inp.dataset.veldId, waarde: inp.value || '0' });
        });

        try {
            await setDoc(doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid),
                { extraAntwoorden }, { merge: true });
            modal.style.display = 'none';
            await updateInschrijfButton(wrap);
        } catch (e) {
            statusDiv.textContent = 'Fout: ' + e.message;
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Opslaan';
        }
    };
}

async function handleUitschrijven(wrap) {
    if (!currentUser) return;
    if (!confirm('Wil je je uitschrijven voor dit evenement?')) return;
    const btn         = wrap.querySelector('.inschrijf-btn');
    const evenementId = wrap.dataset.evenementId;
    btn.disabled      = true;
    btn.textContent   = 'Bezig...';
    try {
        await deleteDoc(doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid));
        await updateInschrijfButton(wrap);
    } catch (e) {
        btn.textContent = 'Fout \u2014 probeer opnieuw';
        btn.disabled    = false;
        console.error(e);
    }
}
loadEvenementen();