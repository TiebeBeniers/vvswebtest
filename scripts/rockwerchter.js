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

                // Bestellingen-knop voor alle ingelogde users met toegang
                const bestBtn = $id('bestellingenBtn');
                if (bestBtn) bestBtn.style.display = 'flex';
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