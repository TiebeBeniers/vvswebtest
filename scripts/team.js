// ===============================================
// TEAM PAGE FUNCTIONALITY
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, getDoc, orderBy, limit, onSnapshot, doc, setDoc, deleteDoc, updateDoc, increment, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Team.js loaded');

// ── Cache ─────────────────────────────────────────────────────────────────────
//
// Wat wordt gecached en hoe lang:
//   recent_matches_{team}   30 min  — verandert alleen na een wedstrijd
//   next_match_{team}       10 min  — komende wedstrijd wijzigt zelden door de week
//   team_stats_{team}       60 min  — doelpunten/assists veranderen alleen na wedstrijd
//   timeline_{matchId}      permanent (wedstrijden zijn immutable na 'finished')
//   ranking_{team}          30 min  — opgeslagen in Firestore, admin invalideert bij update
//
// Availability wordt NIET gecached — dat is real-time via onSnapshot.
//
const CACHE_TTL = {
    recentMatches: 30 * 60 * 1000,           // 30 min — verandert na wedstrijden
    nextMatch:     15 * 60 * 1000,           // 15 min — volgende wedstrijd
    teamStats:     60 * 60 * 1000,           // 60 min — statistieken
    timeline:      7 * 24 * 60 * 60 * 1000, // 7 dagen — afgelopen tijdlijnen (immutable)
};

// Hoe lang (minuten) na aftrap een geplande match nog als "bezig" getoond wordt
// als er geen live-tracking actief is (zelfde waarde als in app.js).
const MATCH_VISIBLE_WINDOW_MINUTES = 90;

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

function tcGet(key, ttl) {
    if (PAGE_REFRESHED) return null; // negeer cache bij refresh
    try {
        const raw = localStorage.getItem(`vvs_${key}`);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (ttl !== Infinity && Date.now() - ts > ttl) {
            localStorage.removeItem(`vvs_${key}`);
            return null;
        }
        return data;
    } catch (_) { return null; }
}

function tcSet(key, data) {
    try {
        localStorage.setItem(`vvs_${key}`, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) { /* quota vol — geen probleem, gewoon doorgaan */ }
}

function tcDel(key) {
    try { localStorage.removeItem(`vvs_${key}`); } catch (_) {}
}

// Get team type from URL (e.g., veteranen.html -> veteranen)
function getTeamTypeFromURL() {
    const path = window.location.pathname;
    const filename = path.substring(path.lastIndexOf('/') + 1);
    const teamType = filename.replace('.html', '');
    
    // Validate team type
    const validTeams = ['veteranen', 'zaterdag', 'zondag'];
    if (validTeams.includes(teamType)) {
        return teamType;
    }
    
    // Fallback: check if set in window
    if (window.TEAM_TYPE) {
        return window.TEAM_TYPE;
    }
    
    console.error('Could not determine team type from URL:', filename);
    return null;
}

const TEAM_TYPE = getTeamTypeFromURL();
console.log('Team type:', TEAM_TYPE);

// ===============================================
// AUTH STATE
// ===============================================

let currentUser = null;
let currentUserData = null; // Firestore gebruikersprofiel van de ingelogde user

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    
    if (user) {
        currentUser = user;
        if (loginLink) loginLink.textContent = 'PROFIEL';

        // Laad Firestore-profiel (gecached in localStorage, 30 min TTL)
        currentUserData = null;
        try {
            const raw = localStorage.getItem(`vvs_authuser_${user.uid}`);
            if (raw) {
                const { ts, data } = JSON.parse(raw);
                if (Date.now() - ts < 30 * 60 * 1000) currentUserData = data;
            }
        } catch (_) {}

        if (!currentUserData) {
            try {
                const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
                if (!snap.empty) {
                    currentUserData = snap.docs[0].data();
                    localStorage.setItem(`vvs_authuser_${user.uid}`,
                        JSON.stringify({ ts: Date.now(), data: currentUserData }));
                }
            } catch (_) {}
        }
    } else {
        currentUser = null;
        currentUserData = null;
        if (loginLink) loginLink.textContent = 'LOGIN';
    }

    // Re-render MOTM sectie zodra auth + userData bekend zijn.
    // loadRecentMatches kan al gelopen hebben vóór login.
    renderMotmSection();
});

// ===============================================
// LOAD NEXT MATCH OR LIVE MATCH
// ===============================================

let liveMatchListener = null;
let allPlannedMatches  = [];   // alle geplande wedstrijden van dit team
let currentPlannedIdx  = 0;   // index van de huidige weergegeven geplande wedstrijd
let liveUpdateInterval = null;

async function loadNextMatch() {
    console.log('Loading next match for', TEAM_TYPE);
    const container = document.getElementById('nextMatchContainer');
    
    if (!container) return;
    
    // First check for live match
    const liveQuery = query(
        collection(db, 'matches'),
        where('team', '==', TEAM_TYPE),
        where('status', 'in', ['live', 'rust'])
    );
    
    try {
        // Setup real-time listener for live matches
        if (liveMatchListener) {
            liveMatchListener();
        }
        
        liveMatchListener = onSnapshot(liveQuery, (snapshot) => {
            if (!snapshot.empty) {
                // Live match found
                const matchData = snapshot.docs[0].data();
                const matchId = snapshot.docs[0].id;
                const fullMatch = { id: matchId, ...matchData };

                // If the card isn't rendered yet, render it; otherwise just refresh data
                const container = document.getElementById('nextMatchContainer');
                if (!container) return;

                if (!container.querySelector('.team-live-card')) {
                    displayLiveMatch(fullMatch, container);
                    startLiveUpdate(fullMatch);
                } else {
                    refreshLiveMatch(fullMatch);
                }
            } else {
                // No live match, show next planned match
                stopLiveUpdate();
                const container = document.getElementById('nextMatchContainer');
                if (container) loadPlannedMatch(container);
            }
        });
        
    } catch (error) {
        console.error('Error loading match:', error);
        container.innerHTML = '<p class="error">Fout bij laden van wedstrijd.</p>';
    }
}

async function loadPlannedMatch(container) {
    console.log('Loading planned matches for team:', TEAM_TYPE);

    // ── Cache check ──────────────────────────────────────────────────────────
    const cacheKey = `planned_matches_${TEAM_TYPE}`;
    const cached = tcGet(cacheKey, CACHE_TTL.nextMatch);
    if (cached && cached.length > 0) {
        console.log('[cache] planned matches geladen:', cached.length);
        allPlannedMatches = cached;
        currentPlannedIdx = 0;
        displayPlannedMatch(allPlannedMatches[0], container);
        renderPlannedNav(container);
        return;
    }

    try {
        const snapshot = await getDocs(query(
            collection(db, 'matches'),
            where('team', '==', TEAM_TYPE),
            where('status', '==', 'planned')
        ));

        if (snapshot.empty) {
            container.innerHTML = '<p class="no-matches">Geen geplande wedstrijden gevonden.</p>';
            return;
        }

        const matches = [];
        snapshot.forEach(doc => matches.push({ id: doc.id, ...doc.data() }));

        matches.sort((a, b) =>
            new Date(`${a.datum}T${a.uur || '00:00'}`) - new Date(`${b.datum}T${b.uur || '00:00'}`)
        );

        const now = new Date();
        const windowMs = MATCH_VISIBLE_WINDOW_MINUTES * 60 * 1000;

        // Splitter: matches die nog komen INCLUSIEF matches die binnen het bezig-venster vallen
        const futureAndOngoing = matches.filter(m => {
            const kickoff = new Date(`${m.datum}T${m.uur || '00:00'}`);
            const windowEnd = new Date(kickoff.getTime() + windowMs);
            return kickoff >= now || (now >= kickoff && now <= windowEnd);
        });

        allPlannedMatches = futureAndOngoing.length > 0 ? futureAndOngoing : [matches[matches.length - 1]];

        // Sla alleen echte toekomstige matches op in cache — niet de "bezig" match,
        // want die zou anders gecached worden als toekomstig na een refresh.
        const onlyFuture = matches.filter(m => new Date(`${m.datum}T${m.uur || '00:00'}`) >= now);
        tcSet(cacheKey, onlyFuture.length > 0 ? onlyFuture : allPlannedMatches);

        currentPlannedIdx = 0;
        const firstMatch = allPlannedMatches[0];
        const firstKickoff = new Date(`${firstMatch.datum}T${firstMatch.uur || '00:00'}`);
        const isBezig = now > firstKickoff;

        if (isBezig) {
            displayBezigMatch(firstMatch, container);
        } else {
            displayPlannedMatch(firstMatch, container);
            renderPlannedNav(container);
        }

    } catch (error) {
        console.error('Error loading planned matches:', error);
        container.innerHTML = `<p class="error">Fout bij laden: ${error.message}</p>`;
    }
}

function renderPlannedNav(container) {
    // Remove existing nav if any
    container.parentElement?.querySelector('.planned-nav')?.remove();

    if (allPlannedMatches.length <= 1) return;

    const nav = document.createElement('div');
    nav.className = 'planned-nav';
    nav.innerHTML = `
        <button class="planned-nav-btn prev" id="plannedPrev" aria-label="Vorige wedstrijd">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="planned-nav-label" id="plannedNavLabel"></span>
        <button class="planned-nav-btn next" id="plannedNext" aria-label="Volgende wedstrijd">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
    `;
    container.parentElement.appendChild(nav);
    updatePlannedNavState();

    nav.querySelector('#plannedPrev').addEventListener('click', () => navigatePlanned(-1, container));
    nav.querySelector('#plannedNext').addEventListener('click', () => navigatePlanned(1, container));

    // Touch/swipe on the card container
    let touchStartX = 0;
    container.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    container.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].screenX - touchStartX;
        if (Math.abs(dx) > 50) navigatePlanned(dx < 0 ? 1 : -1, container);
    }, { passive: true });
}

function updatePlannedNavState() {
    const label = document.getElementById('plannedNavLabel');
    const prev  = document.getElementById('plannedPrev');
    const next  = document.getElementById('plannedNext');
    if (label) label.textContent = `${currentPlannedIdx + 1} / ${allPlannedMatches.length}`;
    if (prev)  prev.disabled  = currentPlannedIdx === 0;
    if (next)  next.disabled  = currentPlannedIdx === allPlannedMatches.length - 1;
}

function navigatePlanned(dir, container) {
    const newIdx = currentPlannedIdx + dir;
    if (newIdx < 0 || newIdx >= allPlannedMatches.length) return;
    currentPlannedIdx = newIdx;
    displayPlannedMatch(allPlannedMatches[currentPlannedIdx], container);
    updatePlannedNavState();
}


