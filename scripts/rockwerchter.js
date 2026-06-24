// ===============================================
// ROCKWERCHTER DRANKKAART  –  V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, orderBy, limit, getDocs, addDoc, deleteDoc, doc, serverTimestamp }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const PAYCONIQ_MERCHANT_ID = '6311028018dada62cdf95ea2';

// ═══════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════
let currentUser     = null;
let currentUserData = null;
let isLoggedIn      = false;
let isAdmin         = false;   // alleen admin ziet stats

const drankjes = {
    'Primus':         { prijs:  4.00, count: 0, img: 'assets/rockwerchter/Primus.png' },
    'Mystic':         { prijs:  4.00, count: 0, img: 'assets/rockwerchter/Mystic.png' },
    'Stella 0.0':     { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Stella00.png' },
    'Cava of Wijn':   { prijs:  5.00, count: 0, img: 'assets/rockwerchter/CavaWijn.png' },
    'Plat water':     { prijs:  3.30, count: 0, img: 'assets/rockwerchter/PlatWater.png' },
    'Bruisend water': { prijs:  3.30, count: 0, img: 'assets/rockwerchter/BruisendWater.png' },
    'Cola':           { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Cola.png' },
    'Cola Zero':      { prijs:  3.30, count: 0, img: 'assets/rockwerchter/ColaZero.png' },
    'Fanta':          { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Fanta.png' },
    'Fuzetea':        { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Fuzetea.png' },
    'Chips':          { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Chips.png' },
    'Cup Refund':     { prijs: -0.70, count: 0, img: 'assets/rockwerchter/CupRefund.png' }
};

// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════
// Laad de drankkaart direct bij pagina-load (niet afhankelijk van auth)
initializeDrankjes();

onAuthStateChanged(auth, async (user) => {
    const $id = id => document.getElementById(id);

    if (user) {
        currentUser = user; isLoggedIn = true;
        try {
            const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
            if (!snap.empty) {
                currentUserData = snap.docs[0].data();
                const rol      = (currentUserData.rol      || '').toLowerCase();
                const categorie = (currentUserData.categorie || '').toLowerCase();
                const rechten  = currentUserData.rechten || [];
                const toegang  = currentUserData.toegang || [];
                isAdmin = rol === 'admin' || rol === 'bestuurslid';

                // Toegangslogica:
                //   - Tijdelijk account (rol === 'tijdelijk' of categorie === 'extern'):
                //     toegang als toegang[] 'rockwerchter' OF 'werken' bevat
                //     (werken = werklijst-toegang voor het event → impliceert ook drankkaart)
                //   - Alle andere ingelogde accounts (speler, admin, bestuurslid):
                //     altijd toegang
                const isTijdelijk = rol === 'tijdelijk' || categorie === 'extern';
                const heeftToegang = isTijdelijk
                    ? (toegang.includes('rockwerchter') || toegang.includes('werken'))
                    : true;

                $id('loginLink').textContent = 'PROFIEL';

                if (!heeftToegang) {
                    // Klein informatie-kadertje, zelfde stijl als login-banner
                    $id('orderSummary')   && ($id('orderSummary').style.display   = 'none');
                    $id('paymentButtons') && ($id('paymentButtons').style.display = 'none');

                    const banner = $id('loginBanner');
                    if (banner) {
                        banner.className = 'login-banner';
                        banner.innerHTML = `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20" style="flex-shrink:0">
                                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                            <span>Dit account heeft geen toegang tot de drankkaart. Neem contact op met de beheerder.</span>`;
                        banner.style.display = 'flex';
                    }
                    // Contact altijd zichtbaar voor accounts zonder toegang
                    $id('contact') && ($id('contact').style.display = 'flex');
                    return;
                }

                // Volledige toegang: verberg banner + contact, toon menu
                $id('loginBanner').style.display  = 'none';
                $id('orderSummary').style.display  = 'block';
                $id('paymentButtons').style.display = 'flex';
                $id('contact') && ($id('contact').style.display = 'none');

                // Bestellingen-knop + tour help-knop voor alle ingelogde users met toegang
                const bestBtn = $id('bestellingenBtn');
                if (bestBtn) bestBtn.style.display = 'flex';
                const tourHelpBtn = $id('rwTourHelpBtn');
                if (tourHelpBtn) tourHelpBtn.style.display = 'flex';
            } else { guestMode(); }
        } catch (e) { console.error(e); guestMode(); }
    } else {
        currentUser = null; currentUserData = null;
        isLoggedIn = false; isAdmin = false;
        $id('loginLink').textContent = 'LOGIN';
        guestMode();
    }
});

function guestMode() {
    document.getElementById('loginBanner').style.display    = 'flex';
    document.getElementById('orderSummary').style.display   = 'none';
    document.getElementById('paymentButtons').style.display = 'none';
    document.getElementById('contact').style.display        = 'flex';
    const bestBtn = document.getElementById('bestellingenBtn');
    if (bestBtn) bestBtn.style.display = 'none';
}

// ═══════════════════════════════════════════════
// DRANKJES GRID
// ═══════════════════════════════════════════════
async function initializeDrankjes() {
    const container = document.getElementById('drankContainer');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:#888;padding:2rem;grid-column:1/-1;">Laden…</p>';

    try {
        const snap = await getDocs(query(collection(db, 'rw_items'), orderBy('volgorde', 'asc')));

        // Wis bestaande state
        for (const k in drankjes) delete drankjes[k];

        snap.forEach(d => {
            const item = d.data();
            if (item.actief !== false && item.naam) {
                drankjes[item.naam] = {
                    prijs:        item.prijs ?? 0,
                    count:        0,
                    img:          item.img || '',
                    vereistItem:  item.vereistItem  || null,
                    vereistItems: Array.isArray(item.vereistItems) ? item.vereistItems
                                  : (item.vereistItem ? [item.vereistItem] : [])
                };
            }
        });

        container.innerHTML = '';

        if (Object.keys(drankjes).length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#888;padding:2rem;grid-column:1/-1;">Geen items geconfigureerd. Neem contact op met de beheerder.</p>';
            return;
        }

        for (const naam in drankjes) container.appendChild(createDrankCard(naam, drankjes[naam]));

    } catch (e) {
        console.error('Kon drankkaart niet laden:', e);
        container.innerHTML = '<p style="text-align:center;color:#c00;padding:2rem;grid-column:1/-1;">Fout bij laden van de drankkaart.</p>';
    }
}

function createDrankCard(naam, d) {
    const card = document.createElement('div');
    card.className = 'drank-card';
    const prijs = d.prijs < 0 ? `- ${fmt(Math.abs(d.prijs))}` : fmt(d.prijs);
    card.innerHTML = `
        <div class="drank-img-wrapper">
            <img src="${d.img}" alt="${naam}" class="drank-img"
                 onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="drank-img-fallback" style="display:none;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
                    <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
                </svg>
            </div>
            <div class="drank-count-badge" id="badge-${slug(naam)}" style="display:none;">0</div>
        </div>
        <p class="drank-naam">${naam}</p>
        <p class="drank-prijs">${prijs}</p>`;
    card.addEventListener('click', () => {
        if (!isLoggedIn) {
            card.classList.add('shake');
            setTimeout(() => card.classList.remove('shake'), 600);
            return;
        }
        voegToe(naam);
    });
    return card;
}

// ═══════════════════════════════════════════════
// BESTELLING LOGICA
// ═══════════════════════════════════════════════
function voegToe(naam, n = 1) {
    if (!isLoggedIn) return;
    // Dynamische vereiste-check: items die in vereistItems staan moeten aanwezig zijn (OR-logica)
    // vereistItems = array van item-namen waarvan minstens 1 aanwezig moet zijn per refund
    const vereistItems = drankjes[naam]?.vereistItems || (drankjes[naam]?.vereistItem ? [drankjes[naam].vereistItem] : []);
    if (vereistItems.length > 0) {
        // Tel het totaal aantal "vereiste" items dat gekocht is
        const totalVereist = vereistItems.reduce((sum, v) => sum + (drankjes[v]?.count ?? 0), 0);
        // Dit item mag max zo vaak als het totaal van de vereiste items
        if (drankjes[naam].count + n > totalVereist) {
            showToast(`Selecteer eerst ${vereistItems.join(' of ')} .Extra bekers via qr-code.`, 'error');
            return;
        }
    }
    drankjes[naam].count += n;
    sync(naam);
}

function verwijder(naam) {
    if (!isLoggedIn || drankjes[naam].count === 0) return;
    drankjes[naam].count--;
    clampRefunds(naam); sync(naam);
}

function verwijderAlles(naam) {
    if (!isLoggedIn) return;
    drankjes[naam].count = 0;
    clampRefunds(naam); sync(naam);
}

function clampRefunds(naam) {
    // Clamp alle items waarbij naam in de vereistItems staat
    for (const depNaam in drankjes) {
        const dep = drankjes[depNaam];
        const vereistItems = dep.vereistItems || (dep.vereistItem ? [dep.vereistItem] : []);
        if (!vereistItems.includes(naam)) continue;
        // Herbereken max toegestaan
        const totalVereist = vereistItems.reduce((sum, v) => sum + (drankjes[v]?.count ?? 0), 0);
        if (dep.count > totalVereist) {
            dep.count = totalVereist;
            badge(depNaam);
        }
    }
}

function sync(naam) { badge(naam); updateTotaal(); updateOverzicht(); updatePayBtns(); }

function badge(naam) {
    const el = document.getElementById(`badge-${slug(naam)}`);
    if (!el) return;
    const c = drankjes[naam].count;
    el.textContent = c; el.style.display = c > 0 ? 'flex' : 'none';
}

function getTotaal() {
    return Object.values(drankjes).reduce((s, d) => s + d.prijs * d.count, 0);
}

function heeftItems() {
    return Object.values(drankjes).some(d => d.count > 0);
}

function fmt(n) { return `\u20AC${Math.max(0, n).toFixed(2).replace('.', ',')}`; }
function slug(s) { return s.replace(/\s+/g, '-'); }

function updateTotaal() {
    const el = document.getElementById('totaalPrijs');
    if (el) el.textContent = `Totaal: ${fmt(getTotaal())}`;
}

function updatePayBtns() {
    const ok = heeftItems() && isLoggedIn;
    ['kaartBtn','qrBtn','cashBtn'].forEach(id => {
        const b = document.getElementById(id); if (b) b.disabled = !ok;
    });
}

function updateOverzicht() {
    const el = document.getElementById('overzichtContainer');
    el.innerHTML = '';
    let iets = false;
    for (const naam in drankjes) {
        const d = drankjes[naam]; if (d.count === 0) continue;
        iets = true;
        const item = document.createElement('div');
        item.className = 'overzicht-item';
        item.innerHTML = `
            <span class="item-naam">${d.count}\u00D7 ${naam}</span>
            <div class="item-knoppen">
                <button class="item-btn plus-btn">+3</button>
                <button class="item-btn min-btn">\u22121</button>
                <button class="item-btn delete-btn">\u00D7</button>
            </div>`;
        item.querySelector('.plus-btn').addEventListener('click',   () => voegToe(naam, 3));
        item.querySelector('.min-btn').addEventListener('click',    () => verwijder(naam));
        item.querySelector('.delete-btn').addEventListener('click', () => verwijderAlles(naam));
        el.appendChild(item);
    }
    if (!iets) el.innerHTML = '<p class="empty-message">Nog niets geselecteerd.</p>';
}

function resetAlles() {
    for (const n in drankjes) { drankjes[n].count = 0; badge(n); }
    updateTotaal(); updateOverzicht(); updatePayBtns();
}

function resetNaBetaling() {
    for (const n in drankjes) { drankjes[n].count = 0; badge(n); }
    updateTotaal(); updateOverzicht(); updatePayBtns();
}

document.getElementById('resetBtn').addEventListener('click', resetAlles);

// ═══════════════════════════════════════════════
// FIRESTORE – OPSLAAN
// ═══════════════════════════════════════════════
async function slaOp(methode, extra = {}) {
    const items = {}; let aantalItems = 0;
    for (const n in drankjes) {
        if (drankjes[n].count > 0) {
            items[n] = {
                count: drankjes[n].count, prijs: drankjes[n].prijs,
                subtotaal: +(drankjes[n].prijs * drankjes[n].count).toFixed(2)
            };
            aantalItems += drankjes[n].count;
        }
    }
    const bestellingDoc = {
        userId:        currentUser?.uid ?? 'gast',
        userName:      currentUserData?.naam ?? 'Onbekend',
        items, aantalItems,
        totaal:        +getTotaal().toFixed(2),
        betaalmethode: methode,
        datum:         serverTimestamp(),
        ...extra
    };
    const ref = await addDoc(collection(db, 'rockwerchter_bestellingen'), bestellingDoc);
    return ref.id;
}

// ═══════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════
function openModal(id)  { document.getElementById(id)?.classList.add('active');    document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); document.body.style.overflow = ''; }

document.querySelectorAll('.rw-modal-backdrop').forEach(bd =>
    bd.addEventListener('click', e => {
        if (e.target === bd) { bd.classList.remove('active'); document.body.style.overflow = ''; }
    })
);

// ═══════════════════════════════════════════════
// 1) KAART – stap 1
// ═══════════════════════════════════════════════
let geselecteerdeTerminal = null;

document.getElementById('kaartBtn').addEventListener('click', () => {
    document.getElementById('kaartTotaal').textContent = `Te betalen: ${fmt(getTotaal())}`;
    geselecteerdeTerminal = null;
    document.querySelectorAll('.terminal-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('kaartVerzend').disabled = true;
    openModal('kaartModal');
});
document.getElementById('kaartModalClose').addEventListener('click',  () => closeModal('kaartModal'));
document.getElementById('kaartModalCancel').addEventListener('click', () => closeModal('kaartModal'));

document.querySelectorAll('.terminal-btn').forEach(btn =>
    btn.addEventListener('click', () => {
        document.querySelectorAll('.terminal-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        geselecteerdeTerminal = btn.dataset.terminal;
        document.getElementById('kaartVerzend').disabled = false;
    })
);

// Stap 1 → stap 2: GEEN opslag, enkel modal wisselen
document.getElementById('kaartVerzend').addEventListener('click', () => {
    closeModal('kaartModal');
    document.getElementById('terminalWachtInfo').innerHTML =
        `<span class="terminal-badge">Terminal ${geselecteerdeTerminal}</span>
         <p>De bestelling is verzonden. Wacht op bevestiging van de terminal.</p>`;
    document.getElementById('kaartBevestigTotaal').textContent = `Te betalen: ${fmt(getTotaal())}`;
    document.getElementById('kaartBevestigStatus').style.display = 'none';
    document.getElementById('kaartGelukt').disabled  = false;
    document.getElementById('kaartMislukt').disabled = false;
    document.getElementById('kaartGelukt').textContent  = '\u2713 Betaling gelukt';
    openModal('kaartBevestigModal');
});

// Stap 2 – gelukt → sla op
document.getElementById('kaartGelukt').addEventListener('click', async () => {
    const btnOk  = document.getElementById('kaartGelukt');
    const btnNok = document.getElementById('kaartMislukt');
    const st     = document.getElementById('kaartBevestigStatus');
    btnOk.disabled = true; btnNok.disabled = true;
    btnOk.textContent = 'Opslaan...';
    try {
        const id = await slaOp('kaart', { terminal: `Terminal ${geselecteerdeTerminal}`, status: 'geslaagd' });
        st.className = 'modal-status success';
        st.innerHTML = `\u2713 Betaling geregistreerd! <small>(ID: ${id})</small>`;
        st.style.display = 'block';
        btnOk.textContent = '\u2713 Geregistreerd';
        setTimeout(() => { closeModal('kaartBevestigModal'); btnOk.textContent = '\u2713 Betaling gelukt'; resetNaBetaling(); }, 2000);
    } catch {
        st.className = 'modal-status error';
        st.textContent = 'Fout bij opslaan. Probeer opnieuw.';
        st.style.display = 'block';
        btnOk.disabled = false; btnNok.disabled = false;
        btnOk.textContent = '\u2713 Betaling gelukt';
    }
});

// Stap 2 – geannuleerd → sluit, bestelling intact
document.getElementById('kaartMislukt').addEventListener('click', () => closeModal('kaartBevestigModal'));

// ═══════════════════════════════════════════════
// 2) PAYCONIQ
// ═══════════════════════════════════════════════
document.getElementById('qrBtn').addEventListener('click', () => {
    const totaal = getTotaal();
    const centen = Math.round(totaal * 100);
    document.getElementById('qrTotaal').textContent = `Te betalen: ${fmt(totaal)}`;
    document.getElementById('qrStatus').style.display = 'none';
    const url = `https://payconiq.com/merchant/1/${PAYCONIQ_MERCHANT_ID}?amount=${centen}&description=VVS+Rockwerchter`;
    const canvas = document.getElementById('qrCanvas');
    if (typeof QRCode !== 'undefined') {
        QRCode.toCanvas(canvas, url, { width: 220, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } },
            err => { if (err) console.error('QR fout:', err); });
    }
    openModal('qrModal');
});
document.getElementById('qrModalClose').addEventListener('click',  () => closeModal('qrModal'));
document.getElementById('qrModalCancel').addEventListener('click', () => closeModal('qrModal'));

document.getElementById('qrBevestig').addEventListener('click', async () => {
    const btn = document.getElementById('qrBevestig');
    const st  = document.getElementById('qrStatus');
    btn.disabled = true; btn.textContent = 'Opslaan...';
    try {
        const id = await slaOp('payconiq');
        st.className = 'modal-status success';
        st.innerHTML = `\u2713 Payconiq bevestigd! <small>(ID: ${id})</small>`;
        st.style.display = 'block';
        btn.textContent = '\u2713 Bevestigd';
        setTimeout(() => { closeModal('qrModal'); btn.textContent = '\u2713 Betaling bevestigen'; btn.disabled = false; resetNaBetaling(); }, 2000);
    } catch {
        st.className = 'modal-status error'; st.textContent = 'Fout bij opslaan. Probeer opnieuw.'; st.style.display = 'block';
        btn.disabled = false; btn.textContent = '\u2713 Betaling bevestigen';
    }
});

// ═══════════════════════════════════════════════
// 3) CASH – fix: typveld overschrijft, snelknoppen tellen op
// ═══════════════════════════════════════════════
let cashOntvangen = 0;
let cashTypModus  = false; // true = gebruiker is aan het typen → snelknoppen tellen NIET op

function updateCashUI() {
    const totaal = getTotaal();
    const input  = document.getElementById('cashOntvangen');

    // Sync het veld alleen als we NIET in typmodus zijn
    if (!cashTypModus) {
        input.value = cashOntvangen > 0 ? cashOntvangen.toFixed(2) : '';
    }

    const wDisplay = document.getElementById('wisselgeldDisplay');
    const wBedrag  = document.getElementById('wisselgeldBedrag');
    const btn      = document.getElementById('cashBevestig');

    if (cashOntvangen > 0.001) {
        const wissel = cashOntvangen - totaal;
        wDisplay.style.display = 'flex';
        if (wissel < -0.005) {
            wBedrag.textContent = `Te weinig (${fmt(Math.abs(wissel))} tekort)`;
            wBedrag.className   = 'wisselgeld-bedrag te-weinig';
            btn.disabled = true;
        } else {
            wBedrag.textContent = fmt(Math.max(0, wissel));
            wBedrag.className   = 'wisselgeld-bedrag';
            btn.disabled = false;
        }
    } else {
        wDisplay.style.display = 'none';
        btn.disabled = true;
    }
}

// Snelknoppen: tellen ALTIJD cumulatief op (ook als er getypt werd)
document.querySelectorAll('.cash-snel-btn[data-bedrag]').forEach(btn =>
    btn.addEventListener('click', () => {
        cashTypModus  = false;
        cashOntvangen = +(cashOntvangen + parseFloat(btn.dataset.bedrag)).toFixed(2);
        updateCashUI();
    })
);

// Vinkje = exact bedrag (overschrijft)
document.getElementById('cashExact').addEventListener('click', () => {
    cashTypModus  = false;
    cashOntvangen = +getTotaal().toFixed(2);
    updateCashUI();
});

// Kruisje = reset volledig
document.getElementById('cashReset').addEventListener('click', () => {
    cashTypModus  = false;
    cashOntvangen = 0;
    document.getElementById('cashOntvangen').value = '';
    updateCashUI();
});

// Typen: gebruiker typt vrij, dit VERVANGT (overschrijft) het opgetelde bedrag
document.getElementById('cashOntvangen').addEventListener('focus', () => {
    cashTypModus = true;
});
document.getElementById('cashOntvangen').addEventListener('input', e => {
    // Vervang komma door punt voor correcte parsing
    const raw = e.target.value.replace(',', '.');
    cashOntvangen = parseFloat(raw) || 0;
    updateCashUI();
});
document.getElementById('cashOntvangen').addEventListener('blur', () => {
    // Na blur: sync de weergave en zet modus terug
    cashTypModus = false;
    updateCashUI();
});

// Open cash modal
document.getElementById('cashBtn').addEventListener('click', () => {
    cashOntvangen = 0;
    cashTypModus  = false;
    document.getElementById('cashTotaal').textContent = `Te betalen: ${fmt(getTotaal())}`;
    document.getElementById('cashOntvangen').value    = '';
    document.getElementById('wisselgeldDisplay').style.display = 'none';
    document.getElementById('cashBevestig').disabled  = true;
    document.getElementById('cashStatus').style.display = 'none';
    openModal('cashModal');
});
document.getElementById('cashModalClose').addEventListener('click',  () => closeModal('cashModal'));
document.getElementById('cashModalCancel').addEventListener('click', () => closeModal('cashModal'));

document.getElementById('cashBevestig').addEventListener('click', async () => {
    const totaal = getTotaal();
    const wissel = +(cashOntvangen - totaal).toFixed(2);
    const btn    = document.getElementById('cashBevestig');
    const st     = document.getElementById('cashStatus');
    btn.disabled = true; btn.textContent = 'Opslaan...';
    try {
        const id = await slaOp('cash', { ontvangen: +cashOntvangen.toFixed(2), wisselgeld: wissel });
        st.className = 'modal-status success';
        st.innerHTML = `\u2713 Geregistreerd! Wisselgeld: ${fmt(Math.max(0, wissel))} <small>(ID: ${id})</small>`;
        st.style.display = 'block';
        btn.textContent = '\u2713 Geregistreerd';
        setTimeout(() => { closeModal('cashModal'); btn.textContent = '\u2713 Bevestigen'; btn.disabled = false; resetNaBetaling(); }, 2000);
    } catch {
        st.className = 'modal-status error'; st.textContent = 'Fout bij opslaan. Probeer opnieuw.'; st.style.display = 'block';
        btn.disabled = false; btn.textContent = '\u2713 Bevestigen';
    }
});

// ═══════════════════════════════════════════════
// 4) BESTELLINGEN OVERZICHT
// ═══════════════════════════════════════════════

// Paginatie-state
let alleDocs      = [];   // alle geladen Firestore-docs
let getoondAantal = 0;    // hoeveel er momenteel getoond worden
let totaalOmzet   = 0;
let totaalAantal  = 0;
let perMethode    = {};
const PAGE_SIZE   = 15;
const PAGE_MEER   = 5;

document.getElementById('bestellingenBtn').addEventListener('click', laadBestellingen);
document.getElementById('bestellingenModalClose').addEventListener('click', () => closeModal('bestellingenModal'));
document.getElementById('bestellingenSluiten').addEventListener('click',    () => closeModal('bestellingenModal'));

async function laadBestellingen() {
    const lijstEl = document.getElementById('bestLijst');
    const statsEl = document.getElementById('bestStats');
    lijstEl.innerHTML = '<p class="loading-tekst"><div class="loader"></div></p>';
    statsEl.innerHTML = '';
    alleDocs      = [];
    getoondAantal = 0;
    totaalOmzet   = 0;
    totaalAantal  = 0;
    perMethode    = {};
    openModal('bestellingenModal');

    try {
        // Haal alles op (max 500) gesorteerd op datum desc
        const q    = query(collection(db, 'rockwerchter_bestellingen'), orderBy('datum', 'desc'), limit(500));
        const snap = await getDocs(q);

        if (snap.empty) {
            lijstEl.innerHTML = '<p class="empty-message">Nog geen bestellingen.</p>';
            return;
        }

        snap.forEach(d => {
            const data = { ...d.data(), _docId: d.id };
            alleDocs.push(data);
            totaalOmzet += data.totaal || 0;
            totaalAantal++;
            const m = data.betaalmethode || 'onbekend';
            perMethode[m] = (perMethode[m] || 0) + 1;
        });

        // Stats: alleen admin
        renderStats(statsEl);

        // Toon eerste 15
        lijstEl.innerHTML = '';
        toonMeer(lijstEl, PAGE_SIZE);

    } catch (e) {
        console.error(e);
        lijstEl.innerHTML = '<p class="modal-status error">Fout bij laden. Controleer Firestore rules.</p>';
    }
}

function renderStats(statsEl) {
    if (!isAdmin) { statsEl.innerHTML = ''; return; }
    statsEl.innerHTML = `
        <div class="best-stat-rij">
            <div class="best-stat">
                <span class="best-stat-getal">${totaalAantal}</span>
                <span class="best-stat-label">Bestellingen</span>
            </div>
            <div class="best-stat">
                <span class="best-stat-getal">${fmt(totaalOmzet)}</span>
                <span class="best-stat-label">Totale omzet</span>
            </div>
            ${Object.entries(perMethode).map(([m, n]) => `
                <div class="best-stat">
                    <span class="best-stat-getal">${n}</span>
                    <span class="best-stat-label">${m}</span>
                </div>`).join('')}
        </div>
        ${isAdmin ? '<button class="export-btn" id="exportBtn">&#8681; Exporteer naar Excel</button>' : ''}`;

    if (isAdmin) {
        document.getElementById('exportBtn')?.addEventListener('click', exportNaarExcel);
    }
}

function toonMeer(lijstEl, aantal) {
    // Verwijder bestaande "meer laden" knop als die er is
    document.getElementById('meerLadenBtn')?.remove();

    const tot   = Math.min(getoondAantal + aantal, alleDocs.length);
    const slice = alleDocs.slice(getoondAantal, tot);

    slice.forEach(data => {
        lijstEl.appendChild(maakBestellingKaart(data, lijstEl));
    });

    getoondAantal = tot;

    // "Meer laden" knop enkel tonen als er nog meer zijn
    if (getoondAantal < alleDocs.length) {
        const rest  = Math.min(PAGE_MEER, alleDocs.length - getoondAantal);
        const btn   = document.createElement('button');
        btn.id        = 'meerLadenBtn';
        btn.className = 'meer-laden-btn';
        btn.textContent = `Meer laden (+${rest})`;
        btn.addEventListener('click', () => toonMeer(lijstEl, PAGE_MEER));
        lijstEl.appendChild(btn);
    }
}

function maakBestellingKaart(data, lijstEl) {
    const datum    = data.datum?.toDate ? data.datum.toDate() : new Date();
    const tijdStr  = datum.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const datumStr = datum.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit' });
    const itemsStr = Object.entries(data.items || {}).map(([n, v]) => `${v.count}\u00D7 ${n}`).join(', ');
    const icon     = { kaart: '\uD83D\uDCB3', payconiq: '\uD83D\uDCF1', cash: '\uD83D\uDCB5' }[data.betaalmethode] || '?';
    const extra    = data.betaalmethode === 'kaart' ? ` \u00B7 ${data.terminal || ''}`
                   : data.betaalmethode === 'cash'  ? ` \u00B7 wisselgeld: ${fmt(data.wisselgeld ?? 0)}`
                   : '';

    const kaart = document.createElement('div');
    kaart.className = 'best-kaart';

    // Delete-knop voor iedereen (ingelogd)
    kaart.innerHTML = `
        <div class="best-kaart-header">
            <div class="best-kaart-tijd">
                <span class="best-datum">${datumStr}</span>
                <span class="best-tijd">${tijdStr}</span>
            </div>
            <div class="best-kaart-meta">
                <span class="best-methode">${icon} ${data.betaalmethode}${extra}</span>
                <span class="best-naam">${data.userName || ''}</span>
            </div>
            <span class="best-prijs">${fmt(data.totaal || 0)}</span>
            <button class="best-delete-btn" title="Verwijder bestelling" data-id="${data._docId}">\u00D7</button>
        </div>
        <div class="best-items">${itemsStr}</div>`;

    kaart.querySelector('.best-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const docId = data._docId;
        if (!confirm('Bestelling verwijderen?')) return;
        try {
            await deleteDoc(doc(db, 'rockwerchter_bestellingen', docId));
            // Verwijder uit alleDocs
            const idx = alleDocs.findIndex(d => d._docId === docId);
            if (idx !== -1) {
                alleDocs.splice(idx, 1);
                totaalOmzet  -= data.totaal || 0;
                totaalAantal--;
                perMethode[data.betaalmethode] = (perMethode[data.betaalmethode] || 1) - 1;
                if (perMethode[data.betaalmethode] <= 0) delete perMethode[data.betaalmethode];
                getoondAantal = Math.max(0, getoondAantal - 1);
            }
            kaart.remove();
            // Stats herrenderen
            renderStats(document.getElementById('bestStats'));
            if (alleDocs.length === 0) {
                lijstEl.innerHTML = '<p class="empty-message">Geen bestellingen meer.</p>';
            }
        } catch (err) {
            console.error('Delete fout:', err);
            showToast('Fout bij verwijderen. Controleer je rechten.', 'error');
        }
    });

    return kaart;
}

// ═══════════════════════════════════════════════
// 5) EXCEL EXPORT + DATABASE LEEGMAKEN (admin)
//
// Stap 1 – exportNaarExcel():  download .xlsx, open bevestigingsmodal
// Stap 2 – leegDatabase():     verwijder alle docs na bevestiging admin
// ═══════════════════════════════════════════════

let exportDocIds = []; // bewaar doc-IDs tussen stap 1 en stap 2

// Stap 1: exporteer naar Excel, open bevestigingsmodal
async function exportNaarExcel() {
    if (!isAdmin) return;

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = 'Exporteren...'; }

    try {
        const q    = query(collection(db, 'rockwerchter_bestellingen'), orderBy('datum', 'asc'));
        const snap = await getDocs(q);

        if (snap.empty) {
            showToast('Geen bestellingen om te exporteren.');
            if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = '\u21E9 Exporteer naar Excel'; }
            return;
        }

        // Bouw Excel-rijen
        const rijen = [['Datum', 'Tijd', 'Naam', 'Betaalmethode', 'Items', 'Totaal (\u20AC)', 'Ontvangen (\u20AC)', 'Wisselgeld (\u20AC)', 'Terminal', 'Bestelling ID']];
        exportDocIds = [];

        snap.forEach(d => {
            const data     = d.data();
            const datum    = data.datum?.toDate ? data.datum.toDate() : new Date();
            const datumStr = datum.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const tijdStr  = datum.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const items    = Object.entries(data.items || {}).map(([n, v]) => `${v.count}x ${n}`).join(', ');
            exportDocIds.push(d.id);
            rijen.push([
                datumStr, tijdStr,
                data.userName    || '',
                data.betaalmethode || '',
                items,
                data.totaal      ?? 0,
                data.ontvangen   ?? '',
                data.wisselgeld  ?? '',
                data.terminal    ?? '',
                d.id
            ]);
        });

        // Genereer xlsx
        const ws = XLSX.utils.aoa_to_sheet(rijen);
        ws['!cols'] = [
            { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 14 },
            { wch: 50 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
            { wch: 12 }, { wch: 28 }
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Bestellingen');

        const now  = new Date();
        const naam = `rockwerchter_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}.xlsx`;
        XLSX.writeFile(wb, naam);

        // Reset export-knop
        if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = '\u21E9 Exporteer naar Excel'; }

        // Open bevestigingsmodal (stap 2)
        const info = document.getElementById('exportBevestigInfo');
        if (info) {
            info.innerHTML = `
                <div class="export-info-rij">
                    <span class="export-info-label">Bestand</span>
                    <span class="export-info-waarde">${naam}</span>
                </div>
                <div class="export-info-rij">
                    <span class="export-info-label">Bestellingen</span>
                    <span class="export-info-waarde">${exportDocIds.length}</span>
                </div>`;
        }
        document.getElementById('exportModalStatus').style.display = 'none';
        document.getElementById('exportLeegBtn').disabled  = false;
        document.getElementById('exportLeegBtn').textContent = '\uD83D\uDDD1\uFE0F Database leegmaken';
        openModal('exportModal');

    } catch (err) {
        console.error('Export fout:', err);
        showToast('Fout bij exporteren: ' + err.message, 'error');
        if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = '\u21E9 Exporteer naar Excel'; }
    }
}

// Stap 2: verwijder alle docs na bevestiging
async function leegDatabase() {
    if (!isAdmin || exportDocIds.length === 0) return;

    const leegBtn = document.getElementById('exportLeegBtn');
    const annuleerBtn = document.getElementById('exportAnnuleer');
    const statusEl   = document.getElementById('exportModalStatus');

    leegBtn.disabled     = true;
    annuleerBtn.disabled = true;

    let verwijderd = 0;
    leegBtn.textContent = `Verwijderen (0/${exportDocIds.length})...`;

    try {
        for (const docId of exportDocIds) {
            await deleteDoc(doc(db, 'rockwerchter_bestellingen', docId));
            verwijderd++;
            leegBtn.textContent = `Verwijderen (${verwijderd}/${exportDocIds.length})...`;
        }

        // Reset alle staat
        alleDocs      = [];
        getoondAantal = 0;
        totaalOmzet   = 0;
        totaalAantal  = 0;
        perMethode    = {};
        exportDocIds  = [];

        statusEl.className   = 'modal-status success';
        statusEl.textContent = `\u2713 ${verwijderd} bestellingen verwijderd uit de database.`;
        statusEl.style.display = 'block';
        leegBtn.textContent  = '\u2713 Geleegd';

        // Na 2s: sluit modal, reset UI
        setTimeout(() => {
            closeModal('exportModal');
            document.getElementById('bestLijst').innerHTML =
                '<p class="empty-message">Database geleegd. Exportbestand is gedownload.</p>';
            document.getElementById('bestStats').innerHTML = '';
            annuleerBtn.disabled = false;
        }, 2000);

    } catch (err) {
        console.error('Leeg fout:', err);
        statusEl.className   = 'modal-status error';
        statusEl.textContent = 'Fout bij verwijderen: ' + err.message;
        statusEl.style.display = 'block';
        leegBtn.disabled     = false;
        annuleerBtn.disabled = false;
        leegBtn.textContent  = '\uD83D\uDDD1\uFE0F Database leegmaken';
    }
}

// Event listeners voor de export modal
document.getElementById('exportAnnuleer').addEventListener('click', () => {
    exportDocIds = []; // vergeet de IDs als geannuleerd
    closeModal('exportModal');
});
document.getElementById('exportLeegBtn').addEventListener('click', leegDatabase);

let toastTimer;
function showToast(msg, type = '') {
    let t = document.getElementById('adminToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'adminToast';
        t.style.cssText = `position:fixed;bottom:1.75rem;right:1.75rem;background:var(--text-dark);color:var(--white);padding:0.75rem 1.3rem;border-radius:9px;font-size:0.88rem;font-weight:600;z-index:9999;transform:translateY(80px);opacity:0;transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;max-width:320px;`;
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--text-dark)';
    t.style.transform  = 'translateY(0)';
    t.style.opacity    = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.transform = 'translateY(80px)'; t.style.opacity = '0'; }, 3500);
}


