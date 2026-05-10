// ===============================================
// SPELERSPROFIEL - speler.js
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import {
    onAuthStateChanged,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword,
    verifyBeforeUpdateEmail
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, query, where, getDocs, doc, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Cache configuratie ────────────────────────────────────────────────────────
//
// Profieldata:          5 minuten  — stats kunnen na een wedstrijd veranderen
// Wedstrijdgeschiedenis: 10 minuten — verandert zelden, bevat veel reads
//
const CACHE_TTL_PROFILE = 5  * 60 * 1000;   // 5 min in ms
const CACHE_TTL_HISTORY = 10 * 60 * 1000;   // 10 min in ms

function cacheKey(type, uid) {
    return `vvs_${type}_${uid}`;
}

// Detecteer page refresh → negeer localStorage cache zodat verse data geladen wordt
const PAGE_REFRESHED = (() => {
    try {
        const nav = performance.getEntriesByType?.('navigation')?.[0];
        if (nav?.type === 'reload') {
            if (!sessionStorage.getItem('vvs_refreshed')) {
                sessionStorage.setItem('vvs_refreshed', '1');
                return true;
            }
        } else {
            sessionStorage.removeItem('vvs_refreshed');
        }
    } catch (_) {}
    return false;
})();
function cacheGet(type, uid, ttl) {
    if (PAGE_REFRESHED) return null;
    try {
        const raw = localStorage.getItem(cacheKey(type, uid));
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > ttl) {
            localStorage.removeItem(cacheKey(type, uid));
            return null;
        }
        return data;
    } catch (_) { return null; }
}

function cacheSet(type, uid, data) {
    try {
        localStorage.setItem(cacheKey(type, uid), JSON.stringify({ ts: Date.now(), data }));
    } catch (_) { /* quota overschreden of privémodus — geen probleem */ }
}

function cacheInvalidate(type, uid) {
    try { localStorage.removeItem(cacheKey(type, uid)); } catch (_) {}
}

// ── State ─────────────────────────────────────────────────────────────────────