// ── Bezig-kaart: render gewone planned-kaart maar met BEZIG-badge en streepjes ──
function displayBezigMatch(match, container) {
    // Render de normale planned-kaart zodat navigatie en availability behouden blijven
    displayPlannedMatch(match, container);
    renderPlannedNav(container);

    // Voeg BEZIG-badge toe in de match-date rij, links van de datum
    const card = container.querySelector('.next-match-card');
    if (!card) return;
    card.classList.add('bezig-card');

    const dateRow = card.querySelector('.match-date');
    if (dateRow) {
        const badge = document.createElement('span');
        badge.className = 'bezig-badge';
        badge.textContent = 'BEZIG';
        dateRow.prepend(badge);
    }

    // Vervang VS door streepjes (score onbekend)
    const vsEl = card.querySelector('.vs');
    if (vsEl) {
        vsEl.innerHTML = `
            <span class="bezig-score">—</span>
            <span class="bezig-separator">-</span>
            <span class="bezig-score">—</span>`;
        vsEl.classList.add('bezig-vs-wrap');
    }
}

function displayPlannedMatch(match, container) {
    console.log('Displaying planned match:', match);
    
    try {
        const matchDate = new Date(`${match.datum}T${match.uur || '00:00'}`);
        const formattedDate = matchDate.toLocaleDateString('nl-BE', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const formattedTime = match.uur || 'Tijd niet beschikbaar';
        
        // Availability section HTML - alleen voor ingelogde users
        const availabilityHTML = currentUser ? `
                <!-- Availability Section -->
                <div class="availability-section" id="availabilitySection">
                    <div class="availability-header">
                        <div class="availability-title">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            Beschikbaarheid
                        </div>
                        <div class="availability-summary" id="availabilitySummary">
                            <div class="availability-count available">
                                <span>✓</span>
                                <span id="availableCount">0</span>
                            </div>
                            <div class="availability-count unavailable">
                                <span>✗</span>
                                <span id="unavailableCount">0</span>
                            </div>
                        </div>
                    </div>
                    <div id="availabilityContent">
                        <div class="loading"><div class="loader"></div></div>
                    </div>
                </div>
        ` : '';
        
        // Cancel any running availability listener from previous card
        if (availabilityListener) { availabilityListener(); availabilityListener = null; }
        
        container.innerHTML = `
            <div class="next-match-card planned">
                <div class="match-date">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span>${formattedDate} om ${formattedTime}</span>
                    ${match.isBekermatch ? '<span class="match-flag-badge flag-beker">🏆 BEKERMATCH</span>' : ''}
                    ${match.isForfait    ? '<span class="match-flag-badge flag-forfait">FORFAIT</span>'      : ''}
                    <button class="match-share-btn" id="matchShareBtn" aria-label="Wedstrijd delen">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                        </svg>
                        Delen
                    </button>
                </div>
                <div class="match-teams-preview">
                    <div class="team-name">${match.thuisploeg || 'Thuisploeg'}</div>
                    <div class="vs">VS</div>
                    <div class="team-name">${match.uitploeg || 'Uitploeg'}</div>
                </div>
                <div class="match-location">
                    <button class="map-trigger" aria-label="Toon op kaart" data-location="${encodeURIComponent(match.locatie || '')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                    </button>
                    <span>${match.locatie || 'Locatie niet beschikbaar'}</span>
                    <div class="map-popup" aria-hidden="true">
                        <div class="map-popup-inner">
                            <iframe
                                class="map-iframe"
                                loading="lazy"
                                referrerpolicy="no-referrer-when-downgrade"
                                src="https://maps.google.com/maps?q=${encodeURIComponent(match.locatie || 'België')}&z=15&output=embed"
                                title="Locatie ${match.locatie || ''}"
                                aria-hidden="true">
                            </iframe>
                            <a class="map-open-link"
                               href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(match.locatie || '')}"
                               target="_blank" rel="noopener noreferrer">
                                Open in Google Maps ↗
                            </a>
                        </div>
                    </div>
                </div>
                ${match.beschrijving ? `<div class="match-description">${match.beschrijving}</div>` : ''}
                ${availabilityHTML}
            </div>
        `;
        
        console.log('Planned match displayed successfully');
        
        // Load availability data (alleen als user ingelogd is)
        if (currentUser) {
            loadAvailability(match.id, match);
        }

        // ── Map hover popup ──────────────────────────────────────────────────
        initMapPopups();
        
        // ── Share knop ────────────────────────────────────────────────────────
        document.getElementById('matchShareBtn')?.addEventListener('click', () => sharePlannedMatch(match));
        
    } catch (error) {
        console.error('Error displaying planned match:', error);
        container.innerHTML = `<p class="error">Fout bij weergeven van wedstrijd: ${error.message}</p>`;
    }
}

function displayLiveMatch(match, container) {
    const isRust = match.status === 'rust';
    const isET   = match.extraTimeStarted;
    const badgeText  = isRust ? 'RUST' : (isET ? 'VERL.' : 'LIVE');
    const badgeClass = isRust ? 'rust' : 'live';

    container.innerHTML = `
        <div class="next-match-card live team-live-card">
            <div class="live-badge-small ${badgeClass}">${badgeText}</div>
            <div class="live-match-display">
                <div class="live-team">
                    <div class="team-name">${match.thuisploeg}</div>
                    <div class="live-score" id="liveHomeScore">${match.scoreThuis ?? 0}</div>
                </div>
                <div class="live-center">
                    <div class="live-time" id="liveTime">${calculateDisplayTime(match)}</div>
                    <div class="live-separator">-</div>
                </div>
                <div class="live-team">
                    <div class="team-name">${match.uitploeg}</div>
                    <div class="live-score" id="liveAwayScore">${match.scoreUit ?? 0}</div>
                </div>
            </div>
            <button class="watch-live-btn" onclick="window.location.href='live.html'">
                VOLG LIVE →
            </button>
        </div>
    `;
}

function updateLiveDisplay(match) {
    const timeEl      = document.getElementById('liveTime');
    const homeScoreEl = document.getElementById('liveHomeScore');
    const awayScoreEl = document.getElementById('liveAwayScore');
    const badgeEl     = document.querySelector('.team-live-card .live-badge-small');
    
    if (!timeEl) return;
    
    if (homeScoreEl) homeScoreEl.textContent = match.scoreThuis ?? 0;
    if (awayScoreEl) awayScoreEl.textContent = match.scoreUit   ?? 0;
    if (timeEl)      timeEl.textContent      = calculateDisplayTime(match);

    if (badgeEl) {
        const isRust = match.status === 'rust';
        const isET   = match.extraTimeStarted;
        badgeEl.textContent = isRust ? 'RUST' : (isET ? 'VERL.' : 'LIVE');
        badgeEl.className   = `live-badge-small ${isRust ? 'rust' : 'live'}`;
    }
}

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

    } catch (error) {
        console.error('Error calculating time:', error);
        return "0'";
    }
}

let currentLiveMatch = null;

function startLiveUpdate(match) {
    currentLiveMatch = match;
    stopLiveUpdate();
    
    liveUpdateInterval = setInterval(() => {
        if (currentLiveMatch) {
            updateLiveDisplay(currentLiveMatch);
        }
    }, 1000);
}

// Called from the onSnapshot to keep currentLiveMatch up to date
function refreshLiveMatch(match) {
    currentLiveMatch = match;
    updateLiveDisplay(match);
}

function stopLiveUpdate() {
    if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
        liveUpdateInterval = null;
    }
    currentLiveMatch = null;
}

// ===============================================
// LOAD RANKING
// ===============================================

async function loadRanking() {
    console.log('Loading ranking for', TEAM_TYPE);
    const tbody = document.getElementById('rankingBody');
    if (!tbody) { console.error('Ranking body element not found'); return; }

    // Check cache eerst (30 min TTL) — cache slaat ook updatedAt op
    const cached = tcGet(`ranking_${TEAM_TYPE}`, 30 * 60 * 1000);
    if (cached) {
        console.log('[cache] ranking hit for', TEAM_TYPE);
        renderRankingTable(tbody, cached.teams, cached.updatedAt);
        return;
    }

    try {
        console.log('[firestore] ranking fetch for', TEAM_TYPE);
        const snap = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')
            .then(m => m.getDoc(m.doc(db, 'ranking', TEAM_TYPE)));

        if (!snap.exists() || !snap.data().teams?.length) {
            console.warn('No ranking in Firestore for', TEAM_TYPE);
            // Mooie lege staat in plaats van kale tekst
            const container = tbody.closest('.ranking-table-container');
            if (container) {
                container.innerHTML = `
                    <div style="
                        display:flex; flex-direction:column; align-items:center;
                        justify-content:center; padding:3rem 1.5rem; gap:0.75rem;
                        color:var(--text-gray,#6b7280); text-align:center;
                    ">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="1.5" opacity="0.45">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <line x1="3" y1="9" x2="21" y2="9"/>
                            <line x1="3" y1="15" x2="21" y2="15"/>
                            <line x1="9" y1="9" x2="9" y2="21"/>
                        </svg>
                        <p style="font-size:1.05rem;font-weight:700;margin:0;
                                  color:var(--text-dark,#1a202c);">
                            Nog geen klassement beschikbaar
                        </p>
                        <p style="font-size:0.88rem;margin:0;max-width:300px;line-height:1.5;">
                            Het klassement wordt toegevoegd zodra de competitie van start gaat.
                            Kom later terug!
                        </p>
                    </div>`;
            } else {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-gray);">Nog geen klassement beschikbaar.</td></tr>';
            }
            return;
        }

        const teams     = snap.data().teams;
        const updatedAt = snap.data().updatedAt?.toDate?.()?.toLocaleDateString('nl-BE') || null;

        tcSet(`ranking_${TEAM_TYPE}`, { teams, updatedAt });
        renderRankingTable(tbody, teams, updatedAt);

    } catch (error) {
        console.error('Error loading ranking:', error);
        tbody.innerHTML = `<tr><td colspan="10" class="error">Fout bij laden van ranking: ${error.message}</td></tr>`;
    }
}

function cleanTeamName(name) {
    // Verwijder aaneengeplakte herhaling: "VC TORENPLOEGVC TORENPLOEG" → "VC TORENPLOEG"
    const concatMatch = name.match(/^(.+)\1$/);
    if (concatMatch) return concatMatch[1].trim();
    // Spatie-gescheiden herhaling: "VC TORENPLOEG VC TORENPLOEG" → "VC TORENPLOEG"
    const words = name.split(/\s+/).filter(w => w);
    const half  = Math.floor(words.length / 2);
    if (words.length > 0 && words.length % 2 === 0 && half > 0) {
        const a = words.slice(0, half).join(' ');
        const b = words.slice(half).join(' ');
        if (a === b) return a;
    }
    return name;
}

