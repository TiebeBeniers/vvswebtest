// ===============================================
// WERKLIJST.JS – Rock Werchter Shiften
// V.V.S Rotselaar
// Leest dynamisch van de actieve werklijst in Firestore:
//   werklijsten/{id}            → { naam, active }
//   werklijsten/{id}/shifts/{id} → { label, date, time, max, note, section, persons }
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, doc, setDoc, onSnapshot,
    query, where, getDocs, limit
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── State ──────────────────────────────────────────────────────────────────────
let currentUser        = null;
let currentUserData    = null;
let activeWerklijst    = null;   // { id, naam }
let shiftsData         = {};     // shiftId → shift doc data
let pendingShiftId     = null;
let unsubShifts        = null;
let toastTimer         = null;

// ── Auth ───────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        document.getElementById('loadingSpinner').style.display = 'none';
        document.getElementById('authGuard').style.display      = 'flex';
        document.getElementById('loginLink').textContent        = 'LOGIN';
        return;
    }

    currentUser = user;

    try {
        const snap = await getDocs(
            query(collection(db, 'users'), where('uid', '==', user.uid))
        );
        if (!snap.empty) {
            currentUserData = snap.docs[0].data();
            document.getElementById('loginLink').textContent = 'PROFIEL';
        }
    } catch (e) {
        console.error('User load error:', e);
    }

    // Toegangscheck:
    //   - Elk ingelogd account (speler, admin, bestuurslid) heeft altijd toegang.
    //   - Uitzondering: accounts met categorie 'extern' hebben expliciet het
    //     'werken'-recht nodig (via rechten[] of toegang[]).
    const categorie = (currentUserData?.categorie || '').toLowerCase();
    const rol       = (currentUserData?.rol || '').toLowerCase();
    const rechten   = currentUserData?.rechten || [];
    const toegang   = currentUserData?.toegang || [];
    const rollen    = currentUserData?.rollen  || [];

    const isExtern         = categorie === 'extern';
    const heeftWerkenRecht = rechten.includes('werken') || toegang.includes('werken');

    // Extern: enkel toegang met expliciet 'werken'-recht
    // Alle andere ingelogde accounts (speler/admin/bestuurslid): altijd toegang
    const heeftToegang = isExtern ? heeftWerkenRecht : true;

    if (!heeftToegang) {
        document.getElementById('loadingSpinner').style.display = 'none';
        const guard = document.getElementById('authGuard');
        if (guard) {
            guard.innerHTML = `
                <div class="auth-guard-inner">
                    <div class="state-icon">&#128274;</div>
                    <h2>Geen toegang</h2>
                    <p>Je hebt geen toegang tot de werklijst. Neem contact op met de beheerder.</p>
                    <a href="index.html" class="state-action-btn">Terug naar home</a>
                </div>`;
            guard.style.display = 'flex';
        }
        return;
    }

    await loadActiveWerklijst();
});

// ── Load active werklijst ──────────────────────────────────────────────────────
async function loadActiveWerklijst() {
    try {
        const snap = await getDocs(
            query(collection(db, 'werklijsten'), where('active', '==', true), limit(1))
        );

        document.getElementById('loadingSpinner').style.display = 'none';

        if (snap.empty) {
            // No active werklijst
            document.getElementById('mainContent').style.display = 'block';
            document.getElementById('noActiveWerklijst').style.display = 'flex';
            return;
        }

        const wlDoc = snap.docs[0];
        activeWerklijst = { id: wlDoc.id, ...wlDoc.data() };

        // Update hero tag
        const heroTag = document.getElementById('heroEventTag');
        if (heroTag) heroTag.textContent = '📋 ' + (activeWerklijst.naam || 'Werkplanning');

        document.getElementById('mainContent').style.display = 'block';

        // Show locked banner if werklijst is locked
        let lockedBanner = document.getElementById('wlLockedBanner');
        if (!lockedBanner) {
            lockedBanner = document.createElement('div');
            lockedBanner.id = 'wlLockedBanner';
            lockedBanner.className = 'wl-locked-banner';
            lockedBanner.innerHTML = '🔒 Deze werklijst is vergrendeld. Je kan je niet meer aan- of afmelden.';
            document.getElementById('mainContent').prepend(lockedBanner);
        }
        lockedBanner.style.display = activeWerklijst.locked ? 'flex' : 'none';

        listenToShifts();

    } catch (e) {
        console.error('loadActiveWerklijst error:', e);
        document.getElementById('loadingSpinner').style.display = 'none';
        showToast('Fout bij laden van werklijst: ' + e.message, 'error');
    }
}

