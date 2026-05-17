// ===============================================
// ADMIN2.JS – Werklijsten Beheren
// V.V.S Rotselaar
// Firestore structuur:
//   werklijsten/{id}            → { naam, active, createdAt }
//   werklijsten/{id}/shifts/{id} → { label, date, time, max, note, section, persons }
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, doc, addDoc, getDocs, getDoc, setDoc, deleteDoc,
    query, where, orderBy, onSnapshot, serverTimestamp, writeBatch, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── State ──────────────────────────────────────────────────────────────────────
let werklijstenCache   = {};   // id → { id, naam, active, createdAt }
let shiftsCache        = {};   // shiftId → shift data (for current editing werklijst)
let editingWerklijstId = null;
let unsubWerklijsten   = null;
let unsubShifts        = null;

// ── Auth guard ─────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }

    try {
        const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
        if (snap.empty) { window.location.href = 'index.html'; return; }
        const data = snap.docs[0].data();
        if (data.rol !== 'admin') { window.location.href = 'index.html'; return; }
    } catch (e) {
        console.error('Auth check error:', e);
        return;
    }

    listenToWerklijsten();
});

// ── Werklijsten listener ────────────────────────────────────────────────────────
function listenToWerklijsten() {
    if (unsubWerklijsten) unsubWerklijsten();
    unsubWerklijsten = onSnapshot(
        collection(db, 'werklijsten'),
        (snap) => {
            werklijstenCache = {};
            snap.forEach(d => { werklijstenCache[d.id] = { id: d.id, ...d.data() }; });
            renderWerklijstenList();
        },
        (err) => {
            console.error('Werklijsten snapshot error:', err);
            showToast('❌ Fout bij laden: ' + err.message, 'error');
        }
    );
}

