// ===============================================
// TRAINING.JS — VVS Rotselaar Kalender
//
// Toont een 7-daagse weekkalender met:
//   - Trainingen (trainingen/{id})
//   - Wedstrijden (matches/{id})
//   - Evenementen (evenementen/{id})
//   - Eigen werklijst-shiften (enkel voor ingelogde gebruikers)
//
// Admin kan items aanmaken met optionele wekelijkse herhaling.
// Firestore structuur trainingen:
//   { titel, team, datum, startTijd, eindTijd, locatie, nota,
//     aanwezigen:[{uid,naam}], type:'training'|'other' }
// ===============================================

import { auth, db } from './firebase-config.js';
import { tcGet, tcSet, CACHE_TTL, PAGE_REFRESHED } from './vvs-cache.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, query, where, getDocs, doc, setDoc, addDoc,
    deleteDoc, onSnapshot, orderBy, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── State ──────────────────────────────────────────────────────────────────────
let currentUser     = null;
let currentUserData = null;
let isAdmin         = false;
let currentWeekStart = getMonday(new Date());
let calItems        = [];   // alle geladen items voor de huidige week
let unsubCal        = null;

const DAY_NAMES   = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const DAY_NAMES_FULL = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];

const TYPE_CONFIG = {
    training: { color: '#0047AB', label: 'Training',   dot: 'training' },
    match:    { color: '#DC3545', label: 'Wedstrijd',  dot: 'match'    },
    event:    { color: '#F59E0B', label: 'Evenement',  dot: 'event'    },
    shift:    { color: '#10B981', label: 'Jouw shift', dot: 'shift'    },
    other:    { color: '#6B7280', label: 'Item',       dot: 'training' },
};

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    if (user) {
        currentUser = user;
        if (loginLink) loginLink.textContent = 'PROFIEL';
        try {
            const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
            if (!snap.empty) {
                currentUserData = snap.docs[0].data();
                isAdmin = currentUserData.rol === 'admin';
            }
        } catch (_) {}
        // Toon shift-legende en admin-knop
        document.querySelectorAll('.cal-legend-auth').forEach(el => el.style.display = '');
        if (isAdmin) document.getElementById('adminAddBtn').style.display = '';
    } else {
        currentUser = null; currentUserData = null; isAdmin = false;
        if (loginLink) loginLink.textContent = 'LOGIN';
    }
    // Herrender met juiste auth-context
    if (calItems.length > 0) renderGrid();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMonday(d) {
    // Gebruik lokale datum componenten om UTC-verschuiving te vermijden
    const dt  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = dt.getDay() || 7;  // Zondag = 7 i.p.v. 0
    dt.setDate(dt.getDate() - day + 1);
    return dt;
}
function isoDate(d) {
    // Gebruik lokale datum (niet UTC) om tijdzone-verschuiving te voorkomen
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function addDays(d, n) {
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    return dt;
}
function fmtWeek(mon) {
    const sun = addDays(mon, 6);
    return mon.toLocaleDateString('nl-BE', { day:'numeric', month:'long' })
        + ' – ' + sun.toLocaleDateString('nl-BE', { day:'numeric', month:'long', year:'numeric' });
}
function todayIso() { return isoDate(new Date()); }

// ── Week navigation ───────────────────────────────────────────────────────────
document.getElementById('calPrevWeek').addEventListener('click', () => shiftWeek(-7));
document.getElementById('calNextWeek').addEventListener('click', () => shiftWeek(7));
document.getElementById('calToday').addEventListener('click', () => {
    currentWeekStart = getMonday(new Date()); updateWeekLabel(); loadWeek();
});

function shiftWeek(days) {
    currentWeekStart = addDays(currentWeekStart, days); updateWeekLabel(); loadWeek();
}
function updateWeekLabel() {
    document.getElementById('calWeekLabel').textContent = fmtWeek(currentWeekStart);
}

// ── Load week data ────────────────────────────────────────────────────────────
async function loadWeek() {
    if (unsubCal) { unsubCal(); unsubCal = null; }
    calItems = [];
    document.getElementById('calGrid').style.display = 'none';
    document.getElementById('calLoading').style.display = 'flex';

    const weekStart = isoDate(currentWeekStart);
    const weekEnd   = isoDate(addDays(currentWeekStart, 6));

    // ── Cache: 30 min per week-blok (publieke data) ──────────────────────────
    const _weekKey = `cal_week_${weekStart}`;
    const _cached  = tcGet(_weekKey, CACHE_TTL.medium);
    if (_cached && !PAGE_REFRESHED) {
        // Cache vers — render direct, geen Firebase reads
        calItems.push(..._cached);
    }

    try {
        if (_cached && !PAGE_REFRESHED) {
            // Skip naar user-specifieke data (werklijst-shiften)
        } else {

        // Parallel load: trainingen + matches + evenementen — allemaal publiek leesbaar
        const results = await Promise.allSettled([
            getDocs(query(collection(db, 'trainingen'), where('datum', '>=', weekStart), where('datum', '<=', weekEnd))),
            getDocs(query(collection(db, 'matches'),   where('datum', '>=', weekStart), where('datum', '<=', weekEnd))),
            getDocs(query(collection(db, 'evenementen'))),
        ]);
        const [trainResult, matchResult, evResult] = results;
        const trainSnap = trainResult.status === 'fulfilled' ? trainResult.value : { forEach: () => {} };
        const matchSnap = matchResult.status === 'fulfilled' ? matchResult.value : { forEach: () => {} };
        const evSnap    = evResult.status    === 'fulfilled' ? evResult.value    : { forEach: () => {} };

        // Trainingen
        trainSnap.forEach(d => {
            const data = d.data();
            calItems.push({ id: d.id, type: data.type || 'training', source: 'training', ...data });
        });

        // Wedstrijden
        matchSnap.forEach(d => {
            const data = d.data();
            calItems.push({ id: d.id, type: 'match', source: 'match',
                datum: data.datum, startTijd: data.uur || '',
                titel: `${data.thuisploeg} — ${data.uitploeg}`,
                locatie: data.locatie, team: data.team,
                status: data.status, scoreThuis: data.scoreThuis, scoreUit: data.scoreUit,
                ...data });
        });

        // Evenementen (filter op week + meerdaagse periodes)
        evSnap.forEach(d => {
            const data = d.data();
            const evStart = data.datum;
            const evEnd   = data.eindDatum || data.datum;
            // Toon op elke dag die overlapt met de zichtbare week
            if (evEnd >= weekStart && evStart <= weekEnd) {
                // Voeg toe op elke dag van de periode die in de week valt
                let cur = new Date(evStart + 'T12:00');
                const endDt = new Date(evEnd + 'T12:00');
                while (cur <= endDt) {
                    const dayStr = cur.toISOString().split('T')[0];
                    if (dayStr >= weekStart && dayStr <= weekEnd) {
                        const isFirst = dayStr === evStart;
                        const isLast  = dayStr === evEnd;
                        calItems.push({ id: d.id + '_' + dayStr, type: 'event', source: 'event',
                            datum: dayStr, startTijd: isFirst ? (data.tijd || '') : '',
                            titel: data.titel + (data.eindDatum ? (isFirst ? ' (start)' : isLast ? ' (einde)' : '') : ''),
                            locatie: data.locatie, eindDatum: data.eindDatum, ...data });
                    }
                    cur.setDate(cur.getDate() + 1);
                }
            }
        });

        // Sla publieke items op in cache (exclusief user-specifieke shiften)
        tcSet(_weekKey, calItems.filter(i => i.source !== 'shift'));

        } // end if(!cached)

        // Werklijst-shiften voor ingelogde gebruiker (nooit gecacht — user-specifiek)
        if (currentUser) {
            try {
                const wlSnap = await getDocs(query(collection(db, 'werklijsten'), where('active', '==', true)));
                if (!wlSnap.empty) {
                    const wlId = wlSnap.docs[0].id;
                    const shiftSnap = await getDocs(collection(db, 'werklijsten', wlId, 'shifts'));
                    shiftSnap.forEach(d => {
                        const data = d.data();
                        const persons = data.persons || [];
                        const mine = persons.find(p => p.uid === currentUser.uid);
                        if (mine && data.date >= weekStart && data.date <= weekEnd) {
                            calItems.push({ id: d.id, type: 'shift', source: 'shift',
                                datum: data.date, startTijd: data.time || '',
                                titel: data.label || 'Shift', locatie: '', ...data });
                        }
                    });
                }
            } catch (_) { /* werklijst optioneel */ }
        }

        document.getElementById('calLoading').style.display = 'none';
        document.getElementById('calGrid').style.display = 'grid';
        renderGrid();

    } catch (e) {
        console.error('Kalender laden mislukt:', e);
        document.getElementById('calLoading').innerHTML = '<p style="color:var(--danger)">❌ Laden mislukt. Vernieuw de pagina.</p>';
    }
}

// ── Render grid ───────────────────────────────────────────────────────────────
function renderGrid() {
    const grid = document.getElementById('calGrid');
    grid.innerHTML = '';
    const today = todayIso();

    for (let i = 0; i < 7; i++) {
        const day    = addDays(currentWeekStart, i);
        const dayIso = isoDate(day);
        const isToday = dayIso === today;

        const dayItems = calItems
            .filter(item => item.datum === dayIso)
            .sort((a, b) => (a.startTijd || '').localeCompare(b.startTijd || ''));

        const col = document.createElement('div');
        col.className = 'cal-day-col' + (isToday ? ' cal-today' : '');

        const dateFmt = day.toLocaleDateString('nl-BE', { day:'numeric', month:'short' });
        col.innerHTML = `
            <div class="cal-day-header">
                <span class="cal-day-name">${DAY_NAMES[i]}</span>
                <span class="cal-day-date ${isToday ? 'cal-today-badge' : ''}">${dateFmt}</span>
            </div>
            <div class="cal-day-items" id="dayitems-${dayIso}"></div>`;

        grid.appendChild(col);

        const itemsEl = col.querySelector(`#dayitems-${dayIso}`);
        if (dayItems.length === 0) {
            itemsEl.innerHTML = '<div class="cal-day-empty">—</div>';
        } else {
            dayItems.forEach(item => itemsEl.appendChild(buildCalItem(item)));
        }
    }
}

function buildCalItem(item) {
    const conf = TYPE_CONFIG[item.type] || TYPE_CONFIG.other;
    const el   = document.createElement('div');
    el.className = 'cal-item cal-item-' + item.type;
    el.style.setProperty('--item-color', conf.color);

    const time = item.startTijd ? `<span class="cal-item-time">${item.startTijd}</span>` : '';
    const isSigned = item.type === 'training' && (item.aanwezigen || []).some(p => p.uid === currentUser?.uid);

    el.innerHTML = `
        ${time}
        <span class="cal-item-title">${esc(item.titel || conf.label)}</span>
        ${isSigned ? '<span class="cal-item-check">✓</span>' : ''}`;

    el.addEventListener('click', () => openPopup(item));
    return el;
}

// ── Popup ─────────────────────────────────────────────────────────────────────
function openPopup(item) {
    const overlay = document.getElementById('calPopup');
    const card    = document.getElementById('calPopupCard');
    const conf    = TYPE_CONFIG[item.type] || TYPE_CONFIG.other;

    const isSigned    = item.type === 'training' && (item.aanwezigen||[]).some(p => p.uid === currentUser?.uid);
    const aanwezigen  = item.aanwezigen || [];
    const startDate    = item.datum ? new Date(item.datum + 'T12:00') : null;
    const startFmtOpts = { weekday:'long', day:'numeric', month:'long' };
    const startStr     = startDate ? startDate.toLocaleDateString('nl-BE', startFmtOpts) : '';
    const dateFmt      = item.eindDatum
        ? startStr + ' — ' + new Date(item.eindDatum + 'T12:00').toLocaleDateString('nl-BE', startFmtOpts)
        : startStr;
    const tijdFmt     = [item.startTijd, item.eindTijd].filter(Boolean).join(' – ');

    const scoreStr = item.type === 'match' && item.status === 'finished'
        ? `<div class="cal-popup-score">${item.scoreThuis ?? '–'} – ${item.scoreUit ?? '–'}</div>` : '';

    const aanmeldBtn = item.type === 'training' && currentUser ? `
        <button class="cal-popup-aanmeld ${isSigned ? 'signed' : ''}" id="calPopupAanmeld">
            ${isSigned ? '✓ Aangemeld (klik om af te melden)' : 'Aanmelden voor training'}
        </button>` : '';

    const adminBtns = isAdmin && (item.source === 'training') ? `
        <div class="cal-popup-admin">
            <button class="cal-popup-edit" id="calPopupEdit"><img src="assets/edit.png" class="icon" alt=""> Bewerken</button>
            <button class="cal-popup-del"  id="calPopupDel"><img src="assets/delete.png" class="icon" alt=""> Verwijderen</button>
        </div>` : '';

    const liveBtn = item.type === 'match' && (item.status === 'live' || item.status === 'rust')
        ? `<a href="live.html" class="cal-popup-live">🔴 Volg live →</a>` : '';

    card.innerHTML = `
        <div class="cal-popup-header" style="background:${conf.color}">
            <span class="cal-popup-type">${conf.label}</span>
            <button class="cal-popup-close" id="calPopupClose">✕</button>
        </div>
        <div class="cal-popup-body">
            <h4>${esc(item.titel || conf.label)}</h4>
            ${scoreStr}
            ${dateFmt   ? `<div class="cal-popup-meta">📅 ${dateFmt}</div>` : ''}
            ${tijdFmt   ? `<div class="cal-popup-meta">🕐 ${tijdFmt}</div>` : ''}
            ${item.locatie ? `<div class="cal-popup-meta">📍 ${esc(item.locatie)}</div>` : ''}
            ${item.team    ? `<div class="cal-popup-meta">👕 ${esc(item.team)}</div>` : ''}
            ${item.nota    ? `<div class="cal-popup-nota">${esc(item.nota)}</div>` : ''}
            ${aanwezigen.length ? `<div class="cal-popup-aanwezigen">
                <strong>${aanwezigen.length} aanwezig</strong>
                <div>${aanwezigen.map(p => `<span class="tr-aanwezig-chip${p.uid===currentUser?.uid?' me':''}">${p.naam}</span>`).join('')}</div>
            </div>` : ''}
            ${liveBtn}
            ${aanmeldBtn}
            ${adminBtns}
        </div>`;

    overlay.style.display = 'flex';

    document.getElementById('calPopupClose').addEventListener('click', closePopup);
    overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });

    if (aanmeldBtn) {
        document.getElementById('calPopupAanmeld').addEventListener('click', async () => {
            await toggleAanwezigheid(item);
            closePopup();
        });
    }
    if (adminBtns) {
        document.getElementById('calPopupEdit').addEventListener('click', () => { closePopup(); openItemModal(item); });
        document.getElementById('calPopupDel').addEventListener('click', async () => {
            if (!confirm(`"${item.titel}" verwijderen?`)) return;
            await deleteDoc(doc(db, 'trainingen', item.id));
            closePopup(); showToast('✅ Verwijderd.', 'success'); loadWeek();
        });
    }
}