let currentUser  = null;
let profileDocId = null;
let isOwnProfile = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function capitalize(str) {
    if (!str) return '—';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function showOnly(id) {
    ['stateLoading', 'stateNotLoggedIn', 'stateNotFound', 'playerProfile']
        .forEach(s => {
            const el = document.getElementById(s);
            if (el) el.style.display = s === id ? '' : 'none';
        });
}

// ── UI vullen ─────────────────────────────────────────────────────────────────

function fillProfile(userData) {
    document.getElementById('heroNaam').textContent       = userData.naam || 'Onbekend';
    document.getElementById('infoNaam').textContent       = userData.naam      || '—';
    // Toon alle ploegen als de speler er meerdere heeft
    const allPloegen = Array.isArray(userData.ploegen) && userData.ploegen.length > 0
        ? userData.ploegen
        : (userData.categorie ? [userData.categorie] : []);
    document.getElementById('infoCategorie').textContent =
        allPloegen.map(p => capitalize(p)).join(' + ') || '—';

    document.getElementById('statGoals').textContent   = userData.goals        ?? 0;
    document.getElementById('statAssists').textContent = userData.assists      ?? 0;
    document.getElementById('statMatches').textContent = userData.matchen      ?? 0;
    document.getElementById('statMinutes').textContent = userData.minuten      ?? 0;
    document.getElementById('statYellow').textContent  = userData.geelKaarten  ?? 0;
    document.getElementById('statRed').textContent     = userData.roodKaarten  ?? 0;

    setAvatarDisplay(userData.fotoUrl || null);

    // Altijd gevoelige rijen verbergen tenzij eigen profiel
    const emailRow    = document.getElementById('infoEmail')?.closest('.info-row');
    const telefoonRow = document.getElementById('infoTelefoonRow');
    const uidRow      = document.getElementById('infoUid')?.closest('.info-row');

    if (isOwnProfile) {
        // ── Geval 1: eigen profiel ───────────────────────────────────────────
        document.getElementById('infoEmail').textContent    = userData.email    || '—';
        document.getElementById('infoTelefoon').textContent = userData.telefoon || '—';
        // Voeg bewerkingsicoontjes toe (na DOM-update zodat refs geldig zijn)
        setTimeout(() => {
            addEditIcon('infoEmail',    'E-mail',        'email');
            addEditIcon('infoTelefoon', 'Telefoonnummer', 'telefoon');
        }, 0);
        const uidEl = document.getElementById('infoUid');
        if (uidEl) {
            const uidValue = userData.uid || '—';

            // Herbouw de inhoud: tekst-span | copy-knop | vraagteken
            uidEl.innerHTML = '';

            const textSpan = document.createElement('span');
            textSpan.className = 'uid-text';
            textSpan.textContent = uidValue;
            uidEl.appendChild(textSpan);

            // Klembord-knop
            const copyBtn = document.createElement('button');
            copyBtn.className = 'uid-copy-btn';
            copyBtn.title = 'Kopieer UID';
            copyBtn.setAttribute('aria-label', 'Kopieer UID');
            copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
            copyBtn.addEventListener('click', () => {
                if (uidValue !== '—') {
                    navigator.clipboard?.writeText(uidValue).then(() => {
                        copyBtn.title = 'Gekopieerd!';
                        setTimeout(() => { copyBtn.title = 'Kopieer UID'; }, 2000);
                    });
                }
            });
            uidEl.appendChild(copyBtn);

            // Vraagteken — tooltip als position:fixed op <html> zodat overflow:hidden
            // op .info-row het blokje nooit kan clippen.
            const helpBtn = document.createElement('span');
            helpBtn.className = 'uid-help';
            helpBtn.setAttribute('tabindex', '0');
            helpBtn.setAttribute('aria-label', 'Info over UID');
            helpBtn.textContent = '?';

            const TOOLTIP_TEXT = 'Deel deze code met de beheerder als je problemen hebt met je account.';

            function getFixedTooltip() {
                let tip = document.getElementById('uidTooltipFixed');
                if (!tip) {
                    tip = document.createElement('div');
                    tip.id = 'uidTooltipFixed';
                    tip.textContent = TOOLTIP_TEXT;
                    document.documentElement.appendChild(tip);
                }
                return tip;
            }

            function showUidTooltip() {
                const tip  = getFixedTooltip();
                const rect = helpBtn.getBoundingClientRect();
                // Eerst tonen om breedte/hoogte te meten (position:fixed = viewport-coördinaten, geen scrollY)
                tip.style.visibility = 'hidden';
                tip.style.display    = 'block';
                const tipW = tip.offsetWidth;
                const tipH = tip.offsetHeight;
                // Boven het vraagteken, rechts uitgelijnd met het vraagteken
                let top  = rect.top - tipH - 10;
                let left = rect.right - tipW;
                // Geen ruimte boven het scherm → flip naar beneden
                if (top < 8) top = rect.bottom + 10;
                // Uitsteek naar links → bijsturen
                if (left < 8) left = 8;
                tip.style.top        = top  + 'px';
                tip.style.left       = left + 'px';
                tip.style.visibility = '';
                helpBtn.classList.add('active');
            }

            function hideUidTooltip() {
                const tip = document.getElementById('uidTooltipFixed');
                if (tip) tip.style.display = 'none';
                helpBtn.classList.remove('active');
            }

            helpBtn.addEventListener('mouseenter', showUidTooltip);
            helpBtn.addEventListener('mouseleave', hideUidTooltip);
            helpBtn.addEventListener('focus',      showUidTooltip);
            helpBtn.addEventListener('blur',       hideUidTooltip);
            helpBtn.addEventListener('click', () => {
                const tip = document.getElementById('uidTooltipFixed');
                (tip && tip.style.display === 'block') ? hideUidTooltip() : showUidTooltip();
            });

            uidEl.appendChild(helpBtn);
        }
        // Guestbanners verbergen, wachtwoord-sectie tonen
        const guestBanner  = document.getElementById('guestBanner');
        const publicBanner = document.getElementById('publicBanner');
        if (guestBanner)  guestBanner.style.display  = 'none';
        if (publicBanner) publicBanner.style.display = 'none';
        showPasswordSection();

    } else if (currentUser) {
        // ── Geval 2: ingelogd, bekijkt iemand anders ────────────────────────
        if (emailRow)    emailRow.style.display    = 'none';
        if (telefoonRow) telefoonRow.style.display = 'none';
        if (uidRow)      uidRow.style.display      = 'none';

        const banner     = document.getElementById('guestBanner');
        const bannerText = document.getElementById('guestBannerText');
        if (banner) banner.style.display = '';
        if (bannerText) bannerText.textContent =
            'Je bekijkt het profiel van ' + (userData.naam || 'een ander lid') + '.';

    } else {
        // ── Geval 3: niet ingelogd ───────────────────────────────────────────
        if (emailRow)    emailRow.style.display    = 'none';
        if (telefoonRow) telefoonRow.style.display = 'none';
        if (uidRow)      uidRow.style.display      = 'none';

        const banner     = document.getElementById('publicBanner');
        const bannerText = document.getElementById('publicBannerText');
        const ownBtn     = document.getElementById('ownProfileBtn');
        if (banner) banner.style.display = '';
        if (bannerText) bannerText.textContent =
            'Je bekijkt het publiek profiel van ' + (userData.naam || 'een speler') + '.';
        if (ownBtn) ownBtn.style.display = 'none';
    }
}

function setAvatarDisplay(url) {
    const circle = document.getElementById('avatarCircle');
    if (!circle) return;
    if (url) {
        circle.innerHTML = `<img src="${url}" alt="Profielfoto">`;
    } else {
        circle.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
            </svg>`;
    }
}

// ── Wachtwoord wijzigen ───────────────────────────────────────────────────────

function showPasswordSection() {
    const title = document.getElementById('passwordSectionTitle');
    const card  = document.getElementById('passwordCard');
    if (title) title.style.display = '';
    if (card)  card.style.display  = '';
}

function setPasswordStatus(elId, type, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.style.display = 'block';
    el.className = `password-status ${type}`;
    el.textContent = msg;
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// Toon/verberg wachtwoord knoppen
document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        const eyeOpen   = btn.querySelector('.eye-open');
        const eyeClosed = btn.querySelector('.eye-closed');
        if (eyeOpen && eyeClosed) {
            eyeOpen.style.display   = isPassword ? 'none'  : '';
            eyeClosed.style.display = isPassword ? ''      : 'none';
        }
    });
});

// Wachtwoord opslaan
const savePasswordBtn = document.getElementById('savePasswordBtn');
if (savePasswordBtn) {
    savePasswordBtn.addEventListener('click', async () => {
        const current  = document.getElementById('currentPassword').value;
        const newPw    = document.getElementById('newPassword').value;
        const confirm  = document.getElementById('confirmPassword').value;

        if (!current || !newPw || !confirm) {
            setPasswordStatus('passwordStatus', 'error', 'Vul alle velden in.');
            return;
        }
        if (newPw.length < 6) {
            setPasswordStatus('passwordStatus', 'error', 'Nieuw wachtwoord moet minimaal 6 tekens bevatten.');
            return;
        }
        if (newPw !== confirm) {
            setPasswordStatus('passwordStatus', 'error', 'De twee nieuwe wachtwoorden komen niet overeen.');
            return;
        }

        savePasswordBtn.disabled = true;
        savePasswordBtn.textContent = 'Bezig…';

        try {
            const user       = auth.currentUser;
            const credential = EmailAuthProvider.credential(user.email, current);

            // Herverificatie vereist door Firebase voor gevoelige acties
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPw);

            // Velden leegmaken
            ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });

            setPasswordStatus('passwordStatus', 'success', '✅ Wachtwoord succesvol gewijzigd!');
        } catch (err) {
            console.error('Password update error:', err);
            let msg = 'Er ging iets mis. Probeer opnieuw.';
            if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                msg = 'Huidig wachtwoord is incorrect.';
            } else if (err.code === 'auth/too-many-requests') {
                msg = 'Te veel pogingen. Probeer later opnieuw of gebruik de reset-link.';
            } else if (err.code === 'auth/weak-password') {
                msg = 'Nieuw wachtwoord is te zwak. Kies een sterker wachtwoord.';
            }
            setPasswordStatus('passwordStatus', 'error', msg);
        } finally {
            savePasswordBtn.disabled = false;
            savePasswordBtn.textContent = '🔒 Wachtwoord opslaan';
        }
    });
}

// ── Profieldata laden (met cache) ─────────────────────────────────────────────

async function loadProfile(targetUid) {
    // 1. Probeer cache eerst
    const cached = cacheGet('profile', targetUid, CACHE_TTL_PROFILE);
    if (cached) {
        console.log('[cache] profiel geladen uit localStorage voor', targetUid);
        profileDocId = cached._docId;
        fillProfile(cached);
        showOnly('playerProfile');

        // Laad geschiedenis ook uit cache (of Firestore als cache leeg/verlopen)
        if (currentUser) {
            loadMatchHistory(targetUid);
        } else {
            const container = document.getElementById('matchHistoryContainer');
            if (container) container.style.display = 'none';
            const historyTitle = Array.from(document.querySelectorAll('.section-title'))
                .find(el => el.textContent.includes('Wedstrijdgeschiedenis'));
            if (historyTitle) historyTitle.style.display = 'none';
        }
        return;
    }

    // 2. Cache miss — haal op uit Firestore
    console.log('[firestore] profiel ophalen voor', targetUid);
    const q    = query(collection(db, 'users'), where('uid', '==', targetUid));
    const snap = await getDocs(q);

    if (snap.empty) {
        showOnly('stateNotFound');
        return;
    }

    profileDocId    = snap.docs[0].id;
    const userData  = { uid: targetUid, _docId: profileDocId, ...snap.docs[0].data() };

    // Sla op in cache
    cacheSet('profile', targetUid, userData);

    fillProfile(userData);
    showOnly('playerProfile');
    // Wedstrijdgeschiedenis vereist auth (availability-subcollection queries)
    // Alleen laden als de gebruiker is ingelogd
    if (currentUser) {
        loadMatchHistory(targetUid);
    } else {
        const container = document.getElementById('matchHistoryContainer');
        if (container) container.style.display = 'none';
        const historyTitle = Array.from(document.querySelectorAll('.section-title'))
            .find(el => el.textContent.includes('Wedstrijdgeschiedenis'));
        if (historyTitle) historyTitle.style.display = 'none';
    }
}

// ── Wedstrijdgeschiedenis (met cache) ─────────────────────────────────────────

async function loadMatchHistory(targetUid) {
    const container = document.getElementById('matchHistoryContainer');
    if (!container) return;

    // 1. Probeer cache eerst
    const cached = cacheGet('history', targetUid, CACHE_TTL_HISTORY);
    if (cached) {
        console.log('[cache] wedstrijdgeschiedenis geladen uit localStorage voor', targetUid);
        if (cached.length === 0) renderNoHistory(container);
        else renderMatchHistory(cached, container);
        return;
    }

    // 2. Cache miss — haal op uit Firestore
    console.log('[firestore] wedstrijdgeschiedenis ophalen voor', targetUid);
    try {
        const matchesSnap = await getDocs(query(
            collection(db, 'matches'),
            where('status', '==', 'finished')
        ));

        if (matchesSnap.empty) {
            cacheSet('history', targetUid, []);
            renderNoHistory(container);
            return;
        }

        const allMatches = [];
        matchesSnap.forEach(d => allMatches.push({ id: d.id, ...d.data() }));
        allMatches.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));

        const recentMatches = [];
        for (const matchDoc of allMatches) {
            if (recentMatches.length >= 3) break;

            const availDoc = await getDocs(
                query(
                    collection(db, 'matches', matchDoc.id, 'availability'),
                    where('available', '==', true)
                )
            );

            const wasPresent = availDoc.docs.some(d =>
                d.id === targetUid || d.data().uid === targetUid
            );
            if (wasPresent) recentMatches.push(matchDoc);
        }

        // Sla resultaat op in cache (ook als leeg, om herhaalde lege queries te vermijden)
        cacheSet('history', targetUid, recentMatches);

        if (recentMatches.length === 0) renderNoHistory(container);
        else renderMatchHistory(recentMatches, container);

    } catch (err) {
        console.error('Fout bij laden wedstrijdgeschiedenis:', err);
        container.innerHTML = `
            <div class="coming-soon">
                <div class="coming-icon">&#128194;</div>
                <p>Wedstrijdgeschiedenis kon niet worden geladen.</p>
            </div>`;
    }
}

function renderNoHistory(container) {
    container.innerHTML = `
        <div class="coming-soon">
            <div class="coming-icon">&#128194;</div>
            <p>Nog geen wedstrijden gevonden waarbij deze speler aanwezig was.</p>
        </div>`;
}

function renderMatchHistory(matches, container) {
    container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'match-history-list';

    matches.forEach(match => {
        const isHome   = (match.thuisploeg || '').toLowerCase().includes('rotselaar');
        const scoreOns = isHome ? (match.scoreThuis ?? '?') : (match.scoreUit ?? '?');
        const scoreOpp = isHome ? (match.scoreUit   ?? '?') : (match.scoreThuis ?? '?');

        let resultClass = 'draw', resultLabel = 'G';
        if (typeof scoreOns === 'number' && typeof scoreOpp === 'number') {
            if (scoreOns > scoreOpp)      { resultClass = 'win';  resultLabel = 'W'; }
            else if (scoreOns < scoreOpp) { resultClass = 'loss'; resultLabel = 'V'; }
        }

        let datumStr = match.datum || '';
        try {
            if (datumStr) {
                const d = new Date(datumStr + 'T00:00:00');
                datumStr = d.toLocaleDateString('nl-BE', {
                    day: 'numeric', month: 'long', year: 'numeric'
                });
            }
        } catch (_) {}

        const card = document.createElement('div');
        card.className = `match-history-card ${resultClass}`;
        card.innerHTML = `
            <div class="match-result-badge ${resultClass}">${resultLabel}</div>
            <div class="match-history-info">
                <div class="match-history-teams">
                    ${match.thuisploeg} &mdash; ${match.uitploeg}
                </div>
                <div class="match-history-meta">${datumStr}${match.team ? ' &middot; ' + capitalize(match.team) : ''}</div>
            </div>
            <div class="match-history-score">${match.scoreThuis ?? '?'}&ndash;${match.scoreUit ?? '?'}</div>
        `;
        list.appendChild(card);
    });

    container.appendChild(list);
}

// ── Auth + profiel laden ──────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');

    currentUser = user || null;
    if (loginLink) loginLink.textContent = user ? 'PROFIEL' : 'LOGIN';

    const params    = new URLSearchParams(window.location.search);
    const uidParam  = params.get('uid');

    if (!user) {
        // Niet ingelogd: alleen gastprofiel tonen als ?uid= aanwezig is
        if (uidParam) {
            isOwnProfile = false;
            try {
                await loadProfile(uidParam);
            } catch (err) {
                console.error('Fout bij laden gastprofiel:', err);
                showOnly('stateNotFound');
            }
        } else {
            showOnly('stateNotLoggedIn');
        }
        return;
    }

    try {
        const targetUid = uidParam || user.uid;
        isOwnProfile    = targetUid === user.uid;

        if (params.get('refresh') === '1') {
            cacheInvalidate('profile', targetUid);
            cacheInvalidate('history', targetUid);
        }

        await loadProfile(targetUid);

    } catch (err) {
        console.error('Fout bij laden profiel:', err);
        showOnly('stateNotFound');
    }
});

// ── Contactgegevens bewerken via modal ────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^(\+\d{1,3}[\s.-]?)?[\d\s.\-(]{7,}[\d]$/;

// Houd bij welk _docId we moeten updaten
let _editDocRef = null;

async function getEditDocRef() {
    if (!auth.currentUser) return null;
    // Probeer direct via uid als doc-ID (na migratie)
    const direct = doc(db, 'users', auth.currentUser.uid);
    try {
        const { getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const snap = await getDoc(direct);
        if (snap.exists()) return direct;
    } catch (_) {}
    // Fallback: zoek op uid-veld
    const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', auth.currentUser.uid)));
    if (snap.empty) return null;
    return snap.docs[0].ref;
}

function addEditIcon(spanId, label, field) {
    const span = document.getElementById(spanId);
    if (!span) return;

    // Verwijder bestaande knop indien aanwezig
    const parent = span.closest('.info-row');
    if (parent) parent.querySelectorAll('.edit-contact-btn').forEach(b => b.remove());

    const btn = document.createElement('button');
    btn.className = 'edit-contact-btn';
    btn.setAttribute('aria-label', `${label} bewerken`);
    btn.title = `${label} bewerken`;
    btn.innerHTML = `
        <img src="assets/edit.png" class="icon-lg" alt="">`;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(field, label, span.textContent.trim());
    });

    // Voeg toe aan de info-val wrapper (na de span)
    span.insertAdjacentElement('afterend', btn);
}

function openEditModal(field, label, currentVal) {
    // Verwijder bestaande modal indien aanwezig
    document.getElementById('editContactModal')?.remove();

    const isEmail = field === 'email';
    const modal = document.createElement('div');
    modal.id = 'editContactModal';
    modal.className = 'ec-modal-backdrop';
    modal.innerHTML = `
        <div class="ec-modal" role="dialog" aria-modal="true" aria-label="${label} wijzigen">
            <div class="ec-modal-header">
                <h3 class="ec-modal-title">${label} wijzigen</h3>
                <button class="ec-modal-close" id="ecClose" aria-label="Sluiten">&times;</button>
            </div>
            <div class="ec-modal-body">
                ${isEmail ? `
                <div class="ec-hint">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    Je krijgt een bevestigingsmail op het nieuwe adres. Je huidige e-mail blijft actief tot je de link aanklikt.
                </div>
                <div class="ec-field">
                    <label class="ec-label" for="ecReauthPw">Huidig wachtwoord <span class="ec-required">*</span></label>
                    <div class="ec-pw-wrap">
                        <input type="password" id="ecReauthPw" class="ec-input" placeholder="Huidig wachtwoord" autocomplete="current-password">
                        <button type="button" class="ec-eye-btn" data-target="ecReauthPw" aria-label="Toon/verberg">
                            <svg class="ec-eye ec-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            <svg class="ec-eye ec-eye-closed" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        </button>
                    </div>
                </div>` : ''}
                <div class="ec-field">
                    <label class="ec-label" for="ecNewVal">Nieuw ${label.toLowerCase()} <span class="ec-required">*</span></label>
                    <input type="${isEmail ? 'email' : 'tel'}" id="ecNewVal" class="ec-input"
                           placeholder="${isEmail ? 'naam@voorbeeld.be' : '+32 471 23 45 67'}"
                           value="${currentVal !== '—' ? currentVal : ''}"
                           autocomplete="${isEmail ? 'email' : 'tel'}">
                </div>
                <div class="ec-error" id="ecError" style="display:none;"></div>
            </div>
            <div class="ec-modal-footer">
                <button class="ec-btn ec-btn-cancel" id="ecCancel">Annuleren</button>
                <button class="ec-btn ec-btn-save"   id="ecSave">Opslaan</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // Oog-knoppen
    modal.querySelectorAll('.ec-eye-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const inp = document.getElementById(btn.dataset.target);
            if (!inp) return;
            const show = inp.type === 'password';
            inp.type = show ? 'text' : 'password';
            btn.querySelector('.ec-eye-open').style.display  = show ? 'none' : '';
            btn.querySelector('.ec-eye-closed').style.display = show ? '' : 'none';
        });
    });

    // Sluit acties
    const close = () => modal.remove();
    document.getElementById('ecClose').addEventListener('click', close);
    document.getElementById('ecCancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    // Focus op eerste input
    setTimeout(() => {
        (document.getElementById('ecReauthPw') || document.getElementById('ecNewVal'))?.focus();
    }, 60);

    // Opslaan
    document.getElementById('ecSave').addEventListener('click', () => saveField(field, label, isEmail, close));
}

