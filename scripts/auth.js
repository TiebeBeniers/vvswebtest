// ===============================================
// AUTHENTICATION PAGE
// V.V.S Rotselaar
// Updated: Password show/hide + encryption
// ===============================================

import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, addDoc, serverTimestamp, doc, updateDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { encryptPassword } from './crypto-utils.js';

// ===============================================
// PASSWORD SHOW/HIDE FUNCTIONALITY
// ===============================================

function setupPasswordToggle(toggleButtonId, passwordInputId) {
    const toggleButton = document.getElementById(toggleButtonId);
    const passwordInput = document.getElementById(passwordInputId);
    
    if (toggleButton && passwordInput) {
        toggleButton.addEventListener('click', () => {
            const eyeOpen = toggleButton.querySelector('.eye-open');
            const eyeClosed = toggleButton.querySelector('.eye-closed');
            
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                eyeOpen.style.display = 'none';
                eyeClosed.style.display = 'block';
            } else {
                passwordInput.type = 'password';
                eyeOpen.style.display = 'block';
                eyeClosed.style.display = 'none';
            }
        });
    }
}

// Initialize password toggles when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    setupPasswordToggle('toggleLoginPassword', 'password');
    setupPasswordToggle('toggleRequestPassword', 'requestPassword');

    // ── Wachtwoord vergeten popup ────────────────────────────────────────────

    const forgotModal      = document.getElementById('forgotPasswordModal');
    const showForgotBtn    = document.getElementById('showForgotPassword');
    const closeForgotBtn   = document.getElementById('closeForgotBtn');
    const sendForgotBtn    = document.getElementById('sendForgotEmailBtn');
    const forgotEmailInput = document.getElementById('forgotEmail');
    const forgotStatus     = document.getElementById('forgotStatus');

    function openForgotModal() {
        // Pre-fill met de eerder ingevulde email als die er is
        const loginEmail = document.getElementById('email')?.value?.trim();
        if (forgotEmailInput && loginEmail) forgotEmailInput.value = loginEmail;
        if (forgotStatus) { forgotStatus.style.display = 'none'; forgotStatus.textContent = ''; }
        if (forgotModal) forgotModal.style.display = 'block';
    }

    function closeForgotModal() {
        if (forgotModal) forgotModal.style.display = 'none';
    }

    if (showForgotBtn)  showForgotBtn.addEventListener('click',  (e) => { e.preventDefault(); openForgotModal(); });
    if (closeForgotBtn) closeForgotBtn.addEventListener('click', closeForgotModal);
    if (forgotModal)    forgotModal.addEventListener('click', (e) => { if (e.target === forgotModal) closeForgotModal(); });

    if (sendForgotBtn) {
        let cooldownUntil = 0;

        sendForgotBtn.addEventListener('click', async () => {
            const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
            if (remaining > 0) {
                showForgotStatus('error', `Wacht nog ${remaining} seconden voor je opnieuw een reset-link aanvraagt.`);
                return;
            }

            const email = forgotEmailInput?.value?.trim();
            if (!email) {
                showForgotStatus('error', 'Vul je e-mailadres in.');
                return;
            }

            sendForgotBtn.disabled = true;
            sendForgotBtn.textContent = 'Bezig…';

            try {
                await sendPasswordResetEmail(auth, email);
                cooldownUntil = Date.now() + 30_000;
                showForgotStatus('success', `Reset-link verstuurd naar ${email}. Controleer ook je spam.`);

                let secs = 30;
                const interval = setInterval(() => {
                    secs--;
                    if (secs <= 0) {
                        clearInterval(interval);
                        sendForgotBtn.disabled = false;
                        sendForgotBtn.textContent = 'Stuur e-mail';
                    } else {
                        sendForgotBtn.textContent = `Opnieuw sturen (${secs}s)`;
                    }
                }, 1000);

            } catch (err) {
                let msg = 'Er ging iets mis. Probeer opnieuw.';
                if (err.code === 'auth/user-not-found')        msg = 'Geen account gevonden met dit e-mailadres.';
                else if (err.code === 'auth/invalid-email')    msg = 'Ongeldig e-mailadres.';
                else if (err.code === 'auth/too-many-requests') msg = 'Te veel pogingen. Probeer later opnieuw.';
                showForgotStatus('error', msg);
                sendForgotBtn.disabled = false;
                sendForgotBtn.textContent = 'Stuur e-mail';
            }
        });
    }

    function showForgotStatus(type, msg) {
        if (!forgotStatus) return;
        forgotStatus.style.display = 'block';
        forgotStatus.style.background = type === 'success' ? '#d4edda' : '#f8d7da';
        forgotStatus.style.color      = type === 'success' ? '#155724' : '#721c24';
        forgotStatus.style.border     = `1px solid ${type === 'success' ? '#c3e6cb' : '#f5c6cb'}`;
        forgotStatus.textContent = msg;
    }
});