function renderRankingTable(tbody, teamRanking, updatedAt = null) {
    tbody.innerHTML = '';
    teamRanking.forEach((team, index) => {
        const row = document.createElement('tr');
        const isVVS = team.team.includes('V.V.S');
        if (isVVS) {
            row.classList.add('vvs-row');
        } else {
            row.classList.add(index % 2 === 0 ? 'even-row' : 'odd-row');
        }

        const teamName = cleanTeamName(team.team);
        const played   = team.played ?? (team.won + team.draw + team.lost);

        row.innerHTML = `
            <td class="pos-col">${team.pos}</td>
            <td class="team-col">${teamName}</td>
            <td class="pnt-col"><strong>${team.pnt}</strong></td>
            <td class="stat-col">${played}</td>
            <td class="stat-col">${team.won}</td>
            <td class="stat-col">${team.draw}</td>
            <td class="stat-col">${team.lost}</td>
            <td class="goals-col">${team.goals_for}</td>
            <td class="goals-col">${team.goals_against}</td>
            <td class="saldo-col ${team.saldo >= 0 ? 'positive' : 'negative'}">${team.saldo >= 0 ? '+' : ''}${team.saldo}</td>
        `;
        tbody.appendChild(row);
    });

    // Toon "laatste update" onder de tabel (buiten de table-container, binnen de section)
    if (updatedAt) {
        const existing = document.getElementById('rankingUpdatedAt');
        if (existing) existing.remove();
        const note = document.createElement('p');
        note.id = 'rankingUpdatedAt';
        note.style.cssText = 'font-size:0.78rem;color:#aaa;margin-top:0.5rem;text-align:right;';
        note.textContent = `Laatste update: ${updatedAt}`;
        const container = tbody.closest('.ranking-table-container');
        container?.parentNode?.insertBefore(note, container.nextSibling);
    }

    console.log('Ranking table populated successfully');
}

// ===============================================
// LOAD RECENT MATCHES
// ===============================================

// Sla alle geladen wedstrijden op voor "meer laden"
let allRecentMatches = [];
const INITIAL_SHOW = 3;
const LOAD_MORE_STEP = 3;
let currentlyShowing = INITIAL_SHOW;

// Bereken win/loss/draw voor VVS Rotselaar
function getMatchResult(match) {
    const vvsNames = ['v.v.s rotselaar', 'vvs rotselaar', 'v.v.s. rotselaar'];
    const homeIsVVS = vvsNames.includes((match.thuisploeg || '').toLowerCase());
    const awayIsVVS = vvsNames.includes((match.uitploeg || '').toLowerCase());

    const home = match.scoreThuis ?? 0;
    const away = match.scoreUit  ?? 0;

    if (!homeIsVVS && !awayIsVVS) return 'unknown';
    if (home === away) return 'draw';

    const vvsScore  = homeIsVVS ? home : away;
    const oppScore  = homeIsVVS ? away : home;
    return vvsScore > oppScore ? 'win' : 'loss';
}

function renderFormBar(matches) {
    // matches zijn gesorteerd van meest recent → oud
    // Neem de laatste 5 (of minder), keer de volgorde om → oudste links
    const last5 = matches.slice(0, 5).reverse();

    const circles = [];
    for (let i = 0; i < 5; i++) {
        if (i < last5.length) {
            const result = getMatchResult(last5[i]);
            if      (result === 'win')  circles.push('<span class="form-circle win"  title="Gewonnen"></span>');
            else if (result === 'loss') circles.push('<span class="form-circle loss" title="Verloren"></span>');
            else if (result === 'draw') circles.push('<span class="form-circle draw" title="Gelijkspel"></span>');
            else                        circles.push('<span class="form-circle empty" title="Onbekend"></span>');
        } else {
            circles.push('<span class="form-circle empty" title="Geen wedstrijd"></span>');
        }
    }
    return circles.join('');
}

// Aparte functie zodat zowel Firestore- als cache-pad hem kunnen aanroepen
function renderFormBarFromMatches() {
    const container = document.getElementById('recentMatchesList');
    if (!container || allRecentMatches.length === 0) return;
    const section = container.closest('section');
    if (!section) return;
    let header = section.querySelector('.recent-matches-header');
    if (!header) {
        const h2 = section.querySelector('h2');
        if (h2) {
            header = document.createElement('div');
            header.className = 'recent-matches-header';
            h2.parentNode.insertBefore(header, h2);
            header.appendChild(h2);
        }
    }
    if (header) {
        const old = header.querySelector('.form-bar');
        if (old) old.remove();
        const formBar = document.createElement('div');
        formBar.className = 'form-bar';
        formBar.innerHTML = `<div class="form-circles">${renderFormBar(allRecentMatches)}</div>`;
        header.appendChild(formBar);
    }
}

async function loadRecentMatches() {
    console.log('Loading recent matches for', TEAM_TYPE);
    const container = document.getElementById('recentMatchesList');
    if (!container) return;

    // ── Cache check ──────────────────────────────────────────────────────────
    const cacheKey = `recent_matches_${TEAM_TYPE}`;
    const cached = tcGet(cacheKey, CACHE_TTL.recentMatches);
    if (cached) {
        console.log('[cache] recent matches geladen:', cached.length);
        allRecentMatches = cached;
        currentlyShowing = INITIAL_SHOW;
        renderRecentMatches(container);
        renderFormBarFromMatches();
        renderMotmSection();
        return;
    }

    try {
        const recentQuery = query(
            collection(db, 'matches'),
            where('team', '==', TEAM_TYPE),
            where('status', '==', 'finished')
        );

        const snapshot = await getDocs(recentQuery);
        console.log('Found', snapshot.size, 'finished matches');

        if (snapshot.empty) {
            container.innerHTML = '<p class="no-matches">Nog geen afgelopen wedstrijden.</p>';
            return;
        }

        // Verzamel en sorteer
        allRecentMatches = [];
        snapshot.forEach(doc => {
            allRecentMatches.push({ id: doc.id, ...doc.data() });
        });
        allRecentMatches.sort((a, b) => {
            const dateA = new Date(`${a.datum}T${a.uur || '00:00'}`);
            const dateB = new Date(`${b.datum}T${b.uur || '00:00'}`);
            return dateB - dateA; // meest recent eerst
        });

        // Cache opslaan
        tcSet(cacheKey, allRecentMatches);

        currentlyShowing = INITIAL_SHOW;
        renderRecentMatches(container);
        renderFormBarFromMatches();
        renderMotmSection();

    } catch (error) {
        console.error('Error loading recent matches:', error);
        container.innerHTML = `<p class="error">Fout bij laden: ${error.message}</p>`;
    }
}

function renderRecentMatches(container) {
    container.innerHTML = '';

    // Wedstrijdkaartjes
    const toShow = allRecentMatches.slice(0, currentlyShowing);
    toShow.forEach(match => {
        container.appendChild(createRecentMatchCard(match));
    });

    // "Meer laden" knop
    if (currentlyShowing < allRecentMatches.length) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'load-more-btn';
        moreBtn.textContent = `Meer laden (${allRecentMatches.length - currentlyShowing} resterend)`;
        moreBtn.addEventListener('click', () => {
            currentlyShowing += LOAD_MORE_STEP;
            renderRecentMatches(container);
            moreBtn.scrollIntoView({ behavior: 'smooth', block: 'end' });
        });
        container.appendChild(moreBtn);
    }
}