// ── Render werklijsten list ─────────────────────────────────────────────────────
function renderWerklijstenList() {
    const container = document.getElementById('werklijstenList');
    if (!container) return;

    const items = Object.values(werklijstenCache).sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        return (a.naam || '').localeCompare(b.naam || '');
    });

    if (items.length === 0) {
        container.innerHTML = `
            <div class="werklijst-empty-state">
                <p>Nog geen werklijsten aangemaakt. Klik op "+ Werklijst Toevoegen" om te beginnen.</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    items.forEach(wl => {
        const el = document.createElement('div');
        el.className = `wl-list-card ${wl.active ? 'wl-active' : ''}`;
        el.innerHTML = `
            <div class="wl-list-card-info">
                ${wl.active ? '<span class="wl-active-badge">● ACTIEF</span>' : ''}
                <span class="wl-list-name">${wl.naam || '(geen naam)'}</span>
            </div>
            <div class="wl-list-actions">
                ${!wl.active ? `<button class="icon-btn activate-btn" data-id="${wl.id}">✔ Activeren</button>` : ''}
                <button class="icon-btn lock-btn ${wl.locked ? 'locked' : ''}" data-id="${wl.id}" title="${wl.locked ? 'Ontgrendelen' : 'Vergrendelen'}">
                    ${wl.locked ? '🔒 Vergrendeld' : '🔓 Vergrendelen'}
                </button>
                <button class="icon-btn export-wl-btn" data-id="${wl.id}" title="Exporteer als Excel">📥 Excel</button>
                <button class="icon-btn rename-btn" data-id="${wl.id}"><img src="assets/edit.png" class="icon" alt=""> Naam</button>
                <button class="icon-btn shifts-btn" data-id="${wl.id}">Shiften Beheren</button>
                <button class="icon-btn delete delete-wl-btn" data-id="${wl.id}"><img src="assets/delete.png" class="icon-lg" alt=""></button>
            </div>
        `;

        if (!wl.active) {
            el.querySelector('.activate-btn').addEventListener('click', () => activateWerklijst(wl.id));
        }
        el.querySelector('.rename-btn').addEventListener('click', () => openWerklijstModal(wl));
        el.querySelector('.shifts-btn').addEventListener('click', () => openShiftsEditor(wl.id));
        el.querySelector('.delete-wl-btn').addEventListener('click', () => confirmDeleteWerklijst(wl));
        el.querySelector('.lock-btn').addEventListener('click', () => toggleLockWerklijst(wl));
        el.querySelector('.export-wl-btn').addEventListener('click', () => exportWerklijstExcel(wl.id));

        container.appendChild(el);
    });
}

// ── Activate werklijst ──────────────────────────────────────────────────────────
async function activateWerklijst(id) {
    try {
        const deactivates = Object.values(werklijstenCache).map(wl =>
            setDoc(doc(db, 'werklijsten', wl.id), { active: false }, { merge: true })
        );
        await Promise.all(deactivates);
        await setDoc(doc(db, 'werklijsten', id), { active: true }, { merge: true });
        showToast('✅ Werklijst geactiveerd!', 'success');
    } catch (e) {
        console.error('activateWerklijst error:', e);
        showToast('❌ Fout: ' + e.message, 'error');
    }
}

// ── Lock / Unlock werklijst ───────────────────────────────────────────────────
async function toggleLockWerklijst(wl) {
    const newLocked = !wl.locked;
    try {
        await setDoc(doc(db, 'werklijsten', wl.id), { locked: newLocked }, { merge: true });
        showToast(newLocked ? '🔒 Werklijst vergrendeld.' : '🔓 Werklijst ontgrendeld.', 'success');
    } catch (e) {
        showToast('❌ Fout: ' + e.message, 'error');
    }
}

// ══ FEATURE 2: Export werklijst to Excel ═════════════════════════════════════
async function exportWerklijstExcel(werklijstId) {
    const wl = werklijstenCache[werklijstId];
    if (!wl) return;

    showToast('⏳ Excel wordt aangemaakt…', '');

    if (!window.ExcelJS) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }

    // ── Data ophalen ────────────────────────────────────────────────────────
    const snap = await getDocs(collection(db, 'werklijsten', werklijstId, 'shifts'));
    const shifts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    shifts.sort((a, b) => ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')));

    const usersSnap = await getDocs(collection(db, 'users'));
    const uidToPhone = {};
    usersSnap.forEach(d => {
        const u = d.data();
        if (u.uid && u.telefoon) uidToPhone[u.uid] = u.telefoon;
    });

    // ── Constanten ──────────────────────────────────────────────────────────
    const COLS_PER_ROW = 6;   // vaste breedte: altijd max 6 naam-kolommen per rij

    // Opvulkleuren
    const FILL_TITLE    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    const FILL_DAY      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
    const FILL_LABEL    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    const FILL_YELLOW   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    const FILL_DARKGRAY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF808080' } };
    const FILL_RESP     = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    const FILL_NONE     = { type: 'pattern', pattern: 'none' };

    // Randen
    const THIN      = { style: 'thin',   color: { argb: 'FF000000' } };
    const THIN_GRAY = { style: 'thin',   color: { argb: 'FF999999' } };
    const BORDER    = { top: THIN,      left: THIN,      bottom: THIN,      right: THIN      };
    const BORDER_G  = { top: THIN_GRAY, left: THIN_GRAY, bottom: THIN_GRAY, right: THIN_GRAY };

    const FONT = (opts = {}) => ({ name: 'Calibri', size: 10, ...opts });

    // Totaal kolommen: tijdstip | label | 6 namen | "X pers"
    const TOTAL_COLS = 2 + COLS_PER_ROW + 1;

    // ── Werkboek ────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VVS Rotselaar';
    const ws = wb.addWorksheet('Werklijst', { views: [{ showGridLines: false }] });

    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 7;
    for (let c = 3; c <= COLS_PER_ROW + 2; c++) ws.getColumn(c).width = 21;
    ws.getColumn(COLS_PER_ROW + 3).width = 8;

    // ── Hulpfuncties ────────────────────────────────────────────────────────
    function sc(cell, { fill, font, border, align, value } = {}) {
        if (value !== undefined) cell.value = value;
        if (fill)   cell.fill      = fill;
        if (font)   cell.font      = font;
        if (border) cell.border    = border;
        if (align)  cell.alignment = align;
    }

    function addMergedRow(text, fill, font, height) {
        const r = ws.addRow([text]);
        r.height = height || 20;
        ws.mergeCells(r.number, 1, r.number, TOTAL_COLS);
        sc(ws.getCell(r.number, 1), {
            fill, font,
            align: { horizontal: 'center', vertical: 'middle' },
        });
        return r;
    }

    // Schrijft één naam-rij + één tel-rij voor een gegeven 'chunk' van personen.
    // firstChunk = true → tijdstip-cel; false → lege tijdstip-cel (vervolgrijen)
    function writeChunk({ timeLabel, showTime, chunk, chunkStart, max, unlimited, persCol }) {
        const rN = ws.addRow([]); rN.height = 18;
        const rT = ws.addRow([]); rT.height = 15;

        // Tijdstip-cel (alleen eerste chunk)
        if (showTime) {
            sc(ws.getCell(rN.number, 1), {
                value:  timeLabel,
                font:   FONT({ bold: true, size: 10 }),
                align:  { horizontal: 'left', vertical: 'middle' },
                border: BORDER,
            });
        } else {
            sc(ws.getCell(rN.number, 1), { fill: FILL_NONE, border: BORDER });
        }
        ws.mergeCells(rN.number, 1, rT.number, 1);

        // Labels
        sc(ws.getCell(rN.number, 2), {
            value: 'Naam', font: FONT({ bold: true, size: 9 }),
            fill: FILL_LABEL, align: { horizontal: 'center', vertical: 'middle' }, border: BORDER,
        });
        sc(ws.getCell(rT.number, 2), {
            value: 'Tel', font: FONT({ bold: true, size: 9 }),
            fill: FILL_LABEL, align: { horizontal: 'center', vertical: 'middle' }, border: BORDER,
        });

        // Persoons-kolommen
        for (let i = 0; i < COLS_PER_ROW; i++) {
            const absIdx = chunkStart + i;
            const col    = i + 3;
            const p      = chunk[i] || null;
            const nC     = ws.getCell(rN.number, col);
            const tC     = ws.getCell(rT.number, col);

            if (p) {
                // Ingevuld slot
                const isResp = !!p.responsible;
                sc(nC, {
                    value:  p.naam,
                    font:   FONT({ bold: true, color: { argb: isResp ? 'FFCC0000' : 'FF000000' } }),
                    fill:   isResp ? FILL_RESP : FILL_NONE,
                    align:  { horizontal: 'left', vertical: 'middle' },
                    border: BORDER,
                });
                sc(tC, {
                    value:  uidToPhone[p.uid] || '',
                    font:   FONT({ size: 9, italic: true }),
                    fill:   isResp ? FILL_RESP : FILL_NONE,
                    align:  { horizontal: 'left', vertical: 'middle' },
                    border: BORDER,
                });
            } else if (unlimited) {
                // Ongelimiteerd: witte cellen — er kunnen altijd mensen bij, maar hoeft niet
                sc(nC, { fill: FILL_NONE, border: BORDER });
                sc(tC, { fill: FILL_NONE, border: BORDER });
            } else if (max !== null && absIdx < max) {
                // Leeg maar binnen max → GEEL (meer mensen nodig)
                sc(nC, { fill: FILL_YELLOW, border: BORDER });
                sc(tC, { fill: FILL_YELLOW, border: BORDER });
            } else {
                // Buiten max → DONKERGRIJS (niet nodig)
                sc(nC, { fill: FILL_DARKGRAY, border: BORDER_G });
                sc(tC, { fill: FILL_DARKGRAY, border: BORDER_G });
            }
        }

        // "X pers" of "∞ pers" uiterst rechts — enkel op eerste chunk
        if (showTime) {
            sc(ws.getCell(rN.number, COLS_PER_ROW + 3), {
                value: unlimited ? '∞ pers' : `${max} pers`,
                font:  FONT({ size: 8, italic: true, color: { argb: 'FF555555' } }),
                align: { horizontal: 'right', vertical: 'middle' },
            });
        }
        sc(ws.getCell(rT.number, COLS_PER_ROW + 3), { fill: FILL_LABEL });
    }

    // ── Titelrij ────────────────────────────────────────────────────────────
    addMergedRow(
        'WERKVERDELING ' + (wl.naam || 'WERKLIJST').toUpperCase(),
        FILL_TITLE,
        FONT({ bold: true, size: 14, color: { argb: 'FFFFFFFF' } }),
        30
    );

    const today = new Date().toLocaleDateString('nl-BE');
    const rDate = ws.addRow([`v_${shifts.length > 0 ? '' : ''}${today}`]);
    rDate.height = 14;
    sc(ws.getCell(rDate.number, 1), {
        value: `v_03 - ${today}`,
        fill: FILL_YELLOW,
        font: FONT({ size: 8, italic: true }),
    });

    // ── Per dag ─────────────────────────────────────────────────────────────
    const byDate = {};
    shifts.forEach(s => {
        const key = s.date || '__no_date__';
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(s);
    });

    Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([date, dayShifts]) => {

            ws.addRow([]).height = 8;

            // Dag-header
            let dagText = 'DATUM ONBEKEND';
            if (date !== '__no_date__') {
                const d = new Date(date + 'T12:00:00');
                const wd = d.toLocaleDateString('nl-BE', { weekday: 'long' }).toUpperCase();
                const dd = d.getDate();
                const mm = d.toLocaleDateString('nl-BE', { month: 'long' });
                dagText  = `${wd} ${dd} ${mm}   (naam + achternaam + telnr invullen!)`;
            }
            addMergedRow(dagText, FILL_DAY, FONT({ bold: true, size: 12 }), 22);

            // "Verantwoordelijke" koptekstrij
            const rVH = ws.addRow([]); rVH.height = 15;
            for (let c = 1; c <= 2; c++)
                sc(ws.getCell(rVH.number, c), { fill: FILL_LABEL, border: BORDER_G });
            sc(ws.getCell(rVH.number, 3), {
                value:  'VERANTWOORDELIJKE',
                font:   FONT({ bold: true, size: 9, color: { argb: 'FFCC0000' } }),
                align:  { horizontal: 'center', vertical: 'middle' },
                border: BORDER,
            });
            for (let c = 4; c <= TOTAL_COLS; c++)
                sc(ws.getCell(rVH.number, c), { fill: FILL_LABEL, border: BORDER_G });

            // ── Shifts ──────────────────────────────────────────────────────
            dayShifts
                .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
                .forEach(shift => {
                    const persons   = shift.persons || [];
                    // Verantwoordelijke altijd vooraan
                    const sorted    = [...persons].sort((a, b) => (b.responsible ? 1 : 0) - (a.responsible ? 1 : 0));
                    const unlimited = shift.max === null || shift.max === undefined || shift.max === 0;
                    const max       = unlimited ? null : shift.max;

                    // Bereken hoeveel rijen nodig zijn:
                    // - Gelimiteerd: toon max slots (geel of grijs voor lege), minimum 1 rij
                    // - Ongelimiteerd: toon het aantal ingeschrevenen afgerond op COLS_PER_ROW
                    const totalSlots = unlimited
                        ? Math.ceil(Math.max(persons.length, COLS_PER_ROW) / COLS_PER_ROW) * COLS_PER_ROW
                        : Math.max(max, persons.length);

                    const numChunks = Math.ceil(totalSlots / COLS_PER_ROW);

                    for (let chunk = 0; chunk < numChunks; chunk++) {
                        const start = chunk * COLS_PER_ROW;
                        const end   = start + COLS_PER_ROW;
                        const slice = sorted.slice(start, end);

                        writeChunk({
                            timeLabel:  shift.time || '',
                            showTime:   chunk === 0,
                            chunk:      slice,
                            chunkStart: start,
                            max,
                            unlimited,
                            persCol:    COLS_PER_ROW + 3,
                        });
                    }
                });
        });

    // ── Downloaden ──────────────────────────────────────────────────────────
    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = (wl.naam || 'werklijst').replace(/[^a-z0-9]/gi, '_') + '.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✅ Excel gedownload!', 'success');
}


// ── Open shifts editor ──────────────────────────────────────────────────────────
function openShiftsEditor(werklijstId) {
    editingWerklijstId = werklijstId;
    const wl = werklijstenCache[werklijstId];

    document.getElementById('werklijstenView').style.display = 'none';
    document.getElementById('shiftsEditorView').style.display = 'block';
    document.getElementById('shiftsEditorTitle').textContent  = wl?.naam || 'Werklijst';
    document.getElementById('shiftsEditorActive').style.display = wl?.active ? 'inline-flex' : 'none';

    if (unsubShifts) unsubShifts();
    shiftsCache = {};
    document.getElementById('shiftsEditorGrid').innerHTML = '<div class="loading">Laden…</div>';

    unsubShifts = onSnapshot(
        collection(db, 'werklijsten', werklijstId, 'shifts'),
        (snap) => {
            shiftsCache = {};
            snap.forEach(d => { shiftsCache[d.id] = { id: d.id, ...d.data() }; });
            renderShiftsEditor();
        },
        (err) => {
            console.error('Shifts snapshot error:', err);
            document.getElementById('shiftsEditorGrid').innerHTML =
                `<p class="error-text text-center">Fout bij laden: ${err.message}</p>`;
        }
    );
}

// ── Close shifts editor ─────────────────────────────────────────────────────────
function closeShiftsEditor() {
    if (unsubShifts) { unsubShifts(); unsubShifts = null; }
    editingWerklijstId = null;
    shiftsCache = {};
    document.getElementById('werklijstenView').style.display = 'block';
    document.getElementById('shiftsEditorView').style.display = 'none';
}

document.getElementById('backToWerklijstenBtn')?.addEventListener('click', closeShiftsEditor);

// ── Render shifts editor (grouped by date) ─────────────────────────────────────
function renderShiftsEditor() {
    const grid = document.getElementById('shiftsEditorGrid');
    if (!grid) return;

    const shifts = Object.values(shiftsCache);

    if (shifts.length === 0) {
        grid.innerHTML = `
            <div class="werklijst-empty-state">
                <p>Nog geen shiften voor deze werklijst. Klik op "+ Shift Toevoegen".</p>
            </div>`;
        return;
    }

    // Sort by date then start time
    shifts.sort((a, b) => {
        const ka = (a.date || '9999') + parseTimeStart(a.time);
        const kb = (b.date || '9999') + parseTimeStart(b.time);
        return ka.localeCompare(kb);
    });

    // Group by date
    const byDate = {};
    shifts.forEach(s => {
        const key = s.date || '__geen_datum__';
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(s);
    });

    grid.innerHTML = '';

    Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([date, dayShifts]) => {
            let dateLabel = 'Datum onbekend';
            if (date !== '__geen_datum__') {
                const d = new Date(date + 'T12:00:00');
                dateLabel = d.toLocaleDateString('nl-BE', {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                });
                // Capitalize first letter
                dateLabel = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
            }

            const dayGroup = document.createElement('div');
            dayGroup.className = 'shifts-day-group';
            dayGroup.innerHTML = `
                <div class="shifts-day-header">
                    <div class="shifts-day-header-left">
                        <span class="shifts-day-icon">📅</span>
                        <h4>${dateLabel}</h4>
                        <span class="shifts-day-count">${dayShifts.length} shift${dayShifts.length !== 1 ? 'en' : ''}</span>
                    </div>
                </div>
                <div class="shifts-day-cards"></div>
            `;

            const cardsEl = dayGroup.querySelector('.shifts-day-cards');
            dayShifts.forEach(shift => cardsEl.appendChild(createShiftCard(shift)));
            grid.appendChild(dayGroup);
        });
}

// ── Create shift card ───────────────────────────────────────────────────────────
function parseTimeStart(t) {
    if (!t) return '00:00';
    return t.split(/[–—\-]/)[0].trim() || '00:00';
}

function createShiftCard(shift) {
    const persons  = shift.persons || [];
    const maxLabel = shift.max ? `${persons.length} / ${shift.max}` : `${persons.length} / ∞`;
    const catTag = shift.category ? `<span class="shift-cat-tag">${shift.category}</span>` : '';

    const reqResp  = shift.requireResponsible ?? true;
    const showLbl  = shift.showLabel ?? false;
    const respBadge  = reqResp
        ? `<span class="shift-opt-badge badge-on"  title="Verantwoordelijke vereist">★ Verantw.</span>`
        : `<span class="shift-opt-badge badge-off" title="Geen verantwoordelijke">★ Uit</span>`;
    const labelBadge = showLbl
        ? `<span class="shift-opt-badge badge-on"  title="Label zichtbaar">🏷️ Label</span>`
        : `<span class="shift-opt-badge badge-off" title="Label verborgen">🏷️ Verborgen</span>`;

    const card = document.createElement('div');
    card.className = 'shift-admin-card';
    card.dataset.id = shift.id;

    card.innerHTML = `
        <div class="shift-admin-header">
            <div class="shift-admin-header-info">
                <div class="shift-admin-title">${shift.label || shift.id} ${catTag}</div>
                <div class="shift-admin-meta">
                    <span class="meta-time">${shift.time || ''}</span>
                    <span class="meta-sep">·</span>
                    <span class="meta-count">${maxLabel} pers.</span>
                    <span class="meta-sep">·</span>
                    ${respBadge}${labelBadge}
                </div>
                ${shift.note ? `<div class="shift-admin-note">${shift.note}</div>` : ''}
            </div>
            <div class="shift-admin-actions-header">
                <button class="icon-btn edit sac-edit" title="Bewerken"><img src="assets/edit.png" class="icon-lg" alt=""></button>
                <button class="icon-btn delete sac-delete" title="Verwijderen"><img src="assets/delete.png" class="icon-lg" alt=""></button>
            </div>
        </div>
        <div class="shift-admin-body">
            <div class="shift-person-list" id="plist-${shift.id}">
                ${persons.length === 0
                    ? '<p class="no-persons-msg">Nog niemand ingeschreven.</p>'
                    : persons.map(p => personRow(p)).join('')}
            </div>
            <div class="shift-add-person">
                <input type="text" class="add-name-input" placeholder="Naam toevoegen…" autocomplete="off">
                <button class="add-person-btn" type="button">+ Toevoegen</button>
            </div>
        </div>
    `;

    card.querySelector('.sac-edit').addEventListener('click', () => openShiftModal(shift));
    card.querySelector('.sac-delete').addEventListener('click', () => confirmDeleteShift(shift));

    card.querySelectorAll('.remove-person-btn').forEach(btn => {
        btn.addEventListener('click', () => removePerson(shift.id, btn.dataset.uid, btn.dataset.naam));
    });

    const input = card.querySelector('.add-name-input');
    const btn   = card.querySelector('.add-person-btn');

    btn.addEventListener('click', () => {
        addPersonByName(shift.id, input.value.trim());
        input.value = '';
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addPersonByName(shift.id, input.value.trim());
            input.value = '';
        }
    });

    return card;
}

function personRow(p) {
    const respLabel = p.responsible ? ' <span class="person-role">(verantw.)</span>' : '';
    const nameClass = p.responsible ? 'person-name is-responsible' : 'person-name';
    return `
        <div class="shift-person-row">
            <span class="${nameClass}">${p.naam}${respLabel}</span>
            <button class="remove-person-btn" data-uid="${p.uid || ''}" data-naam="${p.naam}" title="Verwijder ${p.naam}">✕</button>
        </div>`;
}

// ── Add / Remove person ─────────────────────────────────────────────────────────
async function addPersonByName(shiftId, naam) {
    if (!naam || !editingWerklijstId) return;
    const shift = shiftsCache[shiftId];
    if (!shift) return;
    const existing = shift.persons || [];
    if (existing.some(p => p.naam.toLowerCase() === naam.toLowerCase())) {
        showToast('Deze naam staat er al in.', 'error');
        return;
    }
    try {
        await setDoc(
            doc(db, 'werklijsten', editingWerklijstId, 'shifts', shiftId),
            { persons: [...existing, { uid: '', naam, responsible: false }] },
            { merge: true }
        );
        showToast(`✅ ${naam} toegevoegd.`, 'success');
    } catch (e) {
        console.error('addPersonByName error:', e);
        showToast('❌ ' + e.message, 'error');
    }
}

async function removePerson(shiftId, uid, naam) {
    if (!confirm(`Weet je zeker dat je ${naam} wilt verwijderen van deze shift?`)) return;
    const shift = shiftsCache[shiftId];
    if (!shift || !editingWerklijstId) return;
    const updated = (shift.persons || []).filter(p => uid ? p.uid !== uid : p.naam !== naam);
    try {
        await setDoc(
            doc(db, 'werklijsten', editingWerklijstId, 'shifts', shiftId),
            { persons: updated },
            { merge: true }
        );
        showToast(`↩️ ${naam} verwijderd.`, 'success');
    } catch (e) {
        console.error('removePerson error:', e);
        showToast('❌ ' + e.message, 'error');
    }
}

// ── Werklijst modal (nieuw / hernoemen) ────────────────────────────────────────
const werklijstModal = document.getElementById('werklijstModal');
const werklijstForm  = document.getElementById('werklijstForm');

function openWerklijstModal(wl = null) {
    document.getElementById('werklijstModalTitle').textContent = wl ? 'Werklijst Hernoemen' : 'Werklijst Toevoegen';
    document.getElementById('werklijstId').value   = wl ? wl.id : '';
    document.getElementById('werklijstNaam').value = wl ? (wl.naam || '') : '';
    werklijstModal.classList.add('active');
}

document.getElementById('addWerklijstBtn')?.addEventListener('click', () => openWerklijstModal());
document.getElementById('werklijstModalCancel')?.addEventListener('click', () => werklijstModal.classList.remove('active'));
werklijstModal?.addEventListener('click', e => { if (e.target === werklijstModal) werklijstModal.classList.remove('active'); });

werklijstForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id   = document.getElementById('werklijstId').value.trim();
    const naam = document.getElementById('werklijstNaam').value.trim();
    if (!naam) return;

    const btn = werklijstForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Bezig…';

    try {
        if (id) {
            await setDoc(doc(db, 'werklijsten', id), { naam }, { merge: true });
            showToast('✅ Werklijst hernoemd!', 'success');
        } else {
            await addDoc(collection(db, 'werklijsten'), { naam, active: false, createdAt: serverTimestamp() });
            showToast('✅ Werklijst aangemaakt!', 'success');
        }
        werklijstModal.classList.remove('active');
    } catch (err) {
        console.error('Werklijst save error:', err);
        showToast('❌ Fout: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Opslaan';
    }
});

// ── Shift modal (nieuw / bewerken) ─────────────────────────────────────────────
const shiftModal = document.getElementById('shiftModal');
const shiftForm  = document.getElementById('shiftForm');

function openShiftModal(shift = null) {
    document.getElementById('shiftModalTitle').textContent = shift ? 'Shift Bewerken' : 'Shift Toevoegen';
    document.getElementById('shiftId').value        = shift ? shift.id : '';
    document.getElementById('shiftLabel').value     = shift ? (shift.label    || '') : '';
    document.getElementById('shiftDate').value      = shift ? (shift.date     || '') : '';
    document.getElementById('shiftTime').value      = shift ? (shift.time     || '') : '';
    document.getElementById('shiftMax').value       = shift ? (shift.max      || '') : '';
    document.getElementById('shiftNote').value      = shift ? (shift.note     || '') : '';
    document.getElementById('shiftCategory').value  = shift ? (shift.category || '') : '';

    // Toggles – requireResponsible standaard AAN, showLabel standaard UIT
    const rrEl = document.getElementById('shiftRequireResponsible');
    const slEl = document.getElementById('shiftShowLabel');
    if (rrEl) rrEl.checked = shift ? (shift.requireResponsible ?? true)  : true;
    if (slEl) slEl.checked = shift ? (shift.showLabel          ?? false) : false;

    // Vul de datalist met bestaande categorieën voor autocomplete
    const categories = [...new Set(
        Object.values(shiftsCache).map(s => s.category).filter(Boolean)
    )];
    const dl = document.getElementById('categoryList');
    if (dl) dl.innerHTML = categories.map(c => `<option value="${c}">`).join('');

    shiftModal.classList.add('active');
}

document.getElementById('addShiftBtn')?.addEventListener('click', () => openShiftModal());
document.getElementById('shiftModalCancel')?.addEventListener('click', () => shiftModal.classList.remove('active'));
shiftModal?.addEventListener('click', e => { if (e.target === shiftModal) shiftModal.classList.remove('active'); });

shiftForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingWerklijstId) { showToast('❌ Geen werklijst geselecteerd.', 'error'); return; }

    const id       = document.getElementById('shiftId').value.trim();
    const label    = document.getElementById('shiftLabel').value.trim();
    const date     = document.getElementById('shiftDate').value;
    const time     = document.getElementById('shiftTime').value.trim();
    const maxRaw   = document.getElementById('shiftMax').value;
    const max      = maxRaw ? parseInt(maxRaw, 10) : null;
    const note     = document.getElementById('shiftNote').value.trim();
    const category = document.getElementById('shiftCategory').value.trim();
    const requireResponsible = document.getElementById('shiftRequireResponsible')?.checked ?? true;
    const showLabel          = document.getElementById('shiftShowLabel')?.checked ?? false;

    const shiftId = id || slugify(`${label}_${date}`);

    const btn = shiftForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Bezig…';

    try {
        const existing = shiftsCache[shiftId] || {};
        await setDoc(
            doc(db, 'werklijsten', editingWerklijstId, 'shifts', shiftId),
            { label, date, time, max, note, category, requireResponsible, showLabel, persons: existing.persons || [] }
        );
        showToast('✅ Shift opgeslagen!', 'success');
        shiftModal.classList.remove('active');
    } catch (err) {
        console.error('Save shift error:', err);
        showToast('❌ Fout: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Opslaan';
    }
});

function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 60);
}

// ── Confirm modals ──────────────────────────────────────────────────────────────
function confirmDeleteWerklijst(wl) {
    openConfirm(
        `Weet je zeker dat je werklijst "${wl.naam}" wilt verwijderen? Alle shiften en inschrijvingen gaan verloren.`,
        async () => {
            try {
                // Delete subcollection shifts first (client-side)
                const shiftsSnap = await getDocs(collection(db, 'werklijsten', wl.id, 'shifts'));
                await Promise.all(shiftsSnap.docs.map(d => deleteDoc(d.ref)));
                await deleteDoc(doc(db, 'werklijsten', wl.id));
                showToast('<img src="assets/delete.png" class="icon-lg" alt=""> Werklijst verwijderd.', 'success');
            } catch (err) {
                console.error('Delete werklijst error:', err);
                showToast('❌ Fout: ' + err.message, 'error');
            }
        }
    );
}

function confirmDeleteShift(shift) {
    openConfirm(
        `Weet je zeker dat je de shift "${shift.label || shift.id}" wilt verwijderen? Alle inschrijvingen gaan verloren.`,
        async () => {
            try {
                await deleteDoc(doc(db, 'werklijsten', editingWerklijstId, 'shifts', shift.id));
                showToast('<img src="assets/delete.png" class="icon-lg" alt=""> Shift verwijderd.', 'success');
            } catch (err) {
                console.error('Delete shift error:', err);
                showToast('❌ Fout: ' + err.message, 'error');
            }
        }
    );
}

function openConfirm(message, onConfirm) {
    const confirmModal  = document.getElementById('confirmModal');
    const confirmMsg    = document.getElementById('confirmMessage');
    const confirmDelete = document.getElementById('confirmDelete');
    const confirmCancel = document.getElementById('confirmCancel');

    confirmMsg.textContent = message;
    confirmModal.classList.add('active');

    // Clone to remove old listeners
    const newDeleteBtn = confirmDelete.cloneNode(true);
    confirmDelete.parentNode.replaceChild(newDeleteBtn, confirmDelete);
    const newCancelBtn = confirmCancel.cloneNode(true);
    confirmCancel.parentNode.replaceChild(newCancelBtn, confirmCancel);

    newDeleteBtn.addEventListener('click', async () => {
        confirmModal.classList.remove('active');
        await onConfirm();
    });
    newCancelBtn.addEventListener('click', () => confirmModal.classList.remove('active'));
}

// ── Data reset confirm modal ────────────────────────────────────────────────────

function generateCode(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function showDataResetConfirm({ label, teamLabel, onConfirmed }) {
    let modal = document.getElementById('dataResetConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dataResetConfirmModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3 style="color:var(--danger);">⚠ Bevestig reset</h3>
                <p id="drcDescription" style="margin-bottom:1.25rem;color:var(--text-gray);line-height:1.6;"></p>
                <div class="data-reset-code-box">
                    <span>Typ deze code om te bevestigen:</span>
                    <strong id="drcCode" class="data-reset-code"></strong>
                </div>
                <div class="form-group" style="margin-top:0.75rem;">
                    <input type="text" id="drcInput" autocomplete="off" autocorrect="off"
                        spellcheck="false" placeholder="Typ de code hier"
                        style="letter-spacing:0.15em;font-weight:700;font-size:1.05rem;">
                </div>
                <p id="drcError" style="color:var(--danger);font-size:0.88rem;min-height:1.2rem;margin-bottom:0.5rem;"></p>
                <div class="modal-actions">
                    <button class="modal-btn cancel" id="drcCancelBtn">Annuleren</button>
                    <button class="modal-btn danger" id="drcConfirmBtn">Verwijderen</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
    }

    const code       = generateCode();
    const input      = modal.querySelector('#drcInput');
    const errorEl    = modal.querySelector('#drcError');
    const codeEl     = modal.querySelector('#drcCode');
    const descEl     = modal.querySelector('#drcDescription');
    const confirmBtn = modal.querySelector('#drcConfirmBtn');
    const cancelBtn  = modal.querySelector('#drcCancelBtn');

    descEl.textContent = `Je staat op het punt om de ${label} van de ${teamLabel} te verwijderen. Dit kan NIET ongedaan worden gemaakt.`;
    codeEl.textContent = code;
    input.value        = '';
    errorEl.textContent = '';
    confirmBtn.disabled = true;

    // Enable confirm only when input matches
    input.oninput = () => {
        const match = input.value.trim().toUpperCase() === code;
        confirmBtn.disabled = !match;
        if (errorEl.textContent && match) errorEl.textContent = '';
    };

    cancelBtn.onclick = () => modal.classList.remove('active');

    confirmBtn.onclick = () => {
        if (input.value.trim().toUpperCase() !== code) {
            errorEl.textContent = 'Code komt niet overeen.';
            return;
        }
        modal.classList.remove('active');
        onConfirmed();
    };

    modal.classList.add('active');
    setTimeout(() => input.focus(), 50);
}

// ── Toast ───────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
    let t = document.getElementById('adminToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'adminToast';
        t.style.cssText = `position:fixed;bottom:1.75rem;right:1.75rem;background:var(--text-dark);color:var(--white);
            padding:0.75rem 1.3rem;border-radius:9px;font-size:0.88rem;font-weight:600;z-index:9999;
            transform:translateY(80px);opacity:0;transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);
            box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;max-width:320px;`;
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--text-dark)';
    t.style.transform  = 'translateY(0)';
    t.style.opacity    = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.transform = 'translateY(80px)'; t.style.opacity = '0'; }, 3500);
}

// ── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.tab + 'Tab');
        if (target) target.classList.add('active');
    });
});

// ── Data reset ───────────────────────────────────────────────────────────────

const SUBCOLLECTIONS = ['availability', 'playerMinutes', 'lineup', 'events'];

/**
 * Delete all documents in a subcollection of a match using a batch.
 * Returns the number of deletes queued.
 */
async function queueMatchSubcollectionDeletes(batch, matchId, subName) {
    const snap = await getDocs(collection(db, 'matches', matchId, subName));
    snap.forEach(d => batch.delete(d.ref));
    return snap.size;
}

/**
 * Delete global events linked to a matchId.
 */
async function queueEventsForMatch(batch, matchId) {
    const snap = await getDocs(
        query(collection(db, 'events'), where('matchId', '==', matchId))
    );
    snap.forEach(d => batch.delete(d.ref));
    return snap.size;
}

async function resetStats(team) {
    const snap = await getDocs(collection(db, 'users'));
    const batch = writeBatch(db);
    let count = 0;
    snap.forEach(d => {
        const data = d.data();
        if (team !== 'all') {
            const userPloegen = Array.isArray(data.ploegen) && data.ploegen.length > 0
                ? data.ploegen : (data.categorie ? [data.categorie] : []);
            if (!userPloegen.includes(team)) return;
        }
        batch.update(d.ref, {
            goals: 0, assists: 0, matchen: 0,
            minuten: 0, geelKaarten: 0, roodKaarten: 0
        });
        count++;
    });
    if (count === 0) return 0;
    await batch.commit();
    return count;
}

async function resetMatches(team) {
    const matchSnap = await getDocs(collection(db, 'matches'));
    const toDelete = [];
    matchSnap.forEach(d => {
        const data = d.data();
        if (team === 'all' || data.categorie === team || data.ploeg === team) {
            toDelete.push(d);
        }
    });

    if (toDelete.length === 0) return 0;

    // Firestore batches are limited to 500 ops — chunk if needed
    const MAX_BATCH = 400;
    let ops = [];

    for (const matchDoc of toDelete) {
        const mid = matchDoc.id;
        // Collect all sub-doc refs
        for (const sub of SUBCOLLECTIONS) {
            const subSnap = await getDocs(collection(db, 'matches', mid, sub));
            subSnap.forEach(d => ops.push(d.ref));
        }
        // Global events collection
        const evSnap = await getDocs(
            query(collection(db, 'events'), where('matchId', '==', mid))
        );
        evSnap.forEach(d => ops.push(d.ref));
        // The match doc itself (last so subcollections go first)
        ops.push(matchDoc.ref);
    }

    // Commit in chunks of MAX_BATCH
    for (let i = 0; i < ops.length; i += MAX_BATCH) {
        const batch = writeBatch(db);
        ops.slice(i, i + MAX_BATCH).forEach(ref => batch.delete(ref));
        await batch.commit();
    }

    return toDelete.length;
}

async function resetRanking(team) {
    const snap = await getDocs(collection(db, 'ranking'));
    const batch = writeBatch(db);
    let count = 0;
    snap.forEach(d => {
        const data = d.data();
        if (team !== 'all' && data.categorie !== team && data.ploeg !== team) return;
        batch.delete(d.ref);
        count++;
    });
    if (count === 0) return 0;
    await batch.commit();
    return count;
}

// Wire up reset buttons
document.querySelectorAll('.data-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const team   = btn.dataset.team;
        const teamLabel = team === 'all' ? 'alle ploegen' : team;

        const actionLabels = {
            stats:   'spelersstatistieken',
            matches: 'wedstrijden & events',
            ranking: 'rangschikking'
        };

        showDataResetConfirm({
            label:      actionLabels[action],
            teamLabel,
            onConfirmed: async () => {
                const statusEl = document.getElementById('dataResetStatus');
                statusEl.innerHTML = '<p style="color:var(--text-gray)">Bezig…</p>';
                document.querySelectorAll('.data-reset-btn').forEach(b => b.disabled = true);
                try {
                    let count = 0;
                    if (action === 'stats')   count = await resetStats(team);
                    if (action === 'matches') count = await resetMatches(team);
                    if (action === 'ranking') count = await resetRanking(team);
                    statusEl.innerHTML = `<p style="color:var(--success);font-weight:600;">✓ Klaar — ${count} record(s) verwijderd/gereset.</p>`;
                    showToast('Reset geslaagd', 'success');
                } catch (e) {
                    console.error('Reset error:', e);
                    statusEl.innerHTML = `<p style="color:var(--danger);font-weight:600;">Fout: ${e.message}</p>`;
                    showToast('Fout bij reset', 'error');
                } finally {
                    document.querySelectorAll('.data-reset-btn').forEach(b => b.disabled = false);
                }
            }
        });
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// SPONSORS BEHEREN
// Firestore: sponsors/{id} → { naam, beschrijving, website, websiteLabel,
//                               afbeeldingNaam, volgorde }
// ═══════════════════════════════════════════════════════════════════════════════

let sponsorsCache = {};   // id → sponsor data
let unsubSponsors = null;

// ── Start real-time listener when tab is opened ─────────────────────────────
function startSponsorsListener() {
    if (unsubSponsors) return;   // already listening
    unsubSponsors = onSnapshot(
        collection(db, 'sponsors'),
        (snap) => {
            sponsorsCache = {};
            snap.forEach(d => { sponsorsCache[d.id] = { id: d.id, ...d.data() }; });
            renderSponsorsList();
        },
        (err) => {
            console.error('Sponsors snapshot error:', err);
            showToast('❌ Fout bij laden sponsors: ' + err.message, 'error');
        }
    );
}

// ── Render list ─────────────────────────────────────────────────────────────
function renderSponsorsList() {
    const container = document.getElementById('sponsorsList');
    if (!container) return;

    const items = Object.values(sponsorsCache)
        .sort((a, b) => (a.volgorde ?? 999) - (b.volgorde ?? 999));

    if (items.length === 0) {
        container.innerHTML = `
            <div class="werklijst-empty-state">
                <p>Nog geen sponsors. Klik op "+ Sponsor Toevoegen" om te beginnen.</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    items.forEach((sponsor, idx) => {
        const card = document.createElement('div');
        card.className = 'sponsor-admin-card';
        card.innerHTML = `
            <div class="sponsor-admin-logo">
                ${sponsor.afbeeldingNaam
                    ? `<img src="assets/${sponsor.afbeeldingNaam}" alt="${htmlEscAdmin(sponsor.naam)}" onerror="this.style.display='none'">`
                    : `<div class="sponsor-admin-logo-placeholder">📷</div>`}
            </div>
            <div class="sponsor-admin-info">
                <strong class="sponsor-admin-name">${htmlEscAdmin(sponsor.naam)}</strong>
                ${sponsor.beschrijving
                    ? `<p class="sponsor-admin-desc">${htmlEscAdmin(sponsor.beschrijving)}</p>`
                    : ''}
                ${sponsor.website
                    ? `<a href="${htmlEscAdmin(sponsor.website)}" target="_blank" rel="noopener noreferrer"
                          class="sponsor-admin-link">${htmlEscAdmin(sponsor.websiteLabel || sponsor.website)}</a>`
                    : ''}
                ${sponsor.afbeeldingNaam
                    ? `<span class="sponsor-admin-img-tag">🖼 ${htmlEscAdmin(sponsor.afbeeldingNaam)}</span>`
                    : ''}
            </div>
            <div class="sponsor-admin-actions">
                <button class="icon-btn" title="Omhoog" data-move="up"   ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button class="icon-btn" title="Omlaag" data-move="down" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
                <button class="icon-btn edit"   title="Bewerken"><img src="assets/edit.png" class="icon-lg" alt=""></button>
                <button class="icon-btn delete" title="Verwijderen"><img src="assets/delete.png" class="icon-lg" alt=""></button>
            </div>`;

        card.querySelector('[data-move="up"]')?.addEventListener('click',
            () => moveSponsor(sponsor.id, items, idx, -1));
        card.querySelector('[data-move="down"]')?.addEventListener('click',
            () => moveSponsor(sponsor.id, items, idx, +1));
        card.querySelector('.edit').addEventListener('click',
            () => openSponsorModal(sponsor));
        card.querySelector('.delete').addEventListener('click',
            () => confirmDeleteSponsor(sponsor));

        container.appendChild(card);
    });
}

