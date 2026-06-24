// ===============================================
// VVS-SEASONAL.JS  –  V.V.S Rotselaar
// Seizoensgebonden particle-effecten op de homepage:
//   • December     → sneeuw bij elke paginalading
//   • 14 februari  → hartjes bij het openen
// Vereist: tsparticles confetti bundle
// ===============================================

(function () {
    'use strict';

    // Wacht tot confetti beschikbaar is (script kan asynchroon laden)
    function whenConfettiReady(cb) {
        if (typeof confetti === 'function') { cb(); return; }
        let tries = 0;
        const t = setInterval(() => {
            if (typeof confetti === 'function') { clearInterval(t); cb(); }
            if (++tries > 60) clearInterval(t); // geef op na 6 s
        }, 100);
    }

    const now   = new Date();
    const month = now.getMonth(); // 0 = januari … 11 = december
    const day   = now.getDate();

    // ── DECEMBER: sneeuw ──────────────────────────────────────────────────────
    if (month === 11) {
        whenConfettiReady(startSnow);
    }

    function startSnow() {
        // Looptijd: 15 seconden per run; herstart elke 20 seconden zodat het
        // de hele pagina-sessie actief blijft zonder te zwaar te zijn.
        function runSnow() {
            const duration    = 15 * 1000;
            const animationEnd = Date.now() + duration;
            let skew = 1;

            function randomInRange(min, max) {
                return Math.random() * (max - min) + min;
            }

            (function frame() {
                const timeLeft = animationEnd - Date.now();
                const ticks    = Math.max(200, 500 * (timeLeft / duration));
                skew = Math.max(0.8, skew - 0.001);

                confetti({
                    particleCount:  1,
                    startVelocity:  0,
                    ticks,
                    origin: {
                        x: Math.random(),
                        y: Math.random() * skew - 0.2
                    },
                    colors:  ['#ffffff'],
                    shapes:  ['circle'],
                    gravity: randomInRange(0.4, 0.6),
                    scalar:  randomInRange(0.4, 1),
                    drift:   randomInRange(-0.4, 0.4)
                });

                if (timeLeft > 0) {
                    requestAnimationFrame(frame);
                }
            })();
        }

        runSnow();
        // Herstart elke 20 s zodat er continu lichte sneeuw is
        setInterval(runSnow, 20000);
    }


    // ── 14 FEBRUARI: hartjes ──────────────────────────────────────────────────
    if (month === 1 && day === 14) {
        whenConfettiReady(launchHearts);
    }

    function launchHearts() {
        const defaults = {
            spread:        360,
            ticks:         100,
            gravity:       0,
            decay:         0.94,
            startVelocity: 30,
            shapes:        ['heart'],
            colors:        ['#ec58fc', '#ff69b4', '#ff1493', '#ff85c2', '#ffffff']
        };

        // Drie salvo's voor een mooie spread
        confetti({ ...defaults, particleCount: 50, scalar: 2 });
        setTimeout(() => confetti({ ...defaults, particleCount: 25, scalar: 3 }), 150);
        setTimeout(() => confetti({ ...defaults, particleCount: 10, scalar: 4 }), 300);
    }

})();