console.log('Rockwerchter.js klaar');
// ═══════════════════════════════════════════════
// BARMAN TOUR – rockwerchter.html
// Eenmalig getoond voor ingelogde leden.
// Herstartbaar via ?tour=1 of programmatisch.
// ═══════════════════════════════════════════════

const RW_TOUR_KEY = 'vvs_rw_tour_v1';

// ── Helpers ────────────────────────────────────────────────────────────────

function _rwOpenCashModal() {
    const modal = document.getElementById('cashModal');
    if (modal) modal.style.display = 'flex';
    // Zet een demo-bedrag zodat de wisselgeld UI logisch aanvoelt
    const tot = document.getElementById('cashTotaal');
    if (tot && !tot.textContent.trim()) tot.textContent = 'Te betalen: €0,00';
}
function _rwCloseCashModal() {
    const modal = document.getElementById('cashModal');
    if (modal) modal.style.display = 'none';
}

function _rwSimulateSelect() {
    // Selecteer de eerste twee items als voorbeeld (visuele demo)
    const cards = document.querySelectorAll('#drankContainer .drank-card');
    let tapped = 0;
    cards.forEach(c => {
        if (tapped < 2 && isLoggedIn) { c.click(); tapped++; }
    });
}

// ── Stappen ────────────────────────────────────────────────────────────────