function closePopup() {
    document.getElementById('calPopup').style.display = 'none';
}

// ── Aanwezigheid ──────────────────────────────────────────────────────────────
async function toggleAanwezigheid(item) {
    if (!currentUser || !currentUserData) { showToast('Log in om je aan te melden.', 'error'); return; }
    const naam = currentUserData.naam || currentUserData.email || 'Lid';
    const list = [...(item.aanwezigen || [])];
    const idx  = list.findIndex(p => p.uid === currentUser.uid);
    if (idx === -1) list.push({ uid: currentUser.uid, naam });
    else list.splice(idx, 1);
    try {
        await setDoc(doc(db, 'trainingen', item.id), { aanwezigen: list }, { merge: true });
        showToast(idx === -1 ? '✅ Aangemeld!' : '↩️ Afgemeld.', 'success');
        loadWeek();
    } catch (e) { showToast('❌ ' + e.message, 'error'); }
}

// ── Admin: item modal ─────────────────────────────────────────────────────────
document.getElementById('openAddItemBtn')?.addEventListener('click', () => openItemModal(null));
document.getElementById('calItemCancel')?.addEventListener('click', closeItemModal);
document.getElementById('calItemModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('calItemModal')) closeItemModal();
});

function openItemModal(item = null) {
    const modal = document.getElementById('calItemModal');
    document.getElementById('calItemModalTitle').textContent = item ? 'Item Bewerken' : 'Kalenderitem Toevoegen';
    document.getElementById('calItemType').value    = item?.type    || 'training';
    document.getElementById('calItemTeam').value    = item?.team    || '';
    document.getElementById('calItemTitel').value   = item?.titel   || '';
    document.getElementById('calItemDatum').value   = item?.datum   || isoDate(currentWeekStart);
    document.getElementById('calItemStart').value   = item?.startTijd || '';
    document.getElementById('calItemEinde').value   = item?.eindTijd  || '';
    document.getElementById('calItemLocatie').value = item?.locatie   || '';
    document.getElementById('calItemNota').value    = item?.nota      || '';

    // Herhaling: enkel tonen bij nieuw item
    const recurSection = document.getElementById('calRecurSection');
    const herhalenChk  = document.getElementById('calItemHerhalen');
    const herhalingPanel = document.getElementById('calItemHerhalingPanel');
    if (recurSection) {
        recurSection.style.display = item ? 'none' : '';
        if (herhalenChk) herhalenChk.checked = false;
        if (herhalingPanel) herhalingPanel.style.display = 'none';
    }

    // Herhaling toggle listeners (eenmalig binden)
    if (!modal._recurBound) {
        modal._recurBound = true;
        herhalenChk?.addEventListener('change', e => {
            if (herhalingPanel) herhalingPanel.style.display = e.target.checked ? '' : 'none';
        });
        document.getElementById('calItemAantal')?.addEventListener('input', e => {
            const el = document.getElementById('calItemAantalPreview');
            if (el) el.textContent = e.target.value || '1';
        });
    }

    modal.classList.add('active');

    const form = document.getElementById('calItemForm');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('calItemSave');
        btn.disabled = true; btn.textContent = 'Bezig…';

        const data = {
            type:      document.getElementById('calItemType').value,
            team:      document.getElementById('calItemTeam').value,
            titel:     document.getElementById('calItemTitel').value.trim(),
            datum:     document.getElementById('calItemDatum').value,
            startTijd: document.getElementById('calItemStart').value,
            eindTijd:  document.getElementById('calItemEinde').value,
            locatie:   document.getElementById('calItemLocatie').value.trim(),
            nota:      document.getElementById('calItemNota').value.trim(),
            aanwezigen: item?.aanwezigen || [],
        };

        if (!data.titel || !data.datum) {
            btn.disabled = false; btn.textContent = 'Opslaan'; return;
        }

        try {
            if (item) {
                await setDoc(doc(db, 'trainingen', item.id), data, { merge: true });
            } else {
                const herhalen = herhalenChk?.checked;
                const aantal   = parseInt(document.getElementById('calItemAantal')?.value || '1');
                if (herhalen && aantal > 1) {
                    // Wekelijkse herhaling via batch
                    const batch = writeBatch(db);
                    const [y, m, d] = data.datum.split('-').map(Number);
                    const startDate = new Date(y, m - 1, d);
                    for (let i = 0; i < aantal; i++) {
                        const dt  = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i * 7);
                        const iso = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
                        batch.set(doc(collection(db, 'trainingen')), { ...data, datum: iso, aanwezigen: [] });
                    }
                    await batch.commit();
                    closeItemModal();
                    showToast(`✅ ${aantal} items aangemaakt!`, 'success');
                    loadWeek();
                    btn.disabled = false; btn.textContent = 'Opslaan';
                    return;
                } else {
                    await addDoc(collection(db, 'trainingen'), { ...data, aanwezigen: [] });
                }
            }
            closeItemModal();
            if (!item) showToast('✅ Item aangemaakt!', 'success');
            loadWeek();
        } catch (err) {
            showToast('❌ ' + err.message, 'error');
        }
        btn.disabled = false; btn.textContent = 'Opslaan';
    };
}

function closeItemModal() {
    document.getElementById('calItemModal').classList.remove('active');
}

// ── Init ──────────────────────────────────────────────────────────────────────
updateWeekLabel();
loadWeek();

// ── Toast ──────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
    const t = document.getElementById('trToast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'tr-toast show' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'tr-toast'; }, 3000);
}

function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}