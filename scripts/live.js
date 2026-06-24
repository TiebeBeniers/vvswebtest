// ===============================================
// LIVE MATCH PAGE - V.V.S Rotselaar
// ===============================================
// Phase system:
//   phase 1 = 1e helft reguliere tijd
//   phase 2 = 2e helft reguliere tijd
//   phase 3 = 1e helft verlengingen (ET)
//   phase 4 = 2e helft verlengingen (ET)
//
// Match status: 'live' | 'rust' | 'finished'
//
// NEW: Lineup & minute-tracking fields on match doc:
//   lineup          { uid: { name, status } }
//                   status: 'starter' | 'bench' | 'out'
//   lineupConfirmed bool   – set to true after lineup step
//
// Player minute tracking stored per-match in:
//   matches/{matchId}/playerMinutes/{uid}
//     { uid, name, minuteOn, minuteOff (null if still on) }
//
// On match end, for every VVS player with uid we update their
// users doc with cumulative stats (goals, assists, geelKaarten,
// roodKaarten, matchen, minuten).
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, query, where, onSnapshot, getDocs,
    doc, getDoc, updateDoc, addDoc, setDoc, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Live.js loaded (with lineup + stat tracking)');

// ── Global state ──────────────────────────────────────────────────────────────

let currentUser     = null;
let currentUserData = null;
let currentMatch    = null;
let currentMatchId  = null;
let matchListener   = null;
let eventsListener  = null;
let displayInterval = null;
let hasAccess       = false;

// All players who marked available for this match
// { uid, name, isExternal }
let availablePlayers = [];
let playerUidMap = {}; // name → uid, built from availablePlayers

// Current active lineup:
//   activePlayers  — on the pitch right now (selectable for goals etc.)
//   benchPlayers   — on bench (selectable for cards + sub-in)
//   outPlayers     — subbed off (not selectable for goals; selectable for cards)
let activePlayers = [];
let benchPlayers  = [];
let outPlayers    = [];

// Which side VVS plays: 'home' | 'away'
let vvsSide = 'home';

// Yellow card counts per player name, rebuilt from events
let yellowCardCounts = {};

const ET_HALF_DURATION = 15;

// ── Auth ──────────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    if (user) {
        currentUser = user;
        try {
            const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
            if (!snap.empty) {
                currentUserData = snap.docs[0].data();
                if (loginLink) loginLink.textContent = 'PROFIEL';
            }
        } catch (e) { console.error('Error loading user data:', e); }
    } else {
        currentUser = null;
        currentUserData = null;
        if (loginLink) loginLink.textContent = 'LOGIN';
    }
    loadLiveMatch();
});

// ── Load live match ───────────────────────────────────────────────────────────

async function loadLiveMatch() {
    try {
        const snap = await getDocs(query(
            collection(db, 'matches'),
            where('status', 'in', ['live', 'rust'])
        ));
        if (snap.empty) {
            showNoMatchState();
            return;
        }

        currentMatchId = snap.docs[0].id;
        currentMatch   = snap.docs[0].data();

        checkAccess();
        setupMatchListener();
        setupEventsListener();
        updateMatchDisplay();
        startDisplayInterval();

        if (hasAccess) {
            await loadAvailablePlayers();
        }
    } catch (e) {
        console.error('Error loading live match:', e);
        showToast('Fout bij laden wedstrijd: ' + e.message, 'error');
    }
}

function checkAccess() {
    const panel = document.getElementById('controlPanel');
    if (!currentUser || !currentUserData || !currentMatch) {
        hasAccess = false;
        if (panel) panel.style.display = 'none';
        return;
    }
    const isBestuurslid      = currentUserData.categorie === 'bestuurslid'
        || (currentUserData.rol || '') === 'bestuurslid';
    const isDesignated       = currentMatch.aangeduidePersonen?.includes(currentUser.uid);
    // Spelers met 'score_invullen'-recht of tijdelijk account met score_invullen hebben toegang
    const heeftWedstrijdRecht = (currentUserData.rechten || []).includes('score_invullen')
        || (currentUserData.rol === 'tijdelijk' && (currentUserData.toegang || []).includes('score_invullen'));
    hasAccess = isBestuurslid || isDesignated || heeftWedstrijdRecht;
    if (hasAccess) {
        if (panel) panel.style.display = 'block';
        setupControlButtons();
    } else {
        if (panel) panel.style.display = 'none';
    }
}

// ── Load available players ────────────────────────────────────────────────────

async function loadAvailablePlayers() {
    if (!currentMatchId) return;
    try {
        const snap = await getDocs(collection(db, 'matches', currentMatchId, 'availability'));
        availablePlayers = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.available) {
                availablePlayers.push({
                    uid:        d.id,
                    name:       data.displayName || d.id,
                    isExternal: !!data.isExternalPlayer
                });
            }
        });
        availablePlayers.sort((a, b) => a.name.localeCompare(b.name));

        // Build name→uid map — alleen spelers MET een echt account (geen externe, geen manual_)
        playerUidMap = {};
        availablePlayers.forEach(p => {
            if (p.uid && p.name && !p.isExternal && !p.uid.startsWith('manual_')) playerUidMap[p.name] = p.uid;
        });

        // Determine VVS side
        const thuisploeg = (currentMatch?.thuisploeg || '').toLowerCase();
        vvsSide = thuisploeg.includes('rotselaar') ? 'home' : 'away';

        // If lineup already confirmed, rebuild active/bench/out from match.lineup
        if (currentMatch.lineupConfirmed && currentMatch.lineup) {
            rebuildLineupFromMatch();
        }

        console.log('Available players:', availablePlayers.length, '| VVS side:', vvsSide);
    } catch (e) { console.error('Error loading players:', e); }
}

// Rebuild the three player arrays from the saved lineup on the match doc
function rebuildLineupFromMatch() {
    activePlayers = [];
    benchPlayers  = [];
    outPlayers    = [];
    const lineup = currentMatch.lineup || {};
    for (const [uid, info] of Object.entries(lineup)) {
        // Spelers die niet geselecteerd zijn (geen starter/bench) worden volledig genegeerd
        if (info.status === 'niet_geselecteerd') continue;
        const p = { uid, name: info.name };
        if (info.status === 'starter') activePlayers.push(p);
        else if (info.status === 'bench') benchPlayers.push(p);
        else if (info.status === 'out') outPlayers.push(p);
    }
    activePlayers.sort((a, b) => a.name.localeCompare(b.name));
    benchPlayers.sort((a, b) => a.name.localeCompare(b.name));
}
// ── Real-time listeners ───────────────────────────────────────────────────────

function setupMatchListener() {
    if (matchListener) matchListener();
    matchListener = onSnapshot(doc(db, 'matches', currentMatchId), snap => {
        if (snap.exists()) {
            currentMatch = snap.data();
            // Sync lineup arrays whenever match updates
            if (currentMatch.lineupConfirmed && currentMatch.lineup) {
                rebuildLineupFromMatch();
            }
            updateMatchDisplay();
            updateControlButtonStates();
        }
    });
}

function setupEventsListener() {
    if (eventsListener) eventsListener();
    eventsListener = onSnapshot(
        query(collection(db, 'events'), where('matchId', '==', currentMatchId)),
        snap => {
            const counts = {};
            snap.forEach(d => {
                const ev = d.data();
                if ((ev.type === 'yellow' || ev.type === 'yellow2red') && ev.speler) {
                    counts[ev.speler] = (counts[ev.speler] || 0) + 1;
                }
            });
            yellowCardCounts = counts;
            loadTimeline(snap);
        }
    );
}

// ── Time calculation ──────────────────────────────────────────────────────────

function getRegularHalfDuration() {
    return currentMatch?.team === 'veteranen' ? 35 : 45;
}

function calculateElapsedSeconds() {
    if (!currentMatch?.startedAt) return 0;
    const phase  = currentMatch.phase || 1;
    const frozen = currentMatch.status === 'rust' && currentMatch.pausedAt;
    const now    = frozen ? currentMatch.pausedAt.toMillis() : Date.now();

    let startMs;
    if (phase === 1)      startMs = currentMatch.startedAt.toMillis();
    else if (phase === 2) startMs = currentMatch.resumeStartedAt?.toMillis();
    else if (phase === 3) startMs = currentMatch.etStartedAt?.toMillis();
    else                  startMs = currentMatch.etResumeStartedAt?.toMillis();

    if (!startMs) return 0;
    return Math.max(0, Math.floor((now - startMs) / 1000));
}