const RW_TOUR_STEPS = [
    // 0: Intro
    {
        icon: '🍺',
        title: 'Welkom — Barman rondleiding',
        desc: 'Deze gids legt de Rock Werchter drankkaart uit. Als barman gebruik je deze pagina om bestellingen in te geven en af te rekenen. We doorlopen samen de kaart, de selectie en de drie betaalmethodes.',
        target: null,
    },

    // 1: Drankkaart algemeen
    {
        icon: '',
        title: 'De drankkaart',
        desc: 'Hier zie je alle beschikbare dranken. Elk item toont een afbeelding, naam en prijs. Klik een item aan om het aan de bestelling toe te voegen — het getal rechtsboven op de kaart toont het aantal.',
        target: '#drankContainer',
    },

    // 2: Item met vereist item
    {
        icon: '',
        title: 'Vereist item',
        desc: 'Sommige items kunnen niet los aangeklikt worden totdat een vereist item al in de bestelling zit.<br><br>💡 <em>Voorbeeld:</em> Een Cup Refund kan pas aangeklikt worden als er een nieuwe consumptie met beker besteld wordt. Extra bekers via QR.',
        target: '#drankContainer .drank-card',
    },

    // 3: Demo selectie
    {
        icon: '',
        title: 'Items selecteren',
        desc: 'We selecteren even twee items als voorbeeld. Het badge-getal op de kaart stijgt bij elke klik. Klik een al geselecteerd item opnieuw aan om de hoeveelheid te verhogen.',
        target: '#drankContainer .drank-card',
        onEnter() { _rwSimulateSelect(); },
    },

    // 4: Betaalrij algemeen
    {
        icon: '',
        title: 'Betaalmogelijkheden',
        desc: 'Zodra er items in de bestelling zitten worden de drie betaalknoppen actief. Kies de methode die de klant verkiest.',
        target: '#paymentButtons',
    },

    // 5: Bancontact/kaart
    {
        icon: '',
        title: 'Betalen met kaart',
        desc: 'Klik op <strong>"Kaart"</strong> om de betaling via bancontact/terminal te verwerken. Je kiest de juiste terminal uit de lijst en bevestigt zodra de klant betaald heeft.',
        target: '#kaartBtn',
    },

    // 6: Payconiq/QR
    {
        icon: '',
        title: 'Betalen met Payconiq',
        desc: 'Klik op <strong>"Payconiq"</strong> om een QR-code te genereren. De klant scant die op zijn telefoon. Bevestig eens de betaling geslaagd is.',
        target: '#qrBtn',
    },

    // 7: Cash knop
    {
        icon: '',
        title: 'Betalen met cash',
        desc: 'Klik op <strong>"Cash"</strong> om het cashbetaalvenster te openen. Hieronder zoomen we in op hoe je het wisselgeld snel berekent.',
        target: '#cashBtn',
    },

    // 8: Cash modal — snelknoppen
    {
        icon: '',
        title: 'Cashbetaling & wisselgeld',
        desc: 'Gebruik de snelknoppen (€50, €20, €10 …) om het ontvangen bedrag in te geven. Het wisselgeld wordt automatisch berekend en groot weergegeven. Meerdere knoppen klikken telt op — bv. €20 + €5 = €25.',
        target: '.cash-snelknoppen',
        delay: 350,
        onEnter() { _rwOpenCashModal(); },
        onLeave() { _rwCloseCashModal(); },
    },

    // 9: Exact knop
    {
        icon: '',
        title: 'Exact betalen',
        desc: 'Gaat hoofdrekenen nog soepel? — gebruik dan <strong>"✓ Exact"</strong>. Dat vult automatisch het totaalbedrag in als ontvangen bedrag.',
        target: '#cashExact',
        delay: 350,
        onEnter() { _rwOpenCashModal(); },
        onLeave() { _rwCloseCashModal(); },
    },

    // 10: Einde
    {
        icon: '🎉',
        title: 'Klaar!',
        desc: 'Je kent nu de volledige werking van de drankkaart. Via het vraagteken-icoontje (?) kan je de rondleiding altijd opnieuw starten. Veel succes aan de toog!',
        target: null,
    },
];