function createRecentMatchCard(match) {
    const card = document.createElement('div');
    card.className = 'recent-match-card';

    const matchDate = new Date(`${match.datum}T${match.uur || '00:00'}`);
    const formattedDate = matchDate.toLocaleDateString('nl-BE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    // Voeg result klasse toe aan de kaart voor kleurcodering
    const result = getMatchResult(match);
    if (result === 'win')  card.classList.add('result-win');
    if (result === 'loss') card.classList.add('result-loss');
    if (result === 'draw') card.classList.add('result-draw');

    const now       = new Date();
    const dayEnd    = new Date(matchDate);
    dayEnd.setHours(23, 59, 59, 999);
    const motmVotingOpen = now >= matchDate && now <= dayEnd;
    const motmResults    = match.motmResults || null;

    // Badges voor forfait / bekermatch
    const matchBadges = [
        match.isForfait   ? '<span class="match-flag-badge flag-forfait">FORFAIT</span>' : '',
        match.isBekermatch ? '<span class="match-flag-badge flag-beker">🏆 BEKERMATCH</span>' : '',
    ].filter(Boolean).join('');

    card.innerHTML = `
        <div class="recent-match-date-row">
            <span class="recent-match-date">${formattedDate} - ${match.uur}</span>
            ${matchBadges}
        </div>
        <div class="recent-match-teams">
            <div class="recent-team">${match.thuisploeg}</div>
            <div class="recent-score">${match.scoreThuis} - ${match.scoreUit}</div>
            <div class="recent-team">${match.uitploeg}</div>
        </div>
        ${match.beschrijving ? `<div class="recent-match-desc">${match.beschrijving}</div>` : ''}
        ${motmResults && currentUser && motmResultsVisible(match) ? `<div class="motm-result">
            🏆 Man van de Match: ${motmResults.slice(0,3).map((r,i) => `<span class="motm-pos">${['🥇','🥈','🥉'][i]} ${r.name} (${r.points}pnt)</span>`).join('')}
        </div>` : ''}
    `;

    card.addEventListener('click', () => showMatchTimeline(match));
    return card;
}

// ===============================================
// MATCH TIMELINE MODAL
// ===============================================

async function showMatchTimeline(match) {
    const modal           = document.getElementById('timelineModal');
    const modalTitle      = document.getElementById('timelineModalTitle');
    const modalHomeTeam   = document.getElementById('modalHomeTeam');
    const modalAwayTeam   = document.getElementById('modalAwayTeam');
    const modalHomeScore  = document.getElementById('modalHomeScore');
    const modalAwayScore  = document.getElementById('modalAwayScore');
    const modalMatchDate  = document.getElementById('modalMatchDate');
    const modalMatchLocation = document.getElementById('modalMatchLocation');
    const modalTimeline   = document.getElementById('modalTimeline');

    if (!modal) return;

    modalTitle.textContent      = 'Wedstrijd Samenvatting';
    modalHomeTeam.textContent   = match.thuisploeg;
    modalAwayTeam.textContent   = match.uitploeg;
    modalHomeScore.textContent  = match.scoreThuis || 0;
    modalAwayScore.textContent  = match.scoreUit   || 0;

    const matchDate = new Date(`${match.datum}T${match.uur}`);
    modalMatchDate.textContent = matchDate.toLocaleDateString('nl-BE', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    modalMatchLocation.textContent = match.locatie;

    modal.classList.add('active');
    // Verwijder eventuele knop + panel van een vorige wedstrijd (die als sibling
    // naast modalTimeline staan en dus niet meegaan met een innerHTML-reset).
    modal.querySelectorAll('.av-toggle-btn, .av-toggle-panel').forEach(el => el.remove());
    modalTimeline.innerHTML = '<div class="loading"><div class="loader"></div></div>';

    // Bepaal welke kant VVS is en markeer de timeline voor CSS-kleuring
    const vvsNamesModal = ['v.v.s rotselaar', 'vvs rotselaar', 'v.v.s. rotselaar'];
    const thuisIsVvs = vvsNamesModal.includes((match.thuisploeg || '').toLowerCase());
    modalTimeline.dataset.vvsSide = thuisIsVvs ? 'home' : 'away';

    // Bouw naam→uid map uit de opgeslagen lineup van deze wedstrijd
    const matchUidMap = {};
    if (match.lineup) {
        Object.entries(match.lineup).forEach(([uid, info]) => {
            if (uid && info.name && !uid.startsWith('manual_')) matchUidMap[info.name] = uid;
        });
    }

    // ── Timeline cache — wedstrijdevents veranderen niet meer na 'finished' ──
    const tlKey = `timeline_${match.id}`;
    const cachedEvents = tcGet(tlKey, CACHE_TTL.timeline);
    if (cachedEvents) {
        console.log('[cache] timeline geladen voor', match.id);
        if (cachedEvents.length === 0) {
            await renderModalFallback(modalTimeline, match, matchUidMap);
        } else {
            modalTimeline.innerHTML = '';
            renderTimelineTeam(cachedEvents, modalTimeline, matchUidMap);
            addAvailabilityToggle(modalTimeline, match);
        }
        return;
    }

    try {
        const eventsSnapshot = await getDocs(query(
            collection(db, 'events'),
            where('matchId', '==', match.id)
        ));

        if (eventsSnapshot.empty) {
            tcSet(tlKey, []);
            await renderModalFallback(modalTimeline, match, matchUidMap);
            return;
        }

        const events = [];
        eventsSnapshot.forEach(d => events.push({ id: d.id, ...d.data() }));

        const serializableEvents = events.map(e => ({
            ...e,
            timestamp: e.timestamp?.toMillis ? e.timestamp.toMillis() : e.timestamp
        }));
        tcSet(tlKey, serializableEvents);

        modalTimeline.innerHTML = '';
        renderTimelineTeam(events, modalTimeline, matchUidMap);
        addAvailabilityToggle(modalTimeline, match);

    } catch (error) {
        console.error('Error loading match timeline:', error);
        modalTimeline.innerHTML = '<p class="error">Fout bij laden van timeline.</p>';
    }
}

// ── Modal fallback: availability + lineup when no events ──────────────────────

function renderModalFallback(container, match, uidMap) {
    container.innerHTML = '';

    // Uitsluitend lineupDraft — de key is de echte Firebase UID (of 'manual_...')
    const playerLink = (uid, v) => {
        const name = v.name || uid;
        if (!uid.startsWith('manual_')) {
            return `<a href="speler.html?uid=${uid}" class="modal-fallback-player">${name}</a>`;
        }
        return `<span class="modal-fallback-player">${name}</span>`;
    };

    const draft = match.lineupDraft || null;
    if (draft && Object.keys(draft).length > 0) {
        const starters = Object.entries(draft).filter(([, v]) => v.status === 'starter');
        const bench    = Object.entries(draft).filter(([, v]) => v.status === 'bench');

        const lineupEl = document.createElement('div');
        lineupEl.className = 'modal-fallback-section';
        lineupEl.innerHTML = `
            <h4 class="modal-fallback-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                Opstelling
            </h4>
            <div class="modal-fallback-lineup">
                <div class="modal-fallback-col">
                    <strong>Basis</strong>
                    ${starters.map(([uid, v]) => playerLink(uid, v)).join('')}
                </div>
                ${bench.length > 0 ? `<div class="modal-fallback-col">
                    <strong>Bank</strong>
                    ${bench.map(([uid, v]) => playerLink(uid, v)).join('')}
                </div>` : ''}
            </div>`;
        container.appendChild(lineupEl);
    }

    if (container.children.length === 0) {
        container.innerHTML = '<p class="no-events">Geen opstelling beschikbaar.</p>';
    }
}

function addAvailabilityToggle(timelineEl, match) {
    // Toon knop alleen als er een lineupDraft is
    if (!match.lineupDraft || Object.keys(match.lineupDraft).length === 0) return;

    const btn = document.createElement('button');
    btn.className = 'av-toggle-btn';
    btn.textContent = 'Opstelling';
    btn.title = 'Toon opstelling';

    let panel = null;
    btn.addEventListener('click', () => {
        if (panel) {
            panel.remove();
            panel = null;
            btn.classList.remove('active');
            return;
        }
        btn.classList.add('active');
        panel = document.createElement('div');
        panel.className = 'av-toggle-panel';
        // Direct na de knop invoegen (vóór de tijdslijn) — meteen zichtbaar
        btn.insertAdjacentElement('afterend', panel);
        renderModalFallback(panel, match, {});
    });

    // Insert before the timeline div
    timelineEl.insertAdjacentElement('beforebegin', btn);
}

/**
 * Renders a post-match timeline — logic mirrored from live.js.
 * Structural events (aftrap, rust, einde-regulier, einde) used as dividers.
 * Hervat events are intentionally ignored (not shown).
 * Order (top = most recent):
 *   einde → ET half 4 → ET rust → ET half 3 → einde-regulier
 *   → 2nd half → HT rust → 1st half → aftrap
 */
function renderTimelineTeam(events, container, uidMap = {}) {
    const STRUCTURAL = new Set(['aftrap', 'rust', 'einde-regulier', 'einde', 'hervat']);
    // Filter out 'hervat' entirely from display
    const structural = events.filter(e => STRUCTURAL.has(e.type) && e.type !== 'hervat');
    const regular    = events.filter(e => !STRUCTURAL.has(e.type));

    const byHalf = { 1: [], 2: [], 3: [], 4: [] };
    regular.forEach(e => {
        const h = e.half || 1;
        if (byHalf[h]) byHalf[h].push(e);
    });

    const sortDesc = (a, b) => {
        const d = (b.minuut || 0) - (a.minuut || 0);
        if (d !== 0) return d;
        if (a.timestamp && b.timestamp) {
            const tsA = typeof a.timestamp === 'number' ? a.timestamp : a.timestamp.toMillis?.() ?? 0;
            const tsB = typeof b.timestamp === 'number' ? b.timestamp : b.timestamp.toMillis?.() ?? 0;
            return tsB - tsA;
        }
        return 0;
    };
    [1, 2, 3, 4].forEach(h => byHalf[h].sort(sortDesc));

    const rustEvents = structural.filter(e => e.type === 'rust');
    const rustHT     = rustEvents.find(e => (e.half || 1) <= 2) || rustEvents[0] || null;
    const rustET     = rustEvents.find(e => (e.half || 1) >= 3) || null;
    const aftrap     = structural.find(e => e.type === 'aftrap');
    const eindeReg   = structural.find(e => e.type === 'einde-regulier');
    const einde      = structural.find(e => e.type === 'einde');

    const ordered = [];
    if (einde) ordered.push(einde);
    byHalf[4].forEach(e => ordered.push(e));
    if (rustET) ordered.push(rustET);
    byHalf[3].forEach(e => ordered.push(e));
    if (eindeReg) ordered.push(eindeReg);
    byHalf[2].forEach(e => ordered.push(e));
    if (rustHT) ordered.push(rustHT);
    byHalf[1].forEach(e => ordered.push(e));
    if (aftrap) ordered.push(aftrap);

    ordered.forEach(e => container.appendChild(createTimelineItem(e, uidMap)));
}

// Returns an <img> tag for a given event type — mirrors live.js eventIcon().
function eventIcon(type, half) {
    const img = (file, alt) =>
        `<img src="assets/${file}" alt="${alt}" class="timeline-icon-img ${alt}">`;
    switch (type) {
        case 'aftrap':          return img('goal.png',           'Aftrap');
        case 'goal':            return img('goal.png',           'Goal');
        case 'penalty':         return img('penalty.png',        'Penalty');
        case 'penalty-missed':  return img('penalty_missed.png', 'Penalty gemist');
        case 'own-goal':        return img('own-goal.png',       'Eigen doelpunt');
        case 'yellow':          return img('yellow.png',         'Gele kaart');
        case 'yellow2red':      return img('yellow2red.png',     '2e Gele kaart / Rood');
        case 'red':             return img('red.png',            'Rode kaart');
        case 'substitution':    return img('sub.png',            'Wissel');
        case 'rust':
            return (half >= 3)
                ? img('rust.png', 'Rust verlengingen')
                : img('rust.png', 'Rust');
        case 'einde-regulier': return img('extra-time.png', 'Verlengingen');
        case 'einde':          return img('einde.png',      'Einde');
        default:               return `<span class="timeline-icon-fallback">•</span>`;
    }
}

function createTimelineItem(event, uidMap = {}) {
    const item = document.createElement('div');
    item.className = `timeline-item ${event.ploeg || 'center'}`;

    // Klikbare link voor VVS-spelers met een account
    const n = (name, cls = '') => {
        const uid = uidMap[name];
        if (uid) return `<a href="speler.html?uid=${uid}" class="tl-player-link${cls ? ' ' + cls : ''}">${name}</a>`;
        return `<span${cls ? ` class="${cls}"` : ''}>${name}</span>`;
    };

    let description = '';

    switch (event.type) {
        case 'aftrap':
            description = 'Aftrap'; break;
        case 'goal':
            description = `GOAL${event.speler ? ' - ' + n(event.speler) : ''}`;
            if (event.assist) description += ` <span class="event-assist">(assist: ${n(event.assist)})</span>`;
            break;
        case 'penalty':
            description = `PENALTY${event.speler ? ' - ' + n(event.speler) : ''}`;
            if (event.assist) description += ` <span class="event-assist">(assist: ${n(event.assist)})</span>`;
            break;
        case 'penalty-missed':
            description = `Penalty gemist${event.speler ? ' - ' + n(event.speler) : ''}`;
            break;
        case 'own-goal':
            description = `Eigen doelpunt${event.speler ? ' - ' + n(event.speler) : ''}`; break;
        case 'yellow':
            description = `Gele kaart${event.speler ? ' - ' + n(event.speler) : ''}`; break;
        case 'yellow2red':
            description = `2e Gele kaart (Rood)${event.speler ? ' - ' + n(event.speler) : ''}`; break;
        case 'red':
            description = `Rode kaart${event.speler ? ' - ' + n(event.speler) : ''}`; break;
        case 'substitution': {
            const injuryIcon = event.injured
                ? `<img src="assets/blessure.png" alt="Geblesseerd" class="sub-injury-icon" title="Geblesseerd">`
                : '';
            const outsArr = event.spelersUit?.length ? event.spelersUit : (event.spelerUit ? [event.spelerUit] : []);
            const insArr  = event.spelersIn?.length  ? event.spelersIn  : (event.spelerIn  ? [event.spelerIn]  : []);
            const maxLen  = Math.max(outsArr.length, insArr.length);
            if (maxLen > 0) {
                description = '';
                outsArr.forEach((pOut, _i) => {
                    if (pOut) {
                        const inj = _i === 0 ? injuryIcon : '';
                        description += `<span class="sub-row"><img src="assets/speler_uit.png" class="sub-player-icon" alt="Uit">${n(pOut, 'sub-name')}${inj}</span>`;
                    }
                });
                if (outsArr.some(Boolean) && insArr.some(Boolean)) {
                    description += '<span class="sub-pair-sep"></span>';
                }
                insArr.forEach(pIn => {
                    if (pIn) description += `<span class="sub-row"><img src="assets/speler_in.png" class="sub-player-icon" alt="In">${n(pIn, 'sub-name')}</span>`;
                });
            } else {
                description = `Wissel${injuryIcon}`;
            }
            break;
        }
        case 'rust':
            description = (event.half >= 3) ? 'Rust verlengingen' : 'Rust'; break;
        case 'einde-regulier':
            description = 'Einde reguliere tijd — Verlengingen'; break;
        case 'einde':
            description = 'Einde wedstrijd'; break;
        default:
            description = event.type;
    }

    item.innerHTML = `
        <span class="timeline-minute">${event.minuut || 0}'</span>
        <span class="timeline-icon">${eventIcon(event.type, event.half)}</span>
        <div class="timeline-content">
            <span class="timeline-description">${description}</span>
        </div>
    `;
    return item;
}

// Close modal
const modalClose = document.getElementById('modalClose');
if (modalClose) {
    modalClose.addEventListener('click', () => {
        const modal = document.getElementById('timelineModal');
        if (modal) modal.classList.remove('active');
    });
}

// Close modal on outside click
const timelineModal = document.getElementById('timelineModal');
if (timelineModal) {
    timelineModal.addEventListener('click', (e) => {
        if (e.target === timelineModal) {
            timelineModal.classList.remove('active');
        }
    });
}

// ===============================================
// LOAD STATISTICS (live vanuit Firebase, met cache)
// ===============================================

async function loadStatistics() {
    // Alleen zondag heeft een statistieken-sectie in de HTML
    if (TEAM_TYPE !== 'zondag') return;

    const topScorersEl  = document.getElementById('topScorers');
    const topAssistsEl  = document.getElementById('topAssists');
    if (!topScorersEl && !topAssistsEl) return;

    console.log('Loading statistics for', TEAM_TYPE);

    // ── Cache check ──────────────────────────────────────────────────────────
    const cacheKey = `team_stats_${TEAM_TYPE}`;
    const cached = tcGet(cacheKey, CACHE_TTL.teamStats);
    if (cached) {
        console.log('[cache] stats geladen');
        renderStatistics(cached.topScorers, cached.topAssists);
        return;
    }

    try {
        // Haal alle spelers op van de zondagploeg
        const usersSnap = await getDocs(
            query(collection(db, 'users'), where('categorie', '==', 'zondag'))
        );

        if (usersSnap.empty) {
            renderStatistics([], []);
            return;
        }

        const players = [];
        usersSnap.forEach(d => {
            const u = d.data();
            if (u.naam) players.push({
                name:    u.naam,
                uid:     u.uid || null,
                goals:   u.goals   || 0,
                assists: u.assists || 0,
            });
        });

        // Top 3 doelpuntenmakers (min. 1 goal)
        const topScorers = [...players]
            .filter(p => p.goals > 0)
            .sort((a, b) => b.goals - a.goals)
            .slice(0, 3);

        // Top 3 assistgevers (min. 1 assist)
        const topAssists = [...players]
            .filter(p => p.assists > 0)
            .sort((a, b) => b.assists - a.assists)
            .slice(0, 3);

        tcSet(cacheKey, { topScorers, topAssists });
        renderStatistics(topScorers, topAssists);

    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

function renderStatistics(topScorers, topAssists) {
    const topScorersEl = document.getElementById('topScorers');
    const topAssistsEl = document.getElementById('topAssists');

    const playerLink = (p) => p.uid
        ? `<a href="speler.html?uid=${p.uid}" class="stat-player-link"">${p.name}</a>`
        : `<span>${p.name}</span>`;

    if (topScorersEl) {
        if (topScorers.length === 0) {
            topScorersEl.innerHTML = '<div class="stat-item"><span class="stat-player">Nog geen data</span></div>';
        } else {
            topScorersEl.innerHTML = topScorers.map((p, i) => `
                <div class="stat-item">
                    <span class="stat-rank">${i + 1}</span>
                    <span class="stat-player">${playerLink(p)}</span>
                    <span class="stat-value-team">${p.goals}</span>
                </div>`).join('');
        }
    }

    if (topAssistsEl) {
        if (topAssists.length === 0) {
            topAssistsEl.innerHTML = '<div class="stat-item"><span class="stat-player">Nog geen data</span></div>';
        } else {
            topAssistsEl.innerHTML = topAssists.map((p, i) => `
                <div class="stat-item">
                    <span class="stat-rank">${i + 1}</span>
                    <span class="stat-player">${playerLink(p)}</span>
                    <span class="stat-value-team">${p.assists}</span>
                </div>`).join('');
        }
    }
}

// ===============================================
// INITIALIZE PAGE
// ===============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing team page...');
    loadNextMatch();
    loadRanking();
    loadRecentMatches();
    loadStatistics();
});

// ===============================================
// AVAILABILITY SYSTEM
// ===============================================

let availabilityListener = null;

async function loadAvailability(matchId, matchData = {}) {
    console.log('Loading availability for match:', matchId);
    const contentDiv = document.getElementById('availabilityContent');
    
    if (!contentDiv) return;
    
    // Als gebruiker NIET ingelogd is: toon helemaal niks
    if (!currentUser) {
        contentDiv.innerHTML = '';
        return;
    }
    
    try {
        // Gebruik dezelfde authuser-cache als auth.js (30 min TTL)
        let userData = null;
        try {
            const raw = localStorage.getItem(`vvs_authuser_${currentUser.uid}`);
            if (raw) {
                const { ts, data } = JSON.parse(raw);
                if (Date.now() - ts < 30 * 60 * 1000) userData = data;
            }
        } catch (_) {}

        if (!userData) {
            const userSnapshot = await getDocs(
                query(collection(db, 'users'), where('uid', '==', currentUser.uid))
            );
            if (userSnapshot.empty) { contentDiv.innerHTML = ''; return; }
            userData = userSnapshot.docs[0].data();
            try {
                localStorage.setItem(`vvs_authuser_${currentUser.uid}`,
                    JSON.stringify({ ts: Date.now(), data: userData }));
            } catch (_) {}
        }

        const userCategorie = userData.categorie;
        // ploegen-array: ondersteuning voor spelers in meerdere ploegen
        const userPloegen   = Array.isArray(userData.ploegen) ? userData.ploegen : [userCategorie];

        console.log('User categorie:', userCategorie, 'ploegen:', userPloegen, 'Team type:', TEAM_TYPE);

        const isOwnTeam = userPloegen.includes(TEAM_TYPE);
        const isBestuurslid = userCategorie === 'bestuurslid'
            || (userData.rol || '') === 'bestuurslid';
        const isDesignated = matchData.aangeduidePersonen &&
            matchData.aangeduidePersonen.includes(currentUser.uid);
        // Spelers met 'wedstrijd'-recht kunnen ook de aanwezigheidslijst beheren
        const heeftWedstrijdRecht = (userData.rechten || []).includes('wedstrijd');
        // Afgevaardigde voor deze specifieke ploeg: kan lijst bekijken + spelers toevoegen (geen eigen knoppen)
        const isAfgevaardigde = (userData.rechten || []).includes('afgevaardigde')
            && (userData.afgevaardigdeTeam || '').toLowerCase() === (TEAM_TYPE || '').toLowerCase();
        const canManageList = isBestuurslid || isDesignated || heeftWedstrijdRecht || isAfgevaardigde;
        
        if (isOwnTeam) {
            // Eigen ploeg: toon knoppen EN lijst
            // Als ook aangeduid persoon: toon ook extra speler knop
            const extraPlayerBtn = canManageList ? `
                <button class="availability-btn extra-player" id="addExtraPlayerBtn" style="margin-top:0.5rem;">
                    <span>+</span>
                    <span>Speler toevoegen</span>
                </button>
            ` : '';

            contentDiv.innerHTML = `
                <div class="availability-actions">
                    <button class="availability-btn available" id="availableBtn">
                        <span>✓</span>
                        <span>Ik kan komen</span>
                    </button>
                    <button class="availability-btn unavailable" id="unavailableBtn">
                        <span>✗</span>
                        <span>Ik kan niet komen</span>
                    </button>
                    ${extraPlayerBtn}
                </div>
                <div class="availability-list" id="availabilityList">
                    <div class="loading"><div class="loader"></div></div>
                </div>
            `;
            
            document.getElementById('availableBtn').addEventListener('click', () => setAvailability(matchId, true, userData.naam));
            document.getElementById('unavailableBtn').addEventListener('click', () => setAvailability(matchId, false, userData.naam));
            if (canManageList) {
                document.getElementById('addExtraPlayerBtn').addEventListener('click', () => showAddExtraPlayerModal(matchId));
            }
            
            setupAvailabilityListener(matchId, true, canManageList);
            
        } else if (canManageList) {
            // Aangeduid persoon of bestuurslid van andere ploeg: lijst zien + extra speler toevoegen
            contentDiv.innerHTML = `
                <div class="availability-info">
                    <p style="color: var(--text-gray); font-size: 0.9rem; margin-bottom: 0.75rem; font-style: italic;">
                        Je kunt de beschikbaarheid bekijken en spelers van andere ploegen toevoegen.
                    </p>
                    <button class="availability-btn extra-player" id="addExtraPlayerBtn" style="margin-bottom: 0.5rem;">
                        <span>+</span>
                        <span>Speler toevoegen</span>
                    </button>
                </div>
                <div class="availability-list" id="availabilityList">
                    <div class="loading"><div class="loader"></div></div>
                </div>
            `;
            
            document.getElementById('addExtraPlayerBtn').addEventListener('click', () => showAddExtraPlayerModal(matchId));
            setupAvailabilityListener(matchId, true, true);
            
        } else {
            // Andere ploeg: alleen telling zien, geen lijst
            contentDiv.innerHTML = `<div class="availability-summary-only"></div>`;
            setupAvailabilityListener(matchId, false, false);
        }
        
    } catch (error) {
        console.error('Error loading availability:', error);
        contentDiv.innerHTML = '';
    }
}

// -----------------------------------------------
// EXTRA PLAYER MODAL (from other teams)
// -----------------------------------------------

// Cache of all users (loaded once per page session)
let allUsersCache = null;

async function getAllUsers() {
    if (allUsersCache) return allUsersCache;
    const snapshot = await getDocs(collection(db, 'users'));
    allUsersCache = [];
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        // Exclude users who are member of this team (they already have availability buttons)
        const userPloegen = Array.isArray(data.ploegen) ? data.ploegen : [data.categorie];
        if (!userPloegen.includes(TEAM_TYPE)) {
            allUsersCache.push({
                uid: data.uid || docSnap.id,
                naam: data.naam || data.displayName || '',
                categorie: data.categorie || ''
            });
        }
    });
    allUsersCache.sort((a, b) => a.naam.localeCompare(b.naam));
    return allUsersCache;
}