function calculateTimeDisplay() {
    const elapsed  = calculateElapsedSeconds();
    const mins     = Math.floor(elapsed / 60);
    const secs     = elapsed % 60;
    const pad      = s => String(s).padStart(2, '0');
    const halfDur  = getRegularHalfDuration();
    const fullDur  = halfDur * 2;
    const phase    = currentMatch?.phase || 1;
    const status   = currentMatch?.status;

    if (phase === 1) {
        if (mins < halfDur) return `${mins}:${pad(secs)}`;
        return `${halfDur}+${mins - halfDur}:${pad(secs)}`;
    }
    if (phase === 2) {
        if (status === 'rust' && !currentMatch?.resumeStartedAt) return `${halfDur}:00`;
        const disp = halfDur + mins;
        if (disp < fullDur) return `${disp}:${pad(secs)}`;
        return `${fullDur}+${disp - fullDur}:${pad(secs)}`;
    }
    if (phase === 3) {
        if (status === 'rust' && !currentMatch?.etStartedAt) return `${fullDur}:00`;
        const disp = fullDur + mins;
        const etFull = fullDur + ET_HALF_DURATION;
        if (disp < etFull) return `${disp}:${pad(secs)}`;
        return `${etFull}+${disp - etFull}:${pad(secs)}`;
    }
    if (status === 'rust' && !currentMatch?.etResumeStartedAt) return `${fullDur + ET_HALF_DURATION}:00`;
    const disp   = fullDur + ET_HALF_DURATION + mins;
    const etFull = fullDur + ET_HALF_DURATION * 2;
    if (disp < etFull) return `${disp}:${pad(secs)}`;
    return `${etFull}+${disp - etFull}:${pad(secs)}`;
}

function getCurrentMinuteForEvent() {
    const elapsed = calculateElapsedSeconds();
    const mins    = Math.floor(elapsed / 60);
    const halfDur = getRegularHalfDuration();
    const fullDur = halfDur * 2;
    const phase   = currentMatch?.phase || 1;

    if (phase === 1) return mins;
    if (phase === 2) {
        if (currentMatch?.status === 'rust' && !currentMatch?.resumeStartedAt) return halfDur;
        return halfDur + mins;
    }
    if (phase === 3) return fullDur + mins;
    return fullDur + ET_HALF_DURATION + mins;
}

// ── Display update ────────────────────────────────────────────────────────────

function updateMatchDisplay() {
    if (!currentMatch) return;

    document.getElementById('homeTeamName').textContent  = currentMatch.thuisploeg;
    document.getElementById('awayTeamName').textContent  = currentMatch.uitploeg;
    document.getElementById('homeScore').textContent     = currentMatch.scoreThuis ?? 0;
    document.getElementById('awayScore').textContent     = currentMatch.scoreUit   ?? 0;
    document.getElementById('currentMinute').textContent = calculateTimeDisplay();

    const statusEl = document.getElementById('matchStatus');
    if (statusEl) {
        if (currentMatch.status === 'rust') {
            statusEl.textContent      = 'Rust';
            statusEl.style.background = '#FFC107';
        } else if (currentMatch.extraTimeStarted) {
            statusEl.textContent      = 'Verlengingen';
            statusEl.style.background = '#9C27B0';
        } else {
            statusEl.textContent      = 'Live';
            statusEl.style.background = '#DC3545';
        }
    }

    const descEl = document.getElementById('matchDescription');
    if (descEl) {
        if (currentMatch.beschrijving?.trim()) {
            descEl.textContent   = currentMatch.beschrijving;
            descEl.style.display = 'block';
        } else {
            descEl.style.display = 'none';
        }
    }

    if (hasAccess) {
        const hct = document.getElementById('homeTeamControlTitle');
        const act = document.getElementById('awayTeamControlTitle');
        if (hct) hct.textContent = currentMatch.thuisploeg;
        if (act) act.textContent = currentMatch.uitploeg;
    }
}

function startDisplayInterval() {
    if (displayInterval) clearInterval(displayInterval);
    displayInterval = setInterval(() => {
        if (currentMatch?.status === 'live') updateMatchDisplay();
    }, 1000);
}

// ── Control button states ─────────────────────────────────────────────────────

function updateControlButtonStates() {
    if (!hasAccess || !currentMatch) return;

    const phase             = currentMatch.phase || 1;
    const status            = currentMatch.status;
    const extraTimeStarted  = currentMatch.extraTimeStarted  || false;
    const etHalfTimeReached = currentMatch.etHalfTimeReached || false;

    const pauseBtn     = document.getElementById('pauseBtn');
    const resumeBtn    = document.getElementById('resumeBtn');
    const extraTimeBtn = document.getElementById('extraTimeBtn');

    if (pauseBtn) {
        const showPause = status === 'live' && (phase === 1 || phase === 3);
        pauseBtn.style.display = showPause ? 'inline-block' : 'none';
    }
    if (resumeBtn) {
        resumeBtn.style.display = status === 'rust' ? 'inline-block' : 'none';
        if (status === 'rust') {
            if (!extraTimeStarted)           resumeBtn.textContent = 'START 2E HELFT';
            else if (!etHalfTimeReached)     resumeBtn.textContent = 'START VERLENGINGEN';
            else                             resumeBtn.textContent = 'START 2E VERLENGING';
        }
    }
    if (extraTimeBtn) {
        const scoreEqual = (currentMatch.scoreThuis ?? 0) === (currentMatch.scoreUit ?? 0);
        const showET = status === 'live' && phase === 2 && !extraTimeStarted
            && scoreEqual && currentMatch.team !== 'veteranen';
        extraTimeBtn.style.display = showET ? 'inline-block' : 'none';
    }
}

// ── Setup control buttons ─────────────────────────────────────────────────────

function setupControlButtons() {
    document.querySelectorAll('.control-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', handleControlClick);
    });

    const pauseBtn        = document.getElementById('pauseBtn');
    const resumeBtn       = document.getElementById('resumeBtn');
    const extraTimeBtn    = document.getElementById('extraTimeBtn');
    const endMatchBtn     = document.getElementById('endMatchBtn');
    const scoreCorrectBtn = document.getElementById('scoreCorrectBtn');

    if (pauseBtn)        pauseBtn.addEventListener('click', handlePause);
    if (resumeBtn)       resumeBtn.addEventListener('click', confirmResume);
    if (extraTimeBtn)    extraTimeBtn.addEventListener('click', handleExtraTime);
    if (endMatchBtn)     endMatchBtn.addEventListener('click', handleEndMatch);
    if (scoreCorrectBtn) scoreCorrectBtn.addEventListener('click', openScoreModal);

    updateControlButtonStates();
}

// ── Pause handler ─────────────────────────────────────────────────────────────

async function handlePause() {
    try {
        const minute   = getCurrentMinuteForEvent();
        const phase    = currentMatch.phase || 1;
        const matchRef = doc(db, 'matches', currentMatchId);
        const now      = Timestamp.fromDate(new Date());
        const upd      = { status: 'rust', pausedAt: now };
        if (phase === 1) { upd.halfTimeReached = true; upd.phase = 2; }
        else if (phase === 3) { upd.etHalfTimeReached = true; upd.phase = 4; }

        await updateDoc(matchRef, upd);
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId, minuut: minute, half: phase,
            type: 'rust', ploeg: 'center', speler: '', timestamp: serverTimestamp()
        });
    } catch (e) { console.error('Error pausing:', e); showToast('Fout bij pauze: ' + e.message, 'error'); }
}

// ── Resume confirm modal ─────────────────────────────────────────────────────