// ── Firestore shifts listener ──────────────────────────────────────────────────
function listenToShifts() {
    if (!activeWerklijst) return;
    if (unsubShifts) unsubShifts();

    unsubShifts = onSnapshot(
        collection(db, 'werklijsten', activeWerklijst.id, 'shifts'),
        (snapshot) => {
            shiftsData = {};
            snapshot.forEach(d => { shiftsData[d.id] = { id: d.id, ...d.data() }; });
            rebuildSchedule();
        },
        (err) => {
            console.error('Shifts listener error:', err);
            showToast('Fout bij laden van shiften: ' + err.message, 'error');
        }
    );
}

// ── Build / rebuild the schedule DOM ─────────────────────────────────────────
function rebuildSchedule() {
    const allShifts = Object.values(shiftsData);

    // Show "empty" notice if nothing at all
    const emptyNotice = document.getElementById('emptyShiftsNotice');
    if (emptyNotice) emptyNotice.style.display = allShifts.length === 0 ? 'block' : 'none';

    // Group by category (preserve insertion order of first occurrence by date)
    const categoryOrder = [];
    const byCategory    = {};
    allShifts
        .slice()
        .sort((a, b) => ((a.date || '9999') + parseTimeStart(a.time))
                        .localeCompare((b.date || '9999') + parseTimeStart(b.time)))
        .forEach(s => {
            const cat = (s.category || 'Overige').trim();
            if (!byCategory[cat]) { byCategory[cat] = []; categoryOrder.push(cat); }
            byCategory[cat].push(s);
        });

    // Render into the dynamic sections container
    const sectionsEl = document.getElementById('dynamicSections');
    sectionsEl.innerHTML = '';

    categoryOrder.forEach(cat => {
        const shifts = byCategory[cat];

        // Section label
        const labelEl = document.createElement('div');
        labelEl.className = 'wl-section-label';
        labelEl.innerHTML = `
            <h3>${cat}</h3>
            <div class="wl-divider"></div>
        `;
        sectionsEl.appendChild(labelEl);

        // Grid of day columns
        const gridEl = document.createElement('div');
        gridEl.className = 'wl-category-grid';
        sectionsEl.appendChild(gridEl);

        renderDayGrid(gridEl, shifts);
    });

    // Re-attach all card listeners
    allShifts.forEach(shift => attachCardListeners(shift.id));
}

// ── Render a grid of day columns ───────────────────────────────────────────────
function renderDayGrid(gridEl, shifts) {
    shifts.sort((a, b) => {
        const ka = (a.date || '9999') + parseTimeStart(a.time);
        const kb = (b.date || '9999') + parseTimeStart(b.time);
        return ka.localeCompare(kb);
    });

    const byDate = {};
    shifts.forEach(s => {
        const key = s.date || '__no_date__';
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(s);
    });

    const colCount = Math.min(Object.keys(byDate).length, 4);
    gridEl.style.setProperty('--day-cols', colCount);
    gridEl.querySelectorAll('.wl-day-column').forEach(el => el.remove());

    Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([date, dayShifts]) => {
            dayShifts.sort((a, b) => parseTimeStart(a.time).localeCompare(parseTimeStart(b.time)));

            let dayName = '', dayDate = '';
            if (date !== '__no_date__') {
                const d = new Date(date + 'T12:00:00');
                dayName = capitalize(d.toLocaleDateString('nl-BE', { weekday: 'long' }));
                dayDate = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' });
            } else {
                dayName = 'Datum onbekend'; dayDate = '';
            }

            const safeId = 'day-' + date.replace(/[^a-z0-9]/gi, '');
            const column = document.createElement('div');
            column.className = 'wl-day-column';
            column.innerHTML = `
                <div class="wl-day-header wl-collapsible" id="hdr-${safeId}">
                    <div class="wl-day-header-inner">
                        <div class="day-name">${dayName}</div>
                        <div class="day-date">${dayDate}</div>
                    </div>
                    <span class="wl-collapse-icon">&#9650;</span>
                </div>
                <div class="wl-day-shifts" id="shifts-${safeId}">
                    ${dayShifts.map(shift => renderShiftCard(shift)).join('')}
                </div>
            `;

            const hdr      = column.querySelector('.wl-day-header');
            const shiftsEl = column.querySelector('.wl-day-shifts');
            hdr.addEventListener('click', () => {
                const collapsed = shiftsEl.classList.toggle('wl-collapsed');
                hdr.classList.toggle('wl-header-collapsed', collapsed);
            });

            gridEl.appendChild(column);
        });
}