function showAddExtraPlayerModal(matchId) {
    const existing = document.getElementById('extraPlayerModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'extraPlayerModal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Speler van andere ploeg toevoegen</h3>
            <div class="modal-body">
                <p style="font-size:0.9rem; color: var(--text-gray); margin-bottom:0.75rem;">
                    Zoek een bestaand VVS-lid van een andere ploeg en voeg hem toe aan de
                    beschikbaarheidslijst voor deze wedstrijd.
                </p>
                <label style="font-size:0.85rem; font-weight:600; display:block; margin-bottom:0.4rem;">Zoek speler</label>
                <input
                    type="text"
                    id="extraPlayerSearch"
                    placeholder="Typ naam…"
                    autocomplete="off"
                    style="width:100%; padding:0.5rem 0.75rem; border:1px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box;"
                >
                <div
                    id="extraPlayerResults"
                    style="margin-top:0.4rem; max-height:200px; overflow-y:auto; border:1px solid #e0e0e0; border-radius:8px; display:none;"
                ></div>
                <div id="extraPlayerSelected" style="display:none; margin-top:0.75rem; padding:0.5rem 0.75rem; background: #e0e0e06e; border:2px solid #b2d8b2; border-radius:8px; font-size:0.9rem;"></div>
            </div>
            <div class="modal-actions">
                <button class="modal-btn cancel" id="extraPlayerCancel">Annuleren</button>
                <button class="modal-btn confirm" id="extraPlayerConfirm" disabled style="opacity:0.5;">Toevoegen</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    let selectedUser = null;

    const searchInput    = modal.querySelector('#extraPlayerSearch');
    const resultsBox     = modal.querySelector('#extraPlayerResults');
    const selectedBox    = modal.querySelector('#extraPlayerSelected');
    const confirmBtn     = modal.querySelector('#extraPlayerConfirm');
    const cancelBtn      = modal.querySelector('#extraPlayerCancel');

    const teamLabels = {
        veteranen: 'Veteranen',
        zaterdag:  'Zaterdag',
        zondag:    'Zondag',
        bestuurslid: 'Bestuurslid'
    };

    function selectUser(user) {
        selectedUser = user;
        searchInput.value = user.naam;
        resultsBox.style.display = 'none';
        selectedBox.style.display = 'block';
        selectedBox.textContent = `✓  ${user.naam}  (${teamLabels[user.categorie] || user.categorie})`;
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
    }

    function clearSelection() {
        selectedUser = null;
        selectedBox.style.display = 'none';
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
    }

        searchInput.addEventListener('input', async () => {
        const q = searchInput.value.trim().toLowerCase();
        clearSelection();
 
        if (q.length < 1) {
            resultsBox.style.display = 'none';
            return;
        }
 
        const users = await getAllUsers();
        const matches = users.filter(u => u.naam.toLowerCase().includes(q));
 
        if (matches.length === 0) {
            resultsBox.innerHTML = `
                <div style="padding:0.6rem 0.75rem; color:#888; font-size:0.9rem;">Geen spelers gevonden</div>
                <div
                    class="extra-player-result extra-player-manual-opt"
                    style="padding:0.55rem 0.75rem; cursor:pointer; font-size:0.88rem; color:#555; border-top:1px solid #eee; font-style:italic;"
                >
                    Niet gevonden? Handmatig toevoegen.
                </div>
            `;
            resultsBox.style.display = 'block';
            resultsBox.querySelector('.extra-player-manual-opt')?.addEventListener('click', () => {
                showManualFallback(modal, matchId, searchInput.value.trim());
            });
            return;
        }

        resultsBox.innerHTML = matches.map((u, i) => `
            <div
                class="extra-player-result"
                data-idx="${i}"
                style="padding:0.55rem 0.75rem; cursor:pointer; font-size:0.92rem; border-bottom:1px solid #f0f0f0; display:flex; justify-content:space-between; align-items:center;"
            >
                <span>${u.naam}</span>
                <span style="font-size:0.78rem; color:#888;">${teamLabels[u.categorie] || u.categorie}</span>
            </div>
        `).join('');
        // Add "manual" option at bottom
        resultsBox.innerHTML += `
            <div
                class="extra-player-result extra-player-manual-opt"
                style="padding:0.55rem 0.75rem; cursor:pointer; font-size:0.88rem; color:#555; border-top:2px solid #eee; font-style:italic;"
            >
                Niet gevonden? Handmatig toevoegen.
            </div>
        `;
        resultsBox.style.display = 'block';

        resultsBox.querySelectorAll('.extra-player-result:not(.extra-player-manual-opt)').forEach((row, i) => {
            row.addEventListener('mouseenter', () => row.style.background = '#f5f5f554');
            row.addEventListener('mouseleave', () => row.style.background = '');
            row.addEventListener('click', () => selectUser(matches[i]));
        });
        resultsBox.querySelector('.extra-player-manual-opt')?.addEventListener('click', () => {
            showManualFallback(modal, matchId, searchInput.value.trim());
        });
    });

    cancelBtn.addEventListener('click', () => modal.remove());

    confirmBtn.addEventListener('click', async () => {
        if (!selectedUser) return;

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Bezig…';

        try {
            const availabilityRef = doc(db, 'matches', matchId, 'availability', selectedUser.uid);

            // Check if this player is already in the availability list
            const existing = await getDocs(
                query(collection(db, 'matches', matchId, 'availability'),
                      where('displayName', '==', selectedUser.naam))
            );
            if (!existing.empty) {
                showToast(`${selectedUser.naam} staat al op de lijst`, 'error');
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Toevoegen';
                return;
            }

            await setDoc(availabilityRef, {
                available: true,
                displayName: selectedUser.naam,
                isExternalPlayer: true,
                fromTeam: selectedUser.categorie,
                addedBy: currentUser.uid,
                timestamp: new Date().toISOString()
            });
            console.log('Extra player added:', selectedUser.naam, '(', selectedUser.categorie, ')');
            modal.remove();
        } catch (error) {
            console.error('Error adding extra player:', error);
            showToast('Fout bij toevoegen speler: ' + error.message, 'error');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Toevoegen';
        }
    });

    // Focus search on open
    setTimeout(() => searchInput.focus(), 50);
}

/**
 * Shows a simple manual-entry fallback inside the same modal overlay.
 * Called when the user clicks "Handmatig toevoegen" in the search results.
 */
function showManualFallback(modal, matchId, prefillName = '') {
    const body = modal.querySelector('.modal-body');
    body.innerHTML = `
        <p style="font-size:0.9rem; color:var(--text-gray); margin-bottom:0.75rem;">
            Vul de naam en ploeg in van de speler die niet in het systeem staat.
        </p>
        <label style="font-size:0.85rem; font-weight:600; display:block; margin-bottom:0.3rem;">Naam</label>
        <input
            type="text"
            id="manualFallbackName"
            value="${prefillName}"
            placeholder="Voornaam Achternaam"
            style="width:100%; padding:0.5rem 0.75rem; border:1px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box; margin-bottom:0.75rem;"
        >
        <label style="font-size:0.85rem; font-weight:600; display:block; margin-bottom:0.3rem;">Ploeg</label>
        <select id="manualFallbackTeam" style="width:100%; padding:0.5rem 0.75rem; border:1px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box;">
            <option value="veteranen">Veteranen</option>
            <option value="zaterdag">Zaterdag</option>
            <option value="zondag">Zondag</option>
            <option value="overig">Overig / Extern</option>
        </select>
    `;

    const confirmBtn = modal.querySelector('#extraPlayerConfirm');
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
    confirmBtn.textContent = 'Toevoegen';

    // Override confirm handler for manual mode
    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);

    newConfirm.addEventListener('click', async () => {
        const name = document.getElementById('manualFallbackName')?.value.trim();
        const team = document.getElementById('manualFallbackTeam')?.value;
        if (!name) { showToast('Voer een naam in', 'error'); return; }

        newConfirm.disabled = true;
        newConfirm.textContent = 'Bezig…';
        try {
            // Check for duplicate name
            const existing = await getDocs(
                query(collection(db, 'matches', matchId, 'availability'),
                      where('displayName', '==', name))
            );
            if (!existing.empty) {
                showToast(`${name} staat al op de lijst`, 'error');
                newConfirm.disabled = false;
                newConfirm.textContent = 'Toevoegen';
                return;
            }

            const safeKey = 'manual_' + name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
            await setDoc(doc(db, 'matches', matchId, 'availability', safeKey), {
                available:        true,
                displayName:      name,
                isExternalPlayer: true,
                fromTeam:         team,
                addedBy:          currentUser.uid,
                timestamp:        new Date().toISOString()
            });
            modal.remove();
        } catch (err) {
            console.error('Error adding manual player:', err);
            showToast('Fout bij toevoegen: ' + err.message, 'error');
            newConfirm.disabled = false;
            newConfirm.textContent = 'Toevoegen';
        }
    });
}