// ── Move sponsor (reorder) ───────────────────────────────────────────────────
async function moveSponsor(id, items, idx, delta) {
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= items.length) return;

    // Swap volgorde values
    const a = items[idx];
    const b = items[newIdx];
    try {
        await Promise.all([
            setDoc(doc(db, 'sponsors', a.id), { volgorde: newIdx }, { merge: true }),
            setDoc(doc(db, 'sponsors', b.id), { volgorde: idx   }, { merge: true }),
        ]);
    } catch (e) {
        console.error('moveSponsor error:', e);
        showToast('❌ Volgorde aanpassen mislukt: ' + e.message, 'error');
    }
}

// ── Delete sponsor ────────────────────────────────────────────────────────────
function confirmDeleteSponsor(sponsor) {
    const confirmModal   = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete  = document.getElementById('confirmDelete');
    const confirmCancel  = document.getElementById('confirmCancel');
    if (!confirmModal) return;

    confirmMessage.textContent = `Sponsor "${sponsor.naam}" definitief verwijderen?`;
    confirmModal.classList.add('active');

    const cleanup = () => confirmModal.classList.remove('active');
    confirmCancel.onclick = cleanup;
    confirmModal.onclick  = e => { if (e.target === confirmModal) cleanup(); };

    confirmDelete.onclick = async () => {
        cleanup();
        try {
            await deleteDoc(doc(db, 'sponsors', sponsor.id));
            showToast('↩️ Sponsor verwijderd.', 'success');
            localStorage.removeItem('vvs_sponsors_cache');
        } catch (e) {
            console.error('deleteSponsor error:', e);
            showToast('❌ ' + e.message, 'error');
        }
    };
}

