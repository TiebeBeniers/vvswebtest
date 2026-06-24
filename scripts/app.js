// ===============================================
// HOMEPAGE FUNCTIONALITY - WITH LIVE OVERLAY
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, getDocs, doc, updateDoc, addDoc, setDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { checkAndShowWrapped } from './vvs-wrapped.js';
import { applyLogoFromCache }  from './vvs-logo.js';

// ── Logo: laad snel vanuit cache, async Firestore-check via vvs-logo.js ───────
if (!applyLogoFromCache()) {
    // Eerste keer op deze sessie: vvs-logo.js doet de Firestore-check via zijn
    // eigen IIFE — niets extra nodig hier.
}

console.log('App.js loaded (with live overlay)');

// ── Tijdelijke cache helpers (localStorage + TTL) ────────────────────────────
const CACHE_TTL = {
    profile: 10 * 60 * 1000,   // 10 min
};

const _PAGE_REFRESHED = (() => {
    try {
        const nav = performance.getEntriesByType?.('navigation')?.[0];
        if (nav?.type === 'reload') {
            if (!sessionStorage.getItem('vvs_app_refreshed')) {
                sessionStorage.setItem('vvs_app_refreshed', '1');
                return true;
            }
        } else {
            sessionStorage.removeItem('vvs_app_refreshed');
        }
    } catch (_) {}
    return false;
})();

function tcGet(key, ttl) {
    if (_PAGE_REFRESHED) return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
        return data;
    } catch (_) { return null; }
}

function tcSet(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) { /* quota / privé-modus */ }
}



// ── Config ────────────────────────────────────────────────────────────────────
// How many minutes after the scheduled kick-off does a planned match stay visible
// as "bezig" even without live tracking.
const MATCH_VISIBLE_WINDOW_MINUTES = 150;

// Within how many minutes of kick-off does the designated person get
// "real" start time (serverTimestamp). After this threshold the scheduled
// time is used as startedAt so the timer reflects the actual match time.
const START_LATE_THRESHOLD_MINUTES = 10;

// ── Carousel ──────────────────────────────────────────────────────────────────

let currentSlide = 0;
const slides = document.querySelectorAll('.carousel-slide');
const dots = document.querySelectorAll('.dot');
let carouselInterval;

function showSlide(index) {
    if (slides.length === 0) return;
    slides.forEach(slide => slide.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));
    if (index >= slides.length) currentSlide = 0;
    if (index < 0) currentSlide = slides.length - 1;
    slides[currentSlide].classList.add('active');
    if (dots[currentSlide]) dots[currentSlide].classList.add('active');
}

function nextSlide() { currentSlide++; showSlide(currentSlide); }
function startCarousel() { carouselInterval = setInterval(nextSlide, 12000); }
function stopCarousel() { if (carouselInterval) clearInterval(carouselInterval); }

if (dots.length > 0) {
    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            currentSlide = index;
            showSlide(currentSlide);
            stopCarousel();
            startCarousel();
        });
    });
}

if (slides.length > 0) {
    startCarousel();

    const carouselContainer = document.querySelector('.carousel-container');
    if (carouselContainer) {
        let touchStartX = 0, touchEndX = 0, touchStartY = 0, touchEndY = 0;

        carouselContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        carouselContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            handleSwipe();
        }, { passive: true });

        function handleSwipe() {
            const dx = touchEndX - touchStartX;
            const dy = Math.abs(touchEndY - touchStartY);
            if (dy >= 100) return;
            if (dx > 50) {
                currentSlide--;
                if (currentSlide < 0) currentSlide = slides.length - 1;
                showSlide(currentSlide); stopCarousel(); startCarousel();
            } else if (dx < -50) {
                currentSlide++;
                if (currentSlide >= slides.length) currentSlide = 0;
                showSlide(currentSlide); stopCarousel(); startCarousel();
            }
        }
    }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