// ===============================================
// DOM ELEMENTS
// ===============================================

const loginForm = document.getElementById('loginForm');
const loggedInView = document.getElementById('loggedInView');
const errorMessage = document.getElementById('errorMessage');
const logoutBtn = document.getElementById('logoutBtn');
const adminBtn = document.getElementById('adminBtn');
const profileBtn = document.getElementById('profileBtn');
const tijdelijkBtn = document.getElementById('tijdelijkBtn'); // knop naar rockwerchter voor tijdelijke accounts
const requestAccountView = document.getElementById('requestAccountView');
const showRequestFormBtn = document.getElementById('showRequestForm');
const backToLoginBtn = document.getElementById('backToLogin');
const requestAccountForm = document.getElementById('requestAccountForm');
const loginBoxHeader = document.querySelector('.login-box h2');
const loginSubtitle = document.getElementById('loginSubtitle');

// Debug: Check if all elements are found
console.log('Auth.js loaded (with password show/hide + encryption)');
console.log('Elements found:', {
    loginForm: !!loginForm,
    loggedInView: !!loggedInView,
    errorMessage: !!errorMessage,
    logoutBtn: !!logoutBtn,
    adminBtn: !!adminBtn,
    requestAccountView: !!requestAccountView,
    showRequestFormBtn: !!showRequestFormBtn,
    backToLoginBtn: !!backToLoginBtn,
    requestAccountForm: !!requestAccountForm,
    loginBoxHeader: !!loginBoxHeader,
    loginSubtitle: !!loginSubtitle
});

// ===============================================
// SHOW/HIDE ACCOUNT REQUEST FORM
// ===============================================

if (showRequestFormBtn) {
    showRequestFormBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('Show request form clicked');
        
        // Update header and subtitle
        if (loginBoxHeader) {
            loginBoxHeader.textContent = 'Account Aanvragen';
        }
        if (loginSubtitle) {
            loginSubtitle.textContent = 'Vul onderstaand formulier in om een account aan te vragen';
        }
        
        // Hide login form, show request form
        if (loginForm) {
            loginForm.style.display = 'none';
        }
        if (requestAccountView) {
            requestAccountView.style.display = 'block';
        }
        
        // Clear any previous messages
        const requestSuccessMessage = document.getElementById('requestSuccessMessage');
        const requestErrorMessage = document.getElementById('requestErrorMessage');
        if (requestSuccessMessage) requestSuccessMessage.style.display = 'none';
        if (requestErrorMessage) requestErrorMessage.style.display = 'none';
    });
}

if (backToLoginBtn) {
    backToLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('Back to login clicked');
        
        // Reset header and subtitle
        if (loginBoxHeader) {
            loginBoxHeader.textContent = 'Inloggen';
        }
        if (loginSubtitle) {
            loginSubtitle.textContent = 'Toegang voor clubleden';
        }
        
        // Hide request form, show login form
        if (requestAccountView) {
            requestAccountView.style.display = 'none';
        }
        if (loginForm) {
            loginForm.style.display = 'flex';
            loginForm.style.flexDirection = 'column';
        }
        
        // Clear request form
        if (requestAccountForm) {
            requestAccountForm.reset();
        }
        const requestSuccessMessage = document.getElementById('requestSuccessMessage');
        const requestErrorMessage = document.getElementById('requestErrorMessage');
        if (requestSuccessMessage) requestSuccessMessage.style.display = 'none';
        if (requestErrorMessage) requestErrorMessage.style.display = 'none';
        // Clear login error too
        if (errorMessage) {
            errorMessage.style.display = 'none';
        }
    });
}