// ── Render a single shift card (returns HTML string) ──────────────────────────
function renderShiftCard(shift) {
    const persons  = shift.persons || [];
    const max      = shift.max ?? null;
    const isSigned = persons.some(p => p.uid === currentUser?.uid);
    const isFull   = max !== null && persons.length >= max;

    const capPct  = max ? Math.min((persons.length / max) * 100, 100) : 0;
    const capText = max ? `${persons.length}/${max}` : `${persons.length}`;
    // Graduele kleur: geel (hue 55) bij leeg → donkergroen (hue 130) bij vol
    const capHue  = max ? Math.round(55 + (capPct / 100) * 75) : 55;
    const capLit  = max ? Math.round(52 - (capPct / 100) * 18) : 52;
    const capColor = `hsl(${capHue}, 70%, ${capLit}%)`;
    const capFillCls = 'wl-cap-bar-fill';

    const personChips = persons.map(p => {
        const isMe   = p.uid === currentUser?.uid;
        const cls    = p.responsible ? 'wl-person chip-responsible'
                     : isMe          ? 'wl-person chip-me'
                     :                 'wl-person';
        const star   = p.responsible ? '★ ' : '';
        return `<span class="${cls}">${star}${p.naam}</span>`;
    }).join('');

    const cardCls = ['wl-shift-card', isSigned ? 'is-signed' : '', isFull && !isSigned ? 'is-full' : '']
        .filter(Boolean).join(' ');

    const isLocked = activeWerklijst?.locked;
    const btnCls  = isLocked ? 'wl-btn btn-locked'
                  : isSigned ? 'wl-btn btn-sign-out' : 'wl-btn btn-sign-in';
    const btnText = isLocked ? '🔒 Vergrendeld'
                  : isSigned ? 'Afmelden' : 'Aanmelden';

    const capacityBar = max
        ? `<div class="wl-shift-capacity">
               <span>${capText}</span>
               <div class="wl-cap-bar"><div class="${capFillCls}" style="width:${capPct}%;background:${capColor}"></div></div>
           </div>`
        : '';

    const noteHtml = shift.note ? `<p class="wl-shift-note">${shift.note}</p>` : '';

    const labelHtml = (shift.showLabel ?? false)
        ? `<div class="wl-shift-label">${shift.label || ''}</div>`
        : '';

    return `
        <div class="${cardCls}" id="card-${shift.id}">
            ${labelHtml}
            <div class="wl-shift-time">${shift.time || ''}</div>
            ${capacityBar}
            <div class="wl-shift-people" id="people-${shift.id}">${personChips}</div>
            ${noteHtml}
            <button class="${btnCls}" id="btn-${shift.id}">${btnText}</button>
        </div>`;
}

// ── Attach listeners to rendered cards ────────────────────────────────────────
function attachCardListeners(shiftId) {
    const card = document.getElementById(`card-${shiftId}`);
    const btn  = document.getElementById(`btn-${shiftId}`);
    if (!card || !btn) return;

    card.addEventListener('click', () => handleClick(shiftId));
    btn.addEventListener('click', (e) => { e.stopPropagation(); handleClick(shiftId); });
}

// ── Handle sign-in / sign-out click ──────────────────────────────────────────
function handleClick(shiftId) {
    if (!currentUser) return;
    if (activeWerklijst?.locked) {
        showToast('🔒 Deze werklijst is vergrendeld.', 'error');
        return;
    }

    const persons  = shiftsData[shiftId]?.persons || [];
    const isSigned = persons.some(p => p.uid === currentUser.uid);

    if (isSigned) {
        removeFromShift(shiftId);
        return;
    }

    const shift = shiftsData[shiftId];
    const isSpecial = shift?.section === 'special';

    if (isSpecial) {
        addToShift(shiftId, false);
        return;
    }

    // Festival: ask about responsible if none yet AND shift requires it
    const hasResponsible    = persons.some(p => p.responsible);
    const requireResponsible = shift?.requireResponsible ?? true;

    if (hasResponsible || !requireResponsible) {
        addToShift(shiftId, false);
    } else {
        pendingShiftId = shiftId;
        document.getElementById('modalBackdrop').classList.add('active');
    }
}