let currentUser = null;
let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');

    if (user) {
        currentUser = user;
        try {
            // Cache user role: 10 min (rol verandert zelden midden in een sessie)
            const _rKey = `user_role_${user.uid}`;
            let _rData   = tcGet(_rKey, CACHE_TTL.profile);
            if (!_rData) {
                const _uSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
                _rData = _uSnap.empty ? null : _uSnap.docs[0].data();
                if (_rData) tcSet(_rKey, _rData);
            }
            const userDoc = { empty: !_rData, docs: _rData ? [{ data: () => _rData }] : [] };
            if (!userDoc.empty) {
                currentUserData = userDoc.docs[0].data();
                if (loginLink) loginLink.textContent = 'PROFIEL';
                // VVS Wrapped: toon als admin het heeft ingeschakeld
                checkAndShowWrapped(user, currentUserData);
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    } else {
        currentUser = null;
        currentUserData = null;
        if (loginLink) loginLink.textContent = 'LOGIN';
    }

    checkForLiveMatches();
});

// ── Live / Bezig overlay ──────────────────────────────────────────────────────

let liveMatchListener   = null;
let plannedMatchPoller  = null;   // interval that re-checks planned matches every 30s
let liveOverlayUpdateInterval = null;
let currentLiveMatch = null;

// The planned match currently shown as "bezig" (no live tracking)
let currentBezigMatch = null;

function checkForLiveMatches() {
    const liveOverlay = document.getElementById('liveMatchOverlay');
    if (!liveOverlay) { console.error('Live overlay element not found'); return; }

    if (liveMatchListener) liveMatchListener();

    const liveMatchesQuery = query(
        collection(db, 'matches'),
        where('status', 'in', ['live', 'rust'])
    );

    liveMatchListener = onSnapshot(liveMatchesQuery, (snapshot) => {
        if (!snapshot.empty) {
            // ── Echte live wedstrijd ──────────────────────────────────────
            const matchData = snapshot.docs[0].data();
            const matchId   = snapshot.docs[0].id;
            currentLiveMatch  = { id: matchId, ...matchData };
            currentBezigMatch = null;

            stopPlannedMatchPoller();
            liveOverlay.style.display = 'flex';

            const startMatchContainer = document.getElementById('startMatchContainer');
            if (startMatchContainer) startMatchContainer.style.display = 'none';

            showLiveOverlay(currentLiveMatch);
            startLiveOverlayUpdate();

        } else {
            // ── Geen live wedstrijd ───────────────────────────────────────
            currentLiveMatch = null;
            stopLiveOverlayUpdate();

            // Check for a planned match that should be shown as "bezig"
            checkBezigMatch();

            // Poll every 30 s so the overlay appears/disappears at the right moment
            startPlannedMatchPoller();

            // Start-button for designated person
            if (currentUser && currentUserData) checkForStartMatch();
        }
    });
}

// ── "Bezig" check (planned match within its window) ──────────────────────────

async function checkBezigMatch() {
    const liveOverlay = document.getElementById('liveMatchOverlay');
    if (!liveOverlay) return;

    const now = new Date();

    try {
        const snap = await getDocs(query(
            collection(db, 'matches'),
            where('status', '==', 'planned')
        ));

        let bezigMatch = null;

        snap.forEach(docSnap => {
            const d = docSnap.data();
            const matchTime = new Date(`${d.datum}T${d.uur}`);
            const windowEnd = new Date(matchTime.getTime() + MATCH_VISIBLE_WINDOW_MINUTES * 60 * 1000);

            if (now >= matchTime && now <= windowEnd) {
                bezigMatch = { id: docSnap.id, ...d };
            }
        });

        if (bezigMatch) {
            currentBezigMatch = bezigMatch;
            liveOverlay.style.display = 'flex';
            showBezigOverlay(bezigMatch);
        } else {
            currentBezigMatch = null;
            liveOverlay.style.display = 'none';
        }

    } catch (err) {
        console.error('Error checking bezig match:', err);
    }
}