function confirmResume() {
    const phase = currentMatch.phase || 2;
    const label = phase === 2 ? 'START 2E HELFT'
                : phase === 3 ? 'START VERLENGINGEN'
                :               'START 2E VERLENGING';

    let modal = document.getElementById('resumeConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'resumeConfirmModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3 id="resumeConfirmTitle"></h3>
                <p style="margin-bottom:1.5rem;color:var(--text-gray);">
                    Weet je zeker? De timer start meteen na bevestiging.
                </p>
                <div class="modal-actions">
                    <button class="modal-btn cancel" id="resumeConfirmCancel">Annuleren</button>
                    <button class="modal-btn confirm" id="resumeConfirmOk">▶ Ja, hervatten</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('#resumeConfirmCancel').addEventListener('click',
            () => modal.classList.remove('active'));
        modal.addEventListener('click', e => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }
    modal.querySelector('#resumeConfirmTitle').textContent = label + '?';
    const okBtn = modal.querySelector('#resumeConfirmOk');
    okBtn.onclick = async () => { modal.classList.remove('active'); await handleResume(); };
    modal.classList.add('active');
}

// ── Resume handler ────────────────────────────────────────────────────────────

async function handleResume() {
    try {
        const phase    = currentMatch.phase || 1;
        const matchRef = doc(db, 'matches', currentMatchId);
        const now      = Timestamp.fromDate(new Date());
        const upd      = { status: 'live', pausedAt: null };

        if (phase === 2 && !currentMatch.resumeStartedAt)    upd.resumeStartedAt   = now;
        else if (phase === 3 && !currentMatch.etStartedAt)   upd.etStartedAt       = now;
        else if (phase === 4 && !currentMatch.etResumeStartedAt) upd.etResumeStartedAt = now;

        await updateDoc(matchRef, upd);
    } catch (e) { console.error('Error resuming:', e); showToast('Fout bij hervatten: ' + e.message, 'error'); }
}

// ── Extra time handler ────────────────────────────────────────────────────────

async function handleExtraTime() {
    const halfDur = getRegularHalfDuration();
    const fullDur = halfDur * 2;
    if (!confirm(`Verlengingen starten? De timer springt naar ${fullDur}' en er volgen 2 × 15 minuten.`)) return;
    try {
        const minute = getCurrentMinuteForEvent();
        await updateDoc(doc(db, 'matches', currentMatchId), {
            status: 'rust', pausedAt: Timestamp.fromDate(new Date()),
            extraTimeStarted: true, phase: 3
        });
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId, minuut: minute, half: 2,
            type: 'einde-regulier', ploeg: 'center', speler: '', timestamp: serverTimestamp()
        });
    } catch (e) { console.error('Error starting extra time:', e); showToast('Fout bij verlengingen: ' + e.message, 'error'); }
}

// ── End match handler — with stat finalization ────────────────────────────────

async function handleEndMatch() {
    if (!confirm('Weet je zeker dat je de wedstrijd wilt beëindigen?')) return;
    try {
        const minute = getCurrentMinuteForEvent();
        const phase  = currentMatch.phase || 1;

        await updateDoc(doc(db, 'matches', currentMatchId), { status: 'finished' });
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId, minuut: minute, half: phase,
            type: 'einde', ploeg: 'center', speler: '', timestamp: serverTimestamp()
        });

        // Finalize player stats
        await finalizePlayerStats(minute);

        // Invalideer de localStorage-cache voor alle spelers in de lineup
        // zodat hun profiel direct de nieuwe stats toont na de wedstrijd.
        try {
            const lineup = currentMatch.lineup || {};
            const team   = currentMatch.team   || '';
            for (const uid of Object.keys(lineup)) {
                localStorage.removeItem(`vvs_profile_${uid}`);
                localStorage.removeItem(`vvs_history_${uid}`);
            }
            // Teampagina's: recente wedstrijden en stats zijn nu verouderd
            localStorage.removeItem(`vvs_recent_matches_${team}`);
            localStorage.removeItem(`vvs_team_stats_${team}`);
            localStorage.removeItem(`vvs_next_match_${team}`);
        } catch (_) {}

        showToast('Wedstrijd beëindigd! ✅', 'success');

        // Confetti als VVS gewonnen heeft
        const vvsScore = vvsSide === 'home'
            ? (currentMatch.scoreThuis ?? 0)
            : (currentMatch.scoreUit   ?? 0);
        const oppScore = vvsSide === 'home'
            ? (currentMatch.scoreUit   ?? 0)
            : (currentMatch.scoreThuis ?? 0);
        if (vvsScore > oppScore) {
            launchWinConfetti();
        }

        // Toon eindstand UI (geen redirect)
        showMatchFinishedState();

    } catch (e) { console.error('Error ending match:', e); showToast('Fout bij beëindigen: ' + e.message, 'error'); }
}

// ── Finalize stats on match end ───────────────────────────────────────────────
// For every VVS player with a real uid (non-external), increment their cumulative
// stats in the users collection.

async function finalizePlayerStats(finalMinute) {
    try {
        // 1. Get all playerMinutes records
        const pmSnap = await getDocs(
            collection(db, 'matches', currentMatchId, 'playerMinutes')
        );

        // 2. Fetch all events for this match
        const eventsSnap = await getDocs(
            query(collection(db, 'events'), where('matchId', '==', currentMatchId))
        );
        const events = [];
        eventsSnap.forEach(d => events.push(d.data()));

        // Build a map: playerName → uid (for event lookup by name)
        // Using the lineup stored on the match doc
        const nameToUid = {};
        const lineup = currentMatch.lineup || {};
        for (const [uid, info] of Object.entries(lineup)) {
            nameToUid[info.name] = uid;
        }

        // 3. For each player with a minute record, compute played minutes
        const playerUpdates = {}; // uid → { minuten, matchen, goals, assists, geelKaarten, roodKaarten }

        pmSnap.forEach(d => {
            const pm = d.data();
            const uid = pm.uid;
            if (!uid || uid.startsWith('manual_')) return;

            // FIX 2: totalMinutes bevat de som van afgelopen stints
            // Lopend stint: minuteOn → finalMinute (als minuteOff null/onbekend)
            const totalSoFar = pm.totalMinutes ?? 0;
            let currentStint = 0;
            if (pm.minuteOff === null || pm.minuteOff === undefined) {
                // Speler staat nog op het veld — lopend stint telt door tot einde
                currentStint = Math.max(0, finalMinute - (pm.minuteOn ?? 0));
            }
            const played = totalSoFar + currentStint;

            playerUpdates[uid] = {
                minuten:      played,
                matchen:      1,
                goals:        0,
                assists:      0,
                geelKaarten:  0,
                roodKaarten:  0
            };
        });

        // FIX 3: Zorg dat ALLE lineup-leden (starters + bench) matchen: 1 krijgen,
        // ook als er geen playerMinutes record voor bestaat (edge case bij snelle wedstrijden)
        for (const [uid, info] of Object.entries(lineup)) {
            if (uid.startsWith('manual_')) continue;
            if ((info.status === 'starter' || info.status === 'bench' || info.status === 'out') && !playerUpdates[uid]) {
                // Starter zonder playerMinutes record: heeft de hele wedstrijd gespeeld
                const isStarter = info.status === 'starter';
                playerUpdates[uid] = {
                    minuten:     isStarter ? finalMinute : 0,
                    matchen:     1,
                    goals:       0, assists: 0, geelKaarten: 0, roodKaarten: 0
                };
            } else if (!uid.startsWith('manual_') && playerUpdates[uid]) {
                // Bestaande entry: zorg dat matchen altijd 1 is voor lineup-leden
                playerUpdates[uid].matchen = 1;
            }
        }

        // Helper: zorg dat een uid altijd een entry heeft in playerUpdates
        // (ook als hij niet gespeeld heeft maar wel een stat heeft)
        function ensureEntry(uid) {
            if (!uid || uid.startsWith('manual_')) return false;
            if (!playerUpdates[uid]) {
                playerUpdates[uid] = { minuten: 0, matchen: 0, goals: 0, assists: 0, geelKaarten: 0, roodKaarten: 0 };
            }
            return true;
        }

        // 4. Verwerk events — goals, assists en kaarten elk onafhankelijk
        events.forEach(ev => {
            // Goals & penalties (op naam van de schutter)
            if ((ev.type === 'goal' || ev.type === 'penalty') && ev.speler) {
                const uid = nameToUid[ev.speler];
                if (ensureEntry(uid)) playerUpdates[uid].goals++;
            }

            // Assists — onafhankelijk van of de schutter gevonden wordt
            if ((ev.type === 'goal' || ev.type === 'penalty') && ev.assist) {
                const assistUid = nameToUid[ev.assist];
                if (ensureEntry(assistUid)) playerUpdates[assistUid].assists++;
            }

            // Kaarten
            if (ev.speler) {
                const uid = nameToUid[ev.speler];
                if (uid && !uid.startsWith('manual_')) {
                    if (!playerUpdates[uid]) ensureEntry(uid);
                    if (ev.type === 'yellow')    { playerUpdates[uid].geelKaarten++; }
                    if (ev.type === 'yellow2red') { playerUpdates[uid].geelKaarten++; playerUpdates[uid].roodKaarten++; }
                    if (ev.type === 'red')        { playerUpdates[uid].roodKaarten++; }
                }
            }
        });

        // 5. Apply increments to each user doc
        const userUpdatePromises = [];
        for (const [uid, delta] of Object.entries(playerUpdates)) {
            userUpdatePromises.push(incrementUserStats(uid, delta));
        }
        await Promise.all(userUpdatePromises);
        console.log('Player stats finalized for', Object.keys(playerUpdates).length, 'players');

    } catch (e) {
        console.error('Error finalizing player stats:', e);
        // Non-fatal — match is still ended
    }
}