// ===============================================
// ACCOUNT REQUEST FUNCTIONALITY
// ===============================================

if (requestAccountForm) {
    requestAccountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('requestName').value.trim();
        const email = document.getElementById('requestEmail').value.trim();
        const password = document.getElementById('requestPassword').value;
        // Haal alle geselecteerde ploegen op (multi-select via checkboxes)
        const teamCheckboxes = document.querySelectorAll('input[name="requestTeam"]:checked');
        const ploegen = Array.from(teamCheckboxes).map(cb => cb.value);
        const team    = ploegen[0] || '';  // primaire ploeg = eerste geselecteerde

        // Valideer: minstens 1 ploeg vereist
        const teamError = document.getElementById('teamSelectError');
        if (ploegen.length === 0) {
            if (teamError) teamError.style.display = 'block';
            requestErrorMessage.style.display = 'none';
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'AANVRAAG INDIENEN'; }
            return;
        }
        if (teamError) teamError.style.display = 'none';
        const phoneField = document.getElementById('requestPhone');
        const phone = phoneField ? phoneField.value.trim() : '';

        if (!phone) {
            requestErrorMessage.textContent = 'Vul je telefoonnummer in.';
            requestErrorMessage.style.display = 'block';
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'AANVRAAG INDIENEN'; }
            return;
        }
        
        const requestSuccessMessage = document.getElementById('requestSuccessMessage');
        const requestErrorMessage = document.getElementById('requestErrorMessage');
        
        // Hide messages
        requestSuccessMessage.style.display = 'none';
        requestErrorMessage.style.display = 'none';
        
        // Disable submit button
        const submitBtn = requestAccountForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Bezig met indienen...';
        }
        
        try {
            // Check if email already exists in requests
            const existingRequestQuery = query(
                collection(db, 'account_requests'),
                where('email', '==', email),
                where('status', '==', 'pending')
            );
            
            let existingRequestSnapshot;
            try {
                existingRequestSnapshot = await getDocs(existingRequestQuery);
            } catch (queryError) {
                // If query fails due to permissions, that's okay - we'll try to create anyway
                console.log('Could not check existing requests (expected for non-authenticated users)');
                existingRequestSnapshot = { empty: true };
            }
            
            if (!existingRequestSnapshot.empty) {
                requestErrorMessage.textContent = 'Er bestaat al een aanvraag voor dit e-mailadres.';
                requestErrorMessage.style.display = 'block';
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'AANVRAAG INDIENEN';
                }
                return;
            }
            
            // Check if user already exists (only if we can query)
            try {
                const existingUserQuery = query(
                    collection(db, 'users'),
                    where('email', '==', email)
                );
                const existingUserSnapshot = await getDocs(existingUserQuery);
                
                if (!existingUserSnapshot.empty) {
                    requestErrorMessage.textContent = 'Dit e-mailadres is al geregistreerd. Probeer in te loggen.';
                    requestErrorMessage.style.display = 'block';
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'AANVRAAG INDIENEN';
                    }
                    return;
                }
            } catch (userQueryError) {
                // If we can't query users, that's okay - admin will catch duplicate during approval
                console.log('Could not check existing users (expected for non-authenticated users)');
            }
            
            // Encrypt password before storing
            console.log('Encrypting password...');
            const encryptedPassword = await encryptPassword(password);
            console.log('Password encrypted successfully');
            
            // Create account request in Firestore with encrypted password
            await addDoc(collection(db, 'account_requests'), {
                naam: name,
                email: email,
                encryptedPassword: encryptedPassword,
                categorie: team,       // primaire ploeg (backwards compat)
                ploegen: ploegen,      // array van alle ploegen
                ...(phone && { telefoon: phone }),
                status: 'pending',
                createdAt: serverTimestamp()
            });
            
            console.log('Account request created successfully');
            
            // Clear form first
            requestAccountForm.reset();
            
            // Switch back to login view
            if (requestAccountView) {
                requestAccountView.style.display = 'none';
            }
            if (loginForm) {
                loginForm.style.display = 'flex';
                loginForm.style.flexDirection = 'column';
            }
            
            // Reset header and subtitle
            if (loginBoxHeader) {
                loginBoxHeader.textContent = 'Inloggen';
            }
            if (loginSubtitle) {
                loginSubtitle.textContent = 'Toegang voor clubleden';
            }
            
            // Show success message on login form
            const loginSuccessMessage = document.createElement('div');
            loginSuccessMessage.className = 'success-message';
            loginSuccessMessage.style.marginBottom = '1rem';
            loginSuccessMessage.textContent = 'Je aanvraag is succesvol ingediend! Reactie over goedkeuring volgt binnen enkele dagen.';
            
            // Insert before login button
            const loginButton = loginForm.querySelector('button[type="submit"]');
            if (loginButton) {
                loginForm.insertBefore(loginSuccessMessage, loginButton);
                
                // Remove message after 10 seconds
                setTimeout(() => {
                    loginSuccessMessage.remove();
                }, 10000);
            }
            
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
        } catch (error) {
            console.error('Account request error:', error);
            
            let errorText = 'Er is een fout opgetreden bij het indienen van je aanvraag.';
            
            if (error.code === 'permission-denied') {
                errorText = 'Fout bij het indienen. Meldt het bij de beheerder.';
            } else if (error.message) {
                errorText = 'Fout: ' + error.message;
            }
            
            requestErrorMessage.textContent = errorText;
            requestErrorMessage.style.display = 'block';
        } finally {
            // Re-enable submit button
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'AANVRAAG INDIENEN';
            }
        }
    });
}


