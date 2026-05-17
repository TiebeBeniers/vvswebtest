// ============================================================
//  VVS Rotselaar — PWA Install Prompt + Service Worker Setup
//  • Registreert de service worker
//  • Toont een installatie-banner op Android/Chrome
//  • Toont instructies voor iOS Safari
// ============================================================

(function () {
  'use strict';

  // ── 1. Service Worker registreren ─────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/vvsrotselaar/sw.js', { scope: '/vvsrotselaar/' })
        .then(reg => {
          console.log('[PWA] Service Worker geregistreerd:', reg.scope);

          // Detecteer nieuwe versie op de achtergrond
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker?.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner();
              }
            });
          });
        })
        .catch(err => console.warn('[PWA] SW registratie mislukt:', err));
    });
  }

  // ── 2. Helpers ────────────────────────────────────────────

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function isInStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
  }

  function isAndroidChrome() {
    return /android/i.test(navigator.userAgent)
        && /chrome/i.test(navigator.userAgent);
  }

  // Eén keer per sessie tonen (niet bij elke pagina-refresh spammen)
  const SHOWN_KEY   = 'vvs_pwa_prompt_shown';
  const DISMISS_KEY = 'vvs_pwa_prompt_dismissed';

  function wasShownToday() {
    const d = localStorage.getItem(SHOWN_KEY);
    if (!d) return false;
    return (Date.now() - parseInt(d)) < 24 * 60 * 60 * 1000; // 24u
  }

  function wasDismissed() {
    return !!localStorage.getItem(DISMISS_KEY);
  }

  function markShown()     { localStorage.setItem(SHOWN_KEY, Date.now()); }
  function markDismissed() { localStorage.setItem(DISMISS_KEY, '1'); }

  // ── 3. Banner bouwen ──────────────────────────────────────

  function createBanner(content) {
    const banner = document.createElement('div');
    banner.id        = 'vvs-pwa-banner';
    banner.innerHTML = content;

    // Slide-in animatie via style
    const style = document.createElement('style');
    style.textContent = `
      #vvs-pwa-banner {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        background: #fff;
        border-top: 3px solid #4B6CB7;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
        z-index: 9999;
        padding: 1rem 1.25rem 1.25rem;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        transform: translateY(100%);
        transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        max-width: 480px;
        margin: 0 auto;
        border-radius: 16px 16px 0 0;
      }
      #vvs-pwa-banner.visible { transform: translateY(0); }
      .pwa-banner-inner {
        display: flex; align-items: flex-start; gap: 0.85rem;
      }
      .pwa-banner-logo {
        width: 52px; height: 52px; border-radius: 12px;
        flex-shrink: 0; object-fit: cover;
      }
      .pwa-banner-text { flex: 1; }
      .pwa-banner-title {
        font-size: 0.95rem; font-weight: 700; color: #1a1a2e;
        margin-bottom: 0.2rem;
      }
      .pwa-banner-sub {
        font-size: 0.82rem; color: #666; line-height: 1.4;
        margin-bottom: 0.75rem;
      }
      .pwa-banner-btns { display: flex; gap: 0.5rem; }
      .pwa-install-btn {
        flex: 1; background: #4B6CB7; color: #fff;
        border: none; border-radius: 8px;
        padding: 0.6rem 1rem; font-size: 0.88rem; font-weight: 700;
        cursor: pointer; font-family: inherit;
        transition: background 0.2s;
      }
      .pwa-install-btn:hover { background: #3a5a9e; }
      .pwa-dismiss-btn {
        background: #f0f0f0; color: #555; border: none;
        border-radius: 8px; padding: 0.6rem 0.85rem;
        font-size: 0.82rem; font-weight: 600;
        cursor: pointer; font-family: inherit;
        white-space: nowrap; transition: background 0.2s;
      }
      .pwa-dismiss-btn:hover { background: #e0e0e0; }
      .pwa-ios-steps {
        background: #f0f4ff; border-radius: 10px;
        padding: 0.75rem 0.9rem; margin-top: 0.5rem;
        font-size: 0.82rem; color: #333; line-height: 1.7;
      }
      .pwa-ios-steps strong { color: #4B6CB7; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(banner);

    // Kleine delay voor de slide-in animatie
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('visible'));
    });

    return banner;
  }

  function hideBanner() {
    const b = document.getElementById('vvs-pwa-banner');
    if (!b) return;
    b.style.transform = 'translateY(110%)';
    setTimeout(() => b.remove(), 400);
  }

  // ── 4. Android/Chrome: native install prompt ──────────────

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;

    // Toon enkel als niet al genegeerd of vandaag al getoond
    if (wasDismissed() || wasShownToday()) return;

    // Wacht tot pagina geladen is
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showAndroidBanner);
    } else {
      setTimeout(showAndroidBanner, 1200);
    }
  });

  function showAndroidBanner() {
    if (!deferredPrompt) return;
    markShown();

    const banner = createBanner(`
      <div class="pwa-banner-inner">
        <img src="/vvsrotselaar/assets/icons/icon-192.png" class="pwa-banner-logo" alt="VVS">
        <div class="pwa-banner-text">
          <div class="pwa-banner-title">Toevoegen aan startscherm</div>
          <div class="pwa-banner-sub">Gebruik V.V.S Rotselaar als een echte app — sneller en altijd bij de hand.</div>
          <div class="pwa-banner-btns">
            <button class="pwa-install-btn" id="pwaInstallBtn">Installeren</button>
            <button class="pwa-dismiss-btn" id="pwaDismissBtn">Nee, bedankt</button>
          </div>
        </div>
      </div>
    `);

    banner.querySelector('#pwaInstallBtn').addEventListener('click', async () => {
      hideBanner();
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[PWA] Install outcome:', outcome);
      if (outcome === 'dismissed') markDismissed();
      deferredPrompt = null;
    });

    banner.querySelector('#pwaDismissBtn').addEventListener('click', () => {
      hideBanner();
      markDismissed();
    });
  }

  // ── 5. iOS Safari: manuele instructies ───────────────────
  //      Apple laat geen automatische prompt toe

  function showIosBanner() {
    markShown();

    const shareIcon = `<svg style="display:inline;vertical-align:middle;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4B6CB7" stroke-width="2.5"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;

    const banner = createBanner(`
      <div class="pwa-banner-inner">
        <img src="/vvsrotselaar/assets/icons/icon-192.png" class="pwa-banner-logo" alt="VVS">
        <div class="pwa-banner-text">
          <div class="pwa-banner-title">Toevoegen aan beginscherm</div>
          <div class="pwa-banner-sub">Installeer VVS Rotselaar als app op je iPhone of iPad.</div>
          <div class="pwa-ios-steps">
            1. Tik op ${shareIcon} <strong>Delen</strong> onderaan Safari<br>
            2. Scroll en tik op <strong>Zet op beginscherm</strong><br>
            3. Tik op <strong>Voeg toe</strong> rechtsboven
          </div>
          <div class="pwa-banner-btns" style="margin-top:0.6rem;">
            <button class="pwa-dismiss-btn" id="pwaDismissBtn" style="flex:1;">Begrepen ✓</button>
          </div>
        </div>
      </div>
    `);

    banner.querySelector('#pwaDismissBtn').addEventListener('click', () => {
      hideBanner();
      markDismissed();
    });
  }

  // iOS: toon eenmalig als in Safari (niet al geïnstalleerd)
  if (isIos() && !isInStandaloneMode() && !wasDismissed() && !wasShownToday()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(showIosBanner, 2000));
    } else {
      setTimeout(showIosBanner, 2000);
    }
  }

  // ── 6. Update-banner (nieuwe versie beschikbaar) ─────────

  function showUpdateBanner() {
    // Verwijder vorige banner als die er nog is
    document.getElementById('vvs-pwa-banner')?.remove();

    const banner = createBanner(`
      <div class="pwa-banner-inner">
        <img src="/vvsrotselaar/assets/icons/icon-192.png" class="pwa-banner-logo" alt="VVS">
        <div class="pwa-banner-text">
          <div class="pwa-banner-title">🆕 Update beschikbaar</div>
          <div class="pwa-banner-sub">Er is een nieuwe versie van de VVS app beschikbaar.</div>
          <div class="pwa-banner-btns">
            <button class="pwa-install-btn" id="pwaUpdateBtn">↻ Nu bijwerken</button>
            <button class="pwa-dismiss-btn" id="pwaUpdateLaterBtn">Later</button>
          </div>
        </div>
      </div>
    `);

    banner.querySelector('#pwaUpdateBtn').addEventListener('click', () => {
      navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    });

    banner.querySelector('#pwaUpdateLaterBtn').addEventListener('click', hideBanner);
  }

  // ── 7. Standalone: verberg browser-UI hints ──────────────
  if (isInStandaloneMode()) {
    document.documentElement.classList.add('pwa-standalone');
  }

})();