// ── Sponsor modal (nieuw / bewerken) ─────────────────────────────────────────
const sponsorModal  = document.getElementById('sponsorModal');
const sponsorForm   = document.getElementById('sponsorForm');

function openSponsorModal(sponsor = null) {
    document.getElementById('sponsorModalTitle').textContent = sponsor ? 'Sponsor Bewerken' : 'Sponsor Toevoegen';
    document.getElementById('sponsorId').value             = sponsor ? sponsor.id              : '';
    document.getElementById('sponsorNaam').value           = sponsor ? (sponsor.naam           || '') : '';
    document.getElementById('sponsorBeschrijving').value   = sponsor ? (sponsor.beschrijving   || '') : '';
    document.getElementById('sponsorWebsite').value        = sponsor ? (sponsor.website        || '') : '';
    document.getElementById('sponsorWebsiteLabel').value   = sponsor ? (sponsor.websiteLabel   || '') : '';
    document.getElementById('sponsorAfbeelding').value     = sponsor ? (sponsor.afbeeldingNaam || '') : '';
    sponsorModal.classList.add('active');
}

document.getElementById('addSponsorBtn')?.addEventListener('click', () => openSponsorModal());
document.getElementById('sponsorModalCancel')?.addEventListener('click', () => sponsorModal.classList.remove('active'));
sponsorModal?.addEventListener('click', e => { if (e.target === sponsorModal) sponsorModal.classList.remove('active'); });

sponsorForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id              = document.getElementById('sponsorId').value.trim();
    const naam            = document.getElementById('sponsorNaam').value.trim();
    const beschrijving    = document.getElementById('sponsorBeschrijving').value.trim();
    const website         = document.getElementById('sponsorWebsite').value.trim();
    const websiteLabel    = document.getElementById('sponsorWebsiteLabel').value.trim();
    const afbeeldingNaam  = document.getElementById('sponsorAfbeelding').value.trim();

    if (!naam) return;

    const btn = sponsorForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Bezig…';

    try {
        if (id) {
            // Update bestaande sponsor
            await setDoc(doc(db, 'sponsors', id), {
                naam, beschrijving, website, websiteLabel, afbeeldingNaam
            }, { merge: true });
            showToast('✅ Sponsor bijgewerkt!', 'success');
        // Cache op sponsors.html ongeldig maken
        localStorage.removeItem('vvs_sponsors_cache');
        } else {
            // Nieuwe sponsor — volgorde = einde van de lijst
            const maxVolgorde = Object.values(sponsorsCache)
                .reduce((m, s) => Math.max(m, s.volgorde ?? 0), -1);
            await addDoc(collection(db, 'sponsors'), {
                naam, beschrijving, website, websiteLabel, afbeeldingNaam,
                volgorde: maxVolgorde + 1,
                createdAt: serverTimestamp()
            });
            showToast('✅ Sponsor toegevoegd!', 'success');
        // Cache op sponsors.html ongeldig maken
        localStorage.removeItem('vvs_sponsors_cache');
        }
        sponsorModal.classList.remove('active');
    } catch (err) {
        console.error('Sponsor save error:', err);
        showToast('❌ Fout: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Opslaan';
    }
});

// ── HTML escape helper ────────────────────────────────────────────────────────
function htmlEscAdmin(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Hook into tab switching to lazily start the listener ─────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'sponsors') {
        btn.addEventListener('click', startSponsorsListener);
    }
});


// ═══════════════════════════════════════════════════════════════════════════════
// GALERIJ BEHEREN
// Firestore: galerij/{id} → { bestandsnaam, grootte, volgorde }
// grootte: 'normal' | 'wide' | 'tall' | 'large'
// ═══════════════════════════════════════════════════════════════════════════════

const GROOTTE_LABELS = { normal: 'Normaal', wide: 'Breed', tall: 'Hoog', large: 'Groot' };
const RANDOM_GROOTTES = ['normal', 'normal', 'normal', 'wide', 'tall', 'large'];

let galerijItems  = [];     // working copy (sorted by volgorde)
let galerijDirty  = false;  // unsaved changes pending
let dragSrcIdx    = null;   // index of dragged item

// ── Start listener on tab open ────────────────────────────────────────────────
let galerijLoaded = false;
function startGalerijTab() {
    if (galerijLoaded) return;
    galerijLoaded = true;
    loadGalerijAdmin();
}

async function loadGalerijAdmin() {
    const grid = document.getElementById('galerijAdminGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading">Laden…</div>';
    try {
        const snap = await getDocs(
            query(collection(db, 'galerij'), orderBy('volgorde', 'asc'))
        );
        galerijItems = [];
        snap.forEach(d => galerijItems.push({ id: d.id, ...d.data() }));
        renderGalerijAdminGrid();
    } catch (e) {
        console.error('Galerij laden error:', e);
        grid.innerHTML = `<p class="error-text text-center">Fout bij laden: ${e.message}</p>`;
    }
}

// ── Render admin grid ─────────────────────────────────────────────────────────
function renderGalerijAdminGrid() {
    const grid = document.getElementById('galerijAdminGrid');
    if (!grid) return;

    grid.innerHTML = '';

    if (galerijItems.length === 0) {
        grid.innerHTML = `<div class="werklijst-empty-state" style="grid-column:1/-1;">
            <p>Nog geen foto's. Klik op "+ Foto Toevoegen" om te beginnen.</p>
        </div>`;
        return;
    }

    galerijItems.forEach((item, idx) => {
        const cell = buildGalerijAdminCell(item, idx);
        grid.appendChild(cell);
    });

    updateSaveBtn();
}

function buildGalerijAdminCell(item, idx) {
    const cell = document.createElement('div');
    cell.className = 'galerij-admin-cell' + (item.grootte && item.grootte !== 'normal' ? ' ' + item.grootte : '');
    cell.dataset.idx = idx;
    cell.draggable = true;

    const imgPath = 'assets/galerij/' + item.bestandsnaam;
    cell.innerHTML = `
        <div class="galerij-admin-img-wrap">
            <img src="${imgPath}" alt="${item.bestandsnaam}"
                 onerror="this.parentElement.classList.add('img-error');this.style.display='none'">
            <div class="galerij-admin-missing">⚠️ Niet gevonden</div>
        </div>
        <div class="galerij-admin-overlay">
            <span class="galerij-size-badge">${GROOTTE_LABELS[item.grootte] || 'Normaal'}</span>
            <div class="galerij-admin-actions">
                <button class="ga-btn ga-edit"   title="Bewerken"><img src="assets/edit.png" class="icon-lg" alt=""></button>
                <button class="ga-btn ga-delete" title="Verwijderen"><img src="assets/delete.png" class="icon-lg" alt=""></button>
            </div>
            <span class="galerij-filename">${item.bestandsnaam}</span>
        </div>`;

    // Drag events
    cell.addEventListener('dragstart', (e) => {
        dragSrcIdx = idx;
        cell.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });
    cell.addEventListener('dragend', () => {
        cell.classList.remove('dragging');
        document.querySelectorAll('.galerij-admin-cell').forEach(c => c.classList.remove('drag-over'));
    });
    cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.galerij-admin-cell').forEach(c => c.classList.remove('drag-over'));
        cell.classList.add('drag-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        if (dragSrcIdx === null || dragSrcIdx === idx) return;
        // Reorder in working copy
        const moved = galerijItems.splice(dragSrcIdx, 1)[0];
        galerijItems.splice(idx, 0, moved);
        dragSrcIdx = null;
        markDirty();
        renderGalerijAdminGrid();
    });

    cell.querySelector('.ga-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        openFotoModal(item);
    });
    cell.querySelector('.ga-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDeleteFoto(item, idx);
    });

    return cell;
}

function markDirty() {
    galerijDirty = true;
    updateSaveBtn();
}

function updateSaveBtn() {
    const btn = document.getElementById('saveGalerijBtn');
    if (btn) btn.style.display = galerijDirty ? 'inline-flex' : 'none';
}

// ── Save all (batch write volgorde) ──────────────────────────────────────────
document.getElementById('saveGalerijBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveGalerijBtn');
    btn.disabled = true;
    btn.textContent = 'Bezig…';
    try {
        const batch = writeBatch(db);
        galerijItems.forEach((item, idx) => {
            batch.update(doc(db, 'galerij', item.id), { volgorde: idx });
            item.volgorde = idx;
        });
        await batch.commit();
        galerijDirty = false;
        updateSaveBtn();
        btn.textContent = '✅ Opgeslagen';
        setTimeout(() => {
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Opslaan';
            btn.disabled = false;
        }, 1500);
        showToast('✅ Volgorde opgeslagen!', 'success');
    } catch (e) {
        console.error('Save galerij error:', e);
        showToast('❌ Fout bij opslaan: ' + e.message, 'error');
        btn.disabled = false;
        updateSaveBtn();
    }
});

// ── Randomize order ───────────────────────────────────────────────────────────
document.getElementById('randomizeOrderBtn')?.addEventListener('click', () => {
    for (let i = galerijItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [galerijItems[i], galerijItems[j]] = [galerijItems[j], galerijItems[i]];
    }
    markDirty();
    renderGalerijAdminGrid();
    showToast('🔀 Volgorde gerandomiseerd — klik Opslaan om te bewaren.', '');
});

// ── Randomize sizes ───────────────────────────────────────────────────────────
document.getElementById('randomizeSizeBtn')?.addEventListener('click', async () => {
    if (!confirm('Alle groottes willekeurig aanpassen? Dit wordt direct opgeslagen.')) return;
    try {
        const batch = writeBatch(db);
        galerijItems.forEach(item => {
            const g = RANDOM_GROOTTES[Math.floor(Math.random() * RANDOM_GROOTTES.length)];
            item.grootte = g;
            batch.update(doc(db, 'galerij', item.id), { grootte: g });
        });
        await batch.commit();
        renderGalerijAdminGrid();
        showToast('🎲 Groottes gerandomiseerd!', 'success');
    } catch (e) {
        console.error('Randomize size error:', e);
        showToast('❌ ' + e.message, 'error');
    }
});

// ── Delete foto ───────────────────────────────────────────────────────────────
function confirmDeleteFoto(item, idx) {
    const confirmModal   = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete  = document.getElementById('confirmDelete');
    const confirmCancel  = document.getElementById('confirmCancel');
    if (!confirmModal) return;

    confirmMessage.textContent = `Foto "${item.bestandsnaam}" verwijderen uit de galerij?`;
    confirmModal.classList.add('active');

    const cleanup = () => confirmModal.classList.remove('active');
    confirmCancel.onclick = cleanup;
    confirmModal.onclick  = e => { if (e.target === confirmModal) cleanup(); };

    confirmDelete.onclick = async () => {
        cleanup();
        try {
            await deleteDoc(doc(db, 'galerij', item.id));
            galerijItems.splice(idx, 1);
            renderGalerijAdminGrid();
            showToast('↩️ Foto verwijderd.', 'success');
        } catch (e) {
            console.error('Delete foto error:', e);
            showToast('❌ ' + e.message, 'error');
        }
    };
}

// ── Foto modal (toevoegen / bewerken) ─────────────────────────────────────────
const fotoModal = document.getElementById('fotoModal');
const fotoForm  = document.getElementById('fotoForm');

function openFotoModal(item = null) {
    document.getElementById('fotoModalTitle').textContent = item ? 'Foto Bewerken' : 'Foto Toevoegen';
    document.getElementById('fotoId').value           = item ? item.id : '';
    document.getElementById('fotoBestandsnaam').value = item ? (item.bestandsnaam || '') : '';

    const grootte = item?.grootte || 'normal';
    fotoForm.querySelectorAll('input[name="fotoGrootte"]').forEach(r => {
        r.checked = (r.value === grootte);
    });

    fotoModal.classList.add('active');
}

document.getElementById('addFotoBtn')?.addEventListener('click', () => openFotoModal());
document.getElementById('fotoModalCancel')?.addEventListener('click', () => fotoModal.classList.remove('active'));
fotoModal?.addEventListener('click', e => { if (e.target === fotoModal) fotoModal.classList.remove('active'); });

fotoForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id          = document.getElementById('fotoId').value.trim();
    const bestandsnaam = document.getElementById('fotoBestandsnaam').value.trim();
    const grootte     = fotoForm.querySelector('input[name="fotoGrootte"]:checked')?.value || 'normal';

    if (!bestandsnaam) return;

    const btn = fotoForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Bezig…';

    try {
        if (id) {
            // Bewerk bestaande foto
            await setDoc(doc(db, 'galerij', id), { bestandsnaam, grootte }, { merge: true });
            const item = galerijItems.find(i => i.id === id);
            if (item) { item.bestandsnaam = bestandsnaam; item.grootte = grootte; }
            showToast('✅ Foto bijgewerkt!', 'success');
        } else {
            // Nieuwe foto — volgorde achteraan
            const volgorde = galerijItems.length;
            const ref = await addDoc(collection(db, 'galerij'), {
                bestandsnaam, grootte, volgorde, createdAt: serverTimestamp()
            });
            galerijItems.push({ id: ref.id, bestandsnaam, grootte, volgorde });
            showToast('✅ Foto toegevoegd!', 'success');
        }
        fotoModal.classList.remove('active');
        renderGalerijAdminGrid();
    } catch (err) {
        console.error('Foto save error:', err);
        showToast('❌ Fout: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Opslaan';
    }
});

// ── Hook into tab switching ───────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'galerij') {
        btn.addEventListener('click', startGalerijTab);
    }
});


// ═══════════════════════════════════════════════════════════════════════════════
// MELDINGEN BEHEREN
// Firestore: notificaties/{id} → {
//   titel, tekst, doelgroep, type, vanDatum, totDatum, actief, versie, createdAt
// }
//
// Versie-mechanisme: bij elke aanpassing wordt versie + 1. De dismiss-key in
// localStorage bevat de versie → oude dismissals worden automatisch ongeldig
// zodat iedereen de gewijzigde melding opnieuw krijgt.
// ═══════════════════════════════════════════════════════════════════════════════

let meldingenCache = {};
let unsubMeldingen = null;

const DOELGROEP_LABELS = {
    iedereen:  'Iedereen',
    ingelogd:  'Ingelogde leden',
    zaterdag:  'Zaterdag',
    zondag:    'Zondag',
    veteranen: 'Veteranen',
};
const TYPE_ICONS = { info: 'ℹ️', warning: '⚠️', success: '✅' };

// ── Listener starten bij openen tab ──────────────────────────────────────────
let meldingenLoaded = false;
function startMeldingenTab() {
    if (meldingenLoaded) return;
    meldingenLoaded = true;

    if (unsubMeldingen) unsubMeldingen();
    unsubMeldingen = onSnapshot(
        collection(db, 'notificaties'),
        (snap) => {
            meldingenCache = {};
            snap.forEach(d => { meldingenCache[d.id] = { id: d.id, ...d.data() }; });
            renderMeldingenList();
        },
        (err) => showToast('❌ Fout bij laden meldingen: ' + err.message, 'error')
    );
}

// ── Render lijst ──────────────────────────────────────────────────────────────
function renderMeldingenList() {
    const container = document.getElementById('meldingenList');
    if (!container) return;

    const items = Object.values(meldingenCache)
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));

    if (items.length === 0) {
        container.innerHTML = `<div class="werklijst-empty-state">
            <p>Nog geen meldingen. Klik op "+ Melding Toevoegen".</p></div>`;
        return;
    }

    container.innerHTML = '';
    items.forEach(m => container.appendChild(buildMeldingCard(m)));
}

function buildMeldingCard(m) {
    const card = document.createElement('div');
    card.className = `melding-admin-card${m.actief ? '' : ' melding-inactive'}`;

    const icon      = TYPE_ICONS[m.type] || 'ℹ️';
    const doelLabel = DOELGROEP_LABELS[m.doelgroep] || m.doelgroep;
    const periode   = m.vanDatum || m.totDatum
        ? `${m.vanDatum || '…'} → ${m.totDatum || '…'}`
        : 'Altijd';

    card.innerHTML = `
        <div class="melding-card-left">
            <span class="melding-type-icon">${icon}</span>
            <span class="melding-kleur-dot" style="background:${m.kleur || '#0047AB'}"></span>
            <div class="melding-card-info">
                <div class="melding-card-titel">${htmlEscAdmin(m.titel)}</div>
                <div class="melding-card-tekst">${htmlEscAdmin(m.tekst)}</div>
                <div class="melding-card-meta">
                    <span class="melding-badge">${doelLabel}</span>
                    <span class="melding-periode">📅 ${periode}</span>
                    <span class="melding-versie">v${m.versie ?? 1}</span>
                    ${!m.actief ? '<span class="melding-badge melding-badge-off">Inactief</span>' : ''}
                </div>
            </div>
        </div>
        <div class="melding-card-actions">
            <button class="icon-btn" title="${m.actief ? 'Deactiveren' : 'Activeren'}" data-toggle>
                ${m.actief ? '<img src="assets/pause.png" class="icon-lg" alt="">' : '<img src="assets/play.png" class="icon-lg" alt="">'}
            </button>
            <button class="icon-btn edit" title="Bewerken"><img src="assets/edit.png" class="icon-lg" alt=""></button>
            <button class="icon-btn delete" title="Verwijderen"><img src="assets/delete.png" class="icon-lg" alt=""></button>
        </div>`;

    card.querySelector('[data-toggle]').addEventListener('click', () => toggleMelding(m));
    card.querySelector('.edit').addEventListener('click', () => openMeldingModal(m));
    card.querySelector('.delete').addEventListener('click', () => confirmDeleteMelding(m));

    return card;
}

// ── Toggle actief ─────────────────────────────────────────────────────────────
async function toggleMelding(m) {
    try {
        await setDoc(doc(db, 'notificaties', m.id), { actief: !m.actief }, { merge: true });
        showToast(m.actief ? '⏸ Melding gedeactiveerd.' : '▶ Melding geactiveerd.', 'success');
    } catch (e) {
        showToast('❌ ' + e.message, 'error');
    }
}

// ── Verwijderen ───────────────────────────────────────────────────────────────
function confirmDeleteMelding(m) {
    const confirmModal   = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete  = document.getElementById('confirmDelete');
    const confirmCancel  = document.getElementById('confirmCancel');
    if (!confirmModal) return;

    confirmMessage.textContent = `Melding "${m.titel}" definitief verwijderen?`;
    confirmModal.classList.add('active');
    const cleanup = () => confirmModal.classList.remove('active');
    confirmCancel.onclick = cleanup;
    confirmModal.onclick  = e => { if (e.target === confirmModal) cleanup(); };

    confirmDelete.onclick = async () => {
        cleanup();
        try {
            await deleteDoc(doc(db, 'notificaties', m.id));
            showToast('↩️ Melding verwijderd.', 'success');
        } catch (e) {
            showToast('❌ ' + e.message, 'error');
        }
    };
}

// ── Modal ─────────────────────────────────────────────────────────────────────
const meldingModal = document.getElementById('meldingModal');
const meldingForm  = document.getElementById('meldingForm');

function openMeldingModal(m = null) {
    document.getElementById('meldingModalTitle').textContent = m ? 'Melding Bewerken' : 'Melding Toevoegen';
    document.getElementById('meldingId').value        = m ? m.id            : '';
    document.getElementById('meldingVersie').value    = m ? (m.versie ?? 1) : 1;
    document.getElementById('meldingTitel').value     = m ? (m.titel   || '') : '';
    document.getElementById('meldingTekst').value     = m ? (m.tekst   || '') : '';
    document.getElementById('meldingDoelgroep').value = m ? (m.doelgroep || 'iedereen') : 'iedereen';
    document.getElementById('meldingType').value      = m ? (m.type    || 'info') : 'info';
    document.getElementById('meldingVanDatum').value  = m ? (m.vanDatum || '') : '';
    document.getElementById('meldingTotDatum').value  = m ? (m.totDatum || '') : '';
    document.getElementById('meldingActief').checked  = m ? (m.actief !== false) : true;
    // Kleur
    const kleurEl = document.getElementById('meldingKleur');
    if (kleurEl) kleurEl.value = m?.kleur || '#0047AB';
    // Duur: sla op als slider-index (0–9), waarbij index 9 = oneindig
    const duurIdxEl = document.getElementById('meldingDuur');
    if (duurIdxEl) {
        const opgeslagen = m?.duur ?? 5;       // seconden, 0 = oneindig
        const idx = opgeslagen === 0 ? 9
                  : Math.max(0, Math.min(8, opgeslagen - 2)); // 2s→0 … 10s→8
        duurIdxEl.value = idx;
        updateDuurLabel(idx);
    }
    meldingModal.classList.add('active');
}

document.getElementById('addMeldingBtn')?.addEventListener('click', () => openMeldingModal());
document.getElementById('meldingModalCancel')?.addEventListener('click', () => meldingModal.classList.remove('active'));
meldingModal?.addEventListener('click', e => { if (e.target === meldingModal) meldingModal.classList.remove('active'); });

// Live label voor duur-slider
const duurSlider = document.getElementById('meldingDuur');
const duurLabel  = document.getElementById('meldingDuurLabel');
const DUUR_WAARDEN = [2,3,4,5,6,7,8,9,10,0]; // 0 = oneindig
function updateDuurLabel(val) {
    const w = DUUR_WAARDEN[parseInt(val)] ?? 5;
    if (duurLabel) duurLabel.textContent = w === 0 ? '∞' : `${w} sec`;
}
duurSlider?.addEventListener('input', () => updateDuurLabel(duurSlider.value));

// Preset kleur-knoppen
document.querySelectorAll('.kleur-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        const kleurInput = document.getElementById('meldingKleur');
        if (kleurInput) kleurInput.value = btn.dataset.kleur;
    });
});

meldingForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id         = document.getElementById('meldingId').value.trim();
    const oudeVersie = parseInt(document.getElementById('meldingVersie').value) || 1;
    const titel      = document.getElementById('meldingTitel').value.trim();
    const tekst      = document.getElementById('meldingTekst').value.trim();
    const doelgroep  = document.getElementById('meldingDoelgroep').value;
    const type       = document.getElementById('meldingType').value;
    const vanDatum   = document.getElementById('meldingVanDatum').value || '';
    const totDatum   = document.getElementById('meldingTotDatum').value || '';
    const actief     = document.getElementById('meldingActief').checked;
    const kleur      = document.getElementById('meldingKleur')?.value || '#0047AB';
    const duurIdx    = parseInt(document.getElementById('meldingDuur')?.value ?? 3);
    const DUUR_W     = [2,3,4,5,6,7,8,9,10,0];
    const duur       = DUUR_W[duurIdx] ?? 5; // seconden, 0 = oneindig

    if (!titel || !tekst) return;

    const btn = meldingForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Bezig…';

    try {
        if (id) {
            // Bewerken: versie ophogen → iedereen ziet de melding opnieuw
            const nieuweVersie = oudeVersie + 1;
            await setDoc(doc(db, 'notificaties', id), {
                titel, tekst, doelgroep, type, vanDatum, totDatum, actief, kleur, duur,
                versie: nieuweVersie,
                updatedAt: serverTimestamp()
            }, { merge: true });
            showToast(`✅ Melding bijgewerkt (v${nieuweVersie}) — iedereen ziet ze opnieuw.`, 'success');
        } else {
            // Nieuw
            await addDoc(collection(db, 'notificaties'), {
                titel, tekst, doelgroep, type, vanDatum, totDatum, actief, kleur, duur,
                versie: 1,
                createdAt: serverTimestamp()
            });
            showToast('✅ Melding aangemaakt!', 'success');
        }
        meldingModal.classList.remove('active');
    } catch (err) {
        showToast('❌ Fout: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Opslaan';
    }
});

// ── Hook tab switching ────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'meldingen') btn.addEventListener('click', startMeldingenTab);
});


// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT FUNCTIES (jsPDF + autoTable)
// ═══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', async () => {
        const type = btn.dataset.export;
        const status = document.getElementById('exportStatus');
        if (status) status.textContent = 'PDF wordt aangemaakt…';
        btn.disabled = true;
        try {
            if (type === 'matches')  await exportMatchesPdf();
            if (type === 'stats')    await exportStatsPdf();
            if (type === 'rw')       await exportRwPdf();
            if (status) status.textContent = '✅ PDF gedownload!';
        } catch (e) {
            if (status) status.textContent = '❌ Fout: ' + e.message;
        } finally {
            btn.disabled = false;
        }
    });
});

async function loadJsPdf() {
    if (window.jspdf) return window.jspdf.jsPDF;
    await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    return window.jspdf.jsPDF;
}

function pdfHeader(doc, title) {
    doc.setFontSize(18); doc.setTextColor(0, 71, 171);
    doc.text('V.V.S Rotselaar', 14, 18);
    doc.setFontSize(12); doc.setTextColor(80, 80, 80);
    doc.text(title, 14, 26);
    doc.setFontSize(9); doc.setTextColor(120, 120, 120);
    doc.text('Geëxporteerd op ' + new Date().toLocaleDateString('nl-BE'), 14, 32);
    doc.setDrawColor(0, 71, 171); doc.setLineWidth(0.5);
    doc.line(14, 34, doc.internal.pageSize.width - 14, 34);
    return 40;
}

async function exportMatchesPdf() {
    const JsPDF = await loadJsPdf();
    const teams = ['veteranen', 'zaterdag', 'zondag'];
    const snap  = await getDocs(collection(db, 'matches'));
    const all   = [];
    snap.forEach(d => all.push({ id: d.id, ...d.data() }));
    all.sort((a, b) => new Date(a.datum) - new Date(b.datum));

    const doc = new JsPDF({ orientation: 'landscape' });

    for (let ti = 0; ti < teams.length; ti++) {
        const team    = teams[ti];
        const matches = all.filter(m => m.team === team);
        if (matches.length === 0) continue;
        if (ti > 0) doc.addPage();

        const startY = pdfHeader(doc, `Wedstrijden — ${team.charAt(0).toUpperCase() + team.slice(1)}`);

        const rows = matches.map(m => [
            m.datum || '—',
            m.uur   || '—',
            m.thuisploeg || '—',
            `${m.scoreThuis ?? '–'} - ${m.scoreUit ?? '–'}`,
            m.uitploeg || '—',
            m.locatie  || '—',
            m.status   || '—'
        ]);

        doc.autoTable({
            startY,
            head: [['Datum','Uur','Thuis','Score','Uit','Locatie','Status']],
            body: rows,
            theme: 'striped',
            headStyles: { fillColor: [0, 71, 171], textColor: 255 },
            styles: { fontSize: 8 },
            columnStyles: { 3: { halign: 'center' } }
        });
    }
    doc.save('vvs-wedstrijden.pdf');
}