async function incrementUserStats(uid, delta) {
    try {
        // Find the user doc (uid is stored as a field, not doc ID)
        const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', uid)));
        if (snap.empty) return;

        const userDocId  = snap.docs[0].id;
        const userData   = snap.docs[0].data();
        const userDocRef = doc(db, 'users', userDocId);

        await updateDoc(userDocRef, {
            goals:       (userData.goals       || 0) + delta.goals,
            assists:     (userData.assists     || 0) + delta.assists,
            geelKaarten: (userData.geelKaarten || 0) + delta.geelKaarten,
            roodKaarten: (userData.roodKaarten || 0) + delta.roodKaarten,
            matchen:     (userData.matchen     || 0) + delta.matchen,
            minuten:     (userData.minuten     || 0) + delta.minuten,
        });
    } catch (e) {
        console.error(`Error updating stats for uid ${uid}:`, e);
    }
}

// ── Player picker modal ───────────────────────────────────────────────────────

let pendingAction = null;

// Returns the correct player list depending on the action type
function getPlayersForAction(action, isVvs) {
    if (!isVvs) return []; // opponent: always manual

    switch (action) {
        case 'goal':
        case 'penalty':
        case 'own-goal':
            // Only players currently on the pitch
            return [...activePlayers];
        case 'yellow':
        case 'red':
            // Active + bench + subbed off can all receive cards
            return [...activePlayers, ...benchPlayers, ...outPlayers];
        case 'substitution':
            // Uit: actieve spelers op het veld
            // In: bankspelers + eerder gewisselde spelers (kunnen terugkomen)
            return { out: [...activePlayers], in: [...benchPlayers, ...outPlayers] };
        default:
            return [...activePlayers];
    }
}

function populateSelect(selectEl, players, emptyLabel = '— Selecteer speler —') {
    selectEl.innerHTML = `<option value="">${emptyLabel}</option>`;
    players.forEach(p => {
        const opt = document.createElement('option');
        opt.value       = p.name;
        opt.textContent = p.name;
        selectEl.appendChild(opt);
    });
}

function getModalValue(selectId, manualId, isOpponent = false) {
    const sel = document.getElementById(selectId);
    const man = document.getElementById(manualId);
    if (sel && sel.value) return sel.value;
    if (man && man.value.trim()) {
        const val = man.value.trim();
        if (isOpponent && /^\d+$/.test(val)) return `Nr. ${val}`;
        return val;
    }
    return '';
}

function handleControlClick(e) {
    const btn    = e.currentTarget;
    const team   = btn.dataset.team;
    const action = btn.dataset.action;

    pendingAction = { team, action };

    const modal         = document.getElementById('playerModal');
    const modalTitle    = document.getElementById('modalTitle');
    const singleSection = document.getElementById('singlePlayerSection');
    const assistSection = document.getElementById('assistSection');
    const subSection    = document.getElementById('substitutionSection');
    const pickerLabel   = document.getElementById('playerPickerLabel');

    singleSection.style.display = 'none';
    assistSection.style.display = 'none';
    subSection.style.display    = 'none';

    const actionNames = {
        goal: 'Goal', penalty: 'Penalty', 'own-goal': 'Eigen Doelpunt',
        yellow: 'Gele Kaart', red: 'Rode Kaart', substitution: 'Wissel'
    };
    modalTitle.textContent = actionNames[action] || action;

    const isVvs = team === vvsSide;

    const injuryRow       = document.getElementById('injuryRow');
    const injuryCheck     = document.getElementById('injuryCheck');
    const penaltyMissedRow = document.getElementById('penaltyMissedRow');
    if (injuryRow)       injuryRow.style.display    = 'none';
    if (injuryCheck)     injuryCheck.checked         = false;
    if (penaltyMissedRow) penaltyMissedRow.style.display = 'none';

    if (action === 'substitution') {
        subSection.style.display = 'block';
        // Build first pair, clear any previous pairs
        buildSubPairs(isVvs, 1);

    } else {
        singleSection.style.display = 'block';
        pickerLabel.textContent = action === 'own-goal' ? 'Speler (eigen doelpunt)' : 'Speler';

        const players   = isVvs ? getPlayersForAction(action, true) : [];
        const playerSel = document.getElementById('playerSelect');
        populateSelect(playerSel, players);
        playerSel.style.display = isVvs ? '' : 'none';
        document.getElementById('playerManualInput').placeholder = isVvs ? 'Of typ naam handmatig...' : 'Rugnummer (bijv. 10)';
        document.getElementById('playerManualInput').value = '';

        if (action === 'goal' || action === 'penalty') {
            assistSection.style.display = 'block';
            const assistSel = document.getElementById('assistSelect');
            // Assists: active players only (they must be on the pitch)
            const assistPlayers = isVvs ? [...activePlayers] : [];
            populateSelect(assistSel, assistPlayers, '— Geen assist —');
            assistSel.style.display = isVvs ? '' : 'none';
            document.getElementById('assistManualInput').placeholder = isVvs ? 'Of typ naam handmatig...' : 'Rugnummer (bijv. 10)';
            document.getElementById('assistManualInput').value = '';
        }
        if (action === 'penalty' && penaltyMissedRow) {
            penaltyMissedRow.style.display = 'flex';
        }
    }

    modal.classList.add('active');
}

// ── Modal confirm / cancel ────────────────────────────────────────────────────

const modalConfirm = document.getElementById('modalConfirm');
const modalCancel  = document.getElementById('modalCancel');

if (modalConfirm) {
    modalConfirm.addEventListener('click', async () => {
        if (!pendingAction) return;
        const modal = document.getElementById('playerModal');
        const { team, action } = pendingAction;
        const isOpponent = team !== vvsSide;

        let playerName = '', assistName = '', playerOut = '', playerIn = '';
        let injured = false;

        if (action === 'substitution') {
            // Collect all pairs from the multi-pair container
            const pairs = collectSubPairs(isOpponent);
            modal.classList.remove('active');
            await executeMultiSub(team, pairs);
            pendingAction = null;
            return; // handled separately
        } else {
            playerName = getModalValue('playerSelect', 'playerManualInput', isOpponent);
            if (action === 'goal' || action === 'penalty') {
                assistName = getModalValue('assistSelect', 'assistManualInput', isOpponent);
            }
        }

        modal.classList.remove('active');
        await executeAction(team, action, playerName, playerOut, playerIn, assistName, { injured });
        pendingAction = null;
    });
}
if (modalCancel) {
    modalCancel.addEventListener('click', () => {
        document.getElementById('playerModal').classList.remove('active');
        pendingAction = null;
    });
}

const penaltyMissedBtn = document.getElementById('penaltyMissedBtn');
if (penaltyMissedBtn) {
    penaltyMissedBtn.addEventListener('click', async () => {
        if (!pendingAction) return;
        const modal      = document.getElementById('playerModal');
        const { team }   = pendingAction;
        const isOpponent = team !== vvsSide;
        const playerName = getModalValue('playerSelect', 'playerManualInput', isOpponent);
        modal.classList.remove('active');
        await executeAction(team, 'penalty-missed', playerName, '', '', '', {});
        pendingAction = null;
    });
}


// ── Multi-sub helpers ─────────────────────────────────────────────────────────

let subPairCount = 0; // number of pairs currently rendered

function buildSubPairs(isVvs, count = 1) {
    const container = document.getElementById('subPairsContainer');
    const addBtn    = document.getElementById('addSubPairBtn');
    if (!container) return;
    container.innerHTML = '';
    subPairCount = 0;
    for (let i = 0; i < count; i++) addSubPair(isVvs, container);
    if (addBtn) {
        addBtn.onclick = () => addSubPair(isVvs, container);
        addBtn.style.display = '';
    }
}

