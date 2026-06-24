// ===============================================
// VVS-EXTRAS.JS  –  V.V.S Rotselaar
//   1. Logo confetti easter egg (5× klikken)
//   2. Scroll fade-in animaties
//   3. Teller-animaties voor statistieken
// Gebruik: <script src="scripts/vvs-extras.js" defer></script>
// Vereist: tsparticles confetti bundle al geladen op de pagina
// ===============================================

(function () {
    'use strict';

    // ── HELPER: wacht tot confetti beschikbaar is ─────────────────────────────
    function whenConfettiReady(cb) {
        if (typeof confetti === 'function') { cb(); return; }
        let tries = 0;
        const t = setInterval(() => {
            if (typeof confetti === 'function') { clearInterval(t); cb(); }
            if (++tries > 40) clearInterval(t);
        }, 100);
    }


    // ── 1. LOGO CONFETTI EASTER EGG (5× klikken op logo) ─────────────────────
    (function initLogoEasterEgg() {
        const logo = document.getElementById('teamLogo') || document.querySelector('.team-logo');
        if (!logo) return;

        let clicks = 0;
        let timer  = null;

        logo.style.cursor = 'pointer';

        logo.addEventListener('click', () => {
            clicks++;
            clearTimeout(timer);
            timer = setTimeout(() => { clicks = 0; }, 3000);

            if (clicks >= 5) {
                clicks = 0;
                whenConfettiReady(launchLogoConfetti);
            }
        });

        function launchLogoConfetti() {
            const count    = 200;
            const defaults = { origin: { y: 0.7 } };

            function fire(particleRatio, opts) {
                confetti(Object.assign({}, defaults, opts, {
                    particleCount: Math.floor(count * particleRatio)
                }));
            }

            fire(0.25, { spread: 26, startVelocity: 55 });
            fire(0.20, { spread: 60 });
            fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
            fire(0.10, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
            fire(0.10, { spread: 120, startVelocity: 45 });
        }
    })();


    // ── 2. SCROLL FADE-IN ANIMATIES ──────────────────────────────────────────
    (function initScrollAnimations() {
        if (!('IntersectionObserver' in window)) return;

        // Inject CSS eenmalig
        if (!document.getElementById('vvs-fadein-style')) {
            const style = document.createElement('style');
            style.id = 'vvs-fadein-style';
            style.textContent = `
[data-vvs-fade] {
    opacity: 0;
    transform: translateY(24px);
    transition: opacity 0.55s cubic-bezier(0.4, 0, 0.2, 1),
                transform 0.55s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: opacity, transform;
}
[data-vvs-fade].vvs-visible {
    opacity: 1 !important;
    transform: none !important;
}
@media (prefers-reduced-motion: reduce) {
    [data-vvs-fade] {
        transition: none !important;
        opacity: 1 !important;
        transform: none !important;
    }
}`;
            document.head.appendChild(style);
        }

        // Selectors die automatisch een fade-in krijgen
        const SELECTORS = [
            '.section-title',
            '.stat-card',
            '.info-card',
            '.next-match-card',
            '.recent-match-card',
            '.match-history-card',
            '.featured-evenement',
            '.evenement-card',
            '.sponsor-card',
            '.gallery-item',
            '.team-button',
            '.contact-item',
            '.bestuur-item',
            '.ranking-section',
            '.recent-matches-section',
            '.next-match-section',
            '.wl-shift-card',
            '.wl-category-grid',
            '.contact-form-section',
            '.contact-info-section',
        ];

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const el    = entry.target;
                const delay = parseInt(el.dataset.vvsFadeDelay || '0', 10);
                setTimeout(() => el.classList.add('vvs-visible'), delay);
                observer.unobserve(el);
            });
        }, { threshold: 0.06, rootMargin: '0px 0px -30px 0px' });

        function tagAndObserve() {
            SELECTORS.forEach((sel) => {
                document.querySelectorAll(sel).forEach((el, i) => {
                    if (el.dataset.vvsFade !== undefined) return; // al verwerkt
                    el.dataset.vvsFade = '1';
                    // Stagger per groep, max 300ms
                    el.dataset.vvsFadeDelay = String(Math.min(i * 55, 300));
                    observer.observe(el);
                });
            });
        }

        tagAndObserve();

        // Herbekijk als Firebase content dynamisch geladen wordt
        const mutObs = new MutationObserver(tagAndObserve);
        mutObs.observe(document.body, { childList: true, subtree: true });
    })();


    // ── 3. TELLER-ANIMATIES ───────────────────────────────────────────────────
    // Alle .stat-value elementen: telt op van 0 naar de eindwaarde
    (function initCounters() {
        if (!('IntersectionObserver' in window)) return;

        function animateCounter(el, target, duration) {
            const isFloat = String(target).includes('.');
            const start   = performance.now();
            function tick(now) {
                const p     = Math.min((now - start) / duration, 1);
                const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
                const val   = target * eased;
                el.textContent = isFloat ? val.toFixed(1) : Math.round(val);
                if (p < 1) requestAnimationFrame(tick);
                else       el.textContent = isFloat ? target.toFixed(1) : target;
            }
            requestAnimationFrame(tick);
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const el  = entry.target;
                const raw = el.textContent.trim();
                const num = parseFloat(raw);
                if (!isNaN(num) && num > 0) {
                    el.textContent = '0';
                    // Schaal duur met grootte: kleine getallen sneller
                    const dur = Math.min(800 + num * 8, 1800);
                    animateCounter(el, num, dur);
                }
                observer.unobserve(el);
            });
        }, { threshold: 0.5 });

        function scanCounters() {
            document.querySelectorAll('.stat-value').forEach(el => {
                if (el.dataset.counterObserved) return;
                el.dataset.counterObserved = '1';
                observer.observe(el);
            });
        }

        scanCounters();
        const mut = new MutationObserver(scanCounters);
        mut.observe(document.body, { childList: true, subtree: true });
    })();
})();