async function addToShift(shiftId, asResponsible) {
    if (!currentUser || !currentUserData) return;

    const naam     = currentUserData.naam || currentUserData.email || 'Vrijwilliger';
    const existing = shiftsData[shiftId]?.persons || [];
    if (existing.some(p => p.uid === currentUser.uid)) return;

    const updated = [...existing, { uid: currentUser.uid, naam, responsible: asResponsible }];

    try {
        await setDoc(
            doc(db, 'werklijsten', activeWerklijst.id, 'shifts', shiftId),
            { persons: updated },
            { merge: true }
        );
        showToast(
            asResponsible ? '✅ Ingeschreven als verantwoordelijke!' : '✅ Ingeschreven voor shift!',
            'success'
        );
        showCalendarButton(shiftId);
    } catch (e) {
        console.error('addToShift error:', e);
        showToast('❌ Fout bij aanmelden: ' + e.message, 'error');
    }
}

async function removeFromShift(shiftId) {
    if (!currentUser) return;
    const updated = (shiftsData[shiftId]?.persons || [])
        .filter(p => p.uid !== currentUser.uid);
    try {
        await setDoc(
            doc(db, 'werklijsten', activeWerklijst.id, 'shifts', shiftId),
            { persons: updated },
            { merge: true }
        );
        showToast('↩️ Afgemeld voor shift.', 'success');
        removeCalendarButton(shiftId);
    } catch (e) {
        console.error('removeFromShift error:', e);
        showToast('❌ Fout bij afmelden: ' + e.message, 'error');
    }
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function closeModal() {
    document.getElementById('modalBackdrop').classList.remove('active');
    pendingShiftId = null;
}

document.getElementById('btnYesResponsible').addEventListener('click', () => {
    const id = pendingShiftId; closeModal(); if (id) addToShift(id, true);
});
document.getElementById('btnNoResponsible').addEventListener('click', () => {
    const id = pendingShiftId; closeModal(); if (id) addToShift(id, false);
});
document.getElementById('btnModalCancel').addEventListener('click', closeModal);
document.getElementById('modalBackdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
});

// ── Calendar (.ics) ────────────────────────────────────────────────────────────
function showCalendarButton(shiftId) {
    const btn = document.getElementById(`btn-${shiftId}`);
    if (!btn || document.getElementById(`cal-${shiftId}`)) return;

    const calBtn = document.createElement('button');
    calBtn.className = 'wl-btn btn-calendar';
    calBtn.id        = `cal-${shiftId}`;
    calBtn.innerHTML = '📅 Toevoegen aan agenda';
    calBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadICS(shiftId); });
    btn.parentNode.insertBefore(calBtn, btn.nextSibling);
}

function removeCalendarButton(shiftId) {
    document.getElementById(`cal-${shiftId}`)?.remove();
}

function addDays(yyyymmdd, days) {
    const y  = parseInt(yyyymmdd.slice(0, 4), 10);
    const m  = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
    const d  = parseInt(yyyymmdd.slice(6, 8), 10);
    const dt = new Date(y, m, d + days);
    const pad = n => String(n).padStart(2, '0');
    return dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate());
}

// Parseer "08:00", "Vanaf 18:00", "8:5", etc. → "HHMMSS"
function parseTimeToHHMMSS(t) {
    if (!t) return null;
    t = t.replace(/vanaf\s*/i, '').trim();
    const match = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return null;
    const hh = String(parseInt(match[1], 10)).padStart(2, '0');
    const mm = String(parseInt(match[2], 10)).padStart(2, '0');
    const ss = match[3] ? String(parseInt(match[3], 10)).padStart(2, '0') : '00';
    return hh + mm + ss;
}

