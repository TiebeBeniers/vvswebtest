// ===============================================
// ADMIN3.JS – Content Beheer (volledig herschreven)
// V.V.S Rotselaar
// Beheert: Algemene Voorwaarden + Privacyverklaring
// Firestore:
//   settings/terms   → { sections: [{ id, title, body }], updatedAt }
//   settings/privacy → { sections: [{ id, title, body }], lastUpdated, updatedAt }
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, doc, getDoc, setDoc, addDoc, serverTimestamp }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Standaardinhoud ───────────────────────────────────────────────────────────

const DEFAULT_TERMS_SECTIONS = [
    { id: 'art1', title: 'Artikel 1 - Lidmaatschap',
      body: '<p>Door een account aan te vragen ga je akkoord met het lidmaatschap van V.V.S Rotselaar en aanvaard je de geldende clubregels en het huishoudelijk reglement.</p>' },
    { id: 'art2', title: 'Artikel 2 - Gebruik van persoonsgegevens',
      body: '<p>Je persoonsgegevens (naam, e-mailadres, telefoonnummer) worden uitsluitend gebruikt voor clubdoeleinden zoals communicatie, wedstrijdplanning en ledenregistratie. Raadpleeg onze <a href="/privacy.html">Privacyverklaring</a> voor meer informatie.</p>' },
    { id: 'art3', title: 'Artikel 3 - Gedragsregels',
      body: '<p>Leden dienen zich op en rond het veld sportief en respectvol te gedragen tegenover medespelers, tegenstanders, scheidsrechters en officials. Onsportief gedrag kan leiden tot schorsing of verwijdering.</p>' },
    { id: 'art4', title: 'Artikel 4 - Betalingen en bijdragen',
      body: '<p>Het lidgeld en eventuele andere bijdragen worden jaarlijks vastgesteld door het bestuur. Niet-betaling kan leiden tot uitsluiting van activiteiten.</p>' },
    { id: 'art5', title: 'Artikel 5 - Aansprakelijkheid',
      body: '<p>V.V.S Rotselaar is niet aansprakelijk voor persoonlijk letsel of materiële schade tijdens clubactiviteiten, tenzij er sprake is van opzet of grove nalatigheid van de club.</p>' },
    { id: 'art6', title: 'Artikel 6 - Wijzigingen',
      body: '<p>Het bestuur behoudt het recht deze voorwaarden te wijzigen. Leden worden via de website op de hoogte gesteld van wijzigingen.</p>' }
];

const DEFAULT_PRIVACY_SECTIONS = [
    { id: 'p1', title: '1. Wie zijn wij?',
      body: '<p>V.V.S Rotselaar is een voetbalclub gevestigd te Rotselaar, Belgie. Deze website (<strong>vvsrotselaar.be</strong>) is bestemd voor leden en supporters van de club.</p><p>Verantwoordelijke voor de verwerking:<br>V.V.S Rotselaar - Rotselaar, Belgie<br><a href="mailto:info@vvsrotselaar.be">info@vvsrotselaar.be</a></p>' },
    { id: 'p2', title: '2. Welke persoonsgegevens verzamelen wij?',
      body: '<p>Wij verzamelen uitsluitend gegevens die noodzakelijk zijn voor de werking van de ledenzone:</p><ul><li>Naam en e-mailadres (bij accountaanvraag)</li><li>Telefoonnummer (bij accountaanvraag)</li><li>Wedstrijdstatistieken</li></ul><p>Wij verzamelen <strong>geen</strong> locatiegegevens, betalingsgegevens of gezondheidsgegevens.</p>' },
    { id: 'p3', title: '3. Waarom verwerken wij deze gegevens?',
      body: '<p>Wij verwerken persoonsgegevens op basis van <strong>gerechtvaardigde belangen</strong> (art. 6.1(f) GDPR) en <strong>toestemming</strong> (art. 6.1(a) GDPR) bij accountaanvraag.</p><ul><li>Beheer van ledenaccounts en toegangsbeveiliging</li><li>Weergave van spelersprofielen en statistieken</li><li>Organisatie van wedstrijden en beschikbaarheidsopvolging</li></ul>' },
    { id: 'p4', title: '4. Lokale opslag (localStorage)',
      body: '<p>Deze website gebruikt <strong>localStorage</strong> uitsluitend voor aanmeldingssessies (<code>firebase:authUser:*</code>) en tijdelijke cache van wedstrijddata (<code>vvs_*</code>). Er worden <strong>geen tracking- of marketingcookies</strong> gebruikt.</p>' },
    { id: 'p5', title: '5. Externe diensten',
      body: '<p>Wij maken gebruik van <strong>Firebase (Google LLC)</strong> voor authenticatie en gegevensopslag, en <strong>Cloudflare</strong> voor beveiliging. Overdracht naar de VS gebeurt via standaard contractuele clausules.</p>' },
    { id: 'p6', title: '6. Bewaartermijn',
      body: '<p>Accountgegevens worden bewaard zolang je actief lid bent. Na uitschrijving worden jouw persoonsgegevens op verzoek verwijderd binnen <strong>30 dagen</strong>.</p>' },
    { id: 'p7', title: '7. Jouw rechten (GDPR)',
      body: '<p>Op basis van de AVG/GDPR heb je recht op inzage, correctie, verwijdering, beperking, overdraagbaarheid en bezwaar. Stuur je verzoek naar <a href="mailto:info@vvsrotselaar.be">info@vvsrotselaar.be</a>. Wij reageren binnen <strong>30 dagen</strong>.</p>' },
    { id: 'p8', title: '8. Wijzigingen',
      body: '<p>Wij kunnen deze verklaring aanpassen bij wijzigingen in de website of nieuwe wettelijke vereisten. De datum bovenaan geeft aan wanneer ze voor het laatst werd bijgewerkt.</p>' }
];

