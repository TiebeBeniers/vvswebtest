import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { applyLogoFromCache }  from './vvs-logo.js';

// ── Teams dropdown ────────────────────────────────────────────────────────────
const teamsBtn  = document.getElementById('teamsDropdownBtn');
const teamsMenu = document.getElementById('teamsDropdownMenu');

function openDropdown(btn, menu) {
    menu.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
}
function closeDropdown(btn, menu) {
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
}

if (teamsBtn && teamsMenu) {
    teamsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        teamsMenu.classList.contains('open')
            ? closeDropdown(teamsBtn, teamsMenu)
            : openDropdown(teamsBtn, teamsMenu);
    });

    document.addEventListener('click', (e) => {
        if (!teamsBtn.contains(e.target) && !teamsMenu.contains(e.target)) {
            closeDropdown(teamsBtn, teamsMenu);
        }
    });

    teamsMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            closeDropdown(teamsBtn, teamsMenu);
            document.getElementById('hamburger')?.classList.remove('active');
            document.getElementById('navMenu')?.classList.remove('active');
        });
    });
}

// ── Hamburger ─────────────────────────────────────────────────────────────────
const hamburger = document.getElementById('hamburger');
const navMenu   = document.getElementById('navMenu');
if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });
    navMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
    }));
}

// ── Evenementen dropdown (enkel voor ingelogde gebruikers) ────────────────────
// We zoeken de <a href="evenementen.html"> en vervangen die (indien ingelogd)
// door een dropdown met "Evenementen" + "Werklijst".

// ── Evenementen dropdown ──────────────────────────────────────────────────────
// Niet ingelogd: Evenementen + Kalender
// Ingelogd:      Evenementen + Kalender + Werklijst

function buildEvenementenDropdown(isLoggedIn) {
    const navMenu = document.getElementById('navMenu');
    if (!navMenu) return;

    // Bepaal welke pagina actief is
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const evActive = page === 'evenementen.html';
    const wlActive = page === 'werklijst.html';
    const kalActive = page === 'kalender.html';
    const anyActive = evActive || wlActive || kalActive;

    // Vind de bestaande <li> met de evenementen-link
    const evLink = navMenu.querySelector('a[href="evenementen.html"]');
    if (!evLink) return;
    const evLi = evLink.closest('li');
    if (!evLi) return;

    const werklijstItem = isLoggedIn
        ? `<li><a href="werklijst.html"${wlActive ? ' class="active"' : ''}>Werklijst</a></li>`
        : '';

    // Vervang door nav-dropdown structuur
    evLi.className = 'nav-dropdown';
    evLi.innerHTML = `
        <button class="nav-dropdown-btn${anyActive ? ' active' : ''}"
                id="evenementenDropdownBtn"
                aria-expanded="false" aria-haspopup="true">
            EVENEMENTEN
            <svg class="dropdown-chevron" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" width="14" height="14">
                <polyline points="6 9 12 15 18 9"/>
            </svg>
        </button>
        <ul class="nav-dropdown-menu" id="evenementenDropdownMenu">
            <li><a href="evenementen.html"${evActive ? ' class="active"' : ''}>Evenementen</a></li>
            <li><a href="kalender.html"${kalActive ? ' class="active"' : ''}>Kalender</a></li>
            ${werklijstItem}
        </ul>`;

    const btn  = evLi.querySelector('#evenementenDropdownBtn');
    const menu = evLi.querySelector('#evenementenDropdownMenu');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.contains('open')
            ? closeDropdown(btn, menu)
            : openDropdown(btn, menu);
    });

    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !menu.contains(e.target)) {
            closeDropdown(btn, menu);
        }
    });

    menu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            closeDropdown(btn, menu);
            document.getElementById('hamburger')?.classList.remove('active');
            document.getElementById('navMenu')?.classList.remove('active');
        });
    });
}