function setupAvailabilityListener(matchId, showList = true, canManage = false) {
    // Clean up previous listener
    if (availabilityListener) {
        availabilityListener();
    }
    
    const availabilityRef = collection(db, 'matches', matchId, 'availability');
    
    availabilityListener = onSnapshot(availabilityRef, (snapshot) => {
        console.log('Availability updated, count:', snapshot.size);
        
        const availabilityList = document.getElementById('availabilityList');
        const availableCountEl = document.getElementById('availableCount');
        const unavailableCountEl = document.getElementById('unavailableCount');
        const availableBtn = document.getElementById('availableBtn');
        const unavailableBtn = document.getElementById('unavailableBtn');
        
        let availableCount = 0;
        let unavailableCount = 0;
        const availabilities = [];
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            availabilities.push({ userId: docSnap.id, ...data });
            if (data.available) availableCount++;
            else unavailableCount++;
        });
        
        if (availableCountEl) availableCountEl.textContent = availableCount;
        if (unavailableCountEl) unavailableCountEl.textContent = unavailableCount;
        
        if (currentUser && availableBtn && unavailableBtn) {
            availableBtn.classList.remove('selected');
            unavailableBtn.classList.remove('selected');
            const userAvailability = availabilities.find(a => a.userId === currentUser.uid);
            if (userAvailability) {
                if (userAvailability.available) availableBtn.classList.add('selected');
                else unavailableBtn.classList.add('selected');
            }
        }
        
        if (showList && availabilityList) {
            if (availabilities.length === 0) {
                availabilityList.innerHTML = `
                    <div class="availability-list-empty">
                        Nog niemand heeft beschikbaarheid aangegeven
                    </div>
                `;
            } else {
                availabilities.sort((a, b) => {
                    if (a.available !== b.available) return b.available - a.available;
                    // Nieuwste reactie bovenaan
                    const tsA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tsB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tsB - tsA;
                });
                
                availabilityList.innerHTML = availabilities.map(av => {
                    const isExternal = av.isExternalPlayer === true;
                    const teamLabels = { veteranen: 'Veteranen', zaterdag: 'Zaterdag', zondag: 'Zondag', bestuurslid: 'Bestuurslid' };
                    const sideLabel = isExternal
                        ? ` <span style="font-size:0.75rem; color:#888; font-style:italic;">(${teamLabels[av.fromTeam] || av.fromTeam || 'extern'})</span>`
                        : '';
                    const removeBtn = (canManage && isExternal)
                        ? `<button class="remove-extra-player-btn" data-uid="${av.userId}" data-matchid="${matchId}" style="margin-left:auto; background:none; border:none; cursor:pointer; color:#4A4A4A; font-size:1rem;" title="Verwijder">✕</button>`
                        : '';
                    return `
                        <div class="availability-player" style="display:flex; align-items:center; gap:0.5rem;">
                            <span class="player-name">${av.displayName}${sideLabel}</span>
                            <span class="availability-status ${av.available ? 'available' : 'unavailable'}" style="margin-left:${removeBtn ? '0' : 'auto'};">
                                <span>${av.available ? '✓' : '✗'}</span>
                                <span>${av.available ? 'Aanwezig' : 'Afwezig'}</span>
                            </span>
                            ${removeBtn}
                        </div>
                    `;
                }).join('');

                // Wire up remove buttons
                availabilityList.querySelectorAll('.remove-extra-player-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const uid = btn.dataset.uid;
                        const mid = btn.dataset.matchid;
                        if (!confirm('Speler verwijderen uit de lijst?')) return;
                        try {
                            await deleteDoc(doc(db, 'matches', mid, 'availability', uid));
                        } catch (err) {
                            console.error('Error removing extra player:', err);
                            showToast('Fout bij verwijderen: ' + err.message, 'error');
                        }
                    });
                });
            }
        }
    }, (error) => {
        console.error('Error loading availability:', error);
        const availabilityList = document.getElementById('availabilityList');
        if (availabilityList && showList) {
            availabilityList.innerHTML = `<p class="error">Fout bij laden van beschikbaarheid</p>`;
        }
    });
}