function startPlannedMatchPoller() {
    stopPlannedMatchPoller();
    plannedMatchPoller = setInterval(() => {
        // Only re-check when there's no real live match
        if (!currentLiveMatch) checkBezigMatch();
    }, 30_000);
}

function stopPlannedMatchPoller() {
    if (plannedMatchPoller) { clearInterval(plannedMatchPoller); plannedMatchPoller = null; }
}

// ── Overlay renderers ─────────────────────────────────────────────────────────

/**
 * Show the overlay for a genuinely live/rust match — full details.
 */
function showLiveOverlay(match) {
    const liveBadge      = document.getElementById('liveBadge');
    const overlayHomeTeam = document.getElementById('overlayHomeTeam');
    const overlayAwayTeam = document.getElementById('overlayAwayTeam');
    const overlayHomeScore = document.getElementById('overlayHomeScore');
    const overlayAwayScore = document.getElementById('overlayAwayScore');
    const overlayTime    = document.getElementById('overlayTime');
    const overlayScoreSep = document.getElementById('overlayScoreSeparator'); // optional

    if (!liveBadge || !overlayHomeTeam) return;

    const watchBtn = document.getElementById('overlayWatchBtn');

    // Badge
    if (match.status === 'rust') {
        liveBadge.textContent = 'RUST';
        liveBadge.className   = 'live-badge rust';
    } else if (match.extraTimeStarted) {
        liveBadge.textContent = 'VERL.';
        liveBadge.className   = 'live-badge live';
    } else {
        liveBadge.textContent = 'LIVE';
        liveBadge.className   = 'live-badge live';
    }

    overlayHomeTeam.textContent = match.thuisploeg;
    overlayAwayTeam.textContent = match.uitploeg;

    // Score — always show real numbers for live matches
    if (overlayHomeScore) overlayHomeScore.textContent = match.scoreThuis ?? 0;
    if (overlayAwayScore) overlayAwayScore.textContent = match.scoreUit   ?? 0;
    if (overlayScoreSep)  overlayScoreSep.textContent  = '-';

    if (overlayTime) overlayTime.textContent = calculateDisplayTime(match);

    // Knop tonen — dit is een echte live wedstrijd
    if (watchBtn) watchBtn.style.display = '';
}

/**
 * Show the overlay for a planned match that has started but isn't tracked live.
 * No score, no timer — just the teams and a neutral badge.
 */
function showBezigOverlay(match) {
    const liveBadge       = document.getElementById('liveBadge');
    const overlayHomeTeam = document.getElementById('overlayHomeTeam');
    const overlayAwayTeam = document.getElementById('overlayAwayTeam');
    const overlayHomeScore = document.getElementById('overlayHomeScore');
    const overlayAwayScore = document.getElementById('overlayAwayScore');
    const overlayTime     = document.getElementById('overlayTime');
    const overlayScoreSep = document.getElementById('overlayScoreSeparator');

    if (!liveBadge || !overlayHomeTeam) return;

    liveBadge.textContent = 'BEZIG';
    liveBadge.className   = 'live-badge bezig';

    overlayHomeTeam.textContent = match.thuisploeg;
    overlayAwayTeam.textContent = match.uitploeg;

    // Score unknown — show dashes
    if (overlayHomeScore) overlayHomeScore.textContent = '–';
    if (overlayAwayScore) overlayAwayScore.textContent = '–';
    if (overlayScoreSep)  overlayScoreSep.textContent  = '-';

    // No timer for bezig matches
    if (overlayTime) overlayTime.textContent = '';

    // Knop verbergen — geen live data beschikbaar
    const watchBtn = document.getElementById('overlayWatchBtn');
    if (watchBtn) watchBtn.style.display = 'none';
}

// ── Live timer (phase-aware, mirrors live.js logic) ───────────────────────────