function addSubPair(isVvs, container) {
    subPairCount++;
    const idx = subPairCount;
    const pair = document.createElement('div');
    pair.className = 'sub-pair-block';
    pair.dataset.idx = idx;

    if (idx > 1) {
        const divider = document.createElement('div');
        divider.className = 'sub-pair-divider';
        divider.innerHTML = `<span>Wissel ${idx}</span>
            <button type="button" class="sub-remove-pair" data-idx="${idx}" title="Verwijder wissel">✕</button>`;
        pair.appendChild(divider);
        pair.querySelector('.sub-remove-pair').addEventListener('click', () => {
            pair.remove();
            subPairCount--;
            // Re-index dividers
            container.querySelectorAll('.sub-pair-divider span').forEach((el, i) => {
                el.textContent = `Wissel ${i + 2}`;
            });
        });
    }

    const outOpts = isVvs ? buildSubOptions('out') : '';
    const inOpts  = isVvs ? buildSubOptions('in')  : '';
    const manualPh = isVvs ? 'Of typ naam handmatig...' : 'Rugnummer (bijv. 10)';

    pair.innerHTML += `
        <label class="modal-label">Speler UIT</label>
        ${isVvs ? `<select class="modal-select sub-out-select" data-pair="${idx}">${outOpts}</select>` : ''}
        <input type="text" class="modal-input-manual sub-out-manual" data-pair="${idx}" placeholder="${manualPh}">
        <div class="sub-injury-row" style="display:flex;align-items:center;gap:0.5rem;margin:0.4rem 0 0.25rem;padding:0.4rem 0.5rem;background:rgba(255,80,80,0.07);border-radius:8px;border:1px solid rgba(255,80,80,0.2);">
            <input type="checkbox" class="sub-injury-check" data-pair="${idx}" style="width:18px;height:18px;cursor:pointer;flex-shrink:0;">
            <label style="cursor:pointer;display:flex;align-items:center;gap:0.4rem;font-size:0.9rem;font-weight:600;">
                <img src="assets/blessure.png" alt="" style="width:20px;height:20px;"> Geblesseerd uitgewisseld
            </label>
        </div>
        <label class="modal-label" style="margin-top:0.75rem;">Speler IN</label>
        ${isVvs ? `<select class="modal-select sub-in-select" data-pair="${idx}">${inOpts}</select>` : ''}
        <input type="text" class="modal-input-manual sub-in-manual" data-pair="${idx}" placeholder="${manualPh}">
    `;

    container.appendChild(pair);
}

function buildSubOptions(direction) {
    // Out: actieve spelers op het veld
    // In: bankspelers + outPlayers (voor backward compat met status 'out' in oude data)
    const players = direction === 'out'
        ? [...activePlayers]
        : [...benchPlayers, ...outPlayers];
    let opts = `<option value="">— Speler ${direction === 'out' ? 'uit' : 'in'} —</option>`;
    players.forEach(p => { opts += `<option value="${p.name}">${p.name}</option>`; });
    return opts;
}

function collectSubPairs(isOpponent) {
    const container = document.getElementById('subPairsContainer');
    if (!container) return [];
    const pairs = [];
    const usedOut = new Set();
    const usedIn  = new Set();

    container.querySelectorAll('.sub-pair-block').forEach(block => {
        const idx = block.dataset.idx;
        let playerOut = '', playerIn = '';
        const outSel  = block.querySelector('.sub-out-select');
        const outMan  = block.querySelector('.sub-out-manual');
        const inSel   = block.querySelector('.sub-in-select');
        const inMan   = block.querySelector('.sub-in-manual');
        const injCk   = block.querySelector('.sub-injury-check');

        if (!isOpponent && outSel) {
            playerOut = outSel.value || (outMan ? outMan.value.trim() : '');
        } else if (outMan) {
            playerOut = outMan.value.trim();
        }
        if (!isOpponent && inSel) {
            playerIn = inSel.value || (inMan ? inMan.value.trim() : '');
        } else if (inMan) {
            playerIn = inMan.value.trim();
        }

        // Uniqueness guard
        if (playerOut && usedOut.has(playerOut)) playerOut = '';
        if (playerIn  && usedIn.has(playerIn))   playerIn  = '';
        if (playerOut) usedOut.add(playerOut);
        if (playerIn)  usedIn.add(playerIn);

        pairs.push({ playerOut, playerIn, injured: injCk ? injCk.checked : false });
    });

    return pairs.filter(p => p.playerOut || p.playerIn);
}

async function executeMultiSub(team, pairs) {
    if (!pairs.length) return;
    const minute = getCurrentMinuteForEvent();
    const phase  = currentMatch.phase || 1;

    // Build a single combined event with arrays of names
    const allOut     = pairs.map(p => p.playerOut).filter(Boolean);
    const allIn      = pairs.map(p => p.playerIn).filter(Boolean);
    const anyInjured = pairs.some(p => p.injured);

    const eventData = {
        matchId:   currentMatchId,
        minuut:    minute,
        half:      phase,
        type:      'substitution',
        ploeg:     team,
        speler:    '',
        // Store as arrays for multi-sub; single sub stays backward-compat via [0]
        spelersUit: allOut,
        spelersIn:  allIn,
        // Keep legacy single fields for backward compat (first pair)
        spelerUit:  allOut[0] || '',
        spelerIn:   allIn[0]  || '',
        injured:    anyInjured,
        multiSub:   pairs.length > 1,
        timestamp:  serverTimestamp()
    };

    try {
        await addDoc(collection(db, 'events'), eventData);

        // Update lineup + playerMinutes for each VVS pair
        if (team === vvsSide) {
            for (const { playerOut, playerIn, injured } of pairs) {
                if (playerOut || playerIn) {
                    await handleSubstitutionLineup(playerOut, playerIn, minute);
                }
            }
        }
    } catch (e) {
        console.error('Multi-sub error:', e);
        showToast('Fout bij wissel: ' + e.message, 'error');
    }
}

// ── Execute action ────────────────────────────────────────────────────────────

async function executeAction(team, action, playerName = '', playerOut = '', playerIn = '', assistName = '', options = {}) {
    try {
        const minute   = getCurrentMinuteForEvent();
        const phase    = currentMatch.phase || 1;
        const matchRef = doc(db, 'matches', currentMatchId);

        let resolvedAction = action;
        if (action === 'yellow' && playerName && (yellowCardCounts[playerName] || 0) >= 1) {
            resolvedAction = 'yellow2red';
        }

        const eventData = {
            matchId: currentMatchId,
            minuut:  minute,
            half:    phase,
            type:    resolvedAction,
            ploeg:   team,
            speler:  playerName,
            timestamp: serverTimestamp()
        };

        if ((resolvedAction === 'goal' || resolvedAction === 'penalty') && assistName) {
            eventData.assist = assistName;
        }

        // Score updates
        if (resolvedAction === 'goal' || resolvedAction === 'penalty') {
            const field    = team === 'home' ? 'scoreThuis' : 'scoreUit';
            const newScore = ((team === 'home' ? currentMatch.scoreThuis : currentMatch.scoreUit) || 0) + 1;
            await updateDoc(matchRef, { [field]: newScore });
        } else if (resolvedAction === 'own-goal') {
            const oppTeam = team === 'home' ? 'away' : 'home';
            const field   = oppTeam === 'home' ? 'scoreThuis' : 'scoreUit';
            const cur     = (oppTeam === 'home' ? currentMatch.scoreThuis : currentMatch.scoreUit) || 0;
            await updateDoc(matchRef, { [field]: cur + 1 });
        }

        // Substitution: update lineup + playerMinutes
        if (resolvedAction === 'substitution' && team === vvsSide) {
            eventData.spelerUit = playerOut;
            eventData.spelerIn  = playerIn;
            if (options.injured) eventData.injured = true;

            await handleSubstitutionLineup(playerOut, playerIn, minute);
        } else if (resolvedAction === 'substitution') {
            eventData.spelerUit = playerOut;
            eventData.spelerIn  = playerIn;
            if (options.injured) eventData.injured = true;
        }

        await addDoc(collection(db, 'events'), eventData);
        console.log('Action:', resolvedAction, 'min:', minute, 'phase:', phase);

    } catch (e) {
        console.error('Error executing action:', e);
        showToast('Fout bij uitvoeren actie: ' + e.message, 'error');
    }
}

// ── Handle substitution lineup update ────────────────────────────────────────