async function setAvailability(matchId, available, userName) {
    if (!currentUser) {
        showToast('Je moet ingelogd zijn', 'error');
        return;
    }
    
    const availableBtn = document.getElementById('availableBtn');
    const unavailableBtn = document.getElementById('unavailableBtn');
    
    // Disable buttons during update
    if (availableBtn) availableBtn.disabled = true;
    if (unavailableBtn) unavailableBtn.disabled = true;
    
    try {
        const availabilityRef = doc(db, 'matches', matchId, 'availability', currentUser.uid);
        
        await setDoc(availabilityRef, {
            available: available,
            displayName: userName || currentUser.displayName || currentUser.email,
            timestamp: new Date().toISOString()
        });
        
        console.log('Availability set:', available);
        
    } catch (error) {
        console.error('Error setting availability:', error);
        showToast('Fout bij opslaan beschikbaarheid', 'error');
    } finally {
        // Re-enable buttons
        if (availableBtn) availableBtn.disabled = false;
        if (unavailableBtn) unavailableBtn.disabled = false;
    }
}

// Cleanup availability listener on page unload
window.addEventListener('beforeunload', () => {
    if (availabilityListener) {
        availabilityListener();
    }
});

// ===============================================
// END AVAILABILITY SYSTEM
// ===============================================

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (liveMatchListener) {
        liveMatchListener();
    }
    stopLiveUpdate();
});


// ===============================================
// MAN VAN DE MATCH
// Firestore: matches/{id}/motm/{uid} → { votes: [uid1, uid2, uid3] }
// motmResults op het match-document na bekendmaking
// ===============================================


// ── MOTM standalone sectie (net onder team-hero) ─────────────────────────────
// Toont de stem/bekendmaak knop voor de meest recente wedstrijd waarvoor
// de stemperiode open is. Als er niets is om te tonen blijft de sectie leeg.

function motmResultsVisible(match) {
    // Resultaten zijn 24u zichtbaar na bekendmaking
    if (!match.motmResults || !match.motmRevealedAt) return false;
    return Date.now() - new Date(match.motmRevealedAt).getTime() < 24 * 60 * 60 * 1000;
}

function renderMotmSection() {
    const section = document.getElementById('motmSection');
    if (!section) return;
    section.innerHTML = '';
    section.classList.remove('motm-section--active');

    if (!currentUser || !currentUserData) return; // niet ingelogd of profiel nog niet geladen

    // Bepaal rechten van ingelogde user
    const userPloegen = Array.isArray(currentUserData.ploegen)
        ? currentUserData.ploegen : (currentUserData.categorie ? [currentUserData.categorie] : []);
    const isInTeam            = userPloegen.includes(TEAM_TYPE);
    const heeftWedstrijdRecht = (currentUserData.rechten || []).includes('wedstrijd');
    const isAfgevaardigde     = (currentUserData.rechten || []).includes('afgevaardigde')
        && (currentUserData.afgevaardigdeTeam || '').toLowerCase() === TEAM_TYPE;
    const isAdminUser         = currentUserData.rol === 'admin'
        || (currentUserData.rollen || []).includes('admin');

    // Sectie enkel zichtbaar voor teamleden, aangeduide personen, afgevaardigde, of admin
    if (!isInTeam && !heeftWedstrijdRecht && !isAfgevaardigde && !isAdminUser) return;

    const now = new Date();

    // 1. Zoek vandaag's wedstrijd in finished matches
    let match = allRecentMatches.find(m => {
        const dt     = new Date(`${m.datum}T${m.uur || '00:00'}`);
        const dayEnd = new Date(dt); dayEnd.setHours(23, 59, 59, 999);
        return now >= dt && now <= dayEnd;
    });

    // 2. Fallback: live match die vandaag startte
    if (!match && currentLiveMatch) {
        const dt     = new Date(`${currentLiveMatch.datum}T${currentLiveMatch.uur || '00:00'}`);
        const dayEnd = new Date(dt); dayEnd.setHours(23, 59, 59, 999);
        if (now > dt && now <= dayEnd) match = { ...currentLiveMatch };
    }

    // 3. Fallback: geplande (bezig) match die vandaag startte maar nog niet finished is
    if (!match) {
        match = allPlannedMatches.find(m => {
            const dt     = new Date(`${m.datum}T${m.uur || '00:00'}`);
            const dayEnd = new Date(dt); dayEnd.setHours(23, 59, 59, 999);
            return now > dt && now <= dayEnd;
        }) || null;
    }

    if (!match) return; // geen wedstrijd vandaag

    const motmResults   = match.motmResults || null;
    const isDesignated  = match.aangeduidePersonen?.includes(currentUser.uid);
    // Wie mag de uitslag onthullen: aangeduid persoon, wedstrijdrecht, afgevaardigde, admin
    const canReveal     = isDesignated || heeftWedstrijdRecht || isAfgevaardigde || isAdminUser;
    const resultVisible = motmResults && motmResultsVisible(match);

    // Resultaten zijn bekendgemaakt maar de zichtbaarheidsperiode (24u) is voorbij → niets tonen
    if (motmResults && !resultVisible) return;

    section.classList.add('motm-section--active');

    if (!motmResults) {
        // ── Stem-knop: alleen voor eigen teamleden die meegespeeld hebben
        if (isInTeam) {
            const voteBtn = document.createElement('button');
            voteBtn.className = 'motm-section-vote-btn';
            voteBtn.innerHTML = '🏆 Stem Man van de Match';
            voteBtn.addEventListener('click', () => openMotmModal(match));
            section.appendChild(voteBtn);
        }

        // ── Bekijk stand + onthul: voor aangeduide persoon / afgevaardigde / admin
        if (canReveal) {
            const standBtn = document.createElement('button');
            standBtn.className = 'motm-section-stand-btn';
            standBtn.textContent = '📊 Bekijk & onthul uitslag';
            standBtn.addEventListener('click', () => openStandModal(match));
            section.appendChild(standBtn);
        }
    } else if (resultVisible) {
        // ── Toon bekendgemaakte top 3 als verticale ranglijst-kader
        const medals = ['🥇','🥈','🥉'];
        const rows = motmResults.slice(0, 3).map((r, i) => `
            <div class="motm-pos">
                <span class="motm-pos-medal">${medals[i]}</span>
                <span class="motm-pos-name">${r.name}</span>
                <span class="motm-pos-pts">${r.points} pnt</span>
            </div>`).join('');
        const resEl = document.createElement('div');
        resEl.className = 'motm-section-results';
        resEl.innerHTML = `<div class="motm-results-title">🏆 Man van de Match</div>${rows}`;
        section.appendChild(resEl);
    }
}

async function openMotmModal(match) {
    // Laad beschikbare spelers voor dit team uit het availability-subcollectie
    let players = [];
    try {
        const avSnap = await getDocs(collection(db, 'matches', match.id, 'availability'));
        avSnap.forEach(d => {
            const av = d.data();
            if (av.available && av.displayName) players.push({ uid: d.id, name: av.displayName });
        });
    } catch (_) {}

    if (players.length === 0) {
        showToast('Geen spelers gevonden om op te stemmen.', 'error');
        return;
    }

    // Filter: can't vote for yourself
    const selfPlayers = players.filter(p => p.uid !== currentUser.uid);

    // Check if already voted
    let alreadyVoted = false;
    try {
        const myVote = await getDoc(doc(db, 'matches', match.id, 'motm', currentUser.uid));
        if (myVote.exists()) alreadyVoted = true;
    } catch (_) {}

    let modal = document.getElementById('motmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'motmModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
    }

    const optionsHtml = selfPlayers.map(p =>
        `<option value="${p.uid}" data-name="${p.name}">${p.name}</option>`
    ).join('');

    modal.innerHTML = `
        <div class="modal-content">
            <h3>🏆 Man van de Match</h3>
            <p style="color:var(--text-gray);font-size:0.9rem;margin-bottom:1.25rem;">
                Geef je top 3 in volgorde van beste prestatie. Elke naam mag maar 1 keer voorkomen.
                Je kan niet op jezelf stemmen.
            </p>
            ${alreadyVoted ? `<div class="success-message" style="margin-bottom:1rem;">✅ Je hebt al gestemd. Je kan je stem niet meer wijzigen.</div>` : ''}
            <div class="motm-vote-rows">
                ${[1,2,3].map(i => `
                    <div class="motm-vote-row">
                        <span class="motm-rank-badge">${['🥇','🥈','🥉'][i-1]}</span>
                        <select class="modal-select motm-pick" data-rank="${i}" ${alreadyVoted ? 'disabled' : ''}>
                            <option value="">— Kies speler ${i} —</option>
                            ${optionsHtml}
                        </select>
                    </div>`).join('')}
            </div>
            <div id="motmVoteError" style="color:var(--danger);font-size:0.85rem;margin-top:0.5rem;"></div>
            <div class="modal-actions">
                <button class="modal-btn cancel" id="motmCancelBtn">Annuleren</button>
                ${!alreadyVoted ? `<button class="modal-btn confirm" id="motmConfirmBtn">Stem bevestigen</button>` : ''}
            </div>
        </div>`;

    modal.classList.add('active');
    modal.querySelector('#motmCancelBtn').addEventListener('click', () => modal.classList.remove('active'));

    if (!alreadyVoted) {
        modal.querySelector('#motmConfirmBtn').addEventListener('click', async () => {
            const picks = [...modal.querySelectorAll('.motm-pick')].map(s => ({
                uid:  s.value,
                name: s.options[s.selectedIndex]?.dataset.name || '',
                rank: parseInt(s.dataset.rank)
            })).filter(p => p.uid);

            const errEl = modal.querySelector('#motmVoteError');
            errEl.textContent = '';

            if (picks.length < 1) { errEl.textContent = 'Kies minstens 1 speler.'; return; }
            const uids = picks.map(p => p.uid);
            if (new Set(uids).size !== uids.length) { errEl.textContent = 'Elke speler mag maar 1x voorkomen.'; return; }
            if (uids.includes(currentUser.uid)) { errEl.textContent = 'Je kan niet op jezelf stemmen.'; return; }

            const btn = modal.querySelector('#motmConfirmBtn');
            btn.disabled = true; btn.textContent = 'Bezig…';
            try {
                await setDoc(doc(db, 'matches', match.id, 'motm', currentUser.uid), {
                    votes: picks.map(p => ({ uid: p.uid, name: p.name, rank: p.rank })),
                    timestamp: new Date().toISOString()
                });
                modal.classList.remove('active');
                showToast('✅ Stem opgeslagen!', 'success');
            } catch (e) {
                errEl.textContent = 'Fout: ' + e.message;
                btn.disabled = false; btn.textContent = 'Stem bevestigen';
            }
        });
    }
}