function calculateDisplayTime(match) {
    if (!match.startedAt) return "0'";

    try {
        const phase    = match.phase || 1;
        const halfTime = match.team === 'veteranen' ? 35 : 45;
        const fullTime = halfTime * 2;
        const ET_HALF  = 15;

        const frozen = match.status === 'rust' && match.pausedAt;
        const now    = frozen ? match.pausedAt.toMillis() : Date.now();

        let startMs;
        if (phase === 1) {
            startMs = match.startedAt.toMillis();
        } else if (phase === 2) {
            startMs = match.resumeStartedAt?.toMillis();
        } else if (phase === 3) {
            startMs = match.etStartedAt?.toMillis();
        } else {
            startMs = match.etResumeStartedAt?.toMillis();
        }
        if (!startMs) return "0'";

        const elapsedSeconds = Math.max(0, Math.floor((now - startMs) / 1000));
        const mins = Math.floor(elapsedSeconds / 60);

        if (phase === 1) {
            return mins < halfTime ? `${mins}'` : `${halfTime}+${mins - halfTime}'`;
        }
        if (phase === 2) {
            if (match.status === 'rust' && !match.resumeStartedAt) return `${halfTime}'`;
            const d = halfTime + mins;
            return d < fullTime ? `${d}'` : `${fullTime}+${d - fullTime}'`;
        }
        if (phase === 3) {
            if (match.status === 'rust' && !match.etStartedAt) return `${fullTime}'`;
            const d = fullTime + mins;
            const etEnd = fullTime + ET_HALF;
            return d < etEnd ? `${d}'` : `${etEnd}+${d - etEnd}'`;
        }
        // phase 4
        if (match.status === 'rust' && !match.etResumeStartedAt) return `${fullTime + ET_HALF}'`;
        const d    = fullTime + ET_HALF + mins;
        const end  = fullTime + ET_HALF * 2;
        return d < end ? `${d}'` : `${end}+${d - end}'`;

    } catch (err) {
        console.error('Error calculating display time:', err);
        return "0'";
    }
}

function startLiveOverlayUpdate() {
    stopLiveOverlayUpdate();
    liveOverlayUpdateInterval = setInterval(() => {
        if (currentLiveMatch) showLiveOverlay(currentLiveMatch);
    }, 1000);
}

function stopLiveOverlayUpdate() {
    if (liveOverlayUpdateInterval) {
        clearInterval(liveOverlayUpdateInterval);
        liveOverlayUpdateInterval = null;
    }
}

// ── Start match (for designated persons) ─────────────────────────────────────