// ===============================================
// ALGEMENE VOORWAARDEN MODAL
// ===============================================

const termsModal      = document.getElementById('termsModal');
const showTermsBtn    = document.getElementById('showTermsBtn');
const closeTermsBtn   = document.getElementById('closeTermsBtn');
const acceptTermsBtn  = document.getElementById('acceptTermsBtn');
const declineTermsBtn = document.getElementById('declineTermsBtn');
const acceptTermsCb   = document.getElementById('acceptTerms');
const submitRequestBtn = document.getElementById('submitRequestBtn');

function openTermsModal() {
    if (termsModal) termsModal.style.display = 'block';
}

function closeTermsModal() {
    if (termsModal) termsModal.style.display = 'none';
}

if (showTermsBtn) {
    showTermsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openTermsModal();
    });
}

if (closeTermsBtn) {
    closeTermsBtn.addEventListener('click', closeTermsModal);
}

// Klik buiten modal sluit hem
if (termsModal) {
    termsModal.addEventListener('click', (e) => {
        if (e.target === termsModal) closeTermsModal();
    });
}

if (declineTermsBtn) {
    declineTermsBtn.addEventListener('click', () => {
        if (acceptTermsCb) acceptTermsCb.checked = false;
        updateSubmitBtn();
        closeTermsModal();
    });
}

if (acceptTermsBtn) {
    acceptTermsBtn.addEventListener('click', () => {
        if (acceptTermsCb) acceptTermsCb.checked = true;
        updateSubmitBtn();
        closeTermsModal();
    });
}

function updateSubmitBtn() {
    if (!submitRequestBtn || !acceptTermsCb) return;
    const accepted = acceptTermsCb.checked;
    submitRequestBtn.disabled = !accepted;
    submitRequestBtn.style.opacity = accepted ? '1' : '0.5';
    submitRequestBtn.style.cursor  = accepted ? 'pointer' : 'not-allowed';
}

if (acceptTermsCb) {
    acceptTermsCb.addEventListener('change', updateSubmitBtn);
}