async function computeTally(matchId) {
    const votesSnap = await getDocs(collection(db, 'matches', matchId, 'motm'));
    const tally = {};
    votesSnap.forEach(d => {
        const { votes } = d.data();
        if (!Array.isArray(votes)) return;
        votes.forEach(v => {
            const pts = v.rank === 1 ? 3 : v.rank === 2 ? 2 : 1;
            if (!tally[v.uid]) tally[v.uid] = { name: v.name, points: 0 };
            tally[v.uid].points += pts;
        });
    });
    return Object.values(tally).sort((a, b) => b.points - a.points);
}

async function openStandModal(match) {
    let tally = [];
    try { tally = await computeTally(match.id); } catch (_) {}

    let modal = document.getElementById('motmStandModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'motmStandModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
    }

    const rows = tally.length
        ? tally.map((r, i) => `
            <div class="motm-stand-row">
                <span class="motm-stand-pos">${i + 1}</span>
                <span class="motm-stand-name">${r.name}</span>
                <span class="motm-stand-pts">${r.points} pnt</span>
            </div>`).join('')
        : '<p style="color:var(--text-gray);text-align:center;padding:1rem;">Nog geen stemmen uitgebracht.</p>';

    modal.innerHTML = `
        <div class="modal-content">
            <h3>📊 Huidige stand</h3>
            <p style="color:var(--text-gray);font-size:0.85rem;margin-bottom:1rem;">
                ${tally.length} stem${tally.length !== 1 ? 'men' : ''} uitgebracht.
            </p>
            <div class="motm-stand-list">${rows}</div>
            <div class="modal-actions" style="margin-top:1.5rem;">
                <button class="modal-btn cancel" id="standCancelBtn">Annuleren</button>
                <button class="modal-btn confirm" id="standRevealBtn"
                    ${tally.length === 0 ? 'disabled' : ''}>
                    🏆 Onthul Top 3
                </button>
            </div>
        </div>`;

    modal.classList.add('active');
    modal.querySelector('#standCancelBtn').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#standRevealBtn').addEventListener('click', async () => {
        modal.classList.remove('active');
        await revealMotm(match, tally);
    });
}

async function revealMotm(match, tallyArg = null) {
    try {
        const tally = tallyArg || await computeTally(match.id);
        const top3  = tally.slice(0, 3);
        if (top3.length === 0) { showToast('Nog geen stemmen uitgebracht.', 'error'); return; }

        const revealedAt = new Date().toISOString();
        await setDoc(doc(db, 'matches', match.id),
            { motmResults: top3, motmRevealedAt: revealedAt }, { merge: true });

        // ── Sla MOTM-punten op per speler (1e: 3pnt, 2e: 2pnt, 3e: 1pnt) ──
        const MOTM_PTS = [3, 2, 1];
        for (let i = 0; i < top3.length; i++) {
            const r   = top3[i];
            const pts = MOTM_PTS[i] ?? 1;
            // Sla enkel op voor echte Firebase-accounts (niet manual_...)
            if (r.uid && !String(r.uid).startsWith('manual_')) {
                try {
                    await updateDoc(doc(db, 'users', r.uid), {
                        motmPunten: increment(pts),
                        motmHistory: arrayUnion({
                            matchId:  match.id,
                            datum:    match.datum,
                            positie:  i + 1,
                            punten:   pts,
                            team:     TEAM_TYPE,
                        })
                    });
                } catch (e) {
                    console.warn('Kon MOTM-punten niet opslaan voor', r.name, ':', e.message);
                }
            }
        }

        // Update in-memory array direct zodat de kaart meteen refresht zonder herlaad
        const idx = allRecentMatches.findIndex(m => m.id === match.id);
        if (idx !== -1) {
            allRecentMatches[idx] = { ...allRecentMatches[idx], motmResults: top3, motmRevealedAt: revealedAt };
        }

        // Invalideer localStorage cache
        localStorage.removeItem(`vvs_recent_matches_${TEAM_TYPE}`);

        showToast('🏆 Top 3 bekendgemaakt! Punten opgeslagen.', 'success');

        // Re-render kaarten en sectie direct
        const container = document.getElementById('recentMatchesList');
        if (container) renderRecentMatches(container);
        renderMotmSection();
    } catch (e) {
        showToast('Fout: ' + e.message, 'error');
    }
}

console.log('Team.js initialization complete');
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

// ── Map popup (locatie hover) ────────────────────────────────────────────────
function initMapPopups() {
    document.querySelectorAll('.map-trigger').forEach(btn => {
        const location = btn.closest('.match-location');
        const popup    = location?.querySelector('.map-popup');
        if (!popup) return;

        let closeTimer = null;

        function openPopup() {
            clearTimeout(closeTimer);
            // Sluit alle andere open popups
            document.querySelectorAll('.map-popup.map-popup-open').forEach(p => {
                if (p !== popup) p.classList.remove('map-popup-open');
            });
            popup.classList.add('map-popup-open');
            popup.setAttribute('aria-hidden', 'false');
        }

        function scheduleClose() {
            closeTimer = setTimeout(() => {
                popup.classList.remove('map-popup-open');
                popup.setAttribute('aria-hidden', 'true');
            }, 200);
        }

        // Desktop: hover op de knop of de popup zelf
        btn.addEventListener('mouseenter', openPopup);
        btn.addEventListener('mouseleave', scheduleClose);
        popup.addEventListener('mouseenter', () => clearTimeout(closeTimer));
        popup.addEventListener('mouseleave', scheduleClose);

        // Mobiel: klik wisselt de popup
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            popup.classList.contains('map-popup-open') ? scheduleClose() : openPopup();
        });
    });

    // Sluit bij klik buiten
    document.addEventListener('click', () => {
        document.querySelectorAll('.map-popup.map-popup-open').forEach(p => {
            p.classList.remove('map-popup-open');
            p.setAttribute('aria-hidden', 'true');
        });
    });
}



// ════════════════════════════════════════════════
// WEDSTRIJD DELEN
// ════════════════════════════════════════════════

function sharePlannedMatch(match) {
    const home  = match.thuisploeg || 'Thuis';
    const away  = match.uitploeg   || 'Uit';
    const datum = match.datum
        ? new Date(match.datum + 'T12:00').toLocaleDateString('nl-BE', { weekday:'long', day:'numeric', month:'long' })
        : '';
    const tijd  = match.uur     || '';
    const loc   = match.locatie || '';
    const liveUrl = window.location.origin + '/live.html';
    const bodyText = `⚽ ${home} vs ${away}\n📅 ${datum}${tijd ? ' om ' + tijd : ''}${loc ? '\n📍 ' + loc : ''}\n\n🔴 Volg live: ${liveUrl}`;

    if (navigator.share) {
        navigator.share({ title: `${home} vs ${away}`, text: bodyText, url: liveUrl })
            .catch(e => { if (e.name !== 'AbortError') openSharePopup(match, bodyText, liveUrl); });
        return;
    }
    openSharePopup(match, bodyText, liveUrl);
}

function openSharePopup(match, bodyText, liveUrl) {
    let popup = document.getElementById('sharePopupPlanned');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'sharePopupPlanned';
        popup.className = 'share-popup';
        document.body.appendChild(popup);
        popup.addEventListener('click', e => { if (e.target === popup) popup.classList.remove('active'); });
    }

    const home  = match.thuisploeg || 'Thuis';
    const away  = match.uitploeg   || 'Uit';
    const datum = match.datum
        ? new Date(match.datum + 'T12:00').toLocaleDateString('nl-BE', { weekday:'long', day:'numeric', month:'long' })
        : '';
    const tijd = match.uur || '';
    const loc  = match.locatie || '';

    popup.innerHTML = `
        <div class="share-popup-card">
            <button class="share-popup-close" onclick="document.getElementById('sharePopupPlanned').classList.remove('active')">✕</button>
            <div class="share-preview-card">
                <div class="spc-club">🔵 VVS ROTSELAAR</div>
                <div class="spc-teams">
                    <span class="spc-team">${esc2(home)}</span>
                    <span class="spc-vs">VS</span>
                    <span class="spc-team">${esc2(away)}</span>
                </div>
                ${datum ? `<div class="spc-date">📅 ${esc2(datum)}${tijd ? ' om ' + esc2(tijd) : ''}</div>` : ''}
                ${loc   ? `<div class="spc-loc">📍 ${esc2(loc)}</div>` : ''}
                <div class="spc-live">🔴 Volg <strong><a href="/live.html">live</a></strong></div>
            </div>
            <div class="share-popup-actions">
                <a class="share-btn whatsapp" href="https://wa.me/?text=${encodeURIComponent(bodyText)}" target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                    WhatsApp
                </a>
                <a class="share-btn twitter" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(bodyText)}" target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    X (Twitter)
                </a>
                <button class="share-btn copy" id="sharePlannedCopy">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Tekst kopiëren
                </button>
            </div>
        </div>`;

    popup.classList.add('active');

    popup.querySelector('#sharePlannedCopy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(bodyText);
            popup.querySelector('#sharePlannedCopy').textContent = '✓ Gekopieerd!';
            setTimeout(() => {
                const btn = popup.querySelector('#sharePlannedCopy');
                if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Tekst kopiëren`;
            }, 2000);
        } catch (_) { prompt('Kopieer deze tekst:', bodyText); }
    });
}

function esc2(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}