async function exportStatsPdf() {
    const JsPDF = await loadJsPdf();
    const snap  = await getDocs(collection(db, 'users'));
    const users = [];
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
    users.sort((a, b) => (a.naam || '').localeCompare(b.naam || ''));

    const doc = new JsPDF({ orientation: 'landscape' });
    const teams = ['veteranen', 'zaterdag', 'zondag'];

    for (let ti = 0; ti < teams.length; ti++) {
        const team   = teams[ti];
        const spelers = users.filter(u => {
            const userPloegen = Array.isArray(u.ploegen) && u.ploegen.length > 0
                ? u.ploegen : (u.categorie ? [u.categorie] : []);
            return userPloegen.includes(team);
        });
        if (spelers.length === 0) continue;
        if (ti > 0) doc.addPage();

        const startY = pdfHeader(doc, `Spelersstatistieken — ${team.charAt(0).toUpperCase() + team.slice(1)}`);

        const rows = spelers.map(u => [
            u.naam   || '—',
            u.matchen    ?? 0,
            u.minuten    ?? 0,
            u.goals      ?? 0,
            u.assists    ?? 0,
            u.geelKaarten ?? 0,
            u.roodKaarten ?? 0
        ]);

        doc.autoTable({
            startY,
            head: [['Naam','Matchen','Minuten','Goals','Assists','Gele K.','Rode K.']],
            body: rows,
            theme: 'striped',
            headStyles: { fillColor: [0, 71, 171], textColor: 255 },
            styles: { fontSize: 8 }
        });
    }
    doc.save('vvs-statistieken.pdf');
}

async function exportRwPdf() {
    const JsPDF = await loadJsPdf();
    const snap  = await getDocs(collection(db, 'rockwerchter_bestellingen'));
    const orders = [];
    snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
    orders.sort((a, b) => (a.datum?.seconds ?? 0) - (b.datum?.seconds ?? 0));

    const doc   = new JsPDF({ orientation: 'landscape' });
    const startY = pdfHeader(doc, 'Rock Werchter Bestellingen');

    const rows = orders.map(o => {
        const dt = o.datum?.toDate?.()?.toLocaleString('nl-BE') ?? '—';
        const items = Object.entries(o.items || {})
            .map(([naam, v]) => `${v.count}× ${naam}`).join(', ');
        return [dt, o.userName || '—', o.betaalmethode || '—', items, `€${(o.totaal ?? 0).toFixed(2)}`];
    });

    const totaalAlles = orders.reduce((s, o) => s + (o.totaal ?? 0), 0);

    doc.autoTable({
        startY,
        head: [['Datum','Naam','Betaalmethode','Items','Totaal']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [0, 71, 171], textColor: 255 },
        styles: { fontSize: 7 },
        foot: [['','','','Totaal omzet:', `€${totaalAlles.toFixed(2)}`]],
        footStyles: { fillColor: [240,244,255], textColor: [0,71,171], fontStyle: 'bold' }
    });
    doc.save('vvs-rockwerchter-bestellingen.pdf');
}


// ═══════════════════════════════════════════════════════════════════════════════
// ROCK WERCHTER ADMIN TAB
// Firestore: rw_items/{id} → { naam, prijs, img, actief, volgorde, vereistItem? }
// rw_items bevat de drankkaartconfiguratie die rockwerchter.js dynamisch laadt.
// ═══════════════════════════════════════════════════════════════════════════════

let rwItemsCache  = [];
let rwItemsLoaded = false;
let unsubRwItems  = null;

// ── Hook tab ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'rockwerchter') btn.addEventListener('click', startRwTab);
});

function startRwTab() {
    if (!rwItemsLoaded) { rwItemsLoaded = true; startRwItemsListener(); }
    loadRwBestellingen();
}

function startRwItemsListener() {
    if (unsubRwItems) unsubRwItems();
    unsubRwItems = onSnapshot(
        query(collection(db, 'rw_items'), orderBy('volgorde', 'asc')),
        snap => {
            rwItemsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderRwItems();
        },
        err => showToast('❌ RW items fout: ' + err.message, 'error')
    );
}

// ── Render items list ─────────────────────────────────────────────────────────
function renderRwItems() {
    const container = document.getElementById('rwItemsList');
    if (!container) return;

    if (rwItemsCache.length === 0) {
        container.innerHTML = `<div class="werklijst-empty-state">
            <p>Nog geen items. Klik op "+ Item Toevoegen".</p></div>`;
        return;
    }

    container.innerHTML = '';
    rwItemsCache.forEach(item => {
        const card = document.createElement('div');
        card.className = `melding-admin-card${item.actief ? '' : ' melding-inactive'}`;
        const vereistItems = Array.isArray(item.vereistItems) ? item.vereistItems
            : (item.vereistItem ? [item.vereistItem] : []);
        const vereistLabel = vereistItems.length
            ? vereistItems.map(n => `<span class="melding-badge" style="background:#e3f2fd;color:#0047AB;">Vereist: ${n}</span>`).join('')
            : '';

        card.innerHTML = `
            <div class="melding-card-left">
                ${item.img ? `<img src="${item.img}" alt="${item.naam}" style="width:40px;height:40px;object-fit:contain;border-radius:6px;flex-shrink:0;">` : '<span style="width:40px;flex-shrink:0;"></span>'}
                <div class="melding-card-info">
                    <div class="melding-card-titel">${htmlEscAdmin(item.naam)}</div>
                    <div class="melding-card-meta">
                        <span class="melding-badge">€${(item.prijs ?? 0).toFixed(2).replace('.',',')}</span>
                        ${vereistLabel}
                        ${!item.actief ? '<span class="melding-badge melding-badge-off">Inactief</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="melding-card-actions">
                <button class="icon-btn" title="${item.actief ? 'Deactiveren' : 'Activeren'}">
                    ${item.actief ? '<img src="assets/pause.png" class="icon-lg" alt="">' : '<img src="assets/play.png" class="icon-lg" alt="">'}
                </button>
                <button class="icon-btn edit" title="Bewerken"><img src="assets/edit.png" class="icon-lg" alt=""></button>
                <button class="icon-btn delete" title="Verwijderen"><img src="assets/delete.png" class="icon-lg" alt=""></button>
            </div>`;

        card.querySelector('.icon-btn').addEventListener('click', async () => {
            await setDoc(doc(db, 'rw_items', item.id), { actief: !item.actief }, { merge: true });
        });
        card.querySelector('.edit').addEventListener('click', () => openRwItemModal(item));
        card.querySelector('.delete').addEventListener('click', () => {
            if (confirm(`"${item.naam}" verwijderen?`))
                deleteDoc(doc(db, 'rw_items', item.id));
        });
        container.appendChild(card);
    });
}

// ── Item modal ────────────────────────────────────────────────────────────────
function openRwItemModal(item = null) {
    let modal = document.getElementById('rwItemModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'rwItemModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
    }

    const availableItems = rwItemsCache.filter(x => !item || x.id !== item.id).map(x => x.naam);
    const currentVereist = Array.isArray(item?.vereistItems) ? item.vereistItems
        : (item?.vereistItem ? [item.vereistItem] : []);

    modal.innerHTML = `
        <div class="modal-content large">
            <h3>${item ? 'Item Bewerken' : 'Item Toevoegen'}</h3>
            <form id="rwItemForm" class="admin-form">
                <div class="form-row">
                    <div class="form-group">
                        <label>Naam *</label>
                        <input type="text" id="rwNaam" required value="${item?.naam || ''}">
                    </div>
                    <div class="form-group">
                        <label>Prijs (€) *</label>
                        <input type="number" id="rwPrijs" step="0.01" required value="${item?.prijs ?? ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Afbeelding pad (bv. assets/rockwerchter/Primus.png)</label>
                        <input type="text" id="rwImg" value="${item?.img || ''}">
                    </div>
                    <div class="form-group">
                        <label>Volgorde</label>
                        <input type="number" id="rwVolgorde" value="${item?.volgorde ?? rwItemsCache.length}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Vereiste items (optioneel — meerdere selecteerbaar)</label>
                    <div id="rwVereistItemList" class="rw-vereist-checklist">
                        ${availableItems.map(n => `
                        <label class="rw-vereist-check-row">
                            <input type="checkbox" name="rwVereistItem" value="${n}"
                                ${currentVereist.includes(n) ? 'checked' : ''}>
                            <span>${n}</span>
                        </label>`).join('')}
                        ${availableItems.length === 0 ? '<p style="color:var(--text-gray);font-size:0.85rem;">Geen andere items.</p>' : ''}
                    </div>
                    <small style="color:var(--text-gray);font-size:0.8rem;">Een lid kan dit item pas toevoegen als minstens één van de geselecteerde items al in de bestelling zit.</small>
                </div>
                <label class="toggle-setting-row" style="margin-bottom:1rem;">
                    <div class="toggle-setting-label">
                        <strong>Actief</strong>
                        <small>Zet uit om item tijdelijk te verbergen op de drankkaart.</small>
                    </div>
                    <div class="toggle-switch">
                        <input type="checkbox" id="rwActief" ${item?.actief !== false ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </div>
                </label>
                <div class="modal-actions">
                    <button type="button" class="modal-btn cancel" onclick="document.getElementById('rwItemModal').classList.remove('active')">Annuleren</button>
                    <button type="submit" class="modal-btn confirm">Opslaan</button>
                </div>
            </form>
        </div>`;

    modal.classList.add('active');

    modal.querySelector('#rwItemForm').addEventListener('submit', async e => {
        e.preventDefault();
        const data = {
            naam:        document.getElementById('rwNaam').value.trim(),
            prijs:       parseFloat(document.getElementById('rwPrijs').value) || 0,
            img:         document.getElementById('rwImg').value.trim(),
            volgorde:    parseInt(document.getElementById('rwVolgorde').value) || 0,
            vereistItems: [...modal.querySelectorAll('input[name="rwVereistItem"]:checked')].map(cb => cb.value),
            actief:      document.getElementById('rwActief').checked,
        };
        if (!data.naam) return;
        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true; btn.textContent = 'Bezig…';
        try {
            if (item) {
                await setDoc(doc(db, 'rw_items', item.id), data, { merge: true });
            } else {
                await addDoc(collection(db, 'rw_items'), data);
            }
            modal.classList.remove('active');
            showToast('✅ Item opgeslagen!', 'success');
        } catch (err) {
            showToast('❌ ' + err.message, 'error');
            btn.disabled = false; btn.textContent = 'Opslaan';
        }
    });
}

document.getElementById('addRwItemBtn')?.addEventListener('click', () => openRwItemModal());

document.getElementById('seedRwItemsBtn')?.addEventListener('click', async () => {
    if (!confirm('Standaard drankkaart items laden? Bestaande items worden NIET overschreven, enkel nieuwe namen worden toegevoegd.')) return;
    const btn = document.getElementById('seedRwItemsBtn');
    btn.disabled = true; btn.textContent = 'Bezig…';

    const defaults = [
        { naam:'Primus',         prijs: 4.00, img:'assets/rockwerchter/Primus.png',         volgorde:1 },
        { naam:'Mystic',         prijs: 4.00, img:'assets/rockwerchter/Mystic.png',         volgorde:2 },
        { naam:'Stella 0.0',     prijs: 3.30, img:'assets/rockwerchter/Stella00.png',       volgorde:3 },
        { naam:'Cava of Wijn',   prijs: 5.00, img:'assets/rockwerchter/CavaWijn.png',       volgorde:4 },
        { naam:'Plat water',     prijs: 3.30, img:'assets/rockwerchter/PlatWater.png',      volgorde:5 },
        { naam:'Bruisend water', prijs: 3.30, img:'assets/rockwerchter/BruisendWater.png',  volgorde:6 },
        { naam:'Cola',           prijs: 3.30, img:'assets/rockwerchter/Cola.png',           volgorde:7 },
        { naam:'Cola Zero',      prijs: 3.30, img:'assets/rockwerchter/ColaZero.png',       volgorde:8 },
        { naam:'Fanta',          prijs: 3.30, img:'assets/rockwerchter/Fanta.png',          volgorde:9 },
        { naam:'Fuzetea',        prijs: 3.30, img:'assets/rockwerchter/Fuzetea.png',        volgorde:10 },
        { naam:'Chips',          prijs: 3.30, img:'assets/rockwerchter/Chips.png',          volgorde:11 },
        { naam:'Cup Refund',     prijs:-0.70, img:'assets/rockwerchter/CupRefund.png',      volgorde:12, vereistItems:['Primus','Mystic','Cava of Wijn'] },
    ];

    const existingNames = new Set(rwItemsCache.map(x => x.naam));
    let added = 0;
    for (const item of defaults) {
        if (!existingNames.has(item.naam)) {
            await addDoc(collection(db, 'rw_items'), { ...item, actief: true });
            added++;
        }
    }
    showToast(added > 0 ? `✅ ${added} items toegevoegd!` : 'Alle standaard items bestaan al.', 'success');
    btn.disabled = false; btn.textContent = '📦 Standaard Items';
});