async function saveField(field, label, isEmail, closeFn) {
    const saveBtn  = document.getElementById('ecSave');
    const errorEl  = document.getElementById('ecError');
    const newVal   = document.getElementById('ecNewVal')?.value.trim();

    errorEl.style.display = 'none';

    // Validatie
    if (!newVal) {
        showEcError(`Vul een ${label.toLowerCase()} in.`); return;
    }
    if (isEmail && !EMAIL_RE.test(newVal)) {
        showEcError('Voer een geldig e-mailadres in (bv. naam@voorbeeld.be).'); return;
    }
    if (!isEmail) {
        const digits = newVal.replace(/\D/g, '');
        if (!PHONE_RE.test(newVal) || digits.length < 8) {
            showEcError('Voer een geldig telefoonnummer in (bv. +32 471 23 45 67).'); return;
        }
    }

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Bezig…';

    try {
        if (isEmail) {
            const pw = document.getElementById('ecReauthPw')?.value;
            if (!pw) { showEcError('Vul je huidige wachtwoord in.'); saveBtn.disabled = false; saveBtn.textContent = 'Opslaan'; return; }

            const credential = EmailAuthProvider.credential(auth.currentUser.email, pw);
            await reauthenticateWithCredential(auth.currentUser, credential);
            await verifyBeforeUpdateEmail(auth.currentUser, newVal);

            // Sla het nieuwe adres op als pendingEmail — NIET als email.
            // Na verificatie detecteert onAuthStateChanged in auth.js het verschil
            // tussen auth.currentUser.email en Firestore email, en sync dan automatisch.
            const ref = await getEditDocRef();
            if (ref) await updateDoc(ref, { pendingEmail: newVal });

            closeFn();
            showProfileToast('📧 Verificatiemail verstuurd naar ' + newVal + '. Klik de link om te bevestigen, daarna log je opnieuw in.', 'success');

        } else {
            const ref = await getEditDocRef();
            if (ref) await updateDoc(ref, { telefoon: newVal });
            document.getElementById('infoTelefoon').textContent = newVal;
            // Herplaats edit-icoon
            addEditIcon('infoTelefoon', 'Telefoonnummer', 'telefoon');
            closeFn();
            showProfileToast('✅ Telefoonnummer bijgewerkt.', 'success');
        }
    } catch (err) {
        console.error('saveField error:', err);
        let msg = 'Fout: ' + err.message;
        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Huidig wachtwoord is onjuist.';
        else if (err.code === 'auth/email-already-in-use') msg = 'Dit e-mailadres is al in gebruik.';
        else if (err.code === 'auth/requires-recent-login') msg = 'Log opnieuw in en probeer opnieuw.';
        else if (err.code === 'auth/invalid-email') msg = 'Ongeldig e-mailadres.';
        showEcError(msg);
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Opslaan';
    }
}

function showEcError(msg) {
    const el = document.getElementById('ecError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
}

let _toastTimer;
function showProfileToast(msg, type = '') {
    let t = document.getElementById('profileToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'profileToast';
        t.style.cssText = 'position:fixed;bottom:1.75rem;right:1.75rem;max-width:340px;padding:0.85rem 1.2rem;border-radius:9px;font-size:0.88rem;font-weight:600;z-index:9999;transform:translateY(80px);opacity:0;transition:all 0.3s cubic-bezier(.34,1.56,.64,1);box-shadow:0 4px 16px rgba(0,0,0,.18);pointer-events:none;color:#fff;';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'success' ? '#28A745' : type === 'error' ? '#DC3545' : '#1a1a1a';
    t.style.transform  = 'translateY(0)';
    t.style.opacity    = '1';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.style.transform = 'translateY(80px)'; t.style.opacity = '0'; }, 5000);
}