// ICS-waarden escapen (RFC 5545)
function icsEsc(s) {
    return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// RFC 5545 line folding: max 75 octets per regel
function foldLine(line) {
    if (line.length <= 75) return line;
    const out = [];
    let i = 0;
    while (i < line.length) {
        const chunk = (i === 0 ? 75 : 74);
        out.push((i === 0 ? '' : ' ') + line.slice(i, i + chunk));
        i += chunk;
    }
    return out.join('\r\n');
}

function downloadICS(shiftId) {
    const shift = shiftsData[shiftId];
    if (!shift || !shift.date) {
        showToast('Geen datum gevonden voor deze shift.', 'error');
        return;
    }

    // Valideer datumformaat YYYY-MM-DD
    const dateParts = shift.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateParts) {
        showToast('Ongeldig datumformaat voor deze shift.', 'error');
        return;
    }
    const baseDateStr = dateParts[1] + dateParts[2] + dateParts[3]; // "YYYYMMDD"

    const timeStr = (shift.time || '').trim();
    let dtStart, dtEnd;

    const isVanaf = /^vanaf/i.test(timeStr);

    if (isVanaf) {
        const raw    = parseTimeToHHMMSS(timeStr) || '120000';
        const startH = parseInt(raw.slice(0, 2), 10);
        // +4 uur, over middernacht indien nodig
        const endTotalMin = startH * 60 + 4 * 60;
        const endH        = Math.floor(endTotalMin / 60) % 24;
        const endDate     = endTotalMin >= 24 * 60 ? addDays(baseDateStr, 1) : baseDateStr;
        const endHHMMSS   = String(endH).padStart(2, '0') + '0000';
        dtStart = baseDateStr + 'T' + raw;
        dtEnd   = endDate     + 'T' + endHHMMSS;
    } else {
        // Splits op em-dash, en-dash, gewone streepje (met optionele spaties)
        const parts = timeStr.split(/\s*[\u2013\u2014\-]\s*/);
        const sRaw  = parseTimeToHHMMSS(parts[0]) || '080000';
        const eRaw  = parts[1] ? (parseTimeToHHMMSS(parts[1]) || '140000') : '140000';

        const startH = parseInt(sRaw.slice(0, 2), 10);
        const startM = parseInt(sRaw.slice(2, 4), 10);
        const endH   = parseInt(eRaw.slice(0, 2), 10);
        const endM   = parseInt(eRaw.slice(2, 4), 10);

        // Overnight als eindtijd eerder is dan begintijd:
        //   19:00–01:00, 23:00–06:00, 00:00–06:00 (begint na 00:00 = volgende dag)
        // Niet overnight: 08:00–00:00 (eindigt op middernacht = zelfde dag)
        const startTotalMin = startH * 60 + startM;
        const endTotalMin   = endH   * 60 + endM;
        // 00:00 als eindtijd = 24:00 = einde van de dag → NIET overnight tenzij begin ook laat is
        const endIs2400     = (eRaw === '000000');
        const isOvernight   = !endIs2400 && endTotalMin <= startTotalMin;

        const endDateStr = isOvernight ? addDays(baseDateStr, 1) : baseDateStr;
        dtStart = baseDateStr + 'T' + sRaw;
        dtEnd   = endDateStr  + 'T' + (endIs2400 ? '235959' : eRaw);
    }

    const title       = icsEsc('VVS Rotselaar \u2013 ' + (shift.label || 'Shift') + ' (' + timeStr + ')');
    const description = icsEsc((shift.label || 'Shift') + '\nTijdstip: ' + timeStr + '\nV.V.S Rotselaar');
    const uid         = 'vvs-' + shiftId + '-' + Date.now() + '@vvsrotselaar.be';
    const now         = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

    const icsLines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//VVS Rotselaar//Werklijst//NL',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:VVS Rotselaar Werklijst',
        'X-WR-TIMEZONE:Europe/Brussels',
        'BEGIN:VEVENT',
        'UID:' + uid,
        'DTSTAMP:' + now,
        'DTSTART;TZID=Europe/Brussels:' + dtStart,
        'DTEND;TZID=Europe/Brussels:' + dtEnd,
        'SUMMARY:' + title,
        'DESCRIPTION:' + description,
        'LOCATION:V.V.S. Rotselaar\\, Hellichtstraat 83\\, 3110 Rotselaar',
        'END:VEVENT',
        'END:VCALENDAR',
    ];

    const ics  = icsLines.map(foldLine).join('\r\n') + '\r\n';
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;method=PUBLISH' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'shift-' + (shift.label || shiftId).replace(/[^a-z0-9]/gi, '_') + '.ics';
    a.setAttribute('type', 'text/calendar');
    document.body.appendChild(a);
    a.click();
    // Wacht 1s voor revoke zodat Android de download kan starten
    setTimeout(function() {
        if (document.body.contains(a)) document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
    const t = document.getElementById('wlToast');
    t.textContent = msg;
    t.className   = ['wl-toast', 'show', type ? 'toast-' + type : ''].filter(Boolean).join(' ');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'wl-toast'; }, 3000);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function parseTimeStart(t) {
    if (!t) return '00:00';
    return t.split(/[–—\-]/)[0].replace(/vanaf\s*/i, '').trim() || '00:00';
}

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

console.log('Werklijst.js loaded');