async function handleSubstitutionLineup(playerOutName, playerInName, minute) {
    const lineup = { ...(currentMatch.lineup || {}) };

    // Find uids by name
    let uidOut = null, uidIn = null;
    for (const [uid, info] of Object.entries(lineup)) {
        if (info.name === playerOutName) uidOut = uid;
        if (info.name === playerInName)  uidIn  = uid;
    }

    const updates = {};

    // FIX 1: gebruik 'bench' ipv 'out' zodat de speler later opnieuw geselecteerd kan worden
    if (uidOut) {
        lineup[uidOut] = { ...lineup[uidOut], status: 'bench' };
        updates[`lineup.${uidOut}.status`] = 'bench';
    }
    if (uidIn) {
        lineup[uidIn] = { ...lineup[uidIn], status: 'starter' };
        updates[`lineup.${uidIn}.status`] = 'starter';
    }

    if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, 'matches', currentMatchId), updates);
    }

    // FIX 2: accumuleer minuten over meerdere stints
    // Speler die ERAF gaat: lees huidige minuteOn, voeg stint toe aan totalMinutes
    if (uidOut && !uidOut.startsWith('manual_')) {
        const pmRef = doc(db, 'matches', currentMatchId, 'playerMinutes', uidOut);
        const pmSnap = await getDoc(pmRef);
        const pmData = pmSnap.exists() ? pmSnap.data() : null;
        const prevOn = pmData?.minuteOn ?? 0;
        const prevTotal = pmData?.totalMinutes ?? 0;
        const stintMinutes = Math.max(0, minute - prevOn);
        await setDoc(pmRef, {
            uid:          uidOut,
            name:         playerOutName,
            minuteOff:    minute,
            totalMinutes: prevTotal + stintMinutes
        }, { merge: true });
    }

    // Speler die EROP komt: begin nieuw stint
    if (uidIn && !uidIn.startsWith('manual_')) {
        await setDoc(
            doc(db, 'matches', currentMatchId, 'playerMinutes', uidIn),
            { uid: uidIn, name: playerInName, minuteOn: minute, minuteOff: null },
            { merge: true }
        );
    }
}

// ── Score correction modal ────────────────────────────────────────────────────

function openScoreModal() {
    document.getElementById('homeTeamLabel').textContent = currentMatch.thuisploeg;
    document.getElementById('awayTeamLabel').textContent = currentMatch.uitploeg;
    document.getElementById('homeScoreInput').value      = currentMatch.scoreThuis ?? 0;
    document.getElementById('awayScoreInput').value      = currentMatch.scoreUit   ?? 0;
    document.getElementById('scoreModal').classList.add('active');
}

const scoreModalConfirm = document.getElementById('scoreModalConfirm');
const scoreModalCancel  = document.getElementById('scoreModalCancel');

if (scoreModalConfirm) {
    scoreModalConfirm.addEventListener('click', async () => {
        const h = parseInt(document.getElementById('homeScoreInput').value) || 0;
        const a = parseInt(document.getElementById('awayScoreInput').value) || 0;
        try {
            await updateDoc(doc(db, 'matches', currentMatchId), { scoreThuis: h, scoreUit: a });
            document.getElementById('scoreModal').classList.remove('active');
        } catch (e) { console.error('Score correction error:', e); showToast('Fout: ' + e.message, 'error'); }
    });
}
if (scoreModalCancel) {
    scoreModalCancel.addEventListener('click', () => {
        document.getElementById('scoreModal').classList.remove('active');
    });
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function loadTimeline(snapshot) {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;
    if (snapshot.empty) {
        timeline.innerHTML = '<div class="timeline-empty">Nog geen events...</div>';
        return;
    }
    const events = [];
    snapshot.forEach(d => events.push({ id: d.id, ...d.data() }));
    timeline.innerHTML = '';
    renderTimeline(events, timeline, playerUidMap);
}

export function renderTimeline(events, container, uidMap = {}) {
    const STRUCTURAL = new Set(['aftrap', 'rust', 'einde-regulier', 'einde']);
    const structural = events.filter(e => STRUCTURAL.has(e.type));
    const regular    = events.filter(e => !STRUCTURAL.has(e.type));

    const byHalf = { 1: [], 2: [], 3: [], 4: [] };
    regular.forEach(e => { const h = e.half || 1; if (byHalf[h]) byHalf[h].push(e); });

    const sortDesc = (a, b) => {
        const d = (b.minuut || 0) - (a.minuut || 0);
        if (d !== 0) return d;
        if (a.timestamp && b.timestamp) return b.timestamp.toMillis() - a.timestamp.toMillis();
        return 0;
    };
    [1, 2, 3, 4].forEach(h => byHalf[h].sort(sortDesc));

    const rustEvents = structural.filter(e => e.type === 'rust');
    const rustHT     = rustEvents.find(e => e.half === 1 || e.half === 2) || rustEvents[0] || null;
    const rustET     = rustEvents.find(e => e.half === 3 || e.half === 4);
    const aftrap     = structural.find(e => e.type === 'aftrap');
    const eindeReg   = structural.find(e => e.type === 'einde-regulier');
    const einde      = structural.find(e => e.type === 'einde');

    const ordered = [];
    if (einde)    ordered.push(einde);
    byHalf[4].forEach(e => ordered.push(e));
    if (rustET)   ordered.push(rustET);
    byHalf[3].forEach(e => ordered.push(e));
    if (eindeReg) ordered.push(eindeReg);
    byHalf[2].forEach(e => ordered.push(e));
    if (rustHT)   ordered.push(rustHT);
    byHalf[1].forEach(e => ordered.push(e));
    if (aftrap)   ordered.push(aftrap);

    ordered.forEach(e => container.appendChild(createEventElement(e, uidMap)));
}

function eventIcon(type, half) {
    const img = (file, alt) => `<img src="assets/${file}" alt="${alt}" class="timeline-icon-img ${alt}">`;
    switch (type) {
        case 'aftrap':         return img('goal.png',           'Aftrap');
        case 'goal':           return img('goal.png',           'Goal');
        case 'penalty':        return img('penalty.png',        'Penalty');
        case 'penalty-missed': return img('penalty_missed.png', 'Penalty gemist');
        case 'own-goal':       return img('own-goal.png',       'Eigen doelpunt');
        case 'yellow':         return img('yellow.png',         'Gele kaart');
        case 'yellow2red':     return img('yellow2red.png',     '2e Gele kaart / Rood');
        case 'red':            return img('red.png',            'Rode kaart');
        case 'substitution':   return img('sub.png',            'Wissel');
        case 'rust':           return half >= 3 ? img('rust.png', 'Rust verlengingen') : img('rust.png', 'Rust');
        case 'einde-regulier': return img('extra-time.png', 'Verlengingen');
        case 'einde':          return img('einde.png', 'Einde');
        default:               return `<span class="timeline-icon-fallback">•</span>`;
    }
}

export function createEventElement(event, uidMap = {}) {
    const div = document.createElement('div');
    div.className = `timeline-event ${event.type}`;
    let teamClass = 'center';
    if (event.ploeg === 'home') teamClass = 'home';
    else if (event.ploeg === 'away') teamClass = 'away';
    div.classList.add(teamClass);
    div.dataset.eventId = event.id || '';

    // Only VVS players (known in uidMap) get a clickable link
    const n = (name, cls = '') => {
        const uid = uidMap[name];
        if (uid) return `<a href="speler.html?uid=${uid}" class="tl-player-link${cls ? ' ' + cls : ''}">${name}</a>`;
        return `<span${cls ? ` class="${cls}"` : ''}>${name}</span>`;
    };

    let text = '';
    switch (event.type) {
        case 'aftrap': text = 'Aftrap'; break;
        case 'goal':
            text = `GOAL${event.speler ? ' - ' + n(event.speler) : ''}`;
            if (event.assist) text += ` <span class="event-assist">(assist: ${n(event.assist)})</span>`;
            break;
        case 'penalty':
            text = `PENALTY${event.speler ? ' - ' + n(event.speler) : ''}`;
            if (event.assist) text += ` <span class="event-assist">(assist: ${n(event.assist)})</span>`;
            break;
        case 'penalty-missed': text = `Penalty gemist${event.speler ? ' - ' + n(event.speler) : ''}`; break;
        case 'own-goal':       text = `Eigen doelpunt${event.speler ? ' - ' + n(event.speler) : ''}`; break;
        case 'yellow':         text = `Gele kaart${event.speler ? ' - ' + n(event.speler) : ''}`; break;
        case 'yellow2red':     text = `2e Gele kaart (Rood)${event.speler ? ' - ' + n(event.speler) : ''}`; break;
        case 'red':            text = `Rode kaart${event.speler ? ' - ' + n(event.speler) : ''}`; break;
        case 'substitution': {
            const injuryIcon = event.injured
                ? `<img src="assets/blessure.png" alt="Geblesseerd" class="sub-injury-icon" title="Geblesseerd">`
                : '';
            // Multi-sub: spelersUit / spelersIn arrays; fallback to legacy single fields
            const outsArr = event.spelersUit?.length ? event.spelersUit : (event.spelerUit ? [event.spelerUit] : []);
            const insArr  = event.spelersIn?.length  ? event.spelersIn  : (event.spelerIn  ? [event.spelerIn]  : []);
            const maxLen  = Math.max(outsArr.length, insArr.length);
            if (maxLen > 0) {
                text = '';
                // Alle spelers UIT eerst, daarna alle spelers IN
                outsArr.forEach((pOut, _i) => {
                    if (pOut) {
                        const inj = _i === 0 ? injuryIcon : '';
                        text += `<span class="sub-row"><img src="assets/speler_uit.png" class="sub-player-icon" alt="Uit">${n(pOut, 'sub-name')}${inj}</span>`;
                    }
                });
                if (outsArr.some(Boolean) && insArr.some(Boolean)) {
                    text += '<span class="sub-pair-sep"></span>';
                }
                insArr.forEach(pIn => {
                    if (pIn) text += `<span class="sub-row"><img src="assets/speler_in.png" class="sub-player-icon" alt="In">${n(pIn, 'sub-name')}</span>`;
                });
            } else {
                text = `Wissel${injuryIcon}`;
            }
            break;
        }
        case 'rust':           text = event.half >= 3 ? 'Rust verlengingen' : 'Rust'; break;
        case 'einde-regulier': text = 'Einde reguliere tijd — Verlengingen'; break;
        case 'einde':          text = 'Einde wedstrijd'; break;
        default:               text = event.type;
    }

    const STRUCTURAL_TYPES = new Set(['aftrap','rust','einde-regulier','einde']);
    const isEditable = hasAccess && event.id && !STRUCTURAL_TYPES.has(event.type);

    if (isEditable) div.classList.add('tl-editable');

    div.innerHTML = `
        <span class="event-time">${event.minuut}'</span>
        <span class="event-icon">${eventIcon(event.type, event.half)}</span>
        <span class="event-text">${text}</span>
        ${isEditable ? `<span class="tl-edit-hint"><img src="assets/edit.png" class="icon" alt=""></span>` : ''}
    `;

    if (isEditable) {
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => openEditEventModal(event));
    }
    return div;
}