// Auth check: werklijst tonen/verbergen, dropdown listeners initialiseren
onAuthStateChanged(auth, (user) => {
    const loginLink = document.getElementById('loginLink');
    if (loginLink) loginLink.textContent = user ? 'PROFIEL' : 'LOGIN';

    // Als de HTML al een evenementen-dropdown heeft (nieuwe header-structuur):
    // alleen de werklijst-link tonen/verbergen en listeners koppelen.
    const existingBtn  = document.getElementById('evenementenDropdownBtn');
    const existingMenu = document.getElementById('evenementenDropdownMenu');

    if (existingBtn && existingMenu) {
        // Werklijst-item: toon enkel voor ingelogde gebruikers
        const wlItem = existingMenu.querySelector('a[href="werklijst.html"]')?.closest('li');
        if (wlItem) wlItem.style.display = user ? '' : 'none';

        // Koppel listeners als dat nog niet gedaan is (guard via data-attr)
        if (!existingBtn.dataset.listenerAttached) {
            existingBtn.dataset.listenerAttached = '1';

            existingBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                existingMenu.classList.contains('open')
                    ? closeDropdown(existingBtn, existingMenu)
                    : openDropdown(existingBtn, existingMenu);
            });

            document.addEventListener('click', (e) => {
                if (!existingBtn.contains(e.target) && !existingMenu.contains(e.target)) {
                    closeDropdown(existingBtn, existingMenu);
                }
            });

            existingMenu.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', () => {
                    closeDropdown(existingBtn, existingMenu);
                    document.getElementById('hamburger')?.classList.remove('active');
                    document.getElementById('navMenu')?.classList.remove('active');
                });
            });
        }
    } else {
        // Fallback voor oude HTML-pagina's die nog geen dropdown hebben:
        // bouw hem dynamisch op (bestaand gedrag)
        buildEvenementenDropdown(!!user);
    }
});


// ── Globale zoekfunctie ───────────────────────────────────────────────────────

const SEARCH_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="30">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
</svg>`;

function injectSearchUI() {
    if (document.getElementById('globalSearchBtn')) return;

    // ── Desktop: zoekknop naast login-link in nav-menu ──────────────
    const navMenu   = document.getElementById('navMenu');
    const loginLi   = navMenu?.querySelector('li:has(#loginLink)') ||
                      navMenu?.querySelector('li:last-child');

    if (navMenu && loginLi) {
        const li = document.createElement('li');
        li.className = 'nav-search-li';
        li.innerHTML = `<button id="globalSearchBtn" class="global-search-btn" aria-label="Zoeken">
            ${SEARCH_ICON_SVG}
        </button>`;
        navMenu.insertBefore(li, loginLi);
    }

    // ── Mobiel: zoekitem in hamburger-menu onder HOME ──────────────
    // Voeg een ZOEKEN-rij in als tweede item (na HOME)
    const homeLi = navMenu?.querySelector('li:first-child');
    if (navMenu && homeLi) {
        const mobileLi = document.createElement('li');
        mobileLi.className = 'nav-search-mobile-li';
        mobileLi.innerHTML = `<button class="nav-search-mobile-btn" id="mobileSearchBtn" aria-label="Zoeken">
            ${SEARCH_ICON_SVG} ZOEKEN
        </button>`;
        homeLi.insertAdjacentElement('afterend', mobileLi);

        document.getElementById('mobileSearchBtn')?.addEventListener('click', () => {
            // Sluit hamburger-menu
            document.getElementById('hamburger')?.classList.remove('active');
            navMenu?.classList.remove('active');
            openSearchOverlay();
        });
    }

    document.getElementById('globalSearchBtn')?.addEventListener('click', openSearchOverlay);

    // ── Overlay ────────────────────────────────────────────────────
    if (!document.getElementById('searchOverlay')) {
        const overlay = document.createElement('div');
        overlay.id        = 'searchOverlay';
        overlay.className = 'search-overlay';
        overlay.innerHTML = `
            <div class="search-modal">
                <div class="search-input-wrap">
                    ${SEARCH_ICON_SVG.replace('width="18" height="18"', 'width="20" height="20" class="search-icon"')}
                    <input type="text" id="searchInput" class="search-input"
                        placeholder="Zoek leden, wedstrijden, evenementen…" autocomplete="off">
                    <button id="searchClose" class="search-close-btn" aria-label="Sluiten">✕</button>
                </div>
                <div id="searchResults" class="search-results">
                    <div class="sr-status">Typ om te zoeken…</div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => { if (e.target === overlay) closeSearchOverlay(); });
        document.getElementById('searchClose')?.addEventListener('click', closeSearchOverlay);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeSearchOverlay();
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                overlay.classList.contains('active') ? closeSearchOverlay() : openSearchOverlay();
            }
        });
    }

    // Laad search module dynamisch
    import('./search.js').catch(e => console.warn('Search module not loaded:', e));
}

function openSearchOverlay() {
    const overlay = document.getElementById('searchOverlay');
    if (!overlay) return;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('searchInput')?.focus();
}

function closeSearchOverlay() {
    const overlay = document.getElementById('searchOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    const results = document.getElementById('searchResults');
    if (results) results.innerHTML = '<div class="sr-status">Typ om te zoeken…</div>';
}

injectSearchUI();