// ===============================================
// LOGIN FUNCTIONALITY
// ===============================================

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    // Hide error message
    errorMessage.style.display = 'none';
    
    try {
        // Sign in with Firebase Auth
        await signInWithEmailAndPassword(auth, email, password);
        
        // Auth state listener will handle the UI update
    } catch (error) {
        console.error('Login error:', error);
        
        let errorText = 'Er is een fout opgetreden bij het inloggen.';
        
        switch (error.code) {
            case 'auth/invalid-email':
                errorText = 'Ongeldig e-mailadres.';
                break;
            case 'auth/user-disabled':
                errorText = 'Dit account is uitgeschakeld.';
                break;
            case 'auth/user-not-found':
            case 'auth/wrong-password':
                errorText = 'Onjuist e-mailadres of wachtwoord.';
                break;
            case 'auth/too-many-requests':
                errorText = 'Te veel mislukte pogingen. Probeer later opnieuw.';
                break;
        }
        
        errorMessage.textContent = errorText;
        errorMessage.style.display = 'block';
    }
});

// ===============================================
// LOGOUT FUNCTIONALITY
// ===============================================

logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        // Auth state listener will handle the UI update
    } catch (error) {
        console.error('Logout error:', error);
        showToast('Fout bij uitloggen', 'error');
    }
});

// ===============================================
// ADMIN NAVIGATION
// ===============================================

if (adminBtn) {
    adminBtn.addEventListener('click', () => {
        window.location.href = 'admin.html';
    });
}

if (profileBtn) {
    profileBtn.addEventListener('click', () => {
        window.location.href = 'speler.html';
    });
}

if (tijdelijkBtn) {
    tijdelijkBtn.addEventListener('click', () => {
        window.location.href = 'rockwerchter.html';
    });
}