// ── Bestellingen laden ────────────────────────────────────────────────────────
async function loadRwBestellingen() {
    const container = document.getElementById('rwBestellingenList');
    const summary   = document.getElementById('rwTotaalSummary');
    if (!container) return;
    container.innerHTML = '<div class="loading">Laden…</div>';

    const filter = document.getElementById('rwFilterBetaalmethode')?.value || '';
    let q = collection(db, 'rockwerchter_bestellingen');
    const snap = await getDocs(q);
    let orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (filter) orders = orders.filter(o => o.betaalmethode === filter);
    orders.sort((a, b) => (b.datum?.seconds ?? 0) - (a.datum?.seconds ?? 0));

    if (orders.length === 0) {
        container.innerHTML = '<div class="werklijst-empty-state"><p>Geen bestellingen.</p></div>';
        if (summary) summary.innerHTML = '';
        return;
    }

    const totaal = orders.reduce((s, o) => s + (o.totaal ?? 0), 0);
    if (summary) summary.innerHTML = `<div style="font-weight:700;color:var(--primary-blue);padding:0.5rem 0;">
        Totaal omzet (${orders.length} bestellingen): €${totaal.toFixed(2)}
    </div>`;

    container.innerHTML = '';
    orders.forEach(o => {
        const dt    = o.datum?.toDate?.()?.toLocaleString('nl-BE') ?? '—';
        const items = Object.entries(o.items || {})
            .map(([naam, v]) => `${v.count}× ${naam} (€${(v.subtotaal ?? 0).toFixed(2)})`)
            .join(' · ');
        const card = document.createElement('div');
        card.className = 'melding-admin-card';
        card.style.flexDirection = 'column';
        card.style.alignItems    = 'flex-start';
        card.innerHTML = `
            <div style="display:flex;gap:1rem;align-items:center;width:100%;justify-content:space-between;flex-wrap:wrap;">
                <div>
                    <div class="melding-card-titel">${o.userName || '—'}</div>
                    <div class="melding-card-meta" style="margin-top:0.25rem;">
                        <span class="melding-badge">${o.betaalmethode || '—'}</span>
                        <span style="font-size:0.8rem;color:var(--text-gray);">${dt}</span>
                    </div>
                </div>
                <div style="font-weight:800;color:var(--primary-blue);font-size:1.05rem;">€${(o.totaal ?? 0).toFixed(2)}</div>
            </div>
            <div style="margin-top:0.5rem;font-size:0.82rem;color:var(--text-gray);">${items}</div>`;
        container.appendChild(card);
    });
}

document.getElementById('rwFilterBetaalmethode')?.addEventListener('change', () => {
    if (rwItemsLoaded) loadRwBestellingen();
});


// ── Collapse toggles voor RW secties ─────────────────────────────────────────
document.querySelectorAll('.rw-collapse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        target.classList.toggle('collapsed');
        btn.classList.toggle('open');
    });
});



// ── RW sectie inklap-knoppen ─────────────────────────────────────────────────
function initRwToggles() {
    ['toggleRwItems', 'toggleRwBestellingen'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const targetId = btn.getAttribute('aria-controls');
        const target   = document.getElementById(targetId);
        const icon     = btn.querySelector('.rw-toggle-icon');
        const label    = btn.querySelector('.rw-toggle-label');
        if (!target) return;

        btn.addEventListener('click', () => {
            const isOpen = btn.getAttribute('aria-expanded') === 'true';
            if (isOpen) {
                target.classList.add('rw-collapsed');
                icon.classList.add('collapsed');
                btn.setAttribute('aria-expanded', 'false');
                if (icon)  icon.src = 'assets/dropdown.png';
                if (label) label.textContent = label.textContent.replace('Verberg', 'Toon');
            } else {
                target.classList.remove('rw-collapsed');
                icon.classList.remove('collapsed');
                btn.setAttribute('aria-expanded', 'true');
                if (icon)  icon.src = 'assets/dropdown.png';
                if (label) label.textContent = label.textContent.replace('Toon', 'Verberg');
            }
        });
    });
}

// Init zodra tab geopend wordt (startRwTab roept dit aan)
const _origStartRwTab = typeof startRwTab === 'function' ? startRwTab : null;
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'rockwerchter') {
        btn.addEventListener('click', initRwToggles, { once: true });
    }
});


// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING BEHEER (admin2.js addendum)
// Firestore: trainingen/{id} → { titel, team, datum, startTijd, eindTijd, locatie, nota, aanwezigen[] }
// ═══════════════════════════════════════════════════════════════════════════════

let trainingCache   = [];
let unsubTraining   = null;
let trainingFilter  = 'all';
let trainingLoaded  = false;

// Hook tab click
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'training') {
        btn.addEventListener('click', () => {
            if (!trainingLoaded) { trainingLoaded = true; startTrainingListener(); }
        });
    }
});

// Filter buttons in admin
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        trainingFilter = btn.dataset.team;
        renderTrainingAdminList();
    });
});

function startTrainingListener() {
    if (unsubTraining) unsubTraining();
    unsubTraining = onSnapshot(
        query(collection(db, 'trainingen'), orderBy('datum', 'desc')),
        snap => {
            trainingCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderTrainingAdminList();
        },
        err => showToast('❌ Training fout: ' + err.message, 'error')
    );
}

function renderTrainingAdminList() {
    const container = document.getElementById('trainingAdminList');
    if (!container) return;

    const items = trainingFilter === 'all'
        ? trainingCache
        : trainingCache.filter(t => t.team === trainingFilter);

    if (items.length === 0) {
        container.innerHTML = '<div class="werklijst-empty-state"><p>Geen trainingen gevonden.</p></div>';
        return;
    }

    const TEAM_COLORS = { veteranen: '#0047AB', zaterdag: '#28A745', zondag: '#DC3545' };

    container.innerHTML = '';
    items.forEach(t => {
        const aanwezigen = t.aanwezigen || [];
        const card = document.createElement('div');
        card.className = 'melding-admin-card';
        card.innerHTML = `
            <div class="melding-card-left" style="flex:1;">
                <div class="melding-card-info">
                    <div class="melding-card-titel">${htmlEscAdmin(t.titel || 'Training')}</div>
                    <div class="melding-card-meta">
                        <span class="melding-badge" style="background:${TEAM_COLORS[t.team]||'#666'};color:#fff;">
                            ${{ veteranen:'Veteranen',zaterdag:'Zaterdag',zondag:'Zondag' }[t.team] || t.team}
                        </span>
                        <span class="melding-badge">${t.datum || '—'}</span>
                        ${t.startTijd ? `<span class="melding-badge">${t.startTijd}${t.eindTijd ? ' – '+t.eindTijd : ''}</span>` : ''}
                        ${t.locatie ? `<span class="melding-badge">📍 ${htmlEscAdmin(t.locatie)}</span>` : ''}
                        <span class="melding-badge" style="background:#e8f5e9;color:#2e7d32;">
                            👥 ${aanwezigen.length} aanwezig
                        </span>
                    </div>
                    ${t.nota ? `<div style="font-size:0.8rem;color:var(--text-gray);margin-top:0.3rem;font-style:italic;">${htmlEscAdmin(t.nota)}</div>` : ''}
                    ${aanwezigen.length ? `<div style="font-size:0.78rem;color:var(--text-gray);margin-top:0.3rem;">${aanwezigen.map(p=>p.naam).join(', ')}</div>` : ''}
                </div>
            </div>
            <div class="melding-card-actions">
                <button class="icon-btn edit" title="Bewerken"><img src="assets/edit.png" class="icon-lg" alt=""></button>
                <button class="icon-btn delete" title="Verwijderen"><img src="assets/delete.png" class="icon-lg" alt=""></button>
            </div>`;

        card.querySelector('.edit').addEventListener('click', () => openTrainingModal(t));
        card.querySelector('.delete').addEventListener('click', async () => {
            if (!confirm(`Training "${t.titel}" verwijderen?`)) return;
            try {
                await deleteDoc(doc(db, 'trainingen', t.id));
                showToast('✅ Training verwijderd.', 'success');
            } catch (e) { showToast('❌ ' + e.message, 'error'); }
        });
        container.appendChild(card);
    });
}

document.getElementById('addTrainingBtn')?.addEventListener('click', () => openTrainingModal(null));

function openTrainingModal(training = null) {
    let modal = document.getElementById('trainingModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'trainingModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
    }

    modal.innerHTML = `
        <div class="modal-content large">
            <h3>${training ? 'Training Bewerken' : 'Training Toevoegen'}</h3>
            <form id="trainingForm" class="admin-form">
                <div class="form-row">
                    <div class="form-group">
                        <label>Titel *</label>
                        <input type="text" id="trTitel" required value="${htmlEscAdmin(training?.titel || '')}">
                    </div>
                    <div class="form-group">
                        <label>Ploeg</label>
                        <select id="trTeam">
                            <option value=""          ${!training?.team?'selected':''}>Alle ploegen</option>
                            <option value="veteranen" ${training?.team==='veteranen'?'selected':''}>Veteranen</option>
                            <option value="zaterdag"  ${training?.team==='zaterdag'?'selected':''}>Zaterdag</option>
                            <option value="zondag"    ${training?.team==='zondag'?'selected':''}>Zondag</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Datum *</label>
                        <input type="date" id="trDatum" required value="${training?.datum || ''}">
                    </div>
                    <div class="form-group">
                        <label>Starttijd</label>
                        <input type="time" id="trStartTijd" value="${training?.startTijd || ''}">
                    </div>
                    <div class="form-group">
                        <label>Eindtijd</label>
                        <input type="time" id="trEindTijd" value="${training?.eindTijd || ''}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Locatie</label>
                    <input type="text" id="trLocatie" value="${htmlEscAdmin(training?.locatie || '')}" placeholder="bv. Sportcomplex Rotselaar">
                </div>
                <div class="form-group">
                    <label>Nota (optioneel)</label>
                    <textarea id="trNota" rows="2" style="resize:vertical;font-family:inherit;width:100%;padding:0.5rem;border:1px solid var(--border-color);border-radius:6px;">${htmlEscAdmin(training?.nota || '')}</textarea>
                </div>
                ${!training ? `
                <div style="padding:0.75rem;background:var(--off-white);border-radius:8px;border:1px solid var(--border-color);margin-bottom:0.5rem;">
                    <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer;margin-bottom:0.4rem;">
                        <input type="checkbox" id="trHerhalen" style="width:16px;height:16px;accent-color:var(--primary-blue);">
                        <strong>Wekelijks herhalen</strong>
                    </label>
                    <div id="trHerhalingPanel" style="display:none;margin-top:0.5rem;">
                        <div class="form-group">
                            <label>Aantal weken (inclusief startdatum)</label>
                            <input type="number" id="trAantal" min="2" max="52" value="10" style="width:120px;">
                        </div>
                        <p style="font-size:0.8rem;color:var(--text-gray);">
                            Maakt <strong id="trAantalPreview">10</strong> trainingen aan op dezelfde weekdag, elke week.
                        </p>
                    </div>
                </div>` : ''}
                <div class="modal-actions">
                    <button type="button" class="modal-btn cancel" onclick="document.getElementById('trainingModal').classList.remove('active')">Annuleren</button>
                    <button type="submit" class="modal-btn confirm">Opslaan</button>
                </div>
            </form>
        </div>`;

    modal.classList.add('active');

    // Herhaling toggle
    modal.querySelector('#trHerhalen')?.addEventListener('change', e => {
        modal.querySelector('#trHerhalingPanel').style.display = e.target.checked ? '' : 'none';
    });
    modal.querySelector('#trAantal')?.addEventListener('input', e => {
        const el = modal.querySelector('#trAantalPreview');
        if (el) el.textContent = e.target.value || '1';
    });

    modal.querySelector('#trainingForm').addEventListener('submit', async e => {
        e.preventDefault();
        const data = {
            titel:     document.getElementById('trTitel').value.trim(),
            team:      document.getElementById('trTeam').value,
            datum:     document.getElementById('trDatum').value,
            startTijd: document.getElementById('trStartTijd').value,
            eindTijd:  document.getElementById('trEindTijd').value,
            locatie:   document.getElementById('trLocatie').value.trim(),
            nota:      document.getElementById('trNota').value.trim(),
        };
        if (!data.titel || !data.datum) return;
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true; btn.textContent = 'Bezig…';
        try {
            if (training) {
                await setDoc(doc(db, 'trainingen', training.id), data, { merge: true });
                showToast('✅ Training opgeslagen!', 'success');
            } else {
                const herhalen = modal.querySelector('#trHerhalen')?.checked;
                const aantal   = parseInt(modal.querySelector('#trAantal')?.value || '1');
                if (herhalen && aantal > 1) {
                    // Wekelijkse herhaling via batch
                    const [y, m, d] = data.datum.split('-').map(Number);
                    const startDate = new Date(y, m - 1, d);
                    const batch = writeBatch(db);
                    for (let i = 0; i < aantal; i++) {
                        const dt = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i * 7);
                        const iso = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
                        batch.set(doc(collection(db, 'trainingen')), { ...data, datum: iso, aanwezigen: [] });
                    }
                    await batch.commit();
                    showToast(`✅ ${aantal} trainingen aangemaakt!`, 'success');
                } else {
                    await addDoc(collection(db, 'trainingen'), { ...data, aanwezigen: [] });
                    showToast('✅ Training opgeslagen!', 'success');
                }
            }
            modal.classList.remove('active');
        } catch (err) {
            showToast('❌ ' + err.message, 'error');
            btn.disabled = false; btn.textContent = 'Opslaan';
        }
    });
}

// ===============================================
// ADMIN TOUR – pagina 2 (vervolg van admin.html)
// Start automatisch als ?tour=1 in de URL staat.
// ===============================================

const TOUR_KEY = 'vvs_admin_tour_v2';

// ── Helpers werklijst ──────────────────────────────────────────────────────
function _tourOpenFirstShifts() {
    // Als we al in de editor zitten, niets doen
    if (document.getElementById('shiftsEditorView')?.style.display !== 'none') return;
    const firstBtn = document.querySelector('#werklijstenList .shifts-btn');
    if (firstBtn) firstBtn.click();
}
function _tourCloseShiftsEditor() {
    const back = document.getElementById('backToWerklijstenBtn');
    if (back && document.getElementById('shiftsEditorView')?.style.display !== 'none') back.click();
}