// ── Edit event modal ──────────────────────────────────────────────────────────

async function openEditEventModal(event) {
    const EDITABLE = new Set(['goal','penalty','penalty-missed','own-goal','yellow','yellow2red','red','substitution']);
    if (!EDITABLE.has(event.type)) { showToast('Dit type event is niet aanpasbaar.', 'error'); return; }

    const isVvs = event.ploeg === vvsSide;
    const allPl = [...activePlayers, ...benchPlayers, ...outPlayers];
    const opts  = allPl.map(p => `<option value="${p.name}">${p.name}</option>`).join('');

    let modal = document.getElementById('editEventModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'editEventModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
    }

    const isSub     = event.type === 'substitution';
    const hasAssist = event.type === 'goal' || event.type === 'penalty';
    const outsArr   = event.spelersUit?.length ? event.spelersUit : (event.spelerUit ? [event.spelerUit] : []);
    const insArr    = event.spelersIn?.length  ? event.spelersIn  : (event.spelerIn  ? [event.spelerIn]  : []);

    const TYPE_LABELS = {
        goal:'Goal', penalty:'Penalty', 'penalty-missed':'Penalty gemist',
        'own-goal':'Eigen doelpunt', yellow:'Gele kaart', yellow2red:'2e Gele / Rood',
        red:'Rode kaart', substitution:'Wissel'
    };

    modal.innerHTML = `
        <div class="modal-content">
            <h3>
                <img src="assets/edit.png" class="icon" alt="" style="width:20px;height:20px;vertical-align:middle;margin-right:0.4rem;">
                ${TYPE_LABELS[event.type] || event.type} aanpassen
            </h3>

            <div class="form-group" style="margin-bottom:1rem;">
                <label class="modal-label">Minuut</label>
                <input type="number" id="editMinuut" min="0" max="999" value="${event.minuut ?? 0}"
                    style="width:90px;padding:0.5rem 0.75rem;border:2px solid var(--border-color);border-radius:8px;font-size:1rem;font-family:inherit;">
            </div>

            ${!isSub ? `
            <div class="form-group" style="margin-bottom:1rem;">
                <label class="modal-label">Speler</label>
                ${isVvs ? `<select id="editSpeler" class="modal-select">
                    <option value="">— Geen —</option>${opts}
                </select>` : ''}
                <input type="text" id="editSpelerManual" class="modal-input-manual"
                    value="${event.speler || ''}"
                    placeholder="${isVvs ? 'Of typ naam handmatig...' : 'Naam / rugnummer'}">
            </div>` : ''}

            ${hasAssist ? `
            <div class="form-group" style="margin-bottom:1rem;">
                <label class="modal-label">Assist (optioneel)</label>
                ${isVvs ? `<select id="editAssist" class="modal-select">
                    <option value="">— Geen assist —</option>${opts}
                </select>` : ''}
                <input type="text" id="editAssistManual" class="modal-input-manual"
                    value="${event.assist || ''}" placeholder="Assistgever">
            </div>` : ''}

            ${isSub ? `
            <div class="form-group" style="margin-bottom:1rem;">
                <label class="modal-label">Speler(s) UIT <small style="font-weight:400;color:var(--text-gray);">(komma-gescheiden)</small></label>
                <input type="text" id="editSubUit" class="modal-select"
                    value="${outsArr.join(', ')}" placeholder="Naam1, Naam2">
            </div>
            <div class="form-group" style="margin-bottom:1rem;">
                <label class="modal-label">Speler(s) IN <small style="font-weight:400;color:var(--text-gray);">(komma-gescheiden)</small></label>
                <input type="text" id="editSubIn" class="modal-select"
                    value="${insArr.join(', ')}" placeholder="Naam1, Naam2">
            </div>` : ''}

            <div id="editEventError" style="color:var(--danger);font-size:0.85rem;margin-bottom:0.5rem;min-height:1.2em;"></div>
            <div class="modal-actions">
                <button class="modal-btn cancel" id="editEventCancel">Annuleren</button>
                <button class="modal-btn confirm" id="editEventSave">
                    <img src="assets/edit.png" class="icon" alt=""
                        style="width:15px;height:15px;vertical-align:middle;margin-right:4px;filter:brightness(10);">
                    Opslaan
                </button>
            </div>
        </div>`;

    modal.classList.add('active');

    if (isVvs && !isSub) {
        const selSp = modal.querySelector('#editSpeler');
        if (selSp) selSp.value = event.speler || '';
        const selAs = modal.querySelector('#editAssist');
        if (selAs) selAs.value = event.assist || '';
    }

    modal.querySelector('#editEventCancel').addEventListener('click',
        () => modal.classList.remove('active'));

    modal.querySelector('#editEventSave').addEventListener('click', async () => {
        const errEl = modal.querySelector('#editEventError');
        errEl.textContent = '';
        const newMinuut = parseInt(modal.querySelector('#editMinuut').value) || 0;

        // Recalculate half based on new minute (regular time only)
        let newHalf = event.half || 1;
        if ((event.half || 1) <= 2) {
            const halfDur = getRegularHalfDuration();
            newHalf = newMinuut <= halfDur ? 1 : 2;
        }
        const updates = { minuut: newMinuut, half: newHalf };

        if (!isSub) {
            const selSp = modal.querySelector('#editSpeler');
            const manSp = modal.querySelector('#editSpelerManual');
            updates.speler = (isVvs && selSp?.value) ? selSp.value
                           : (manSp?.value.trim() || '');
            if (hasAssist) {
                const selAs = modal.querySelector('#editAssist');
                const manAs = modal.querySelector('#editAssistManual');
                updates.assist = (isVvs && selAs?.value) ? selAs.value
                               : (manAs?.value.trim() || '');
            }
        } else {
            const rawUit = modal.querySelector('#editSubUit').value;
            const rawIn  = modal.querySelector('#editSubIn').value;
            const newOut = rawUit.split(',').map(s => s.trim()).filter(Boolean);
            const newIn  = rawIn.split(',').map(s => s.trim()).filter(Boolean);
            updates.spelersUit = newOut;
            updates.spelersIn  = newIn;
            updates.spelerUit  = newOut[0] || '';
            updates.spelerIn   = newIn[0]  || '';

            // Update playerMinutes if VVS sub changed
            if (isVvs) {
                const oldMin = event.minuut ?? 0;
                const lineup = currentMatch.lineup || {};
                const updatePM = async (name, fields) => {
                    for (const [uid, info] of Object.entries(lineup)) {
                        if (info.name === name && !uid.startsWith('manual_')) {
                            await setDoc(
                                doc(db, 'matches', currentMatchId, 'playerMinutes', uid),
                                { uid, name, ...fields }, { merge: true }
                            );
                        }
                    }
                };
                // Reverse old
                for (const nm of outsArr) await updatePM(nm, { minuteOff: null });
                for (const nm of insArr)  await updatePM(nm, { minuteOn: 0 });
                // Apply new
                for (const nm of newOut) await updatePM(nm, { minuteOff: newMinuut });
                for (const nm of newIn)  await updatePM(nm, { minuteOn: newMinuut });
            }
        }

        const btn = modal.querySelector('#editEventSave');
        btn.disabled = true;
        try {
            await updateDoc(doc(db, 'events', event.id), updates);
            modal.classList.remove('active');
            showToast('✅ Event bijgewerkt!', 'success');
        } catch (e) {
            errEl.textContent = 'Fout: ' + e.message;
            btn.disabled = false;
        }
    });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
    if (matchListener)   matchListener();
    if (eventsListener)  eventsListener();
    if (displayInterval) clearInterval(displayInterval);
});