async function checkForStartMatch() {
    const container = document.getElementById('startMatchContainer');
    if (!container) return;

    if (!currentUser || !currentUserData) {
        container.style.display = 'none';
        return;
    }

    const isBestuurslid  = currentUserData.categorie === 'bestuurslid'
        || (currentUserData.rol || '') === 'bestuurslid';
    // Spelers met 'score_invullen'-recht of tijdelijk account met score_invullen kunnen wedstrijd starten
    const heeftWedstrijdRecht = (currentUserData.rechten || []).includes('score_invullen')
        || (currentUserData.rol === 'tijdelijk' && (currentUserData.toegang || []).includes('score_invullen'));
    const now = new Date();
    // Window: from 24u before match kick-off, until end of match day
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    try {
        const snap = await getDocs(query(
            collection(db, 'matches'),
            where('status', '==', 'planned')
        ));

        // Grace period: toon lineup/start-knop ook tot START_LATE_THRESHOLD_MINUTES na geplande aftrap
        const graceCutoff = new Date(now.getTime() - START_LATE_THRESHOLD_MINUTES * 60 * 1000);

        let todayMatch = null;

        snap.forEach(docSnap => {
            const d             = docSnap.data();
            const matchDateTime = new Date(`${d.datum}T${d.uur}`);
            const isDesignated  = d.aangeduidePersonen?.includes(currentUser.uid);

            // Match moet binnen de volgende 24 uur vallen OF binnen de grace period liggen
            if ((isBestuurslid || isDesignated || heeftWedstrijdRecht) && matchDateTime <= in24Hours && matchDateTime >= graceCutoff) {
                // Kies de eerstvolgende kwalificerende wedstrijd
                if (!todayMatch || matchDateTime < new Date(`${todayMatch.datum}T${todayMatch.uur}`)) {
                    todayMatch = { id: docSnap.id, ...d };
                }
            }
        });

        if (!todayMatch) {
            container.style.display = 'none';
            return;
        }

        const matchDateTime  = new Date(`${todayMatch.datum}T${todayMatch.uur}`);
        const graceEnd       = new Date(matchDateTime.getTime() + START_LATE_THRESHOLD_MINUTES * 60 * 1000);
        const pastGraceWindow = now > graceEnd;

        // Na de grace period alles verbergen — de match had al gestart moeten zijn
        if (pastGraceWindow) {
            container.style.display = 'none';
            return;
        }

        const thirtyBefore  = new Date(matchDateTime.getTime() - 30 * 60 * 1000);
        const inStartWindow = now >= thirtyBefore; // tot 10 min na aftrap (grace period bewaakt de bovengrens)
        const lineupSaved   = !!todayMatch.lineupDraftConfirmed;

        container.style.display = 'flex';

        // ── Build the right button set ────────────────────────────────────
        if (!lineupSaved) {
            // State 1: lineup not yet confirmed — show only "Line-up selecteren"
            container.innerHTML = `
                <button class="start-match-btn" id="lineupSelectBtn">
                    Line-up selecteren
                </button>`;
            document.getElementById('lineupSelectBtn').onclick = () => openLineupForDraft(todayMatch);

        } else if (inStartWindow) {
            // State 3: lineup confirmed + within 30-min window — show start + wijzig
            container.innerHTML = `
                <div class="start-match-btn-group">
                    <button class="start-match-btn" id="startMatchBtn">
                        ▶ Start wedstrijd
                    </button>
                    <button class="wijzig-lineup-btn" id="wijzigLineupBtn">
                        <img src="assets/edit.png" class="icon" alt=""> Wijzig lineup
                    </button>
                </div>`;
            document.getElementById('startMatchBtn').onclick   = () => confirmStartMatch(todayMatch);
            document.getElementById('wijzigLineupBtn').onclick = () => openLineupForDraft(todayMatch, true);

        } else {
            // State 2: lineup confirmed but not yet in start window — show only wijzig
            container.innerHTML = `
                <div class="start-match-btn-group">
                    <div class="lineup-saved-badge">✓ Opstelling opgeslagen</div>
                    <button class="wijzig-lineup-btn" id="wijzigLineupBtn">
                        <img src="assets/edit.png" class="icon" alt=""> Wijzig lineup
                    </button>
                </div>`;
            document.getElementById('wijzigLineupBtn').onclick = () => openLineupForDraft(todayMatch, true);
        }

    } catch (err) {
        console.error('Error checking for start match:', err);
    }
}

// ── Confirmation before actually starting ────────────────────────────────────

function confirmStartMatch(matchData) {
    let confirmModal = document.getElementById('startMatchConfirmModal');
    if (!confirmModal) {
        confirmModal = document.createElement('div');
        confirmModal.id        = 'startMatchConfirmModal';
        confirmModal.className = 'modal';
        confirmModal.innerHTML = `
            <div class="modal-content">
                <h3>Wedstrijd starten?</h3>
                <p style="margin-bottom:1.5rem;color:var(--text-gray);">
                    De wedstrijd wordt live gezet en je wordt doorgestuurd naar de live pagina.
                    Dit kan niet ongedaan worden gemaakt.
                </p>
                <div class="modal-actions">
                    <button class="modal-btn cancel" id="startConfirmCancel">Annuleren</button>
                    <button class="modal-btn confirm" id="startConfirmOk">▶ Ja, start!</button>
                </div>
            </div>`;
        document.body.appendChild(confirmModal);
        document.getElementById('startConfirmCancel').addEventListener('click', () => {
            confirmModal.classList.remove('active');
        });
        confirmModal.addEventListener('click', e => {
            if (e.target === confirmModal) confirmModal.classList.remove('active');
        });
    }

    // Wire confirm button fresh each time
    const okBtn = document.getElementById('startConfirmOk');
    okBtn.onclick = async () => {
        okBtn.disabled    = true;
        okBtn.textContent = 'Bezig...';
        confirmModal.classList.remove('active');
        await finalizeMatchStart(matchData);
    };

    confirmModal.classList.add('active');
}

