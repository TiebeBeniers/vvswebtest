import { db } from './firebase-config.js';
import { collection, addDoc, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
        
// ── Cooldown: 5 minuten tussen berichten (localStorage) ─────────────────────
const COOLDOWN_MS  = 5 * 60 * 1000;  // 5 minuten
const COOLDOWN_KEY = 'vvs_contact_last_sent';

function getCooldownRemaining() {
    const last = parseInt(localStorage.getItem(COOLDOWN_KEY) || '0', 10);
    const remaining = COOLDOWN_MS - (Date.now() - last);
    return remaining > 0 ? remaining : 0;
}

function formatCooldown(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return min > 0
        ? `${min} min ${String(sec).padStart(2, '0')} sec`
        : `${sec} sec`;
}

// Toon afteltimer op de knop als de cooldown actief is
let cooldownInterval = null;
function startCooldownUI(submitBtn, originalText) {
    clearInterval(cooldownInterval);
    function update() {
        const rem = getCooldownRemaining();
        if (rem <= 0) {
            clearInterval(cooldownInterval);
            submitBtn.disabled    = false;
            submitBtn.textContent = originalText;
            submitBtn.classList.remove('cooldown-active');
        } else {
            submitBtn.disabled    = true;
            submitBtn.textContent = `Wacht ${formatCooldown(rem)}`;
            submitBtn.classList.add('cooldown-active');
        }
    }
    update();
    cooldownInterval = setInterval(update, 1000);
}

// ── Contact form submission ───────────────────────────────────────────────────
const contactForm = document.getElementById('contactForm');

if (contactForm) {
    const submitBtn   = contactForm.querySelector('.submit-btn');
    const originalText = submitBtn ? submitBtn.textContent : 'VERZENDEN';

    // Herstel cooldown bij herladen van de pagina
    if (submitBtn && getCooldownRemaining() > 0) {
        startCooldownUI(submitBtn, originalText);
    }

    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Cooldown check
        const remaining = getCooldownRemaining();
        if (remaining > 0) {
            showToast(`Wacht nog ${formatCooldown(remaining)} voor een volgend bericht.`, 'error');
            return;
        }

        try {
            submitBtn.textContent = 'VERZENDEN...';
            submitBtn.disabled    = true;

            const email   = document.getElementById('email').value.trim();
            const message = document.getElementById('message').value.trim();

            if (!email || !message) {
                showToast('Vul alle velden in', 'error');
                submitBtn.textContent = originalText;
                submitBtn.disabled    = false;
                return;
            }

            const docRef = await addDoc(collection(db, 'contactberichten'), {
                email:     email,
                bericht:   message,
                datum:     Timestamp.now(),
                gelezen:   false,
                createdAt: new Date().toISOString(),
            });

            console.log('Contact bericht saved with ID:', docRef.id);

            // Sla timestamp op en start cooldown
            localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
            showToast('Bericht verzonden! We nemen snel contact op.', 'success');
            contactForm.reset();
            startCooldownUI(submitBtn, originalText);

        } catch (error) {
            console.error('Error submitting form:', error);
            let errorMessage = 'Er is een fout opgetreden. ';
            if (error.code === 'permission-denied') {
                errorMessage += 'Geen toegang tot de database.';
            } else if (error.code === 'unavailable') {
                errorMessage += 'Database niet bereikbaar. Probeer het later opnieuw.';
            } else {
                errorMessage += 'Probeer het later opnieuw.';
            }
            showToast(errorMessage, 'error');
            submitBtn.textContent = originalText;
            submitBtn.disabled    = false;
        }
    });
}
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