const TOUR_STEPS_P2 = [
    // ── Intro pagina 2 ───────────────────────────────────────────────────
    {
        icon: '', title: 'Pagina 2 – overzicht',
        desc: 'Welkom op de tweede adminpagina! Hier beheer je werklijsten, trainingen, sponsors, de galerij en push-meldingen. We overlopen ze één voor één.',
        tab: null, target: null,
    },

    // ── WERKLIJST ─────────────────────────────────────────────────────────
    {
        icon: '', title: 'Werklijst Beheren',
        desc: 'Maak werklijsten aan voor evenementen. Slechts één werklijst is tegelijk <strong>actief</strong> — dit is de lijst die leden zien op de werklijstpagina.',
        tab: 'werklijst', target: '.tab-btn[data-tab="werklijst"]',
    },
    {
        icon: '', title: 'Nieuwe werklijst',
        desc: 'Maak een nieuwe werklijst aan voor een specifiek evenement. Daarna kan je shifts (taken + tijdslot) toevoegen en leden toewijzen.',
        tab: 'werklijst', target: '#addWerklijstBtn',
    },
    {
        icon: '', title: 'Werklijstkaart',
        desc: 'Elke werklijst heeft een reeks knoppen:<br><br>'
            + '<strong>✔ Activeren</strong> — zet deze lijst als actieve werklijst voor leden.<br>'
            + '<strong>🔒 Vergrendelen</strong> — leden kunnen hun inschrijvingen niet meer aanpassen. Gebruik dit vlak voor het evenement.<br>'
            + '<strong>📥 Excel</strong> — download de volledige werklijst met alle inschrijvingen als Excel-bestand.<br>'
            + '<strong>✏️ Naam</strong> — hernoem de werklijst.<br>'
            + '<strong>Shiften Beheren</strong> — open de shift-editor voor deze werklijst.',
        tab: 'werklijst', target: '#werklijstenList .wl-list-card',
    },
    {
        icon: '', title: 'Shift-editor',
        desc: 'In de shift-editor zie je alle shifts (taken) van de werklijst, gegroepeerd per dag. Elke shiftkaart toont het label, tijdstip, het aantal ingeschreven leden en badges voor opties (verantwoordelijke vereist, label zichtbaar).<br><br>'
            + 'Via het <strong>bewerken</strong>-icoon pas je een shift aan. Met <strong>"+ Naam toevoegen"</strong> voeg je manueel een persoon toe.',
        tab: 'werklijst', target: '#shiftsEditorGrid .shift-admin-card',
        delay: 900,
        onEnter() { _tourOpenFirstShifts(); },
        onLeave() { _tourCloseShiftsEditor(); },
    },

    // ── TRAINING ──────────────────────────────────────────────────────────
    {
        icon: '', title: 'Training',
        desc: 'Voeg trainingen toe met datum, tijdstip en locatie. Leden kunnen hun aanwezigheid bevestigen en de trainer ziet wie aanwezig is.',
        tab: 'training', target: '.tab-btn[data-tab="training"]',
    },

    // ── SPONSORS ──────────────────────────────────────────────────────────
    {
        icon: '', title: 'Sponsors',
        desc: 'Beheer de sponsorlogo\'s die op de website verschijnen. Voeg een naam, logo en (optionele) link toe. De volgorde pas je aan via de pijlknoppen.',
        tab: 'sponsors', target: '.tab-btn[data-tab="sponsors"]',
    },

    // ── GALERIJ ───────────────────────────────────────────────────────────
    {
        icon: '', title: 'Galerij',
        desc: 'Upload foto\'s voor de galerij op de website. Voeg een titel en beschrijving toe. Foto\'s worden gegroepeerd per album.',
        tab: 'galerij', target: '.tab-btn[data-tab="galerij"]',
    },

    // ── MELDINGEN ─────────────────────────────────────────────────────────
    {
        icon: '', title: 'Meldingen',
        desc: 'Stuur push-meldingen naar leden — voor iedereen of per ploeg. Anders dan de aankondigingsbanner zijn dit persoonlijke notificaties in het meldingencentrum van de leden.',
        tab: 'meldingen', target: '.tab-btn[data-tab="meldingen"]',
    },

    // ── ROCK WERCHTER ─────────────────────────────────────────────────────
    {
        icon: '', title: 'Rock Werchter',
        desc: 'Hier beheer je de <strong>drankkaart</strong> die op de Rock Werchter pagina te zien is. Wijzigingen zijn meteen live. Je kan ook alle bestellingen bekijken en filteren per betaalmethode.',
        tab: 'rockwerchter', target: '.tab-btn[data-tab="rockwerchter"]',
    },
    {
        icon: '', title: 'Standaard Items',
        desc: 'Klik op <strong>"Standaard Items"</strong> om in één klik alle standaard dranken (Primus, Cola, Water, …) met hun vaste prijzen te laden. Handig als startpunt — je kan daarna elk item nog aanpassen of verwijderen.',
        tab: 'rockwerchter', target: '#seedRwItemsBtn',
    },
    {
        icon: '', title: 'Item Toevoegen',
        desc: 'Voeg een nieuw item toe aan de drankkaart: naam, prijs, afbeelding en volgorde. Hieronder zoomen we in op de <strong>vereiste items</strong> — de krachtigste optie.',
        tab: 'rockwerchter', target: '#addRwItemBtn',
    },
    {
        icon: '', title: 'Vereiste items',
        desc: '<strong>Vereiste items</strong> bepalen dat dit artikel pas selecteerbaar is als minstens één van de gelinkte items al in de bestelling zit.<br><br>'
            + '💡 <em>Voorbeeld:</em> je maakt een item <strong>"Beker"</strong> aan. Als vereist item kies je "Pint" én "Cola". Dan kan een barman pas een Beker toevoegen als er al een Pint óf Cola in de bestelling zit — een Beker alleen bestellen is niet mogelijk.',
        tab: 'rockwerchter', target: '#rwVereistItemList',
        delay: 450,
        onEnter() {
            // Open de "Item Toevoegen" modal
            const btn = document.getElementById('addRwItemBtn');
            if (btn) btn.click();
        },
        onLeave() {
            const modal = document.getElementById('rwItemModal');
            if (modal) modal.classList.remove('active');
        },
    },

    // ── DATA ──────────────────────────────────────────────────────────────
    {
        icon: '', title: 'Data beheer',
        desc: '<strong>Let op:</strong> dit tabblad bevat knoppen om data te resetten of permanent te verwijderen. Gebruik deze enkel als je zeker bent — dit kan niet ongedaan worden gemaakt.',
        tab: 'data', target: '.tab-btn[data-tab="data"]',
    },

    // ── REDIRECT NAAR PAGINA 3 ────────────────────────────────────────────
    {
        icon: '➡️', title: 'Verder naar pagina 3',
        desc: 'Bijna klaar! Klik op <strong>Volgende</strong> om door te gaan naar pagina 3, waar we de algemene voorwaarden, de privacyverklaring en de mailfunctie bekijken.',
        tab: null, target: null,
        isRedirect: true,
        redirectTo: 'admin3.html',
    },
];

// ── Spotlight engine (identiek patroon als admin.js) ──────────────────────
let _p2TourStep = 0;
let _p2ResizeHandler = null;

function _p2clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _p2switchTab(name) {
    const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (btn && !btn.classList.contains('active')) btn.click();
}
function _p2getEl(sel) {
    if (!sel) return null;
    try {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return (r.width === 0 && r.height === 0) ? null : el;
    } catch { return null; }
}

const _P2_PAD = 8, _P2_GAP = 14, _P2_CW = 360;

function _p2Spotlight(el) {
    const s = document.getElementById('tourSpotlight');
    if (!s || !el) return;
    const r = el.getBoundingClientRect();
    s.style.top    = (r.top    - _P2_PAD) + 'px';
    s.style.left   = (r.left   - _P2_PAD) + 'px';
    s.style.width  = (r.width  + _P2_PAD*2) + 'px';
    s.style.height = (r.height + _P2_PAD*2) + 'px';
    s.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.50),0 0 0 2.5px var(--primary-blue,#0047AB),0 0 12px 4px rgba(0,71,171,0.25)';
    s.style.display = 'block';
}

function _p2PosCard(el) {
    const card = document.getElementById('adminTourCard');
    if (!card || !el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = Math.min(_P2_CW, vw - 32), ch = card.offsetHeight || 260;
    const sT = r.top - _P2_PAD, sB = r.bottom + _P2_PAD, sR = r.right + _P2_PAD;
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    let pos = 'bottom';
    if (sB + ch + _P2_GAP + 16 > vh && sT - ch - _P2_GAP - 16 >= 0) pos = 'top';
    else if (sB + ch + _P2_GAP + 16 > vh && sR + cw + _P2_GAP + 16 <= vw) pos = 'right';
    let top, left;
    if (pos === 'bottom') { top = sB + _P2_GAP; left = _p2clamp(cx - cw/2, 16, vw-cw-16); }
    else if (pos === 'top') { top = sT - _P2_GAP - ch; left = _p2clamp(cx - cw/2, 16, vw-cw-16); }
    else { top = _p2clamp(cy - ch/2, 16, vh-ch-16); left = sR + _P2_GAP; }
    top = _p2clamp(top, 16, vh - ch - 16);
    Object.assign(card.style, { position:'fixed', top:top+'px', left:left+'px', width:cw+'px', maxWidth:cw+'px', transform:'none', display:'block' });
}

function _p2CenterCard() {
    const card = document.getElementById('adminTourCard');
    if (!card) return;
    Object.assign(card.style, { position:'fixed', top:'50%', left:'50%', width:'min(440px, calc(100vw - 2rem))', maxWidth:'', transform:'translate(-50%,-50%)', display:'block' });
}

function _p2BuildDots() {
    const c = document.getElementById('tourProgress');
    if (!c) return;
    c.innerHTML = '';
    TOUR_STEPS_P2.forEach((_, i) => {
        const d = document.createElement('button');
        d.className = 'tour-dot' + (i < _p2TourStep ? ' done' : '') + (i === _p2TourStep ? ' active' : '');
        d.setAttribute('aria-label', `Stap ${i+1}`);
        d.addEventListener('click', () => _p2GoTo(i));
        c.appendChild(d);
    });
}

function _p2UpdateNav() {
    const isFirst = _p2TourStep === 0;
    const isLast  = _p2TourStep === TOUR_STEPS_P2.length - 1;
    const step    = TOUR_STEPS_P2[_p2TourStep];
    const isRedir = !!(step && step.isRedirect);
    document.getElementById('tourPrevBtn')  .style.display = isFirst ? 'none' : '';
    document.getElementById('tourNextBtn')  .style.display = (isLast && !isRedir) ? 'none' : '';
    document.getElementById('tourFinishBtn').style.display = (isLast && !isRedir) ? '' : 'none';
}

function _p2Render() {
    const step = TOUR_STEPS_P2[_p2TourStep];
    if (!step) return;
    document.getElementById('tourStepIcon').textContent  = step.icon  || '';
    document.getElementById('tourStepTitle').textContent = step.title || '';
    document.getElementById('tourStepDesc').innerHTML    = step.desc  || '';
    _p2UpdateNav();
    _p2BuildDots();
    document.querySelectorAll('.tab-btn.tour-tab-highlight').forEach(b => b.classList.remove('tour-tab-highlight'));
    if (step.tab) _p2switchTab(step.tab);

    const overlay = document.getElementById('adminTourOverlay');
    const spot    = document.getElementById('tourSpotlight');

    requestAnimationFrame(() => {
        if (step.onEnter) step.onEnter();

        const _afterDelay = () => {
            const el = _p2getEl(step.target);
            if (el) {
                if (overlay) { overlay.style.background = 'transparent'; overlay.style.display = 'block'; }
                el.scrollIntoView({ behavior:'instant', block:'center', inline:'nearest' });
                requestAnimationFrame(() => {
                    _p2Spotlight(el);
                    _p2PosCard(el);
                    if (step.tab) {
                        const tb = document.querySelector(`.tab-btn[data-tab="${step.tab}"]`);
                        if (tb) tb.classList.add('tour-tab-highlight');
                    }
                    if (_p2ResizeHandler) window.removeEventListener('resize', _p2ResizeHandler);
                    _p2ResizeHandler = () => { _p2Spotlight(el); _p2PosCard(el); };
                    window.addEventListener('resize', _p2ResizeHandler);
                });
            } else {
                if (spot)    spot.style.display    = 'none';
                if (overlay) { overlay.style.background = 'rgba(0,0,0,0.50)'; overlay.style.display = 'block'; }
                _p2CenterCard();
                if (step.tab) {
                    const tb = document.querySelector(`.tab-btn[data-tab="${step.tab}"]`);
                    if (tb) tb.classList.add('tour-tab-highlight');
                }
                if (_p2ResizeHandler) { window.removeEventListener('resize', _p2ResizeHandler); _p2ResizeHandler = null; }
            }
        };

        const _delay = step.delay || 0;
        if (_delay > 0) setTimeout(_afterDelay, _delay);
        else requestAnimationFrame(_afterDelay);
    });
}

function _p2GoTo(index) {
    const prev = TOUR_STEPS_P2[_p2TourStep];
    if (prev && prev.onLeave) prev.onLeave();
    _p2TourStep = Math.max(0, Math.min(TOUR_STEPS_P2.length - 1, index));
    _p2Render();
}

function _p2Advance() {
    const cur = TOUR_STEPS_P2[_p2TourStep];
    if (cur && cur.isRedirect) {
        localStorage.setItem(TOUR_KEY, 'p3');
        window.location.href = cur.redirectTo + '?tour=1';
        return;
    }
    if (_p2TourStep < TOUR_STEPS_P2.length - 1) _p2GoTo(_p2TourStep + 1);
    else _p2Close(true);
}

function _p2Close(markDone = true) {
    const cur = TOUR_STEPS_P2[_p2TourStep];
    if (cur && cur.onLeave) cur.onLeave();
    ['adminTourOverlay','adminTourCard','tourSpotlight'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    document.querySelectorAll('.tab-btn.tour-tab-highlight').forEach(b => b.classList.remove('tour-tab-highlight'));
    if (_p2ResizeHandler) { window.removeEventListener('resize', _p2ResizeHandler); _p2ResizeHandler = null; }
    if (markDone) localStorage.setItem(TOUR_KEY, '1');
}

function _p2Open() {
    _p2TourStep = 0;
    ['adminTourOverlay','adminTourCard'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'block';
    });
    const s = document.getElementById('tourSpotlight'); if (s) s.style.display = 'none';
    _p2Render();
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('tourNextBtn')  ?.addEventListener('click', _p2Advance);
    document.getElementById('tourPrevBtn')  ?.addEventListener('click', () => _p2GoTo(_p2TourStep - 1));
    document.getElementById('tourFinishBtn')?.addEventListener('click', () => _p2Close(true));
    document.getElementById('tourSkipBtn')  ?.addEventListener('click', () => _p2Close(true));
    document.getElementById('adminTourBtn') ?.addEventListener('click', _p2Open);

    document.getElementById('adminTourOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('adminTourOverlay')) _p2Close(true);
    });

    document.addEventListener('keydown', e => {
        const card = document.getElementById('adminTourCard');
        if (!card || card.style.display === 'none') return;
        if (e.key === 'ArrowRight' || e.key === 'Enter') _p2Advance();
        if (e.key === 'ArrowLeft') _p2GoTo(_p2TourStep - 1);
        if (e.key === 'Escape')    _p2Close(true);
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('tour') === '1') {
        history.replaceState(null, '', window.location.pathname + window.location.hash);
        setTimeout(_p2Open, 700);
    }
});