// ── Lineup modal ──────────────────────────────────────────────────────────────

let lineupMatchData        = null;
let lineupAvailablePlayers = [];

/**
 * Open the lineup modal in "draft" mode.
 * @param {Object}  matchData  - the match object
 * @param {boolean} isEdit     - true when editing an already-saved draft
 */
async function openLineupForDraft(matchData, isEdit = false) {
    lineupMatchData = matchData;

    try {
        const snap = await getDocs(collection(db, 'matches', matchData.id, 'availability'));
        lineupAvailablePlayers = [];
        snap.forEach(d => {
            if (d.data().available) {
                lineupAvailablePlayers.push({ uid: d.id, name: d.data().displayName || d.id });
            }
        });
        lineupAvailablePlayers.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
        showToast('Fout bij laden spelers: ' + e.message, 'error');
        return;
    }

    // Pre-load saved starters + subs when editing
    const savedStarters = new Set();
    const savedSubs     = new Set();
    if (isEdit && matchData.lineupDraft) {
        Object.entries(matchData.lineupDraft).forEach(([uid, info]) => {
            if (info.status === 'starter') savedStarters.add(uid);
            else if (info.status === 'bench') savedSubs.add(uid);
        });
    }

    openLineupModal(savedStarters, savedSubs);
}

function openLineupModal(initialStarters = new Set(), initialSubs = new Set()) {
    let modal = document.getElementById('lineupModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id        = 'lineupModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content lineup-modal-content">
                <h3>Opstelling Aanduiden</h3>
                <p class="lineup-subtitle">
                    Verdeel de aanwezige spelers over <strong>Basis</strong> (exact 11) en
                    <strong>Wisselspelers</strong> (max 5). Spelers die niet geselecteerd worden
                    komen niet in aanmerking tijdens de wedstrijd en krijgen geen statistieken.
                </p>

                <div class="lineup-columns lineup-columns-3">

                    <!-- Kolom 1: niet geselecteerd -->
                    <div class="lineup-col">
                        <div class="lineup-col-header lineup-col-header--avail">
                            <span class="lineup-col-icon">👥</span>
                            <h4>Aanwezig</h4>
                            <span class="lineup-col-badge" id="lineupAvailCount">0</span>
                        </div>
                        <div id="lineupAvailList" class="lineup-list"></div>
                        <p class="lineup-col-sub">Klik om te plaatsen</p>
                    </div>

                    <!-- Kolom 2: basisspelers -->
                    <div class="lineup-col">
                        <div class="lineup-col-header lineup-col-header--start">
                            <span class="lineup-col-icon">⚽</span>
                            <h4>Basis</h4>
                            <span class="lineup-col-badge" id="lineupStartCount">0</span>
                            <span class="lineup-col-max">/11</span>
                        </div>
                        <div id="lineupStartList" class="lineup-list starter-list"></div>
                        <p class="lineup-col-sub">Exact 11 spelers</p>
                    </div>

                    <!-- Kolom 3: wisselspelers -->
                    <div class="lineup-col">
                        <div class="lineup-col-header lineup-col-header--sub">
                            <span class="lineup-col-icon">🔄</span>
                            <h4>Wisselspelers</h4>
                            <span class="lineup-col-badge" id="lineupSubCount">0</span>
                            <span class="lineup-col-max">/5</span>
                        </div>
                        <div id="lineupSubList" class="lineup-list sub-list"></div>
                        <p class="lineup-col-sub">Max 5 wisselspelers</p>
                    </div>
                </div>

                <div class="lineup-hint" id="lineupHint">Selecteer 11 basisspelers.</div>
                <div class="lineup-actions">
                    <button class="modal-btn cancel" id="lineupCancelBtn">Annuleren</button>
                    <button class="modal-btn confirm" id="lineupConfirmBtn" disabled>Bevestigen</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('lineupCancelBtn').addEventListener('click', () => {
            modal.classList.remove('active');
        });
        modal.addEventListener('click', e => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }

    renderLineupModal(modal, initialStarters, initialSubs);
    modal.classList.add('active');
}

// Cycle: avail → starter → sub → avail
function getNextStatus(uid, starters, subs) {
    if (starters.has(uid)) return 'sub';
    if (subs.has(uid)) return 'avail';
    return 'starter';
}

function renderLineupModal(modal, initialStarters = new Set(), initialSubs = new Set()) {
    const availList  = modal.querySelector('#lineupAvailList');
    const startList  = modal.querySelector('#lineupStartList');
    const subList    = modal.querySelector('#lineupSubList');
    const confirmBtn = modal.querySelector('#lineupConfirmBtn');
    const availCount = modal.querySelector('#lineupAvailCount');
    const startCount = modal.querySelector('#lineupStartCount');
    const subCount   = modal.querySelector('#lineupSubCount');
    const hintEl     = modal.querySelector('#lineupHint');

    const MAX_START = 11;
    const MIN_START = 7;
    const MAX_SUBS  = 5;

    const starters = new Set(initialStarters);
    const subs     = new Set(initialSubs);

    function refresh() {
        availList.innerHTML = '';
        startList.innerHTML = '';
        subList.innerHTML   = '';

        const sc = starters.size;
        const bc = subs.size;
        const ac = lineupAvailablePlayers.length - sc - bc;

        if (availCount) availCount.textContent = ac;
        if (startCount) startCount.textContent = sc;
        if (subCount)   subCount.textContent   = bc;

        const startFull = sc >= MAX_START;
        const subFull   = bc >= MAX_SUBS;
        const valid     = sc === MAX_START;

        if (confirmBtn) confirmBtn.disabled = !valid;

        if (hintEl) {
            if (sc < MIN_START)
                hintEl.textContent = `Voeg nog ${MIN_START - sc} basisspeler(s) toe (minimum).`;
            else if (sc < MAX_START)
                hintEl.textContent = `Voeg nog ${MAX_START - sc} basisspeler(s) toe.`;
            else if (bc === 0)
                hintEl.textContent = `✓ Basis volledig. Voeg optioneel wisselspelers toe.`;
            else
                hintEl.textContent = `✓ Klaar — ${sc} basis, ${bc} wissel${bc !== 1 ? 's' : ''}.`;
            hintEl.style.color = valid ? 'var(--success, #28a745)' : 'var(--text-gray, #666)';
        }

        lineupAvailablePlayers.forEach(p => {
            const isStarter = starters.has(p.uid);
            const isSub     = subs.has(p.uid);
            const isAvail   = !isStarter && !isSub;

            const btn = document.createElement('button');
            btn.textContent = p.name;

            if (isStarter) {
                btn.className = 'lineup-player-btn lineup-player-btn--starter';
                btn.title     = 'Klik: verplaats naar wisselbank';
                startList.appendChild(btn);
            } else if (isSub) {
                btn.className = 'lineup-player-btn lineup-player-btn--sub';
                btn.title     = 'Klik: terugplaatsen naar beschikbaar';
                subList.appendChild(btn);
            } else {
                btn.className = 'lineup-player-btn';
                btn.title     = startFull
                    ? (subFull ? 'Basis en bank zijn vol' : 'Klik: voeg toe als wisselspeler')
                    : 'Klik: voeg toe aan basis';
                if (startFull && subFull) btn.disabled = true;
                availList.appendChild(btn);
            }

            btn.addEventListener('click', () => {
                if (isStarter) {
                    // starter → sub (als sub niet vol) anders → avail
                    starters.delete(p.uid);
                    if (subs.size < MAX_SUBS) subs.add(p.uid);
                } else if (isSub) {
                    // sub → avail
                    subs.delete(p.uid);
                } else {
                    // avail: eerst proberen basis te vullen, daarna bank
                    if (!startFull) {
                        starters.add(p.uid);
                    } else if (!subFull) {
                        subs.add(p.uid);
                    }
                }
                refresh();
            });
        });
    }

    refresh();

    confirmBtn.textContent = 'Bevestigen';
    confirmBtn.onclick = async () => {
        if (starters.size !== MAX_START) return;
        confirmBtn.disabled    = true;
        confirmBtn.textContent = 'Opslaan...';

        try {
            const lineupDraft = {};
            lineupAvailablePlayers.forEach(p => {
                let status = 'niet_geselecteerd';
                if (starters.has(p.uid)) status = 'starter';
                else if (subs.has(p.uid)) status = 'bench';
                lineupDraft[p.uid] = { name: p.name, status };
            });

            await updateDoc(doc(db, 'matches', lineupMatchData.id), {
                lineupDraft,
                lineupDraftConfirmed: true
            });

            lineupMatchData.lineupDraft          = lineupDraft;
            lineupMatchData.lineupDraftConfirmed = true;

            modal.classList.remove('active');
            await checkForStartMatch();

        } catch (e) {
            showToast('Fout bij opslaan opstelling: ' + e.message, 'error');
            confirmBtn.disabled    = false;
            confirmBtn.textContent = 'Bevestigen';
        }
    };
}

async function finalizeMatchStart(matchData) {
    try {
        const matchRef = doc(db, 'matches', matchData.id);

        // Use the saved draft lineup
        const lineup = matchData.lineupDraft || {};
        if (Object.keys(lineup).length === 0) {
            showToast('Geen opgeslagen opstelling gevonden', 'error');
            return;
        }

        const starterUids = new Set(
            Object.entries(lineup)
                .filter(([, info]) => info.status === 'starter')
                .map(([uid]) => uid)
        );

        const scheduledTime = new Date(`${matchData.datum}T${matchData.uur}`);
        const now           = new Date();
        const lateMinutes   = (now.getTime() - scheduledTime.getTime()) / 60_000;
        const startedAt     = lateMinutes > START_LATE_THRESHOLD_MINUTES
            ? Timestamp.fromDate(scheduledTime)
            : Timestamp.fromDate(now);

        await updateDoc(matchRef, {
            status:            'live',
            startedAt,
            scoreThuis:        0,
            scoreUit:          0,
            phase:             1,
            halfTimeReached:   false,
            extraTimeStarted:  false,
            etHalfTimeReached: false,
            pausedAt:          null,
            resumeStartedAt:   null,
            etStartedAt:       null,
            etResumeStartedAt: null,
            lineupConfirmed:   true,
            lineup,
        });

        // Write playerMinutes for starters
        const minutePromises = [];
        for (const [uid, info] of Object.entries(lineup)) {
            if (info.status === 'starter') {
                minutePromises.push(
                    setDoc(doc(db, 'matches', matchData.id, 'playerMinutes', uid), {
                        uid, name: info.name, minuteOn: 0, minuteOff: null
                    })
                );
            }
        }
        await Promise.all(minutePromises);

        await addDoc(collection(db, 'events'), {
            matchId:   matchData.id,
            minuut:    0,
            half:      1,
            type:      'aftrap',
            ploeg:     'center',
            speler:    '',
            timestamp: serverTimestamp()
        });

        window.location.href = 'live.html';

    } catch (e) {
        console.error('Error finalizing match start:', e);
        showToast('Fout bij starten wedstrijd: ' + e.message, 'error');
        // Re-enable start button if something went wrong
        await checkForStartMatch();
    }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
    if (liveMatchListener) liveMatchListener();
    stopPlannedMatchPoller();
    stopCarousel();
    stopLiveOverlayUpdate();
});

console.log('App.js initialization complete');

// ── Toast ────────────────────────────────────────────────────────────────────
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