console.log('Live.js initialization complete');

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

// ── Geen live wedstrijd ───────────────────────────────────────────────────────
async function showNoMatchState() {
    // Verberg controlpanel
    const panel = document.getElementById('controlPanel');
    if (panel) panel.style.display = 'none';

    // Scorebord neutraal zetten
    const homeTeam = document.getElementById('homeTeamName');
    const awayTeam = document.getElementById('awayTeamName');
    const minute   = document.getElementById('currentMinute');
    const status   = document.getElementById('matchStatus');
    if (homeTeam) homeTeam.textContent = 'V.V.S. Rotselaar';
    if (awayTeam) awayTeam.textContent = '—';
    if (minute)   minute.textContent   = '—';
    if (status) {
        status.textContent      = 'Geen wedstrijd';
        status.style.background = '#6c757d';
    }

    // Zoek eerstvolgende geplande wedstrijd
    let nextMatch = null;
    try {
        const snap = await getDocs(query(
            collection(db, 'matches'),
            where('status', '==', 'planned')
        ));
        const now = Date.now();
        snap.forEach(d => {
            const data = d.data();
            const ts   = new Date(`${data.datum}T${data.uur}`).getTime();
            if (ts > now) {
                if (!nextMatch || ts < new Date(`${nextMatch.datum}T${nextMatch.uur}`).getTime()) {
                    nextMatch = { id: d.id, ...data };
                }
            }
        });
    } catch (_) {}

    // Banner bouwen
    const matchHeader = document.querySelector('.match-header');
    if (!matchHeader || document.getElementById('noMatchBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'noMatchBanner';
    banner.style.cssText = [
        'background:var(--off-white,#f5f7fa)',
        'border:2px solid var(--border-color,#e0e4ed)',
        'border-radius:14px',
        'padding:1.5rem 1.75rem',
        'margin:1.25rem auto',
        'max-width:620px',
        'text-align:center',
        'font-family:Barlow Condensed,sans-serif',
    ].join(';');

    if (nextMatch) {
        const matchTs   = new Date(`${nextMatch.datum}T${nextMatch.uur}`).getTime();
        const homeLabel = nextMatch.thuisploeg || 'Thuisploeg';
        const awayLabel = nextMatch.uitploeg   || 'Uitploeg';

        banner.innerHTML = `
            <div style="font-size:0.85rem;font-weight:700;letter-spacing:.08em;color:var(--text-gray,#6b7280);margin-bottom:.6rem;">
                VOLGENDE WEDSTRIJD
            </div>
            <div style="font-size:1.3rem;font-weight:800;color:var(--primary-blue,#0047AB);letter-spacing:.04em;margin-bottom:.9rem;">
                ${homeLabel} &nbsp;–&nbsp; ${awayLabel}
            </div>
            <div id="liveCountdown" style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;"></div>
            <div style="font-size:.88rem;color:var(--text-gray,#6b7280);">
                📅 ${new Date(`${nextMatch.datum}T${nextMatch.uur}`).toLocaleString('nl-BE',
                    { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' })}
            </div>
            <div style="margin-top:1rem;">
                <a href="index.html" style="color:var(--primary-blue,#0047AB);font-size:.9rem;text-decoration:underline;">← Terug naar home</a>
            </div>`;

        matchHeader.parentNode.insertBefore(banner, matchHeader.nextSibling);
        startCountdown(matchTs);

    } else {
        banner.innerHTML = `
            <div style="font-size:1.05rem;font-weight:600;color:var(--text-gray,#6b7280);letter-spacing:.03em;">
                ⚽ Er is momenteel geen live wedstrijd gepland.
            </div>
            <div style="margin-top:.9rem;">
                <a href="index.html" style="color:var(--primary-blue,#0047AB);font-size:.9rem;text-decoration:underline;">← Terug naar home</a>
            </div>`;
        matchHeader.parentNode.insertBefore(banner, matchHeader.nextSibling);
    }
}

// ── Aftelklok ────────────────────────────────────────────────────────────────
let _countdownInterval = null;
function startCountdown(targetTs) {
    function unit(val, label) {
        return `<div style="background:var(--primary-blue,#0047AB);color:#fff;border-radius:10px;
                            padding:.6rem .9rem;min-width:60px;text-align:center;">
                    <div style="font-size:1.7rem;font-weight:800;line-height:1;">${String(val).padStart(2,'0')}</div>
                    <div style="font-size:.62rem;letter-spacing:.08em;opacity:.8;margin-top:2px;">${label}</div>
                </div>`;
    }

    function render() {
        const diff = targetTs - Date.now();
        const el   = document.getElementById('liveCountdown');
        if (!el) { clearInterval(_countdownInterval); return; }

        if (diff <= 0) {
            clearInterval(_countdownInterval);
            el.innerHTML = '<span style="font-size:1.1rem;font-weight:700;color:var(--primary-blue,#0047AB);">⚽ Aftrap verwacht!</span>';
            return;
        }

        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000)  / 60000);
        const s = Math.floor((diff % 60000)    / 1000);

        let html = '';
        if (d > 0) html += unit(d, d === 1 ? 'DAG' : 'DAGEN');
        html += unit(h, 'UUR');
        html += unit(m, 'MIN');
        html += unit(s, 'SEC');
        el.innerHTML = html;
    }

    render();
    clearInterval(_countdownInterval);
    _countdownInterval = setInterval(render, 1000);
}

// ── Eindstand banner na beëindigen ───────────────────────────────────────────
function showMatchFinishedState() {
    // Status badge updaten
    const statusEl = document.getElementById('matchStatus');
    if (statusEl) {
        statusEl.textContent      = 'Afgelopen';
        statusEl.style.background = '#6c757d';
    }

    // Minuut-display
    const minuteEl = document.getElementById('currentMinute');
    if (minuteEl) minuteEl.textContent = 'FT';

    // Controlpanel verbergen
    const panel = document.getElementById('controlPanel');
    if (panel) panel.style.display = 'none';

    // Eindstand-banner tonen
    const matchHeader = document.querySelector('.match-header');
    if (matchHeader && !document.getElementById('finishedBanner')) {
        const banner = document.createElement('div');
        banner.id = 'finishedBanner';
        banner.style.cssText = [
            'background:#d1fae5',
            'border:2px solid #6ee7b7',
            'border-radius:12px',
            'padding:1.25rem 1.5rem',
            'margin:1.5rem auto',
            'max-width:600px',
            'text-align:center',
            'font-family:Barlow Condensed,sans-serif',
            'font-size:1.2rem',
            'font-weight:700',
            'color:#065f46',
            'letter-spacing:0.04em',
        ].join(';');
        banner.innerHTML = '✅ Wedstrijd beëindigd! De eindstand is opgeslagen. ' +
            '<br><a href="index.html" style="color:#047857;text-decoration:underline;font-size:1rem;">Terug naar home →</a>';
        matchHeader.parentNode.insertBefore(banner, matchHeader.nextSibling);
    }
}

// ── VVS WIN CONFETTI ─────────────────────────────────────────────────────────
function launchWinConfetti() {
    if (typeof confetti !== 'function') return;

    const end    = Date.now() + 2 * 1000;
    const colors = ['#0047AB', '#ffffff'];

    (function frame() {
        confetti({
            particleCount: 2,
            angle:  60,
            spread: 55,
            origin: { x: 0 },
            colors
        });
        confetti({
            particleCount: 2,
            angle:  120,
            spread: 55,
            origin: { x: 1 },
            colors
        });
        if (Date.now() < end) requestAnimationFrame(frame);
    })();
}