// ===============================================
// AUTH STATE LISTENER
// ===============================================

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is logged in
        console.log('User logged in:', user.uid);
        try {
            // Get user data from Firestore
            const userQuery = query(
                collection(db, 'users'),
                where('uid', '==', user.uid)
            );
            const userSnapshot = await getDocs(userQuery);
            
            if (!userSnapshot.empty) {
                const userDocRef = userSnapshot.docs[0].ref;
                let userData = userSnapshot.docs[0].data();
                console.log('User data found:', userData);

                // ── Email-sync na verificatie ─────────────────────────────────
                // Na een geverifieerde e-mailwijziging is auth.currentUser.email al
                // bijgewerkt, maar Firestore nog niet. We detecteren dit hier en
                // updaten Firestore automatisch zodat alles in sync blijft.
                if (user.email && userData.email !== user.email) {
                    try {
                        await updateDoc(userDocRef, {
                            email: user.email,
                            pendingEmail: null
                        });
                        userData = { ...userData, email: user.email, pendingEmail: null };
                        console.log('Firestore email gesynchroniseerd naar:', user.email);
                    } catch (syncErr) {
                        console.error('Email sync mislukt:', syncErr);
                    }
                }
                
                // Hide both login and request forms, show logged in view
                if (loginForm) {
                    loginForm.style.display = 'none';
                }
                if (requestAccountView) {
                    requestAccountView.style.display = 'none';
                }
                if (loggedInView) {
                    loggedInView.style.display = 'block';
                }
                
                // Update user info
                const userNameEl = document.getElementById('userName');
                const userEmailEl = document.getElementById('userEmail');
                const userRoleEl = document.getElementById('userRole');

                if (userNameEl)  userNameEl.textContent  = userData.naam  || 'Gebruiker';
                if (userEmailEl) userEmailEl.textContent = userData.email || user.email;

                // ── Tijdelijk account: valideer geldigheidsperiode ──────────
                if (userData.rol === 'tijdelijk') {
                    const now   = new Date();
                    const from  = userData.validFrom?.toDate  ? userData.validFrom.toDate()  : new Date(userData.validFrom);
                    const until = userData.validUntil?.toDate ? userData.validUntil.toDate() : new Date(userData.validUntil);

                    if (now < from) {
                        await signOut(auth);
                        showToast(`Dit account is pas actief vanaf ${from.toLocaleString('nl-BE')}.`, 'error');
                        return;
                    }
                    if (now > until) {
                        await signOut(auth);
                        showToast('Dit tijdelijk account is verlopen. Neem contact op met de beheerder.', 'error');
                        return;
                    }

                    // Geldig — toon tijdelijke account UI
                    if (userRoleEl) userRoleEl.textContent = 'Tijdelijk account';
                    if (adminBtn)   adminBtn.style.display   = 'none';
                    if (profileBtn) profileBtn.style.display = 'none';
                    if (tijdelijkBtn) {
                        tijdelijkBtn.style.display = (userData.toegang || []).includes('rockwerchter') ? 'block' : 'none';
                    }
                    return; // verdere knop-logica overslaan
                }

                // ── Normale accounts ────────────────────────────────────────

                // Toon vraagteken-knop voor algemene voorwaarden als ingelogd
                //TODO: layout fixen.
                const termsQuickBtn = document.getElementById('termsQuickBtn');
                if (termsQuickBtn) {
                    termsQuickBtn.style.display = 'block';
                    if (!termsQuickBtn.dataset.listenerAttached) {
                        termsQuickBtn.dataset.listenerAttached = '1';
                        termsQuickBtn.addEventListener('click', () => {
                            const modal = document.getElementById('termsModal');
                            if (modal) modal.style.display = 'block';
                        });
                    }
                }

                // Multi-rol: gebruiker kan tegelijk speler én admin zijn
                const userRollen = Array.isArray(userData.rollen) && userData.rollen.length > 0
                    ? userData.rollen : [userData.rol || 'speler'];
                const isAdmin = userRollen.includes('admin') || userData.rol === 'admin';
                const isSpeler = userRollen.includes('speler') && (
                    Array.isArray(userData.ploegen) && userData.ploegen.length > 0
                    || userData.categorie
                );

                // Show admin button if user has admin access
                if (adminBtn) {
                    adminBtn.style.display = isAdmin ? 'block' : 'none';
                }

                if (tijdelijkBtn) tijdelijkBtn.style.display = 'none';

                // Profiel-knop: toon als speler OF als admin (admins hebben ook een profiel)
                if (profileBtn) {
                    const userPloegen = Array.isArray(userData.ploegen) && userData.ploegen.length > 0
                        ? userData.ploegen : (userData.categorie ? [userData.categorie] : []);
                    const isBestuurslid = userPloegen.includes('bestuurslid')
                        || userData.categorie === 'bestuurslid'
                        || userData.rol === 'bestuurslid';
                    // Toon profiel-knop als speler of admin (ook naast admin-knop)
                    profileBtn.style.display = (isAdmin || (isSpeler && !isBestuurslid)) ? 'block' : 'none';
                }

                // Layout: naast elkaar bij meerdere actie-knoppen (excl. logout)
                const actionBtns = document.getElementById('profileActionBtns');
                if (actionBtns) {
                    const visibleBtns = Array.from(actionBtns.querySelectorAll('button:not(#logoutBtn)')).filter(b => b.style.display !== 'none');
                    actionBtns.classList.toggle('profile-action-btns-grid', visibleBtns.length >= 2);
                }

                // Roltext aanpassen
                if (userRoleEl) {
                    const userPloegen2 = Array.isArray(userData.ploegen) && userData.ploegen.length > 0
                        ? userData.ploegen : (userData.categorie ? [userData.categorie] : []);
                    const isBestuurslid2 = userPloegen2.includes('bestuurslid')
                        || userData.categorie === 'bestuurslid'
                        || userData.rol === 'bestuurslid';
                    if (isAdmin && isSpeler) userRoleEl.textContent = 'Speler + Administrator';
                    else if (isAdmin) userRoleEl.textContent = 'Administrator';
                    else if (isBestuurslid2) userRoleEl.textContent = 'Bestuurslid';
                    else userRoleEl.textContent = 'Clublid';
                }

                // Herbereken layout na render (knoppen kunnen display:none zijn)
                setTimeout(() => {
                    if (!actionBtns) return;
                    const vis = Array.from(actionBtns.querySelectorAll('button:not(#logoutBtn)')).filter(b => b.style.display !== 'none');
                    actionBtns.classList.toggle('profile-action-btns-grid', vis.length >= 2);
                }, 50);
            } else {
                console.error('No user data found in Firestore for UID:', user.uid);
                // Show error and logout
                showToast('Gebruikersgegevens niet gevonden', 'error');
                await signOut(auth);
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
            showToast('Fout bij ophalen gegevens: ' + error.message, 'error');
        }
    } else {
        // User is logged out
        console.log('User logged out');
        
        // Reset header and subtitle to login state
        if (loginBoxHeader) {
            loginBoxHeader.textContent = 'Inloggen';
        }
        if (loginSubtitle) {
            loginSubtitle.textContent = 'Toegang voor clubleden';
        }
        
        // Show login form, hide request and logged in views
        if (loginForm) {
            loginForm.style.display = 'flex';
            loginForm.style.flexDirection = 'column';
        }
        if (requestAccountView) {
            requestAccountView.style.display = 'none';
        }
        if (loggedInView) {
            loggedInView.style.display = 'none';
        }
        
        // Clear forms
        if (loginForm) {
            loginForm.reset();
        }
        if (requestAccountForm) {
            requestAccountForm.reset();
        }
        if (errorMessage) {
            errorMessage.style.display = 'none';
        }
        
        // Clear request messages
        const requestSuccessMessage = document.getElementById('requestSuccessMessage');
        const requestErrorMessage = document.getElementById('requestErrorMessage');
        if (requestSuccessMessage) requestSuccessMessage.style.display = 'none';
        if (requestErrorMessage) requestErrorMessage.style.display = 'none';
    }
});