// ── Engine ─────────────────────────────────────────────────────────────────
let _rwStep = 0;
let _rwResizeH = null;

const _RW_PAD = 8, _RW_GAP = 14, _RW_CW = 360;

function _rwclamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _rwGetEl(sel) {
    if (!sel) return null;
    try {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return (r.width === 0 && r.height === 0) ? null : el;
    } catch { return null; }
}

function _rwSpotlight(el) {
    const s = document.getElementById('rwTourSpotlight');
    if (!s || !el) return;
    const r = el.getBoundingClientRect();
    s.style.top    = (r.top    - _RW_PAD) + 'px';
    s.style.left   = (r.left   - _RW_PAD) + 'px';
    s.style.width  = (r.width  + _RW_PAD*2) + 'px';
    s.style.height = (r.height + _RW_PAD*2) + 'px';
    s.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.50),0 0 0 2.5px #0047ab,0 0 12px 4px rgba(0,71,171,0.25)';
    s.style.display = 'block';
}

function _rwPosCard(el) {
    const card = document.getElementById('rwTourCard');
    if (!card || !el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = Math.min(_RW_CW, vw - 32), ch = card.offsetHeight || 260;
    const sT = r.top - _RW_PAD, sB = r.bottom + _RW_PAD, sR = r.right + _RW_PAD;
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    let pos = 'bottom';
    if (sB + ch + _RW_GAP + 16 > vh && sT - ch - _RW_GAP - 16 >= 0) pos = 'top';
    else if (sB + ch + _RW_GAP + 16 > vh && sR + cw + _RW_GAP + 16 <= vw) pos = 'right';
    let top, left;
    if (pos === 'bottom') { top = sB + _RW_GAP; left = _rwclamp(cx - cw/2, 16, vw-cw-16); }
    else if (pos === 'top') { top = sT - _RW_GAP - ch; left = _rwclamp(cx - cw/2, 16, vw-cw-16); }
    else { top = _rwclamp(cy - ch/2, 16, vh-ch-16); left = sR + _RW_GAP; }
    top = _rwclamp(top, 16, vh - ch - 16);
    Object.assign(card.style, { position:'fixed', top:top+'px', left:left+'px', width:cw+'px', maxWidth:cw+'px', transform:'none', display:'block' });
}

function _rwCenterCard() {
    const card = document.getElementById('rwTourCard');
    if (!card) return;
    Object.assign(card.style, { position:'fixed', top:'50%', left:'50%', width:'min(440px, calc(100vw - 2rem))', maxWidth:'', transform:'translate(-50%,-50%)', display:'block' });
}

function _rwBuildDots() {
    const c = document.getElementById('rwTourProgress');
    if (!c) return;
    c.innerHTML = '';
    RW_TOUR_STEPS.forEach((_, i) => {
        const d = document.createElement('button');
        d.className = 'tour-dot' + (i < _rwStep ? ' done' : '') + (i === _rwStep ? ' active' : '');
        d.setAttribute('aria-label', `Stap ${i+1}`);
        d.addEventListener('click', () => _rwGoTo(i));
        c.appendChild(d);
    });
}

function _rwUpdateNav() {
    const isFirst = _rwStep === 0;
    const isLast  = _rwStep === RW_TOUR_STEPS.length - 1;
    document.getElementById('rwTourPrev')  .style.display = isFirst ? 'none' : '';
    document.getElementById('rwTourNext')  .style.display = isLast  ? 'none' : '';
    document.getElementById('rwTourFinish').style.display = isLast  ? '' : 'none';
}

function _rwRender() {
    const step = RW_TOUR_STEPS[_rwStep];
    if (!step) return;
    document.getElementById('rwTourIcon').textContent  = step.icon  || '';
    document.getElementById('rwTourTitle').textContent = step.title || '';
    document.getElementById('rwTourDesc').innerHTML    = step.desc  || '';
    _rwUpdateNav();
    _rwBuildDots();

    const overlay = document.getElementById('rwTourOverlay');
    const spot    = document.getElementById('rwTourSpotlight');

    requestAnimationFrame(() => {
        if (step.onEnter) step.onEnter();

        const _after = () => {
            const el = _rwGetEl(step.target);
            if (el) {
                if (overlay) { overlay.style.background = 'transparent'; overlay.style.display = 'block'; }
                el.scrollIntoView({ behavior:'instant', block:'center', inline:'nearest' });
                requestAnimationFrame(() => {
                    _rwSpotlight(el); _rwPosCard(el);
                    if (_rwResizeH) window.removeEventListener('resize', _rwResizeH);
                    _rwResizeH = () => { _rwSpotlight(el); _rwPosCard(el); };
                    window.addEventListener('resize', _rwResizeH);
                });
            } else {
                if (spot)    spot.style.display    = 'none';
                if (overlay) { overlay.style.background = 'rgba(0,0,0,0.50)'; overlay.style.display = 'block'; }
                _rwCenterCard();
                if (_rwResizeH) { window.removeEventListener('resize', _rwResizeH); _rwResizeH = null; }
            }
        };

        const d = step.delay || 0;
        if (d > 0) setTimeout(_after, d); else requestAnimationFrame(_after);
    });
}

function _rwGoTo(index) {
    const prev = RW_TOUR_STEPS[_rwStep];
    if (prev && prev.onLeave) prev.onLeave();
    _rwStep = Math.max(0, Math.min(RW_TOUR_STEPS.length - 1, index));
    _rwRender();
}

function _rwClose(markDone = true) {
    const cur = RW_TOUR_STEPS[_rwStep];
    if (cur && cur.onLeave) cur.onLeave();
    ['rwTourOverlay','rwTourCard','rwTourSpotlight'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    if (_rwResizeH) { window.removeEventListener('resize', _rwResizeH); _rwResizeH = null; }
    if (markDone) localStorage.setItem(RW_TOUR_KEY, '1');
}

function startRwTour() {
    if (!isLoggedIn) return;          // only for logged-in users
    _rwStep = 0;
    ['rwTourOverlay','rwTourCard'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'block';
    });
    const s = document.getElementById('rwTourSpotlight'); if (s) s.style.display = 'none';
    _rwRender();
}

// ── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('rwTourNext')  ?.addEventListener('click', () => {
        if (_rwStep < RW_TOUR_STEPS.length - 1) _rwGoTo(_rwStep + 1); else _rwClose(true);
    });
    document.getElementById('rwTourPrev')  ?.addEventListener('click', () => _rwGoTo(_rwStep - 1));
    document.getElementById('rwTourFinish')?.addEventListener('click', () => location.reload());
    document.getElementById('rwTourSkip')  ?.addEventListener('click', () => _rwClose(true));

    // Close on overlay click
    document.getElementById('rwTourOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('rwTourOverlay')) _rwClose(true);
    });

    // Keyboard
    document.addEventListener('keydown', e => {
        const card = document.getElementById('rwTourCard');
        if (!card || card.style.display === 'none') return;
        if (e.key === 'ArrowRight' || e.key === 'Enter') {
            if (_rwStep < RW_TOUR_STEPS.length - 1) _rwGoTo(_rwStep + 1); else _rwClose(true);
        }
        if (e.key === 'ArrowLeft') _rwGoTo(_rwStep - 1);
        if (e.key === 'Escape')    _rwClose(true);
    });

    // Auto-start: wait for auth to settle (Firebase auth is async)
    // We hook into the auth-ready event dispatched by the main script
    // or fall back to a setTimeout watching isLoggedIn
    const _tryAutoStart = () => {
        if (!isLoggedIn) return;                          // not logged in — skip
        if (localStorage.getItem(RW_TOUR_KEY)) return;   // already seen
        setTimeout(startRwTour, 1200);                    // small delay so drankkaart can render
    };

    // If auth resolves quickly
    setTimeout(_tryAutoStart, 1500);
    // Also try a bit later in case Firebase is slow
    setTimeout(_tryAutoStart, 4000);
});

// Also expose so the help button (if any) can call it
window.startRwTour = startRwTour;