// ── Auth guard ────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    try {
        const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
        if (snap.empty || snap.docs[0].data().rol !== 'admin') {
            window.location.href = 'index.html'; return;
        }
        initPage();
    } catch (e) { console.error('Auth check failed:', e); }
});

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${btn.dataset.tab}Tab`).classList.add('active');
    });
});

// ── Unieke ID-teller ──────────────────────────────────────────────────────────
let _sectionCounter = 0;
function newId() { return 'sec_' + (++_sectionCounter) + '_' + Date.now(); }

// ── Module-level drag state ───────────────────────────────────────────────────
let _draggingItem = null;

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTIE-EDITOR
// ═════════════════════════════════════════════════════════════════════════════

function buildSectionEditor(config) {
    const listEl        = document.getElementById(config.listId);
    const addBtn        = document.getElementById(config.addBtnId);
    const previewOffBtn = document.getElementById(config.previewOffBtnId);
    const previewOnBtn  = document.getElementById(config.previewOnBtnId);
    const fullPreviewEl = document.getElementById(config.fullPreviewId);
    const loadStatusEl  = document.getElementById(config.loadStatusId);
    const docType       = config.docType; // 'terms' | 'privacy'

    let previewMode = false;

    // ── Publieke API ──────────────────────────────────────────────────────────

    function getSections() {
        return Array.from(listEl.querySelectorAll('.section-item')).map(item => ({
            id:    item.dataset.secId,
            title: item.querySelector('.section-title-input').value.trim(),
            body:  item.querySelector('.rich-editor').innerHTML.trim()
        }));
    }

    function loadSections(sections) {
        listEl.innerHTML = '';
        sections.forEach(s => addSectionRow(s));
        initDragSort();
    }

    function setStatus(msg) {
        if (loadStatusEl) loadStatusEl.textContent = msg;
    }

    // ── Drag-and-drop herordenen ──────────────────────────────────────────────

    function initDragSort() {
        // Verwijder oude listeners door nieuwe functiereferenties
        listEl.addEventListener('dragover', onDragOver);
        listEl.addEventListener('dragleave', onDragLeave);
        listEl.addEventListener('drop', onDrop);
        listEl.addEventListener('dragend', cleanupDrag);
    }

    function onDragOver(e) {
        e.preventDefault();
        const target = e.target.closest('.section-item');
        if (!target || target === _draggingItem) return;
        listEl.querySelectorAll('.section-item').forEach(i =>
            i.classList.remove('drag-above', 'drag-below'));
        const mid = target.getBoundingClientRect().top + target.offsetHeight / 2;
        target.classList.add(e.clientY < mid ? 'drag-above' : 'drag-below');
    }

    function onDragLeave(e) {
        if (!listEl.contains(e.relatedTarget)) {
            listEl.querySelectorAll('.section-item').forEach(i =>
                i.classList.remove('drag-above', 'drag-below'));
        }
    }

    function onDrop(e) {
        e.preventDefault();
        const target = e.target.closest('.section-item');
        if (!target || target === _draggingItem || !_draggingItem) return;
        const mid = target.getBoundingClientRect().top + target.offsetHeight / 2;
        listEl.insertBefore(_draggingItem,
            e.clientY < mid ? target : target.nextElementSibling);
        cleanupDrag();
    }

    function cleanupDrag() {
        listEl.querySelectorAll('.section-item').forEach(i =>
            i.classList.remove('dragging', 'drag-above', 'drag-below'));
        _draggingItem = null;
    }

    // ── Opmaak toepassen ─────────────────────────────────────────────────────

    function applyFormat(editorEl, cmd) {
        editorEl.focus();
        switch (cmd) {
            case 'bold':
                document.execCommand('bold', false, null); break;
            case 'italic':
                document.execCommand('italic', false, null); break;
            case 'h3':
                document.execCommand('formatBlock', false, 'h3'); break;
            case 'h4':
                document.execCommand('formatBlock', false, 'h4'); break;
            case 'p':
                document.execCommand('formatBlock', false, 'p'); break;
            case 'ul':
                document.execCommand('insertUnorderedList', false, null); break;
            case 'ol':
                document.execCommand('insertOrderedList', false, null); break;
            case 'link': {
                const selText = window.getSelection()?.toString().trim();
                const url = prompt('URL (bv. https://vvsrotselaar.be):', 'https://');
                if (!url) break;
                if (selText) {
                    document.execCommand('createLink', false, url);
                    // Zet target="_blank" op het zojuist aangemaakte linkje
                    const links = editorEl.querySelectorAll('a');
                    links.forEach(a => { if (a.href === url) a.target = '_blank'; });
                } else {
                    const linkText = prompt('Linktekst:', 'klik hier') || 'link';
                    document.execCommand('insertHTML', false,
                        `<a href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`);
                }
                break;
            }
            case 'info-card':
                document.execCommand('insertHTML', false,
                    `<div class="info-card"><strong class="info-card-title">&#128204; Titel van het kader</strong><p>Beschrijving of informatie die je wil tonen...</p></div><p><br></p>`);
                break;
            case 'br-sm':
                // Kleine witregel: halve regelhoogte
                document.execCommand('insertHTML', false, '<span class="spacer-sm"></span>');
                break;
            case 'br-lg':
                // Grote witregel: anderhalve regelhoogte
                document.execCommand('insertHTML', false, '<div class="spacer-lg"></div>');
                break;
            case 'hr':
                document.execCommand('insertHTML', false, '<hr><p><br></p>');
                break;
        }
        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // ── Sectionrij aanmaken ───────────────────────────────────────────────────

    function addSectionRow(data = {}) {
        const secId = data.id || newId();
        const item  = document.createElement('div');
        item.className     = 'section-item';
        item.dataset.secId = secId;

        item.innerHTML = `
            <div class="section-item-header">
                <span class="section-handle" title="Sleep om te herordenen">&#8943;</span>
                <input type="text" class="section-title-input"
                    placeholder="Sectietitel (optioneel)"
                    value="${escHtml(data.title || '')}">
                <div class="section-controls">
                    <button class="sec-ctrl-btn up"     title="Omhoog">&#8593;</button>
                    <button class="sec-ctrl-btn down"   title="Omlaag">&#8595;</button>
                    <button class="sec-ctrl-btn delete" title="Sectie verwijderen">&#10005;</button>
                </div>
            </div>
            <div class="format-toolbar">
                <div class="fmt-group">
                    <button class="fmt-btn" data-cmd="bold"   title="Vet (selecteer tekst en klik)"><b>B</b></button>
                    <button class="fmt-btn" data-cmd="italic" title="Cursief (selecteer tekst en klik)"><i>I</i></button>
                    <button class="fmt-btn" data-cmd="h3"     title="Grote koptekst">H3</button>
                    <button class="fmt-btn" data-cmd="h4"     title="Kleine koptekst">H4</button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-cmd="ul"     title="Opsomming met puntjes">&#8226; Lijst</button>
                    <button class="fmt-btn" data-cmd="ol"     title="Genummerde opsomming">1. Lijst</button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-cmd="link"   title="Link invoegen">&#128279; Link</button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn fmt-btn-special" data-cmd="info-card" title="Info-kader invoegen (blokje met titel en tekst)">&#128204; Info kader</button>
                    <button class="fmt-btn" data-cmd="br-sm"  title="Kleine witruimte (0.4rem)">&#8597; Klein</button>
                    <button class="fmt-btn" data-cmd="br-lg"  title="Grote witruimte (1.5rem)">&#8597; Groot</button>
                    <button class="fmt-btn" data-cmd="hr"     title="Horizontale scheidingslijn">&#8212; Lijn</button>
                </div>
            </div>
            <div class="rich-editor" contenteditable="true" spellcheck="true"
                 data-placeholder="Klik hier om te beginnen typen..."></div>
        `;

        // Vul editor inhoud
        const editorEl = item.querySelector('.rich-editor');
        if (data.body) editorEl.innerHTML = data.body;

        // Stel standaard alineatag in als <p>
        editorEl.addEventListener('focus', () => {
            document.execCommand('defaultParagraphSeparator', false, 'p');
        });

        // Toolbar: mousedown preventDefault zodat editor focus behoudt
        item.querySelectorAll('.fmt-btn').forEach(btn => {
            btn.addEventListener('mousedown', e => e.preventDefault());
            btn.addEventListener('click', () => applyFormat(editorEl, btn.dataset.cmd));
        });

        // Drag-handle: maakt de sectie versleepbaar
        const handle = item.querySelector('.section-handle');
        handle.setAttribute('draggable', 'true');
        handle.addEventListener('dragstart', (e) => {
            _draggingItem = item;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', secId);
            try { e.dataTransfer.setDragImage(item, 20, 20); } catch (_) {}
            setTimeout(() => item.classList.add('dragging'), 0);
        });

        // Omhoog / Omlaag knoppen
        item.querySelector('.sec-ctrl-btn.up').addEventListener('click', () => {
            const prev = item.previousElementSibling;
            if (prev) listEl.insertBefore(item, prev);
            if (previewMode) updateFullPreview();
        });
        item.querySelector('.sec-ctrl-btn.down').addEventListener('click', () => {
            const next = item.nextElementSibling;
            if (next) listEl.insertBefore(next, item);
            if (previewMode) updateFullPreview();
        });

        // Verwijder sectie
        item.querySelector('.sec-ctrl-btn.delete').addEventListener('click', () => {
            if (confirm(`Sectie "${item.querySelector('.section-title-input').value || 'zonder titel'}" verwijderen?`)) {
                item.remove();
                if (previewMode) updateFullPreview();
            }
        });

        // Live preview bijwerken bij typen
        editorEl.addEventListener('input', () => {
            if (previewMode) updateFullPreview();
        });
        item.querySelector('.section-title-input').addEventListener('input', () => {
            if (previewMode) updateFullPreview();
        });

        listEl.appendChild(item);
        return item;
    }

    // ── Exacte iframe-voorvertoning ───────────────────────────────────────────

    function buildPreviewHtml(sections) {
        const basePath = window.location.href.replace(/\/[^\/]*(\?.*)?$/, '/');

        const sectionHtml = sections.map(s => {
            const hTag = docType === 'terms' ? 'h4' : 'h3';
            return `<div class="policy-section">
                ${s.title ? `<${hTag} class="policy-title">${s.title}</${hTag}>` : ''}
                <div class="policy-body">${s.body}</div>
            </div>`;
        }).join('\n');

        // Stijlen die exact overeenkomen met de echte pagina
        const typeStyles = docType === 'terms' ? `
            body { padding: 1.5rem 1rem; background: rgba(0,0,0,.55); }
            .preview-wrap {
                background: #fff;
                max-width: 620px; margin: 2rem auto;
                border-radius: 10px; padding: 2rem 2rem 1.5rem;
                box-shadow: 0 8px 32px rgba(0,0,0,.2);
                font-family: 'Barlow','Segoe UI',Arial,sans-serif;
            }
            .preview-heading { margin: 0 0 0.2rem; font-size: 1.25rem; font-weight: 700; color: #1a1a1a; }
            .preview-sub     { color: #888; font-size: 0.85rem; margin: 0 0 1.5rem; }
            .policy-title    { font-size: 1rem; font-weight: 700; margin: 0 0 0.4rem; color: #1a1a1a; }
            .policy-body     { font-size: 0.9rem; line-height: 1.75; color: #333; }
            .policy-section  { margin-bottom: 1.25rem; }
        ` : `
            body { padding: 2rem 1rem; background: #f8f9fa; }
            .preview-wrap {
                background: #fff;
                max-width: 760px; margin: 0 auto;
                border-radius: 12px; padding: 2.5rem 2rem;
                font-family: 'Barlow','Segoe UI',Arial,sans-serif;
            }
            .policy-title   { color: #0047AB; font-size: 1.15rem; font-weight: 700;
                              margin: 0 0 0.75rem; padding-bottom: 0.4rem;
                              border-bottom: 2px solid #e8eef8; }
            .policy-body    { font-size: 0.95rem; line-height: 1.75; color: #333; }
            .policy-section { margin-bottom: 2rem; }
        `;

        return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base href="${basePath}">
<link rel="stylesheet" href="styles/styles.css">
<style>
* { box-sizing: border-box; }
${typeStyles}
/* Gedeelde body-stijlen — exact gelijk aan de echte pagina */
.policy-body p             { margin: 0 0 0.75rem; }
.policy-body p:last-child  { margin-bottom: 0; }
.policy-body ul, .policy-body ol { margin: 0.5rem 0 0.75rem 1.5rem; }
.policy-body li            { margin-bottom: 0.3rem; }
.policy-body h3            { color: #0047AB; font-size: 1.05rem; font-weight: 700; margin: 0.75rem 0 0.35rem; }
.policy-body h4            { color: #0047AB; font-size: 0.95rem; font-weight: 700; margin: 0.6rem 0 0.3rem; }
.policy-body a             { color: #0047AB; text-decoration: underline; }
.policy-body strong        { font-weight: 700; }
.policy-body em            { font-style: italic; }
.policy-body code          { font-family: monospace; background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }
.policy-body hr            { border: none; border-top: 1px solid #e0e0e0; margin: 1.25rem 0; }
/* Info kader */
.info-card                 { border: 1px solid #ddd; border-radius: 6px; padding: 0.9rem 1rem; background: #fafafa; margin: 0.75rem 0; }
.info-card-title           { font-weight: 700; font-size: 0.9rem; margin-bottom: 0.35rem; display: block; color: #333; }
/* Witruimtes */
.spacer-sm                 { display: block; height: 0.4rem; }
.spacer-lg                 { display: block; height: 1.5rem; }
</style>
</head>
<body>
<div class="preview-wrap">
${docType === 'terms' ? '<h3 class="preview-heading">Algemene Voorwaarden</h3><p class="preview-sub">V.V.S Rotselaar</p>' : ''}
${sectionHtml}
</div>
<script>
function reportHeight() {
    window.parent.postMessage({ type: 'preview-height', h: document.body.scrollHeight }, '*');
}
window.addEventListener('load', reportHeight);
if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(reportHeight).observe(document.body);
}
<\/script>
</body>
</html>`;
    }

    function updateFullPreview() {
        if (!fullPreviewEl) return;

        let iframe = fullPreviewEl.querySelector('iframe.preview-iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.className = 'preview-iframe';
            iframe.style.cssText = 'width:100%;border:none;min-height:300px;border-radius:8px;display:block;transition:height 0.2s;';
            fullPreviewEl.innerHTML = '';
            fullPreviewEl.appendChild(iframe);
        }

        iframe.srcdoc = buildPreviewHtml(getSections());
    }

    // Pas iframe-hoogte aan op basis van berichten vanuit de iframe
    window.addEventListener('message', (e) => {
        if (e.data?.type !== 'preview-height') return;
        const iframe = fullPreviewEl?.querySelector('iframe.preview-iframe');
        if (iframe) iframe.style.height = (e.data.h + 32) + 'px';
    });

    // ── Preview/Bewerken toggle ───────────────────────────────────────────────

    previewOffBtn?.addEventListener('click', () => {
        previewMode = false;
        previewOffBtn.classList.add('active');
        previewOnBtn?.classList.remove('active');
        // Toon editor
        listEl.style.display = '';
        if (addBtn) addBtn.style.display = '';
        // Verberg preview
        if (fullPreviewEl) fullPreviewEl.style.display = 'none';
    });

    previewOnBtn?.addEventListener('click', () => {
        previewMode = true;
        previewOnBtn.classList.add('active');
        previewOffBtn?.classList.remove('active');
        // Verberg editor
        listEl.style.display = 'none';
        if (addBtn) addBtn.style.display = 'none';
        // Toon preview
        updateFullPreview();
        if (fullPreviewEl) fullPreviewEl.style.display = 'block';
    });

    // ── Sectie toevoegen ──────────────────────────────────────────────────────

    addBtn?.addEventListener('click', () => {
        const row = addSectionRow();
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => row.querySelector('.rich-editor').focus(), 100);
    });

    return { getSections, loadSections, setStatus };
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGINA-INITIALISATIE
// ═════════════════════════════════════════════════════════════════════════════

async function initPage() {

    const termsEditor = buildSectionEditor({
        listId: 'termsSectionList', addBtnId: 'termsAddSection',
        previewOffBtnId: 'termsPreviewOff', previewOnBtnId: 'termsPreviewOn',
        fullPreviewId: 'termsFullPreview', loadStatusId: 'termsLoadStatus',
        docType: 'terms'
    });

    const privacyEditor = buildSectionEditor({
        listId: 'privacySectionList', addBtnId: 'privacyAddSection',
        previewOffBtnId: 'privacyPreviewOff', previewOnBtnId: 'privacyPreviewOn',
        fullPreviewId: 'privacyFullPreview', loadStatusId: 'privacyLoadStatus',
        docType: 'privacy'
    });

    // ── Laad vanuit Firestore ─────────────────────────────────────────────────
    try {
        const snap = await getDoc(doc(db, 'settings', 'terms'));
        if (snap.exists() && snap.data().sections?.length) {
            termsEditor.loadSections(snap.data().sections);
            termsEditor.setStatus('Geladen uit database');
        } else {
            termsEditor.loadSections(DEFAULT_TERMS_SECTIONS);
            termsEditor.setStatus('Standaardinhoud geladen');
        }
    } catch (e) {
        console.error('Terms load error:', e);
        termsEditor.loadSections(DEFAULT_TERMS_SECTIONS);
        termsEditor.setStatus('Laadprobleem - standaard geladen');
    }

    try {
        const snap = await getDoc(doc(db, 'settings', 'privacy'));
        if (snap.exists() && snap.data().sections?.length) {
            privacyEditor.loadSections(snap.data().sections);
            const di = document.getElementById('privacyLastUpdatedInput');
            if (di && snap.data().lastUpdated) di.value = snap.data().lastUpdated;
            privacyEditor.setStatus('Geladen uit database');
        } else {
            privacyEditor.loadSections(DEFAULT_PRIVACY_SECTIONS);
            privacyEditor.setStatus('Standaardinhoud geladen');
        }
    } catch (e) {
        console.error('Privacy load error:', e);
        privacyEditor.loadSections(DEFAULT_PRIVACY_SECTIONS);
        privacyEditor.setStatus('Laadprobleem - standaard geladen');
    }

    // ── Opslaan: Algemene Voorwaarden ─────────────────────────────────────────
    const termsSaveBtn    = document.getElementById('termsSaveBtn');
    const termsSaveStatus = document.getElementById('termsSaveStatus');

    termsSaveBtn?.addEventListener('click', async () => {
        termsSaveBtn.disabled = true; termsSaveBtn.textContent = 'Bezig...';
        try {
            await setDoc(doc(db, 'settings', 'terms'), {
                sections: termsEditor.getSections(), updatedAt: serverTimestamp()
            });
            // Stuur eenmalige notificatie naar alle ingelogde gebruikers
            await stuurBeleidsNotificatie('terms');
            showSaveStatus(termsSaveStatus);
            termsEditor.setStatus('Opgeslagen');
            showToast('Algemene Voorwaarden opgeslagen!', 'success');
        } catch (e) {
            showToast('Fout bij opslaan: ' + e.message, 'error');
        } finally {
            termsSaveBtn.disabled = false; termsSaveBtn.textContent = 'Opslaan';
        }
    });

    // ── Mail tab ──────────────────────────────────────────────────────────────
    initMailTab();

    // ── Opslaan: Privacyverklaring ────────────────────────────────────────────
    const privacySaveBtn    = document.getElementById('privacySaveBtn');
    const privacySaveStatus = document.getElementById('privacySaveStatus');

    privacySaveBtn?.addEventListener('click', async () => {
        privacySaveBtn.disabled = true; privacySaveBtn.textContent = 'Bezig...';
        try {
            // Automatische datum: dag maand jaar in het Nederlands
            const now = new Date();
            const lastUpdated = now.toLocaleDateString('nl-BE', {
                day: 'numeric', month: 'long', year: 'numeric'
            });
            await setDoc(doc(db, 'settings', 'privacy'), {
                sections:    privacyEditor.getSections(),
                lastUpdated: lastUpdated,
                updatedAt:   serverTimestamp()
            });
            // Stuur eenmalige notificatie naar alle ingelogde gebruikers
            await stuurBeleidsNotificatie('privacy');
            showSaveStatus(privacySaveStatus);
            privacyEditor.setStatus('Opgeslagen');
            showToast('Privacyverklaring opgeslagen!', 'success');
        } catch (e) {
            showToast('Fout bij opslaan: ' + e.message, 'error');
        } finally {
            privacySaveBtn.disabled = false; privacySaveBtn.textContent = 'Opslaan';
        }
    });
}

// ── Hulpfuncties ──────────────────────────────────────────────────────────────

// ── Beleid-update notificatie ─────────────────────────────────────────────────
// Maakt een document aan in Firestore notificaties-collection dat aan alle
// ingelogde gebruikers getoond wordt. Versie wordt verhoogd zodat eerder
// gedismissed gebruikers de notificatie opnieuw zien.

async function stuurBeleidsNotificatie(type) {
    const docId  = type === 'privacy' ? 'policy_privacy_update' : 'policy_terms_update';
    const titel  = type === 'privacy' ? 'Privacyverklaring bijgewerkt' : 'Algemene Voorwaarden bijgewerkt';
    const tekst  = type === 'privacy'
        ? 'Onze privacyverklaring werd aangepast. Bekijk de wijzigingen op de privacypagina.'
        : 'Onze algemene voorwaarden werden aangepast. Lees ze na op de loginpagina.';
    const link   = type === 'privacy' ? 'privacy.html' : 'login.html';

    try {
        // Haal huidige versie op om te verhogen
        const bestaand = await getDoc(doc(db, 'notificaties', docId));
        const oudeVersie = bestaand.exists() ? (bestaand.data().versie || 1) : 0;
        const nieuweVersie = oudeVersie + 1;

        await setDoc(doc(db, 'notificaties', docId), {
            id:        docId,
            titel:     titel,
            tekst:     tekst,
            type:      'info',
            actief:    true,
            doelgroep: 'ingelogd',   // enkel voor ingelogde gebruikers
            versie:    nieuweVersie, // verhoogde versie reset alle dismiss-states
            link:      link,
            aangemaakt: serverTimestamp(),
            // Geen vanDatum/totDatum → blijft actief tot manueel uitgeschakeld
        });
        console.log(`Beleid-notificatie aangemaakt: ${docId} v${nieuweVersie}`);
    } catch (e) {
        console.warn('Beleid-notificatie aanmaken mislukt:', e.message);
        // Geen showToast — opslaan is al gelukt
    }
}

// ── Mail-tab initialisatie ────────────────────────────────────────────────────

async function initMailTab() {
    // Laad spelerlijst voor de ontvanger-selector
    const recipientGroup = document.getElementById('mailRecipientGroup');
    const recipientList  = document.getElementById('mailRecipientList');
    const sendBtn        = document.getElementById('mailSendBtn');
    const mailStatus     = document.getElementById('mailSendStatus');
    const subjectInput   = document.getElementById('mailSubject');
    const bodyEditor     = document.getElementById('mailBodyEditor');

    if (!sendBtn) return;

    // Laad alle leden voor de "Specifieke spelers" optie
    let allUsers = [];
    try {
        const snap = await getDocs(collection(db, 'users'));
        snap.forEach(d => {
            const u = d.data();
            if (u.email) allUsers.push({ uid: u.uid || d.id, naam: u.naam || '?', email: u.email, categorie: u.categorie || '', ploegen: u.ploegen || [] });
        });
        allUsers.sort((a, b) => a.naam.localeCompare(b.naam));
    } catch (e) {
        console.error('Gebruikers laden mislukt:', e);
    }

    // Ontvanger-type wissel
    document.querySelectorAll('input[name="mailRecipientType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const val = radio.value;
            // Toon individuele spelerslijst enkel bij 'specific'
            if (recipientList) recipientList.style.display = val === 'specific' ? '' : 'none';
            if (val === 'specific' && recipientList && !recipientList.dataset.loaded) {
                recipientList.dataset.loaded = '1';
                recipientList.innerHTML = allUsers.map(u => `
                    <label class="mail-user-label">
                        <input type="checkbox" class="mail-user-cb" value="${u.email}" data-naam="${u.naam}">
                        <span>${u.naam}</span>
                        <span class="mail-user-cat">${(u.ploegen.length > 1 ? u.ploegen : [u.categorie]).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')}</span>
                    </label>`).join('');
            }
        });
    });

    // Mail-opmaakknoppen (zelfde principe als admin3 rich editor)
    document.querySelectorAll('.mail-fmt-btn').forEach(btn => {
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', () => {
            if (!bodyEditor) return;
            bodyEditor.focus();
            const cmd = btn.dataset.cmd;
            switch (cmd) {
                case 'bold':   document.execCommand('bold',   false, null); break;
                case 'italic': document.execCommand('italic', false, null); break;
                case 'ul':     document.execCommand('insertUnorderedList', false, null); break;
                case 'link': {
                    const url = prompt('URL:', 'https://');
                    if (url) document.execCommand('createLink', false, url);
                    break;
                }
            }
        });
    });

    // Verzenden
    sendBtn.addEventListener('click', async () => {
        const subject = subjectInput?.value.trim();
        const html    = bodyEditor?.innerHTML.trim();
        if (!subject) { showToast('Vul een onderwerp in.', 'error'); return; }
        if (!html || html === '<br>') { showToast('Vul een bericht in.', 'error'); return; }

        const type = document.querySelector('input[name="mailRecipientType"]:checked')?.value;
        let toAddresses = [];

        if (type === 'all') {
            toAddresses = allUsers.map(u => u.email);
        } else if (type === 'veteranen' || type === 'zaterdag' || type === 'zondag') {
            toAddresses = allUsers
                .filter(u => (u.ploegen.length > 0 ? u.ploegen : [u.categorie]).includes(type))
                .map(u => u.email);
        } else if (type === 'specific') {
            toAddresses = Array.from(document.querySelectorAll('.mail-user-cb:checked')).map(cb => cb.value);
        }

        if (toAddresses.length === 0) {
            showToast('Geen ontvangers geselecteerd.', 'error');
            return;
        }

        if (!confirm(`Mail versturen naar ${toAddresses.length} ontvanger(s)?`)) return;

        sendBtn.disabled    = true;
        sendBtn.textContent = 'Bezig...';

        try {
            // Trigger Email from Firestore Extension: schrijf naar 'mail' collection
            // De extensie pikt dit op en verzendt de mail.
            // Meerdere mails in één batch (max ~500 adressen per document is OK;
            // voor grotere lijsten: split in batches).
            const BATCH_SIZE = 100;
            for (let i = 0; i < toAddresses.length; i += BATCH_SIZE) {
                const batch = toAddresses.slice(i, i + BATCH_SIZE);
                await addDoc(collection(db, 'mail'), {
                    to:      batch,
                    message: {
                        subject: subject,
                        html:    html,
                    },
                    createdAt: serverTimestamp(),
                    sentBy:    auth.currentUser?.uid || 'admin',
                });
            }

            if (mailStatus) { mailStatus.style.display = 'inline'; setTimeout(() => mailStatus.style.display = 'none', 4000); }
            showToast(`Mail verstuurd naar ${toAddresses.length} ontvanger(s)!`, 'success');
            // Reset formulier
            if (subjectInput) subjectInput.value = '';
            if (bodyEditor)   bodyEditor.innerHTML = '';
            document.querySelectorAll('.mail-user-cb:checked').forEach(cb => cb.checked = false);
        } catch (e) {
            console.error('Mail verzenden mislukt:', e);
            showToast('Fout bij verzenden: ' + e.message, 'error');
        } finally {
            sendBtn.disabled    = false;
            sendBtn.textContent = '&#9993; Versturen';
        }
    });
}

// ── Mail-tab koppelen ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Mail tab initialiseren zodra een admin de pagina laadt
    // (wordt getriggerd vanuit initPage via onAuthStateChanged)
});

function showSaveStatus(el) {
    if (!el) return;
    el.style.display = 'inline';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
}

let toastTimer;
function showToast(msg, type = '') {
    let t = document.getElementById('adminToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'adminToast';
        t.style.cssText = `position:fixed;bottom:1.75rem;right:1.75rem;background:var(--text-dark);
            color:var(--white);padding:0.75rem 1.3rem;border-radius:9px;font-size:0.88rem;
            font-weight:600;z-index:9999;transform:translateY(80px);opacity:0;
            transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);
            box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;max-width:320px;`;
        document.body.appendChild(t);
    }
    t.textContent  = msg;
    t.style.background = type === 'success' ? 'var(--success)'
                       : type === 'error'   ? 'var(--danger)'
                       : 'var(--text-dark)';
    t.style.transform = 'translateY(0)'; t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        t.style.transform = 'translateY(80px)'; t.style.opacity = '0';
    }, 3500);
}

// ===============================================
// ADMIN TOUR – pagina 3 (vervolg van admin2.html)
// ===============================================

const TOUR_KEY = 'vvs_admin_tour_v2';

const TOUR_STEPS_P3 = [
    // ── Intro pagina 3 ────────────────────────────────────────────────────
    {
        icon: '', title: 'Pagina 3 – overzicht',
        desc: 'De laatste adminpagina bevat de juridische teksten van de website en een ingebouwde mailfunctie. We overlopen elk onderdeel.',
        tab: null, target: null,
    },

    // ── ALGEMENE VOORWAARDEN ──────────────────────────────────────────────
    {
        icon: '', title: 'Algemene Voorwaarden',
        desc: 'Dit zijn de voorwaarden die nieuwe leden moeten accepteren bij het aanmaken van een account. Pas de tekst hier aan via de sectie-editor.',
        tab: 'terms', target: '.tab-btn[data-tab="terms"]',
    },
    {
        icon: '', title: 'Secties bewerken',
        desc: 'De voorwaarden zijn opgebouwd uit secties. Klik op een sectie om de titel en inhoud te bewerken. Voeg nieuwe secties toe onderaan via <strong>"+ Nieuwe sectie toevoegen"</strong>.',
        tab: 'terms', target: '#termsSectionList',
    },
    {
        icon: '', title: 'Voorvertoning & opslaan',
        desc: 'Schakel tussen <strong>Bewerken</strong> en <strong>Voorvertoning</strong> om te zien hoe de tekst er voor leden uitziet. Vergeet niet <strong>"💾 Opslaan"</strong> te klikken om de wijzigingen op te slaan in de database.',
        tab: 'terms', target: '.save-bar',
    },

    // ── PRIVACYVERKLARING ─────────────────────────────────────────────────
    {
        icon: '', title: 'Privacyverklaring',
        desc: 'De privacyverklaring is zichtbaar op de website voor alle bezoekers. Werkt identiek aan de Algemene Voorwaarden: sectie-editor, voorvertoning en opslaan.',
        tab: 'privacy', target: '.tab-btn[data-tab="privacy"]',
    },
    {
        icon: '', title: 'Privacysecties',
        desc: 'Bewerk elke sectie afzonderlijk. Denk aan: welke gegevens worden verzameld, hoe worden ze gebruikt, en hoe kunnen leden hun gegevens laten verwijderen.',
        tab: 'privacy', target: '#privacySectionList',
    },

    // ── MAILEN ────────────────────────────────────────────────────────────
    {
        icon: '', title: 'Mailen',
        desc: 'Stuur een e-mail rechtstreeks vanuit het beheerpaneel naar één of meerdere groepen leden.',
        tab: 'mail', target: '.tab-btn[data-tab="mail"]',
    },
    {
        icon: '', title: 'Ontvangers kiezen',
        desc: 'Selecteer wie de mail ontvangt: <strong>Iedereen</strong>, een specifieke ploeg (Veteranen, Zaterdag, Zondag) of <strong>Specifieke leden</strong> die je handmatig aanvinkt in de lijst die verschijnt.',
        tab: 'mail', target: '.mail-recipient-grid',
    },
    {
        icon: '', title: 'Onderwerp & bericht',
        desc: 'Vul een duidelijk onderwerp in en schrijf je bericht in de tekstverwerker. Je kan tekst <strong>vetgedrukt</strong>, <em>cursief</em> of onderlijnd opmaken via de werkbalk. Klik <strong>"📩 Versturen"</strong> om de mail te verzenden.',
        tab: 'mail', target: '#mailBodyEditor',
    },

    // ── AFSLUITING ────────────────────────────────────────────────────────
    {
        icon: '🎉', title: 'Rondleiding voltooid!',
        desc: 'Je hebt nu een compleet overzicht van alle drie adminpagina\'s. Vergeet niet dat je de gids altijd opnieuw kan starten via de <strong>"Gids"</strong> knop bovenaan. Heb je vragen, contacteer Tiebe Beniers. Veel succes!',
        tab: null, target: null,
    },
];

// ── Spotlight engine ──────────────────────────────────────────────────────
let _p3TourStep = 0;
let _p3ResizeHandler = null;

function _p3clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _p3switchTab(name) {
    const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (btn && !btn.classList.contains('active')) btn.click();
}
function _p3getEl(sel) {
    if (!sel) return null;
    try {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return (r.width === 0 && r.height === 0) ? null : el;
    } catch { return null; }
}

const _P3_PAD = 8, _P3_GAP = 14, _P3_CW = 360;

function _p3Spotlight(el) {
    const s = document.getElementById('tourSpotlight');
    if (!s || !el) return;
    const r = el.getBoundingClientRect();
    s.style.top    = (r.top    - _P3_PAD) + 'px';
    s.style.left   = (r.left   - _P3_PAD) + 'px';
    s.style.width  = (r.width  + _P3_PAD*2) + 'px';
    s.style.height = (r.height + _P3_PAD*2) + 'px';
    s.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.50),0 0 0 2.5px var(--primary-blue,#0047AB),0 0 12px 4px rgba(0,71,171,0.25)';
    s.style.display = 'block';
}

function _p3PosCard(el) {
    const card = document.getElementById('adminTourCard');
    if (!card || !el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = Math.min(_P3_CW, vw - 32), ch = card.offsetHeight || 260;
    const sT = r.top - _P3_PAD, sB = r.bottom + _P3_PAD, sR = r.right + _P3_PAD;
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    let pos = 'bottom';
    if (sB + ch + _P3_GAP + 16 > vh && sT - ch - _P3_GAP - 16 >= 0) pos = 'top';
    else if (sB + ch + _P3_GAP + 16 > vh && sR + cw + _P3_GAP + 16 <= vw) pos = 'right';
    let top, left;
    if (pos === 'bottom') { top = sB + _P3_GAP; left = _p3clamp(cx - cw/2, 16, vw-cw-16); }
    else if (pos === 'top') { top = sT - _P3_GAP - ch; left = _p3clamp(cx - cw/2, 16, vw-cw-16); }
    else { top = _p3clamp(cy - ch/2, 16, vh-ch-16); left = sR + _P3_GAP; }
    top = _p3clamp(top, 16, vh - ch - 16);
    Object.assign(card.style, { position:'fixed', top:top+'px', left:left+'px', width:cw+'px', maxWidth:cw+'px', transform:'none', display:'block' });
}

function _p3CenterCard() {
    const card = document.getElementById('adminTourCard');
    if (!card) return;
    Object.assign(card.style, { position:'fixed', top:'50%', left:'50%', width:'min(440px, calc(100vw - 2rem))', maxWidth:'', transform:'translate(-50%,-50%)', display:'block' });
}

function _p3BuildDots() {
    const c = document.getElementById('tourProgress');
    if (!c) return;
    c.innerHTML = '';
    TOUR_STEPS_P3.forEach((_, i) => {
        const d = document.createElement('button');
        d.className = 'tour-dot' + (i < _p3TourStep ? ' done' : '') + (i === _p3TourStep ? ' active' : '');
        d.setAttribute('aria-label', `Stap ${i+1}`);
        d.addEventListener('click', () => _p3GoTo(i));
        c.appendChild(d);
    });
}

function _p3UpdateNav() {
    const isFirst = _p3TourStep === 0;
    const isLast  = _p3TourStep === TOUR_STEPS_P3.length - 1;
    document.getElementById('tourPrevBtn')  .style.display = isFirst ? 'none' : '';
    document.getElementById('tourNextBtn')  .style.display = isLast  ? 'none' : '';
    document.getElementById('tourFinishBtn').style.display = isLast  ? '' : 'none';
}

function _p3Render() {
    const step = TOUR_STEPS_P3[_p3TourStep];
    if (!step) return;
    document.getElementById('tourStepIcon').textContent  = step.icon  || '';
    document.getElementById('tourStepTitle').textContent = step.title || '';
    document.getElementById('tourStepDesc').innerHTML    = step.desc  || '';
    _p3UpdateNav();
    _p3BuildDots();
    document.querySelectorAll('.tab-btn.tour-tab-highlight').forEach(b => b.classList.remove('tour-tab-highlight'));
    if (step.tab) _p3switchTab(step.tab);

    const overlay = document.getElementById('adminTourOverlay');
    const spot    = document.getElementById('tourSpotlight');

    requestAnimationFrame(() => {
        if (step.onEnter) step.onEnter();
        const _afterDelay = () => {
            const el = _p3getEl(step.target);
            if (el) {
                if (overlay) { overlay.style.background = 'transparent'; overlay.style.display = 'block'; }
                el.scrollIntoView({ behavior:'instant', block:'center', inline:'nearest' });
                requestAnimationFrame(() => {
                    _p3Spotlight(el); _p3PosCard(el);
                    if (step.tab) {
                        const tb = document.querySelector(`.tab-btn[data-tab="${step.tab}"]`);
                        if (tb) tb.classList.add('tour-tab-highlight');
                    }
                    if (_p3ResizeHandler) window.removeEventListener('resize', _p3ResizeHandler);
                    _p3ResizeHandler = () => { _p3Spotlight(el); _p3PosCard(el); };
                    window.addEventListener('resize', _p3ResizeHandler);
                });
            } else {
                if (spot)    spot.style.display = 'none';
                if (overlay) { overlay.style.background = 'rgba(0,0,0,0.50)'; overlay.style.display = 'block'; }
                _p3CenterCard();
                if (step.tab) {
                    const tb = document.querySelector(`.tab-btn[data-tab="${step.tab}"]`);
                    if (tb) tb.classList.add('tour-tab-highlight');
                }
                if (_p3ResizeHandler) { window.removeEventListener('resize', _p3ResizeHandler); _p3ResizeHandler = null; }
            }
        };
        const d = step.delay || 0;
        if (d > 0) setTimeout(_afterDelay, d); else requestAnimationFrame(_afterDelay);
    });
}

function _p3GoTo(index) {
    const prev = TOUR_STEPS_P3[_p3TourStep];
    if (prev && prev.onLeave) prev.onLeave();
    _p3TourStep = Math.max(0, Math.min(TOUR_STEPS_P3.length - 1, index));
    _p3Render();
}

function _p3Close(markDone = true) {
    const cur = TOUR_STEPS_P3[_p3TourStep];
    if (cur && cur.onLeave) cur.onLeave();
    ['adminTourOverlay','adminTourCard','tourSpotlight'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    document.querySelectorAll('.tab-btn.tour-tab-highlight').forEach(b => b.classList.remove('tour-tab-highlight'));
    if (_p3ResizeHandler) { window.removeEventListener('resize', _p3ResizeHandler); _p3ResizeHandler = null; }
    if (markDone) localStorage.setItem(TOUR_KEY, '1');
}

function _p3Open() {
    _p3TourStep = 0;
    ['adminTourOverlay','adminTourCard'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'block';
    });
    const s = document.getElementById('tourSpotlight'); if (s) s.style.display = 'none';
    _p3Render();
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('tourNextBtn')  ?.addEventListener('click', () => {
        if (_p3TourStep < TOUR_STEPS_P3.length - 1) _p3GoTo(_p3TourStep + 1);
        else _p3Close(true);
    });
    document.getElementById('tourPrevBtn')  ?.addEventListener('click', () => _p3GoTo(_p3TourStep - 1));
    document.getElementById('tourFinishBtn')?.addEventListener('click', () => _p3Close(true));
    document.getElementById('tourSkipBtn')  ?.addEventListener('click', () => _p3Close(true));
    document.getElementById('adminTourBtn') ?.addEventListener('click', _p3Open);

    document.getElementById('adminTourOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('adminTourOverlay')) _p3Close(true);
    });

    document.addEventListener('keydown', e => {
        const card = document.getElementById('adminTourCard');
        if (!card || card.style.display === 'none') return;
        if (e.key === 'ArrowRight' || e.key === 'Enter') {
            if (_p3TourStep < TOUR_STEPS_P3.length - 1) _p3GoTo(_p3TourStep + 1);
            else _p3Close(true);
        }
        if (e.key === 'ArrowLeft') _p3GoTo(_p3TourStep - 1);
        if (e.key === 'Escape')    _p3Close(true);
    });

    // Auto-start when redirected from page 2
    const params = new URLSearchParams(window.location.search);
    if (params.get('tour') === '1') {
        history.replaceState(null, '', window.location.pathname + window.location.hash);
        setTimeout(_p3Open, 700);
    }
});