// ===============================================
// DYNAMISCHE ALGEMENE VOORWAARDEN (vanuit Firestore)
// Firestore: settings/terms → { sections: [{ id, title, body }] }
// Valt terug op de hard-coded inhoud als er geen data is.
// ===============================================

async function loadTermsFromFirestore() {
    const contentEl  = document.getElementById('termsContent');
    const fallbackEl = document.getElementById('termsFallback');
    const subtitleEl = document.getElementById('termsSubtitle');
    if (!contentEl) return;  // element bestaat niet op deze pagina

    // Laadspinner tonen
    contentEl.innerHTML = `<div style="text-align:center;padding:2rem;color:#888;">
        <div style="display:inline-block;width:22px;height:22px;border:2.5px solid #ddd;
            border-top-color:#0047AB;border-radius:50%;animation:tc-spin 0.8s linear infinite;"></div>
        <p style="margin-top:0.5rem;font-size:0.88rem;">Laden…</p>
    </div>`;
    if (!document.getElementById('tcSpinStyle')) {
        const st = document.createElement('style');
        st.id = 'tcSpinStyle';
        st.textContent = '@keyframes tc-spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(st);
    }

    try {
        const snap = await getDoc(doc(db, 'settings', 'terms'));

        if (snap.exists() && snap.data().sections?.length) {
            const { sections, updatedAt } = snap.data();

            // Datum in subtitle
            if (subtitleEl && updatedAt?.toDate) {
                const d = updatedAt.toDate();
                subtitleEl.textContent = 'V.V.S Rotselaar — ' +
                    d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
            }

            // Render secties — exact gelijk aan admin3 terms preview
            contentEl.innerHTML = sections.map(s => `
                <div class="terms-section">
                    ${s.title ? `<h4>${s.title}</h4>` : ''}
                    <div class="terms-body">${s.body || ''}</div>
                </div>
            `).join('');

            // Verberg fallback
            if (fallbackEl) fallbackEl.style.display = 'none';
            return;
        }
    } catch (err) {
        console.warn('Terms kon niet geladen worden vanuit Firestore:', err.message);
    }

    // Fallback: verberg spinner, toon hardcoded inhoud
    contentEl.innerHTML = '';
    if (fallbackEl) fallbackEl.style.display = '';
}

// Laad zodra de pagina klaar is
document.addEventListener('DOMContentLoaded', loadTermsFromFirestore);

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