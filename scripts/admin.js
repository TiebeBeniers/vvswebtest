// ===============================================
// ADMIN PAGE - FINAL FIX
// V.V.S Rotselaar
// Fix: CreateUser zonder admin logout + form validation
// Updated: Password decryption for account requests
// Updated: Multi-ploeg request handling + oldest-first contact messages
// ===============================================

import { auth, db, app } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { decryptPassword } from './crypto-utils.js';

console.log('Admin.js loaded (FINAL FIX VERSION with password decryption)');

// ===============================================
// SECONDARY FIREBASE APP FOR USER CREATION
// ===============================================

let secondaryApp = null;
let secondaryAuth = null;

// ===============================================
// GLOBAL VARIABLES
// ===============================================

let currentUser = null;
let currentUserData = null;
let allMembers = [];
let allEvenementen = [];
let allMatchesCache = [];
let currentMatchFilter = 'all';

// ===============================================
// ACCESS CONTROL
// ===============================================

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.log('User not logged in, redirecting to login');
        window.location.href = 'login.html';
        return;
    }
    
    currentUser = user;
    console.log('User logged in:', user.uid);
    
    try {
        const userQuery = query(collection(db, 'users'), where('uid', '==', user.uid));
        const userSnapshot = await getDocs(userQuery);
        
        if (userSnapshot.empty) {
            console.error('User not found in database');
            window.location.href = 'index.html';
            return;
        }
        
        currentUserData = userSnapshot.docs[0].data();
        console.log('User data loaded:', currentUserData.naam, 'Role:', currentUserData.rol);
        
        if (currentUserData.rol !== 'admin' && !(currentUserData.rollen || []).includes('admin')) {
            console.log('User is not admin, redirecting');
            window.location.href = 'index.html';
            return;
        }
        
        console.log('Admin access granted, initializing page...');
        
        await initializeSecondaryApp();
        await initializeAdminPage();
    } catch (error) {
        console.error('Error checking user permissions:', error);
    }
});

async function initializeSecondaryApp() {
    try {
        const firebaseConfig = app.options;
        try {
            secondaryApp = initializeApp(firebaseConfig, 'Secondary');
        } catch (error) {
            console.log('Secondary app already initialized');
            const { getApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
            secondaryApp = getApp('Secondary');
        }
        secondaryAuth = getAuth(secondaryApp);
        console.log('Secondary Firebase app initialized for user creation');
    } catch (error) {
        console.error('Error initializing secondary app:', error);
    }
}

// ===============================================
// TAB MANAGEMENT
// ===============================================

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        console.log('Switching to tab:', targetTab);

        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(`${targetTab}Tab`).classList.add('active');

        if (targetTab === 'announcements') loadAnnouncementTab();
    });
});

document.querySelectorAll('[data-match-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-match-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMatchFilter = btn.getAttribute('data-match-filter');
        renderMatchList();
    });
});

// ===============================================
// INITIALIZE ADMIN PAGE
// ===============================================

async function initializeAdminPage() {
    console.log('Initializing admin page...');
    try {
        await loadMembers();
        await loadTempAccounts();
        await loadMatches();
        await loadEvenementen();
        await loadContactberichten();
        await updateRequestsBadge();
        await updateContactberichtenBadge();
        console.log('Admin page initialized successfully');
    } catch (error) {
        console.error('Error initializing admin page:', error);
    }
}

// ===============================================
// ANNOUNCEMENTS
// ===============================================

function setTabCount(tabName, count) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (!btn) return;
    let span = btn.querySelector('.tab-count');
    if (!span) {
        span = document.createElement('span');
        span.className = 'tab-count';
        btn.appendChild(span);
    }
    if (count !== null) {
        span.textContent = ` (${count})`;
        span.style.display = '';
    } else {
        span.style.display = 'none';
    }
}

// ===============================================
// ANNOUNCEMENTS — emoji-picker + preview + opslaan
// Firestore: settings/announcement → { text, icon }
// ===============================================

// De 16 beschikbare emoji's
const ANN_EMOJIS = ['⚠️','❗','🔔','📢','💥','🔆','🔜','🎉','⚽','🏆','📅','🚨','ℹ️','✅','🌟','🍺'];
 
// Huidige icoon-waarde (emoji-string of bestandspad)
let _annIcon = 'assets/bier.png'; // standaard zoals in announcement.js
 
// Bouw de emoji-grid éénmalig op
function buildEmojiGrid() {
    const grid = document.getElementById('annEmojiGrid');
    if (!grid || grid.dataset.built) return;
    grid.dataset.built = 'true';
    ANN_EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ann-emoji-btn';
        btn.textContent = emoji;
        btn.setAttribute('aria-label', emoji);
        btn.addEventListener('click', () => selectIcon(emoji));
        grid.appendChild(btn);
    });
}
 
function selectIcon(value) {
    _annIcon = value;
    // Update picker-knop
    const preview = document.getElementById('annIconPreview');
    if (preview) {
        if (value.includes('/') || value.includes('.')) {
            preview.innerHTML = `<img src="${value}" alt="" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;">`;
        } else {
            preview.textContent = value;
        }
    }
    // Update live preview
    updateAnnPreview();
    closeAnnDropdown();
}
 
function openAnnDropdown() {
    const dd = document.getElementById('annIconDropdown');
    const btn = document.getElementById('annIconSelectedBtn');
    dd?.classList.add('ann-icon-dropdown-open');
    btn?.setAttribute('aria-expanded', 'true');
}
 
function closeAnnDropdown() {
    const dd = document.getElementById('annIconDropdown');
    const btn = document.getElementById('annIconSelectedBtn');
    dd?.classList.remove('ann-icon-dropdown-open');
    btn?.setAttribute('aria-expanded', 'false');
}
 
function updateAnnPreview() {
    const text = document.getElementById('announcementText')?.value.trim()
        || 'Bier van de maand: Primus';
    const iconEl = document.getElementById('annPreviewIcon');
    const textEl = document.getElementById('annPreviewText');
    if (textEl) textEl.textContent = text;
    if (iconEl) {
        if (!_annIcon) {
            iconEl.innerHTML = '';
        } else if (_annIcon.includes('/') || _annIcon.includes('.')) {
            iconEl.innerHTML = `<img src="${_annIcon}" alt="" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;">`;
        } else {
            iconEl.textContent = _annIcon;
        }
    }
}
 
async function loadAnnouncementTab() {
    const field = document.getElementById('announcementText');
    if (!field || field.dataset.loaded) return;
    field.dataset.loaded = 'true';
 
    buildEmojiGrid();
 
    // Wire up toggle
    document.getElementById('annIconSelectedBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = document.getElementById('annIconDropdown');
        dd?.classList.contains('ann-icon-dropdown-open') ? closeAnnDropdown() : openAnnDropdown();
    });
 
    // Sluit dropdown bij klik buiten
    document.addEventListener('click', (e) => {
        if (!document.getElementById('annIconPicker')?.contains(e.target)) {
            closeAnnDropdown();
        }
    }, { capture: true });
 
    // Eigen bestandspad "Gebruik"-knop
    document.getElementById('annCustomApplyBtn')?.addEventListener('click', () => {
        const path = document.getElementById('annCustomPath')?.value.trim();
        if (path) selectIcon(path);
    });
 
    // Live preview on typing
    field.addEventListener('input', updateAnnPreview);
 
    // Laad bestaande data uit Firestore
    try {
        const snap = await getDoc(doc(db, 'settings', 'announcement'));
        if (snap.exists()) {
            const data = snap.data();
            if (data.text) field.value = data.text;
            if (data.icon !== undefined) {
                _annIcon = data.icon ?? '';
                selectIcon(_annIcon);
            }
        }
    } catch (e) { console.error('Error loading announcement:', e); }
 
    updateAnnPreview();
}
 
const saveAnnouncementBtn = document.getElementById('saveAnnouncementBtn');
if (saveAnnouncementBtn) {
    saveAnnouncementBtn.addEventListener('click', async () => {
        const field  = document.getElementById('announcementText');
        const status = document.getElementById('announcementStatus');
        const text   = field?.value.trim() || '';
        saveAnnouncementBtn.disabled = true;
        try {
            await setDoc(doc(db, 'settings', 'announcement'), { text, icon: _annIcon }, { merge: true });
            if (status) { status.style.display = 'inline'; setTimeout(() => status.style.display = 'none', 3000); }
        } catch (e) {
            showToast('Fout bij opslaan: ' + e.message, 'error');
        } finally {
            saveAnnouncementBtn.disabled = false;
        }
    });
}

// ===============================================
// MEMBERS MANAGEMENT
// ===============================================

const addMemberBtn = document.getElementById('addMemberBtn');
const memberModal = document.getElementById('memberModal');
const memberForm = document.getElementById('memberForm');
const memberModalCancel = document.getElementById('memberModalCancel');
const manageRequestsBtn = document.getElementById('manageRequestsBtn');
const requestsModal = document.getElementById('requestsModal');
const requestsModalClose = document.getElementById('requestsModalClose');

if (addMemberBtn) {
    addMemberBtn.addEventListener('click', () => {
        console.log('Opening add member modal');
        document.getElementById('memberModalTitle').textContent = 'Nieuw Lid Toevoegen';
        document.getElementById('memberUid').value = '';
        memberForm.reset();
        setMemberPloegen([]);
        setMemberRechten([], '');
        setMemberRollen(['speler']);

        const passwordField = document.getElementById('memberPassword');
        const passwordGroup = passwordField.closest('.form-group');
        if (passwordGroup) {
            passwordGroup.style.display = 'block';
            passwordField.required = true;
            passwordField.disabled = false;
        }

        const statsGroup = document.getElementById('statsEditGroup');
        if (statsGroup) statsGroup.style.display = 'none';
        
        memberModal.classList.add('active');
    });
}

if (memberModalCancel) {
    memberModalCancel.addEventListener('click', () => {
        memberModal.classList.remove('active');
    });
}

if (manageRequestsBtn) {
    manageRequestsBtn.addEventListener('click', async () => {
        console.log('Opening account requests modal');
        await loadAccountRequests();
        requestsModal.classList.add('active');
    });
}

if (requestsModalClose) {
    requestsModalClose.addEventListener('click', () => {
        requestsModal.classList.remove('active');
    });
}

function getMemberPloegen() {
    const checked = document.querySelectorAll('input[name="memberPloeg"]:checked');
    return Array.from(checked).map(cb => cb.value);
}

function setMemberPloegen(ploegen) {
    document.querySelectorAll('input[name="memberPloeg"]').forEach(cb => cb.checked = false);
    const arr = Array.isArray(ploegen) ? ploegen : (ploegen ? [ploegen] : []);
    arr.forEach(p => {
        const cb = document.querySelector(`input[name="memberPloeg"][value="${p}"]`);
        if (cb) cb.checked = true;
    });
    const cat = document.getElementById('memberCategorie');
    if (cat) cat.value = arr[0] || 'veteranen';
}

// ── Rechten helpers ────────────────────────────────────────────────────────────
function getMemberRechten() {
    return Array.from(document.querySelectorAll('input[name="memberRecht"]:checked'))
        .map(cb => cb.value);
}

function getMemberAfgevaardigdeTeam() {
    const el = document.getElementById('afgevaardigdeTeam');
    return el ? el.value : '';
}

function setMemberRechten(rechten, afgevaardigdeTeam) {
    document.querySelectorAll('input[name="memberRecht"]').forEach(cb => cb.checked = false);
    const arr = Array.isArray(rechten) ? rechten : [];
    arr.forEach(r => {
        const cb = document.querySelector(`input[name="memberRecht"][value="${r}"]`);
        if (cb) cb.checked = true;
    });
    // Sync afgevaardigde team selector
    const teamEl = document.getElementById('afgevaardigdeTeam');
    if (teamEl) teamEl.value = afgevaardigdeTeam || '';
    const groupEl = document.getElementById('afgevaardigdeTeamGroup');
    if (groupEl) groupEl.style.display = arr.includes('afgevaardigde') ? '' : 'none';
}

// ── Multi-rol helpers ──────────────────────────────────────────────────────────
function getMemberRollen() {
    return Array.from(document.querySelectorAll('input[name="memberRol"]:checked'))
        .map(cb => cb.value);
}

function setMemberRollen(rollen) {
    document.querySelectorAll('input[name="memberRol"]').forEach(cb => cb.checked = false);
    const arr = Array.isArray(rollen) ? rollen : (rollen ? [rollen] : ['speler']);
    arr.forEach(r => {
        const cb = document.querySelector(`input[name="memberRol"][value="${r}"]`);
        if (cb) cb.checked = true;
    });
}

function rollenLabel(rollen) {
    const labels = { speler: 'Speler', admin: 'Admin' };
    const arr = Array.isArray(rollen) && rollen.length > 0 ? rollen : ['speler'];
    return arr.map(r => labels[r] || r).join(' + ');
}

function heeftAdminToegang(userData) {
    return userData.rol === 'admin'
        || (Array.isArray(userData.rollen) && userData.rollen.includes('admin'));
}

function rechtenLabel(rechten, afgevaardigdeTeam) {
    if (!Array.isArray(rechten) || rechten.length === 0) return 'Geen extra rechten';
    const labels = {
        score_invullen: 'Score invullen',
        afgevaardigde:  `Afgevaardigde${afgevaardigdeTeam ? ` (${afgevaardigdeTeam.charAt(0).toUpperCase() + afgevaardigdeTeam.slice(1)})` : ''}`
    };
    return rechten.map(r => labels[r] || r).join(' + ');
}

// Wire afgevaardigde checkbox → show/hide team selector
document.addEventListener('DOMContentLoaded', () => {
    const cbAfg = document.getElementById('rechtAfgevaardigde');
    const grpAfg = document.getElementById('afgevaardigdeTeamGroup');
    if (cbAfg && grpAfg) {
        cbAfg.addEventListener('change', () => {
            grpAfg.style.display = cbAfg.checked ? '' : 'none';
            if (!cbAfg.checked) {
                const t = document.getElementById('afgevaardigdeTeam');
                if (t) t.value = '';
            }
        });
    }
});

if (memberForm) {
    memberForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('memberName').value.trim();
        const email = document.getElementById('memberEmail').value.trim();
        const passwordField = document.getElementById('memberPassword');
        const password = passwordField ? passwordField.value : '';
        const telefoon = document.getElementById('memberTelefoon')?.value.trim() || '';
        const ploegen   = getMemberPloegen();
        if (ploegen.length === 0) {
            showToast('Selecteer minstens één ploeg.', 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Opslaan'; }
            return;
        }
        const categorie = ploegen[0];
        const catField = document.getElementById('memberCategorie');
        if (catField) catField.value = categorie;
        // Multi-rol: lees uit checkboxes, leid primaire rol af
        const rollen = getMemberRollen();
        const role = rollen.includes('admin') && !rollen.includes('speler') ? 'admin'
                   : rollen.includes('admin') ? 'admin'  // admin domineert voor Firestore-compat
                   : 'speler';
        const uid = document.getElementById('memberUid').value;
        
        const goals       = parseInt(document.getElementById('memberGoals')?.value)  || 0;
        const assists     = parseInt(document.getElementById('memberAssists')?.value) || 0;
        const matchen     = parseInt(document.getElementById('memberMatchen')?.value) || 0;
        const minuten     = parseInt(document.getElementById('memberMinuten')?.value) || 0;
        const geelKaarten = parseInt(document.getElementById('memberGeel')?.value)    || 0;
        const roodKaarten = parseInt(document.getElementById('memberRood')?.value)    || 0;
        
        console.log('Submitting member form:', { name, email, categorie, role, isUpdate: !!uid });
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Bezig...';
        }
        
        try {
            if (uid) {
                console.log('Updating member with UID:', uid);
                const memberQuery = query(collection(db, 'users'), where('uid', '==', uid));
                const memberSnapshot = await getDocs(memberQuery);
                
                if (!memberSnapshot.empty) {
                    const memberDoc = memberSnapshot.docs[0];
                    const rechten = getMemberRechten();
                    const afgevaardigdeTeam = getMemberAfgevaardigdeTeam();
                    const updateData = {
                        naam:        name,
                        email:       email,
                        telefoon:    telefoon,
                        categorie:   categorie,
                        ploegen:     ploegen,
                        rol:         role,
                        rollen:      rollen,
                        rechten:     rechten,
                        afgevaardigdeTeam: rechten.includes('afgevaardigde') ? afgevaardigdeTeam : null,
                        goals,
                        assists,
                        matchen,
                        minuten,
                        geelKaarten,
                        roodKaarten,
                    };
                    
                    console.log('Updating document:', memberDoc.id, updateData);
                    await updateDoc(doc(db, 'users', memberDoc.id), updateData);
                    console.log('Member updated successfully');
                    
                    showToast('Lid bijgewerkt!', 'success');
                    memberModal.classList.remove('active');
                    memberForm.reset();
                    await loadMembers();
                }
            } else {
                console.log('Creating new member using secondary auth...');
                
                if (!password || password.length < 6) {
                    throw new Error('Wachtwoord moet minimaal 6 karakters zijn');
                }
                
                if (!secondaryAuth) {
                    throw new Error('Secondary auth not initialized. Please refresh the page.');
                }
                
                console.log('Creating Firebase Auth user (secondary)...');
                const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
                const newUser = userCredential.user;
                console.log('Auth user created with UID:', newUser.uid);
                
                await secondaryAuth.signOut();
                console.log('Secondary auth signed out');
                
                const rechten = getMemberRechten();
                const afgevaardigdeTeam = getMemberAfgevaardigdeTeam();
                const userData = {
                    uid: newUser.uid,
                    naam: name,
                    email: email,
                    rol: role,
                    rollen: rollen,
                    categorie: categorie,
                    ploegen: ploegen,
                    rechten: rechten,
                    afgevaardigdeTeam: rechten.includes('afgevaardigde') ? afgevaardigdeTeam : null,
                };
                
                console.log('Adding user to Firestore:', userData);
                await setDoc(doc(db, 'users', newUser.uid), userData);
                console.log('User document created with UID as doc-ID:', newUser.uid);
                
                showToast('Nieuw lid succesvol aangemaakt!', 'success');
                memberModal.classList.remove('active');
                memberForm.reset();
                await loadMembers();
            }
            
        } catch (error) {
            console.error('Error saving member:', error);
            
            let errorText = 'Er is een fout opgetreden: ' + error.message;
            
            if (error.code === 'auth/email-already-in-use') {
                errorText = 'Dit e-mailadres is al in gebruik.';
            } else if (error.code === 'auth/weak-password') {
                errorText = 'Het wachtwoord is te zwak. Gebruik minimaal 6 karakters.';
            } else if (error.code === 'permission-denied') {
                errorText = 'Geen toestemming. Controleer of je ingelogd bent als admin en of de Firebase Security Rules correct zijn.';
            }
            
            showToast(errorText, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Opslaan';
            }
        }
    });
}

// ── Leden zoekbalk ────────────────────────────────────────────────────────────
(function initMemberSearch() {
    const input = document.getElementById('memberSearchInput');
    const clearBtn = document.getElementById('memberSearchClear');
    if (!input) return;

    function filterMembers(query) {
        const q = query.trim().toLowerCase();
        clearBtn.style.display = q ? '' : 'none';

        document.querySelectorAll('#membersList .member-card').forEach(card => {
            const text = card.textContent.toLowerCase();
            card.style.display = (!q || text.includes(q)) ? '' : 'none';
        });

        // Lege-toestand bericht
        const visible = [...document.querySelectorAll('#membersList .member-card')]
            .filter(c => c.style.display !== 'none').length;
        let noResult = document.getElementById('memberSearchNoResult');
        if (visible === 0 && q) {
            if (!noResult) {
                noResult = document.createElement('p');
                noResult.id = 'memberSearchNoResult';
                noResult.className = 'member-search-noresult';
                noResult.textContent = 'Geen leden gevonden voor "' + query.trim() + '".';
                document.getElementById('membersList').appendChild(noResult);
            } else {
                noResult.textContent = 'Geen leden gevonden voor "' + query.trim() + '".';
                noResult.style.display = '';
            }
        } else if (noResult) {
            noResult.style.display = 'none';
        }
    }

    input.addEventListener('input', () => filterMembers(input.value));
    clearBtn.addEventListener('click', () => {
        input.value = '';
        filterMembers('');
        input.focus();
    });
})();

async function loadMembers() {
    const membersList = document.getElementById('membersList');
    if (!membersList) {
        console.error('membersList element not found');
        return;
    }
    
    membersList.innerHTML = '<div class="loading"><div class="loader"></div></div>';
    console.log('Loading members...');
    
    try {
        const membersSnapshot = await getDocs(collection(db, 'users'));
        allMembers = [];
        
        membersList.innerHTML = '';
        
        if (membersSnapshot.empty) {
            console.log('No members found');
            membersList.innerHTML = '<p class="text-center">Geen leden gevonden.</p>';
            return;
        }
        
        console.log('Found', membersSnapshot.size, 'members');
        
        membersSnapshot.forEach(docSnap => {
            const member = { id: docSnap.id, ...docSnap.data() };
            // Tijdelijke en externe accounts worden alleen in de tijdelijke accounts sectie getoond
            if (member.rol === 'tijdelijk' || member.categorie === 'extern') return;
            allMembers.push(member);
            const memberCard = createMemberCard(member);
            membersList.appendChild(memberCard);
        });
        
        setTabCount('members', allMembers.length);
        console.log('Members loaded successfully');
        
    } catch (error) {
        console.error('Error loading members:', error);
        membersList.innerHTML = '<p class="text-center">Fout bij laden: ' + error.message + '</p>';
    }
}

function createMemberCard(member) {
    const card = document.createElement('div');
    card.className = 'member-card';
    
    const roleText = member.rol === 'admin' ? 'Admin' : 'Speler';
    const memberPloegen = Array.isArray(member.ploegen) && member.ploegen.length > 0
        ? member.ploegen
        : [member.categorie || 'Geen categorie'];
    const categorieText = memberPloegen.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ');
    const rechtenText   = rechtenLabel(member.rechten || [], member.afgevaardigdeTeam || '');
    // Gebruik rollen-array als die beschikbaar is, anders val terug op rol-veld
    const effectieveRollen = Array.isArray(member.rollen) && member.rollen.length > 0
        ? member.rollen
        : [member.rol || 'speler'];
    const rolBadges = effectieveRollen.map(r => {
        const kleur = r === 'admin' ? 'var(--danger)' : 'var(--primary-blue)';
        const label = r === 'admin' ? 'Admin' : 'Speler';
        return `<span class="member-badge" style="background:${kleur}">${label}</span>`;
    }).join('');
    
    card.innerHTML = `
        <div class="member-info">
            <h4 class="member-name-link">${member.naam}</h4>
            <p>${member.email}</p>
            ${rolBadges}
            <span class="member-badge">${categorieText}</span>
            ${rechtenText !== 'Geen extra rechten' ? `<span class="member-badge" style="background:var(--accent-blue)">${rechtenText}</span>` : ''}
        </div>
        <div class="card-actions">
            <button class="action-btn edit" data-id="${member.id}">Bewerken</button>
            <button class="action-btn delete" data-id="${member.id}">Verwijderen</button>
        </div>
    `;
    
    card.querySelector('.member-info').addEventListener('click', () => showMemberDetail(member));
    card.querySelector('.edit').addEventListener('click', () => editMember(member));
    card.querySelector('.delete').addEventListener('click', () => deleteMember(member));
    
    return card;
}

// ── Member Detail Overlay ─────────────────────────────────────────────────────

let _detailCurrentMember = null;

function showMemberDetail(member) {
    _detailCurrentMember = member;
    const modal = document.getElementById('memberDetailModal');
    if (!modal) return;

    document.getElementById('detailNaam').textContent     = member.naam || '—';
    document.getElementById('detailUid').textContent      = member.uid  || '—';
    document.getElementById('detailEmail').textContent    = member.email || '—';
    document.getElementById('detailTelefoon').textContent = member.telefoon || '—';
    const detailPloegen = Array.isArray(member.ploegen) && member.ploegen.length > 0
        ? member.ploegen
        : (member.categorie ? [member.categorie] : []);
    const detailPloegText = detailPloegen.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ') || '—';
    document.getElementById('detailCategorie').textContent = detailPloegText;
    document.getElementById('detailRol').textContent      = member.rol === 'admin' ? 'Admin' : 'Speler';
    const detailRechtenEl = document.getElementById('detailRechten');
    if (detailRechtenEl) detailRechtenEl.textContent = rechtenLabel(member.rechten || [], member.afgevaardigdeTeam || '');

    const badgesEl = document.getElementById('detailBadges');
    if (badgesEl) {
        const ploegBadges = detailPloegen.map(p =>
            `<span class="member-badge">${p.charAt(0).toUpperCase() + p.slice(1)}</span>`
        ).join('') || `<span class="member-badge">—</span>`;
        badgesEl.innerHTML = `
            <span class="member-badge">${member.rol === 'admin' ? 'Admin' : 'Speler'}</span>
            ${ploegBadges}`;
    }

    document.getElementById('detailGoals').textContent   = member.goals        ?? 0;
    document.getElementById('detailAssists').textContent = member.assists      ?? 0;
    document.getElementById('detailMatchen').textContent = member.matchen      ?? 0;
    document.getElementById('detailMinuten').textContent = member.minuten      ?? 0;
    document.getElementById('detailGeel').textContent    = member.geelKaarten  ?? 0;
    document.getElementById('detailRood').textContent    = member.roodKaarten  ?? 0;

    modal.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
    const detailModal    = document.getElementById('memberDetailModal');
    const closeX         = document.getElementById('memberDetailClose');
    const closeBtn       = document.getElementById('memberDetailCloseBtn');
    const editBtn        = document.getElementById('memberDetailEditBtn');

    const closeDetail = () => detailModal?.classList.remove('active');

    if (closeX)   closeX.addEventListener('click', closeDetail);
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);
    if (detailModal) detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) closeDetail();
    });
    if (editBtn) editBtn.addEventListener('click', () => {
        closeDetail();
        if (_detailCurrentMember) editMember(_detailCurrentMember);
    });
});

function editMember(member) {
    console.log('Editing member:', member.naam);
    document.getElementById('memberModalTitle').textContent = 'Lid Bewerken';
    document.getElementById('memberUid').value = member.uid;
    document.getElementById('memberName').value = member.naam;
    document.getElementById('memberEmail').value = member.email;
    document.getElementById('memberTelefoon').value = member.telefoon || '';
    const memberPloegen = Array.isArray(member.ploegen) && member.ploegen.length > 0
        ? member.ploegen
        : [member.categorie || 'veteranen'];
    setMemberPloegen(memberPloegen);
    setMemberRechten(member.rechten || [], member.afgevaardigdeTeam || '');
    // Herstel rollen: gebruik rollen-array als beschikbaar, anders rol-veld
    const memberRollen = Array.isArray(member.rollen) && member.rollen.length > 0
        ? member.rollen : [member.rol || 'speler'];
    setMemberRollen(memberRollen);

    document.getElementById('memberGoals').value   = member.goals       ?? 0;
    document.getElementById('memberAssists').value = member.assists     ?? 0;
    document.getElementById('memberMatchen').value = member.matchen     ?? 0;
    document.getElementById('memberMinuten').value = member.minuten     ?? 0;
    document.getElementById('memberGeel').value    = member.geelKaarten ?? 0;
    document.getElementById('memberRood').value    = member.roodKaarten ?? 0;

    const statsGroup = document.getElementById('statsEditGroup');
    if (statsGroup) statsGroup.style.display = '';
    
    const passwordField = document.getElementById('memberPassword');
    const passwordGroup = passwordField.closest('.form-group');
    if (passwordGroup) {
        passwordGroup.style.display = 'none';
        passwordField.required = false;
        passwordField.disabled = true;
        passwordField.value = '';
    }
    
    memberModal.classList.add('active');
}

async function deleteMember(member) {
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete = document.getElementById('confirmDelete');
    const confirmCancel = document.getElementById('confirmCancel');
    
    confirmMessage.textContent = `Weet je zeker dat je ${member.naam} wilt verwijderen? (Dit verwijdert alleen het Firestore document, niet het Firebase Auth account)`;
    confirmModal.classList.add('active');
    
    confirmCancel.onclick = () => {
        confirmModal.classList.remove('active');
    };
    
    confirmDelete.onclick = async () => {
        try {
            console.log('Deleting member:', member.naam);
            
            const memberQuery = query(collection(db, 'users'), where('uid', '==', member.uid));
            const memberSnapshot = await getDocs(memberQuery);
            
            if (!memberSnapshot.empty) {
                const memberDoc = memberSnapshot.docs[0];
                await deleteDoc(doc(db, 'users', memberDoc.id));
                console.log('Member deleted successfully from Firestore');
            }
            
            confirmModal.classList.remove('active');
            await loadMembers();
        } catch (error) {
            console.error('Error deleting member:', error);
            showToast('Fout bij verwijderen: ' + error.message, 'error');
        }
    };
}


// ===============================================
// TIJDELIJKE ACCOUNTS
// ===============================================

const addTempAccountBtn      = document.getElementById('addTempAccountBtn');
const tempAccountModal       = document.getElementById('tempAccountModal');
const tempAccountForm        = document.getElementById('tempAccountForm');
const tempAccountModalCancel = document.getElementById('tempAccountModalCancel');

// Helper: Date → datetime-local string (lokale tijdzone)
function toDatetimeLocal(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

if (addTempAccountBtn) {
    addTempAccountBtn.addEventListener('click', () => openTempAccountModal(null));
}
if (tempAccountModalCancel) {
    tempAccountModalCancel.addEventListener('click', () => closeTempAccountModal());
}
tempAccountModal?.addEventListener('click', (e) => {
    if (e.target === tempAccountModal) closeTempAccountModal();
});

function openTempAccountModal(acc) {
    tempAccountForm.reset();
    delete tempAccountForm.dataset.editId;

    const now  = new Date();
    const plus = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const emailField    = document.getElementById('tempEmail');
    const passwordGroup = document.getElementById('tempPasswordGroup');
    const passwordField = document.getElementById('tempPassword');

    const passwordDisplayGroup = document.getElementById('tempPasswordDisplayGroup');
    const passwordDisplay      = document.getElementById('tempPasswordDisplay');
    const passwordCopyBtn      = document.getElementById('tempPasswordCopyBtn');

    if (acc) {
        document.getElementById('tempAccountModalTitle').textContent = 'Tijdelijk Account Bewerken';
        document.getElementById('tempName').value = acc.naam || '';
        emailField.value    = acc.email || '';
        emailField.disabled = true;
        if (passwordGroup)        passwordGroup.style.display        = 'none';
        if (passwordField)        { passwordField.required = false; passwordField.value = ''; }
        if (passwordDisplayGroup) passwordDisplayGroup.style.display  = '';
        if (passwordDisplay)      passwordDisplay.value               = acc.wachtwoord || '(niet opgeslagen)';
        // Kopieer-knop
        if (passwordCopyBtn) {
            passwordCopyBtn.onclick = () => {
                navigator.clipboard.writeText(acc.wachtwoord || '').then(() => {
                    passwordCopyBtn.textContent = '✓';
                    setTimeout(() => {
                        passwordCopyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
                    }, 2000);
                });
            };
        }

        const from  = acc.validFrom?.toDate  ? acc.validFrom.toDate()  : new Date(acc.validFrom  || now);
        const until = acc.validUntil?.toDate ? acc.validUntil.toDate() : new Date(acc.validUntil || plus);
        document.getElementById('tempValidFrom').value  = toDatetimeLocal(from);
        document.getElementById('tempValidUntil').value = toDatetimeLocal(until);
        document.getElementById('tempNote').value = acc.note || '';
        document.querySelectorAll('input[name="tempPerm"]').forEach(cb => {
            cb.checked = (acc.toegang || []).includes(cb.value);
        });
        tempAccountForm.dataset.editId = acc.id;
        // Fix: knoptekst aanpassen bij bewerken bestaand account
        const submitBtnEdit = tempAccountForm.querySelector('button[type="submit"]');
        if (submitBtnEdit) submitBtnEdit.textContent = 'Opslaan';
    } else {
        document.getElementById('tempAccountModalTitle').textContent = 'Tijdelijk Account Aanmaken';
        const submitBtnNew = tempAccountForm.querySelector('button[type="submit"]');
        if (submitBtnNew) submitBtnNew.textContent = 'Account Aanmaken';
        emailField.disabled = false;
        if (passwordGroup)        passwordGroup.style.display        = '';
        if (passwordField)        passwordField.required              = true;
        if (passwordDisplayGroup) passwordDisplayGroup.style.display  = 'none';
        if (passwordDisplay)      passwordDisplay.value               = '';
        document.getElementById('tempValidFrom').value  = toDatetimeLocal(now);
        document.getElementById('tempValidUntil').value = toDatetimeLocal(plus);
    }

    tempAccountModal.classList.add('active');
}

function closeTempAccountModal() {
    tempAccountModal.classList.remove('active');
    document.getElementById('tempEmail').disabled = false;
    const passwordGroup        = document.getElementById('tempPasswordGroup');
    const passwordField        = document.getElementById('tempPassword');
    const passwordDisplayGroup = document.getElementById('tempPasswordDisplayGroup');
    const passwordDisplay      = document.getElementById('tempPasswordDisplay');
    if (passwordGroup)        passwordGroup.style.display        = '';
    if (passwordField)        { passwordField.required = true; passwordField.value = ''; }
    if (passwordDisplayGroup) passwordDisplayGroup.style.display  = 'none';
    if (passwordDisplay)      passwordDisplay.value               = '';
    delete tempAccountForm.dataset.editId;
}

if (tempAccountForm) {
    tempAccountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = tempAccountForm.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Bezig…'; }

        const naam       = document.getElementById('tempName').value.trim();
        const email      = document.getElementById('tempEmail').value.trim();
        const password   = document.getElementById('tempPassword')?.value || '';
        const validFrom  = new Date(document.getElementById('tempValidFrom').value);
        const validUntil = new Date(document.getElementById('tempValidUntil').value);
        const note       = document.getElementById('tempNote').value.trim();
        const perms      = Array.from(document.querySelectorAll('input[name="tempPerm"]:checked')).map(cb => cb.value);
        const editId     = tempAccountForm.dataset.editId;

        if (validUntil <= validFrom) {
            showToast('"Geldig tot" moet na "Geldig vanaf" liggen.', 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editId ? 'Opslaan' : 'Account Aanmaken'; }
            return;
        }
        if (perms.length === 0) {
            showToast('Selecteer minstens één toegangsrecht.', 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editId ? 'Opslaan' : 'Account Aanmaken'; }
            return;
        }

        try {
            if (editId) {
                await updateDoc(doc(db, 'users', editId), {
                    naam, toegang: perms, validFrom, validUntil, note: note || null,
                });
                showToast(`Account "${naam}" bijgewerkt.`, 'success');
            } else {
                if (!password || password.length < 6) throw new Error('Wachtwoord moet minimaal 6 tekens zijn.');
                if (!secondaryAuth) throw new Error('Secundaire auth niet beschikbaar.');
                const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
                const uid  = cred.user.uid;
                await secondaryAuth.signOut();
                await setDoc(doc(db, 'users', uid), {
                    uid, naam, email,
                    rol: 'tijdelijk', categorie: 'extern', ploegen: [], rechten: [],
                    toegang: perms, validFrom, validUntil,
                    note: note || null,
                    wachtwoord: password,   // leesbaar opgeslagen voor admin-raadpleging
                    aangemaaktOp: serverTimestamp(),
                });
                showToast(`Tijdelijk account aangemaakt voor ${naam}.`, 'success');
            }
            closeTempAccountModal();
            await loadMembers();
            await loadTempAccounts();
        } catch (err) {
            let msg = 'Fout: ' + err.message;
            if (err.code === 'auth/email-already-in-use') msg = 'Dit e-mailadres is al in gebruik.';
            showToast(msg, 'error');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editId ? 'Opslaan' : 'Account Aanmaken'; }
        }
    });
}

async function loadTempAccounts() {
    const section = document.getElementById('tempAccountsSection');
    const listEl  = document.getElementById('tempAccountsList');
    if (!section || !listEl) return;

    try {
        const snap = await getDocs(query(collection(db, 'users'), where('rol', '==', 'tijdelijk')));
        if (snap.empty) { section.style.display = 'none'; return; }

        const accounts = [];
        snap.forEach(d => accounts.push({ id: d.id, ...d.data() }));
        accounts.sort((a, b) => (a.validUntil?.toMillis?.() || 0) - (b.validUntil?.toMillis?.() || 0));

        listEl.innerHTML = '';
        const now = new Date();

        accounts.forEach(acc => {
            const from  = acc.validFrom?.toDate  ? acc.validFrom.toDate()  : new Date(acc.validFrom  || 0);
            const until = acc.validUntil?.toDate ? acc.validUntil.toDate() : new Date(acc.validUntil || 0);
            const expired = until < now;
            const pending = from  > now;

            const permLabels = { werken: '🛠️ Werken', score_invullen: '⚽ Score invullen' };
            const permsHtml  = (acc.toegang || []).map(p =>
                `<span class="temp-perm-badge">${permLabels[p] || p}</span>`
            ).join('');

            const statusClass = expired ? 'temp-status-expired' : pending ? 'temp-status-pending' : 'temp-status-active';
            const statusLabel = expired ? 'Verlopen' : pending ? 'Nog niet actief' : 'Actief';

            const card = document.createElement('div');
            card.className = `temp-account-card${expired ? ' temp-expired' : ''}`;
            card.innerHTML = `
                <div class="temp-card-info">
                    <div class="temp-card-name">
                        ${acc.naam}
                        <span class="temp-status-badge ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="temp-card-email">${acc.email}</div>
                    <div class="temp-card-period">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        ${formatTempDate(from)} → ${formatTempDate(until)}
                    </div>
                    <div class="temp-card-perms">${permsHtml}</div>
                    ${acc.note ? `<div class="temp-card-note">📝 ${acc.note}</div>` : ''}
                </div>
                <div class="card-actions">
                    <button class="action-btn edit">Bewerken</button>
                    <button class="action-btn delete">Verwijderen</button>
                </div>
            `;

            card.querySelector('.action-btn.edit').addEventListener('click', () => openTempAccountModal(acc));
            card.querySelector('.action-btn.delete').addEventListener('click', () => deleteTempAccount(acc.id, acc.naam));
            listEl.appendChild(card);
        });

        section.style.display = 'block';
    } catch (err) {
        console.error('loadTempAccounts error:', err);
    }
}

function formatTempDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return '?';
    return d.toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function deleteTempAccount(docId, naam) {
    if (!confirm(`Tijdelijk account "${naam}" verwijderen?\n\nHet Firebase Auth-account blijft bestaan maar inloggen is niet meer mogelijk.`)) return;
    try {
        await deleteDoc(doc(db, 'users', docId));
        showToast(`Account "${naam}" verwijderd.`, 'success');
        await loadMembers();
        await loadTempAccounts();
    } catch (err) {
        showToast('Fout bij verwijderen: ' + err.message, 'error');
    }
}

// ===============================================
// ACCOUNT REQUESTS MANAGEMENT
// ===============================================

async function updateRequestsBadge() {
    const dot        = document.getElementById('requestsBadge');
    const countBadge = document.getElementById('requestsCountBadge');

    try {
        const requestsQuery = query(
            collection(db, 'account_requests'),
            where('status', '==', 'pending')
        );
        const requestsSnapshot = await getDocs(requestsQuery);
        const count = requestsSnapshot.size;

        if (dot) dot.style.display = count > 0 ? 'block' : 'none';

        if (countBadge) {
            if (count > 0) {
                countBadge.textContent = count;
                countBadge.style.display = 'inline-flex';
            } else {
                countBadge.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error updating requests badge:', error);
        if (dot) dot.style.display = 'none';
        if (countBadge) countBadge.style.display = 'none';
    }
}

async function updateContactberichtenBadge() {
    const badge = document.getElementById('contactberichtenBadge');
    if (!badge) return;
    
    try {
        const berichtenQuery = query(
            collection(db, 'contactberichten'),
            where('gelezen', '==', false)
        );
        const berichtenSnapshot = await getDocs(berichtenQuery);
        badge.style.display = berichtenSnapshot.size > 0 ? 'block' : 'none';
    } catch (error) {
        console.error('Error updating contactberichten badge:', error);
        badge.style.display = 'none';
    }
}

async function loadAccountRequests() {
    const requestsList = document.getElementById('requestsList');
    
    try {
        console.log('Loading account requests...');
        requestsList.innerHTML = '<div class="loading"><div class="loader"></div></div>';
        
        const requestsQuery = query(
            collection(db, 'account_requests'),
            where('status', '==', 'pending')
        );
        const requestsSnapshot = await getDocs(requestsQuery);
        
        requestsList.innerHTML = '';
        
        if (requestsSnapshot.empty) {
            console.log('No pending requests found');
            requestsList.innerHTML = '<p class="text-center" style="padding: 2rem; color: #666;">Geen openstaande aanvragen.</p>';
            return;
        }
        
        console.log('Found', requestsSnapshot.size, 'pending requests');
        
        const requests = [];
        requestsSnapshot.forEach(docSnap => {
            const request = { id: docSnap.id, ...docSnap.data() };
            requests.push(request);
        });
        
        // Sort by createdAt (newest first)
        requests.sort((a, b) => {
            if (!a.createdAt) return 1;
            if (!b.createdAt) return -1;
            return b.createdAt.toMillis() - a.createdAt.toMillis();
        });
        
        requests.forEach(request => {
            const requestCard = createRequestCard(request);
            requestsList.appendChild(requestCard);
        });
        
        console.log('Account requests loaded successfully');
        
    } catch (error) {
        console.error('Error loading account requests:', error);
        requestsList.innerHTML = '<p class="text-center error-text">Fout bij laden: ' + error.message + '</p>';
    }
}

// ── FIX 1: createRequestCard toont ALLE aangevraagde ploegen en laat admin per ploeg kiezen ──

function createRequestCard(request) {
    const card = document.createElement('div');
    card.className = 'request-card';
    
    let dateText = 'Onbekend';
    if (request.createdAt) {
        const date = request.createdAt.toDate();
        dateText = date.toLocaleDateString('nl-BE', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    // Haal alle aangevraagde ploegen op
    const requestedPloegen = Array.isArray(request.ploegen) && request.ploegen.length > 0
        ? request.ploegen
        : (request.categorie ? [request.categorie] : ['onbekend']);
    
    const encryptedPwd = request.encryptedPassword || '';
    const phoneDisplay = request.telefoon ? `<p><strong>Tel:</strong> ${request.telefoon}</p>` : '';
    
    // Bouw checkboxes voor per-ploeg selectie door admin
    const ploegCheckboxesHtml = requestedPloegen.map(p => `
        <label class="admin-team-cb-label">
            <input type="checkbox" class="req-ploeg-cb" data-ploeg="${p}" checked>
            ${p.charAt(0).toUpperCase() + p.slice(1)}
        </label>
    `).join('');
    
    card.innerHTML = `
        <div class="request-info">
            <h4>${request.naam}</h4>
            <p><strong>Email:</strong> ${request.email}</p>
            ${phoneDisplay}
            <p style="margin-bottom:0.35rem;"><strong>Aangevraagde ploeg(en):</strong></p>
            <div class="admin-team-checkboxes request-ploegen-selector">
                ${ploegCheckboxesHtml}
            </div>
            <p class="request-date" style="margin-top:0.6rem;"><strong>Aangevraagd op:</strong> ${dateText}</p>
            <p class="request-ploeg-hint" style="font-size:0.82rem;color:var(--text-gray);margin-top:0.3rem;">
                ✏️ Deselecteer ploegen die de speler <em>niet</em> mag deelnemen.
            </p>
        </div>
        <div class="request-actions">
            <button class="btn-accept req-accept-btn">✓ Goedkeuren</button>
            <button class="btn-reject req-reject-btn">✗ Afwijzen</button>
        </div>
    `;
    
    // Accept: haal geselecteerde ploegen op uit checkboxes
    card.querySelector('.req-accept-btn').addEventListener('click', () => {
        const selectedPloegen = Array.from(card.querySelectorAll('.req-ploeg-cb:checked'))
            .map(cb => cb.dataset.ploeg);
        if (selectedPloegen.length === 0) {
            showToast('Selecteer minstens één ploeg voor de speler.', 'error');
            return;
        }
        acceptRequest(
            request.id,
            request.naam,
            request.email,
            encryptedPwd,
            request.categorie,
            request.telefoon || '',
            selectedPloegen
        );
    });
    
    card.querySelector('.req-reject-btn').addEventListener('click', () => {
        rejectRequest(request.id);
    });
    
    return card;
}

// ── FIX 1b: acceptRequest accepteert nu een ploegen-array ──

window.acceptRequest = async function(requestId, naam, email, encryptedPassword, categorieOriginal, telefoon = '', ploegen = []) {
    console.log('Accepting request:', requestId, 'for ploegen:', ploegen);
    
    try {
        if (!confirm(`Account goedkeuren voor ${naam}?\nPloegen: ${ploegen.join(', ')}`)) {
            return;
        }
        
        if (!secondaryAuth) {
            showToast('Fout: Secundaire authenticatie niet geïnitialiseerd', 'error');
            return;
        }
        
        // Decrypt password
        console.log('Decrypting password...');
        let password;
        try {
            password = await decryptPassword(encryptedPassword);
            console.log('Password decrypted successfully');
        } catch (decryptError) {
            console.error('Password decryption failed:', decryptError);
            showToast('Fout bij decrypteren wachtwoord', 'error');
            return;
        }
        
        // Create user in Firebase Auth using secondary app
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUser = userCredential.user;
        
        console.log('User created in Auth:', newUser.uid);
        
        await secondaryAuth.signOut();
        
        // Bepaal de ploegen om op te slaan
        const ploegenToSave = ploegen.length > 0 ? ploegen : [categorieOriginal || 'veteranen'];
        const primaryCategorie = ploegenToSave[0];
        
        // Add user to Firestore — doc-ID = Auth UID
        await setDoc(doc(db, 'users', newUser.uid), {
            uid: newUser.uid,
            naam: naam,
            email: email,
            categorie: primaryCategorie,
            ploegen: ploegenToSave,
            rol: 'speler',
            ...(telefoon && { telefoon })
        });
        
        console.log('User added to Firestore with ploegen:', ploegenToSave);
        
        // DELETE the request document
        await deleteDoc(doc(db, 'account_requests', requestId));
        console.log('Request document deleted from Firestore');
        
        await loadAccountRequests();
        await loadMembers();
        updateRequestsBadge();
        
        showToast(`Account aangemaakt voor ${naam} (${ploegenToSave.join(', ')})`, 'success');
        
    } catch (error) {
        console.error('Error accepting request:', error);
        
        let errorText = 'Er is een fout opgetreden bij het goedkeuren van de aanvraag.';
        
        if (error.code === 'auth/email-already-in-use') {
            errorText = 'Dit e-mailadres is al in gebruik.';
        } else if (error.code === 'auth/invalid-email') {
            errorText = 'Ongeldig e-mailadres.';
        } else if (error.code === 'auth/weak-password') {
            errorText = 'Wachtwoord is te zwak.';
        }
        
        showToast(errorText, 'error');
    }
};

window.rejectRequest = async function(requestId) {
    console.log('Rejecting request:', requestId);
    
    try {
        if (!confirm('Weet je zeker dat je deze aanvraag wilt afwijzen?')) {
            return;
        }
        
        await deleteDoc(doc(db, 'account_requests', requestId));
        console.log('Request document deleted from Firestore');
        
        await loadAccountRequests();
        updateRequestsBadge();
        
        showToast('Aanvraag afgewezen en verwijderd', 'success');
        
    } catch (error) {
        console.error('Error rejecting request:', error);
        showToast('Fout bij afwijzen: ' + error.message, 'error');
    }
};

// ===============================================
// MATCHES MANAGEMENT
// ===============================================

const addMatchBtn = document.getElementById('addMatchBtn');
const matchModal = document.getElementById('matchModal');
const matchForm = document.getElementById('matchForm');
const matchModalCancel = document.getElementById('matchModalCancel');

if (addMatchBtn) {
    addMatchBtn.addEventListener('click', () => {
        console.log('Opening add match modal');
        document.getElementById('matchModalTitle').textContent = 'Nieuwe Wedstrijd Aanmaken';
        document.getElementById('matchId').value = '';
        matchForm.reset();
        
        document.getElementById('matchType').value = 'upcoming';
        document.getElementById('btnUpcoming').classList.add('active');
        document.getElementById('btnFinished').classList.remove('active');
        document.getElementById('scoreFields').style.display = 'none';
        document.getElementById('designatedPersonsGroup').style.display = 'block';
        const fT = document.getElementById('matchForfaitThuis');
        const fU = document.getElementById('matchForfaitUit');
        const fB = document.getElementById('matchBekermatch');
        if (fT) fT.checked = false;
        if (fU) fU.checked = false;
        if (fB) fB.checked = false;
        initForfaitListeners();
        
        document.getElementById('matchHomeScore').removeAttribute('required');
        document.getElementById('matchAwayScore').removeAttribute('required');
        
        populateDesignatedPersonsSelect();
        matchModal.classList.add('active');
    });
}

if (matchModalCancel) {
    matchModalCancel.addEventListener('click', () => {
        matchModal.classList.remove('active');
    });
}

const btnUpcoming = document.getElementById('btnUpcoming');
const btnFinished = document.getElementById('btnFinished');
const scoreFields = document.getElementById('scoreFields');
const designatedPersonsGroup = document.getElementById('designatedPersonsGroup');
const matchTypeInput = document.getElementById('matchType');
const matchHomeScore = document.getElementById('matchHomeScore');
const matchAwayScore = document.getElementById('matchAwayScore');

if (btnUpcoming) {
    btnUpcoming.addEventListener('click', () => {
        btnUpcoming.classList.add('active');
        btnFinished.classList.remove('active');
        scoreFields.style.display = 'none';
        designatedPersonsGroup.style.display = 'block';
        matchTypeInput.value = 'upcoming';
        matchHomeScore.removeAttribute('required');
        matchAwayScore.removeAttribute('required');
    });
}

if (btnFinished) {
    btnFinished.addEventListener('click', () => {
        btnFinished.classList.add('active');
        btnUpcoming.classList.remove('active');
        scoreFields.style.display = 'flex';
        designatedPersonsGroup.style.display = 'none';
        matchTypeInput.value = 'finished';
        matchHomeScore.setAttribute('required', 'required');
        matchAwayScore.setAttribute('required', 'required');
    });
}

function populateDesignatedPersonsSelect() {
    const container = document.getElementById('designatedPersonsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (allMembers.length === 0) {
        container.innerHTML = '<p style="padding: 10px;">Geen leden beschikbaar. Voeg eerst leden toe.</p>';
        return;
    }
    
    allMembers.forEach(member => {
        const checkbox = document.createElement('div');
        checkbox.className = 'checkbox-item';
        checkbox.innerHTML = `
            <label>
                <input type="checkbox" name="designatedPerson" value="${member.uid}">
                ${member.naam} (${
                    Array.isArray(member.ploegen) && member.ploegen.length > 0
                        ? member.ploegen.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')
                        : member.categorie || 'geen categorie'
                })
            </label>
        `;
        container.appendChild(checkbox);
    });
}

if (matchForm) {
    matchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const matchId = document.getElementById('matchId').value;
        const date = document.getElementById('matchDate').value;
        const time = document.getElementById('matchTime').value;
        const location = document.getElementById('matchLocation').value.trim();
        const homeTeam = document.getElementById('matchHomeTeam').value.trim();
        const awayTeam = document.getElementById('matchAwayTeam').value.trim();
        const team = document.getElementById('matchTeam').value;
        const descriptionField = document.getElementById('matchDescription');
        const description = descriptionField ? descriptionField.value.trim() : '';
        const matchType = document.getElementById('matchType').value;
        
        let matchData;
        
        if (matchType === 'upcoming') {
            const checkboxes = document.querySelectorAll('input[name="designatedPerson"]:checked');
            const aangeduidePersonen = Array.from(checkboxes).map(cb => cb.value);
            
            if (aangeduidePersonen.length === 0) {
                showToast('Selecteer minstens één persoon met toegang', 'error');
                return;
            }
            
            const forfaitVal     = document.querySelector('input[name="matchForfait"]:checked')?.value || 'geen';
            const isForfaitThuis = forfaitVal === 'thuis';
            const isForfaitUit   = forfaitVal === 'uit';
            const isBekermatch   = document.getElementById('matchBekermatch')?.checked || false;
            const fScoreThuis = isForfaitThuis ? 0 : (isForfaitUit ? 5 : 0);
            const fScoreUit   = isForfaitThuis ? 5 : (isForfaitUit ? 0 : 0);
            matchData = {
                datum: date,
                uur: time,
                locatie: location,
                thuisploeg: homeTeam,
                uitploeg: awayTeam,
                team: team,
                beschrijving: description,
                aangeduidePersonen: aangeduidePersonen,
                status: 'planned',
                scoreThuis: fScoreThuis,
                scoreUit: fScoreUit,
                isForfait:   isForfaitThuis || isForfaitUit,
                forfaitSide: isForfaitThuis ? 'thuis' : (isForfaitUit ? 'uit' : null),
                isBekermatch,
            };
        } else {
            const homeScore = parseInt(document.getElementById('matchHomeScore').value) || 0;
            const awayScore = parseInt(document.getElementById('matchAwayScore').value) || 0;
            const matchDateTime = new Date(`${date}T${time}`);
            
            const forfaitValF    = document.querySelector('input[name="matchForfait"]:checked')?.value || 'geen';
            const isForfaitThuisF = forfaitValF === 'thuis';
            const isForfaitUitF   = forfaitValF === 'uit';
            const isBekermatchF   = document.getElementById('matchBekermatch')?.checked || false;
            const finalHomeScore  = isForfaitThuisF ? 0 : (isForfaitUitF ? 5 : homeScore);
            const finalAwayScore  = isForfaitThuisF ? 5 : (isForfaitUitF ? 0 : awayScore);
            matchData = {
                datum: date,
                uur: time,
                locatie: location,
                thuisploeg: homeTeam,
                uitploeg: awayTeam,
                team: team,
                beschrijving: description,
                aangeduidePersonen: [],
                status: 'finished',
                scoreThuis: finalHomeScore,
                scoreUit: finalAwayScore,
                halfTimeReached: true,
                pausedAt: null,
                pausedDuration: 0,
                startedAt: matchDateTime,
                resumeStartedAt: matchDateTime,
                isForfait:   isForfaitThuisF || isForfaitUitF,
                forfaitSide: isForfaitThuisF ? 'thuis' : (isForfaitUitF ? 'uit' : null),
                isBekermatch: isBekermatchF,
            };
        }
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Bezig...';
        }
        
        try {
            if (matchId) {
                await updateDoc(doc(db, 'matches', matchId), matchData);
            } else {
                const docRef = await addDoc(collection(db, 'matches'), matchData);
                console.log('Match created with ID:', docRef.id);
            }
            
            showToast('Wedstrijd opgeslagen!', 'success');
            matchModal.classList.remove('active');
            matchForm.reset();
            await loadMatches();
            
        } catch (error) {
            console.error('Error saving match:', error);
            showToast('Fout bij opslaan: ' + error.message, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Opslaan';
            }
        }
    });
}

async function loadMatches() {
    const matchesList = document.getElementById('matchesList');
    if (!matchesList) return;
    
    matchesList.innerHTML = '<div class="loading"><div class="loader"></div></div>';
    
    try {
        try {
            const matchesQuery = query(collection(db, 'matches'), orderBy('datum', 'desc'));
            const matchesSnapshot = await getDocs(matchesQuery);
            displayMatches(matchesSnapshot);
        } catch (orderError) {
            if (orderError.code === 'failed-precondition') {
                const matchesSnapshot = await getDocs(collection(db, 'matches'));
                displayMatches(matchesSnapshot);
            } else {
                throw orderError;
            }
        }
    } catch (error) {
        console.error('Error loading matches:', error);
        matchesList.innerHTML = '<p class="text-center">Fout bij laden: ' + error.message + '</p>';
    }
}

function displayMatches(matchesSnapshot) {
    const matchesList = document.getElementById('matchesList');
    matchesList.innerHTML = '';

    if (matchesSnapshot.empty) {
        allMatchesCache = [];
        renderMatchList();
        return;
    }

    allMatchesCache = [];
    matchesSnapshot.forEach(docSnap => {
        allMatchesCache.push({ id: docSnap.id, ...docSnap.data() });
    });

    setTabCount('matches', allMatchesCache.length);
    renderMatchList();
}

function renderMatchList() {
    const matchesList = document.getElementById('matchesList');
    matchesList.innerHTML = '';

    let filtered = allMatchesCache;

    if (currentMatchFilter === 'planned') {
        filtered = allMatchesCache.filter(m => m.status === 'planned');
        const today = new Date();
        filtered.sort((a, b) => {
            const da = new Date(a.datum + 'T' + (a.uur || '00:00'));
            const db_ = new Date(b.datum + 'T' + (b.uur || '00:00'));
            const aFuture = da >= today;
            const bFuture = db_ >= today;
            if (aFuture && !bFuture) return -1;
            if (!aFuture && bFuture) return 1;
            return aFuture ? da - db_ : db_ - da;
        });
    } else if (currentMatchFilter === 'finished') {
        filtered = allMatchesCache.filter(m => m.status === 'finished' || m.status === 'live' || m.status === 'rust');
        filtered.sort((a, b) => new Date(b.datum) - new Date(a.datum));
    } else {
        filtered = [...allMatchesCache].sort((a, b) => new Date(b.datum) - new Date(a.datum));
    }

    if (filtered.length === 0) {
        matchesList.innerHTML = '<p class="text-center">Geen wedstrijden gevonden voor deze filter.</p>';
        return;
    }

    filtered.forEach(match => {
        const matchCard = createMatchCard(match);
        matchesList.appendChild(matchCard);
    });
}

function createMatchCard(match) {
    const card = document.createElement('div');
    card.className = 'match-card';
    
    const statusBadge = getMatchStatusBadge(match.status);
    const dateFormatted = new Date(match.datum).toLocaleDateString('nl-BE');
    
    const personenNames = (match.aangeduidePersonen || []).map(uid => {
        const person = allMembers.find(m => m.uid === uid);
        return person ? person.naam : 'Onbekend';
    }).join(', ') || 'Niemand';
    
    card.innerHTML = `
        <div class="match-info-admin">
            <h4>${match.thuisploeg} - ${match.uitploeg}</h4>
            <p>${dateFormatted} om ${match.uur} | ${match.locatie}</p>
            <p>Team: ${match.team || 'Niet gespecificeerd'}</p>
            ${match.beschrijving ? `<p class="match-description">${match.beschrijving}</p>` : ''}
            <p>Toegang: ${personenNames}</p>
            ${statusBadge}
            ${match.status !== 'planned' ? `<span class="member-badge">Score: ${match.scoreThuis || 0} - ${match.scoreUit || 0}</span>` : ''}
        </div>
        <div class="card-actions match-card-actions">
            ${match.status === 'planned' ? `<button class="action-btn edit match-action-edit" data-id="${match.id}">Bewerken</button>` : ''}
            ${(() => {
                const isAfgelopen = match.status === 'finished' || match.status === 'live' || match.status === 'rust';
                if (!isAfgelopen) return '';
                if (match.isForfait) {
                    return `<span class="match-badge match-badge-forfait" title="Forfaitwedstrijd — geen tijdslijn nodig">🏳 Forfait</span>`;
                }
                if (match.lineupConfirmed) {
                    return `<span class="match-badge retro-done-badge" title="Tijdslijn en opstelling zijn ingevoerd">✓ Tijdslijn</span>`;
                }
                return `<button class="action-btn retro-btn match-action-retro" data-id="${match.id}">⏱ Tijdslijn invoeren</button>`;
            })()}
            <button class="action-btn delete match-action-delete" data-id="${match.id}">Verwijderen</button>
        </div>
    `;
    
    const editBtn = card.querySelector('.match-action-edit');
    if (editBtn) editBtn.addEventListener('click', () => editMatch(match));

    const retroBtn = card.querySelector('.match-action-retro');
    if (retroBtn) retroBtn.addEventListener('click', (e) => { e.stopPropagation(); openRetroWizard(match); });

    card.querySelector('.match-action-delete').addEventListener('click', () => deleteMatch(match));
    card.querySelector('.match-info-admin').addEventListener('click', () => editMatch(match));
    
    return card;
}

function getMatchStatusBadge(status) {
    const statusMap = {
        'planned': { class: 'upcoming', text: 'Gepland' },
        'live': { class: 'live', text: 'Live' },
        'rust': { class: 'live', text: 'Rust' },
        'finished': { class: 'finished', text: 'Afgelopen' }
    };
    const s = statusMap[status] || { class: '', text: status };
    return `<span class="match-badge ${s.class}">${s.text}</span>`;
}

function editMatch(match) {
    const isFinished = match.status === 'finished' || match.status === 'live' || match.status === 'rust';

    document.getElementById('matchModalTitle').textContent = 'Wedstrijd Bewerken';
    document.getElementById('matchId').value       = match.id;
    document.getElementById('matchDate').value     = match.datum;
    document.getElementById('matchTime').value     = match.uur;
    document.getElementById('matchLocation').value = match.locatie;
    document.getElementById('matchHomeTeam').value = match.thuisploeg;
    document.getElementById('matchAwayTeam').value = match.uitploeg;
    document.getElementById('matchTeam').value     = match.team || 'veteranen';

    const descField = document.getElementById('matchDescription');
    if (descField) descField.value = match.beschrijving || '';

    const btnUp  = document.getElementById('btnUpcoming');
    const btnFin = document.getElementById('btnFinished');
    const sfEl   = document.getElementById('scoreFields');
    const dpEl   = document.getElementById('designatedPersonsGroup');
    const mtEl   = document.getElementById('matchType');
    const hsEl   = document.getElementById('matchHomeScore');
    const asEl   = document.getElementById('matchAwayScore');

    if (isFinished) {
        btnFin?.classList.add('active');
        btnUp?.classList.remove('active');
        if (sfEl) sfEl.style.display = 'flex';
        if (dpEl) dpEl.style.display = 'none';
        if (mtEl) mtEl.value = 'finished';
        if (hsEl) { hsEl.value = match.scoreThuis ?? 0; hsEl.setAttribute('required', 'required'); }
        if (asEl) { asEl.value = match.scoreUit   ?? 0; asEl.setAttribute('required', 'required'); }
    } else {
        btnUp?.classList.add('active');
        btnFin?.classList.remove('active');
        if (sfEl) sfEl.style.display = 'none';
        if (dpEl) dpEl.style.display = 'block';
        if (mtEl) mtEl.value = 'upcoming';
        if (hsEl) hsEl.removeAttribute('required');
        if (asEl) asEl.removeAttribute('required');
    }

    const efT = document.getElementById('matchForfaitThuis');
    const efU = document.getElementById('matchForfaitUit');
    const efB = document.getElementById('matchBekermatch');
    const forfaitRadioVal = match.forfaitSide === 'thuis' ? 'thuis' : match.forfaitSide === 'uit' ? 'uit' : 'geen';
    const forfaitRadio = document.querySelector(`input[name="matchForfait"][value="${forfaitRadioVal}"]`);
    if (forfaitRadio) forfaitRadio.checked = true;
    if (efB) efB.checked = !!match.isBekermatch;
    initForfaitListeners();

    populateDesignatedPersonsSelect();
    (match.aangeduidePersonen || []).forEach(uid => {
        const cb = document.querySelector(`input[name="designatedPerson"][value="${uid}"]`);
        if (cb) cb.checked = true;
    });

    matchModal.classList.add('active');
}

async function deleteMatch(match) {
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete = document.getElementById('confirmDelete');
    const confirmCancel = document.getElementById('confirmCancel');
    
    confirmMessage.textContent = `Weet je zeker dat je de wedstrijd ${match.thuisploeg} - ${match.uitploeg} wilt verwijderen?`;
    confirmModal.classList.add('active');
    
    confirmCancel.onclick = () => {
        confirmModal.classList.remove('active');
    };
    
    confirmDelete.onclick = async () => {
        try {
            const eventsSnapshot = await getDocs(
                query(collection(db, 'events'), where('matchId', '==', match.id))
            );
            const availabilitySnapshot = await getDocs(
                collection(db, 'matches', match.id, 'availability')
            );
            const playerMinutesSnapshot = await getDocs(
                collection(db, 'matches', match.id, 'playerMinutes')
            );

            await Promise.all([
                ...eventsSnapshot.docs.map(d => deleteDoc(d.ref)),
                ...availabilitySnapshot.docs.map(d => deleteDoc(d.ref)),
                ...playerMinutesSnapshot.docs.map(d => deleteDoc(d.ref))
            ]);

            await deleteDoc(doc(db, 'matches', match.id));

            confirmModal.classList.remove('active');
            await loadMatches();
        } catch (error) {
            console.error('Error deleting match:', error);
            showToast('Fout bij verwijderen: ' + error.message, 'error');
        }
    };
}

// ===============================================
// EVENEMENTEN MANAGEMENT
// ===============================================

const addEvenementBtn = document.getElementById('addEvenementBtn');
const evenementModal = document.getElementById('evenementModal');
const evenementForm = document.getElementById('evenementForm');
const evenementModalCancel = document.getElementById('evenementModalCancel');

if (addEvenementBtn) {
    addEvenementBtn.addEventListener('click', () => {
        document.getElementById('evenementModalTitle').textContent = 'Nieuw Evenement Aanmaken';
        document.getElementById('evenementId').value = '';
        evenementForm.reset();
        const opties = document.getElementById('inschrijfOpties');
        if (opties) opties.style.display = 'none';
        loadExtraVelden([]);
        evenementModal.classList.add('active');
    });
}

if (evenementModalCancel) {
    evenementModalCancel.addEventListener('click', () => {
        evenementModal.classList.remove('active');
    });
}

const evenementInschrijvingenCb = document.getElementById('evenementInschrijvingen');

if (evenementInschrijvingenCb) {
    evenementInschrijvingenCb.addEventListener('change', () => {
        const opties = document.getElementById('inschrijfOpties');
        if (opties) opties.style.display = evenementInschrijvingenCb.checked ? '' : 'none';
        if (!evenementInschrijvingenCb.checked) {
            const maxF = document.getElementById('evenementMaxDeelnemers');
            if (maxF) maxF.value = '';
        }
    });
}

let extraVeldenCounter = 0;

function addExtraVeldRow(data = {}) {
    extraVeldenCounter++;
    const id = data.id || ('veld_' + extraVeldenCounter);
    const div = document.createElement('div');
    div.className = 'extra-veld-row';
    div.dataset.veldId = id;
    const wijzigbaar = data.wijzigbaar || false;
    div.innerHTML = `
        <div class="extra-veld-row-header">
            <span class="extra-veld-row-title">Veld</span>
            <button class="modal-close-x" id="memberDetailClose">&times;</button>
        </div>
        <div class="form-row">
            <div class="form-group" style="flex:2;">
                <label>Label *</label>
                <input type="text" class="veld-label" placeholder="bv. Aantal volwassenen" value="${data.label || ''}" required>
            </div>
            <div class="form-group" style="flex:1;">
                <label>Prijs p.p. (€)</label>
                <input type="number" class="veld-prijs" min="0" step="0.01" placeholder="0 = gratis" value="${data.pricePerUnit ?? ''}">
            </div>
        </div>
        <div class="form-group">
            <label>Toelichting <small style="font-weight:400;">(optioneel)</small></label>
            <input type="text" class="veld-toelichting" placeholder="bv. t.e.m. 12 jaar gratis" value="${data.toelichting || ''}">
        </div>
        <div class="toggle-setting-row extra-veld-toggle-row">
            <div class="toggle-setting-label">
                <strong>Achteraf aanpasbaar</strong>
                <small>Lid kan dit veld na inschrijving nog wijzigen</small>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" class="veld-wijzigbaar" ${wijzigbaar ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
        </div>
    `;
    div.querySelector('.modal-close-x').addEventListener('click', () => {
        if (confirm('Ben je zeker dat je dit veld wilt verwijderen?')) {
            div.remove();
        }
    });
    document.getElementById('extraVeldenList').appendChild(div);
}

document.getElementById('addExtraVeldBtn')?.addEventListener('click', () => addExtraVeldRow());

function getExtraVelden() {
    const rows = document.querySelectorAll('#extraVeldenList .extra-veld-row');
    const velden = [];
    rows.forEach(row => {
        const label = row.querySelector('.veld-label')?.value.trim();
        if (!label) return;
        const pricePerUnit = parseFloat(row.querySelector('.veld-prijs')?.value) || 0;
        const toelichting  = row.querySelector('.veld-toelichting')?.value.trim() || '';
        const wijzigbaar   = row.querySelector('.veld-wijzigbaar')?.checked || false;
        velden.push({ id: row.dataset.veldId, label, pricePerUnit, toelichting, wijzigbaar });
    });
    return velden;
}

function loadExtraVelden(velden = []) {
    document.getElementById('extraVeldenList').innerHTML = '';
    extraVeldenCounter = 0;
    velden.forEach(v => addExtraVeldRow(v));
}

if (evenementForm) {
    evenementForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const evenementId = document.getElementById('evenementId').value;
        const datum      = document.getElementById('evenementDatum').value;
        const eindDatum = document.getElementById('evenementEindDatum')?.value || '';
        const eindTijd  = document.getElementById('evenementEindTijd')?.value  || '';
        const tijd = document.getElementById('evenementTijd').value;
        const titel = document.getElementById('evenementTitel').value.trim();
        const locatie = document.getElementById('evenementLocatie').value.trim();
        const beschrijving = document.getElementById('evenementBeschrijving').value.trim();
        const afbeeldingNaam = document.getElementById('evenementAfbeelding').value.trim();
        const linkField = document.getElementById('evenementLink');
        const link = linkField ? linkField.value.trim() : '';
        
        const inschrijvingenCb = document.getElementById('evenementInschrijvingen');
        const maxDeelnemersField = document.getElementById('evenementMaxDeelnemers');
        const inschrijvingenAan = inschrijvingenCb ? inschrijvingenCb.checked : false;
        const maxDeelnemers = maxDeelnemersField && maxDeelnemersField.value
            ? parseInt(maxDeelnemersField.value) : null;
        const inschrijfBeschrijving = document.getElementById('evenementInschrijfBeschrijving')?.value.trim() || '';
        const extraVelden = inschrijvingenAan ? getExtraVelden() : [];

        const evenementData = {
            datum,
            eindDatum: eindDatum || null,
            eindTijd:  eindTijd  || null,
            tijd,
            titel,
            locatie,
            beschrijving,
            afbeeldingNaam,
            link,
            inschrijvingenAan,
            ...(maxDeelnemers !== null && { maxDeelnemers }),
            inschrijfBeschrijving,
            extraVelden,
            createdAt: serverTimestamp()
        };
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Bezig...';
        }
        
        try {
            if (evenementId) {
                await updateDoc(doc(db, 'evenementen', evenementId), evenementData);
            } else {
                const docRef = await addDoc(collection(db, 'evenementen'), evenementData);
                console.log('Evenement created with ID:', docRef.id);
            }
            
            showToast('Evenement opgeslagen!', 'success');
            evenementModal.classList.remove('active');
            evenementForm.reset();
            await loadEvenementen();
            
        } catch (error) {
            console.error('Error saving evenement:', error);
            showToast('Fout bij opslaan: ' + error.message, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Opslaan';
            }
        }
    });
}

async function togglePinEvenement(evenement, newPinned) {
    try {
        await setDoc(doc(db, 'evenementen', evenement.id),
            { pinned: newPinned }, { merge: true });
        showToast(newPinned ? '📌 Evenement uitgelicht!' : '📌 Uitlichting verwijderd.', 'success');
        await loadEvenementen();
    } catch (e) {
        showToast('Fout: ' + e.message, 'error');
    }
}

async function loadEvenementen() {
    const evenementenList = document.getElementById('evenementenList');
    if (!evenementenList) return;
    
    evenementenList.innerHTML = '<div class="loading"><div class="loader"></div></div>';
    
    try {
        const evenementenSnapshot = await getDocs(collection(db, 'evenementen'));
        
        evenementenList.innerHTML = '';
        
        if (evenementenSnapshot.empty) {
            evenementenList.innerHTML = '<p class="text-center">Geen evenementen gevonden.</p>';
            return;
        }
        
        allEvenementen = [];
        evenementenSnapshot.forEach(docSnap => {
            const evenement = { id: docSnap.id, ...docSnap.data() };
            allEvenementen.push(evenement);
        });
        
        allEvenementen.sort((a, b) => new Date(a.datum + 'T' + a.tijd) - new Date(b.datum + 'T' + b.tijd));
        
        allEvenementen.forEach(evenement => {
            const card = createEvenementCard(evenement);
            evenementenList.appendChild(card);
        });
        
        setTabCount('evenementen', allEvenementen.length);
        
    } catch (error) {
        console.error('Error loading evenementen:', error);
        evenementenList.innerHTML = '<p class="text-center">Fout bij laden: ' + error.message + '</p>';
    }
}

function createEvenementCard(evenement) {
    const card = document.createElement('div');
    card.className = 'evenement-card';
    
    const dateFormatted = new Date(evenement.datum).toLocaleDateString('nl-BE');
    
    const inschrijvBadge = evenement.inschrijvingenAan
        ? `<span class="member-badge" style="background:#e8f5e9;color:#2e7d32;cursor:pointer;" id="badge_${evenement.id}">
               📋 Inschrijvingen <div class="loader"></div>
           </span>`
        : '';

    const isPinned = evenement.pinned === true;

    card.innerHTML = `
        <div class="evenement-info">
            <h4>${evenement.titel}</h4>
            <p>${dateFormatted} om ${evenement.tijd}</p>
            <p>${evenement.locatie}</p>
            ${evenement.beschrijving ? `<p class="evenement-description">${evenement.beschrijving.substring(0, 100)}...</p>` : ''}
            ${inschrijvBadge}
        </div>
        <div class="card-actions">
            <label class="ev-pin-toggle" title="${isPinned ? 'Uitgelicht — klik om te deactiveren' : 'Niet uitgelicht — klik om te activeren'}">
                <input type="checkbox" class="ev-pin-checkbox" ${isPinned ? 'checked' : ''}>
                <span class="ev-pin-slider"></span>
                <span class="ev-pin-label">${isPinned ? '📌 Uitgelicht' : 'Uitlichten'}</span>
            </label>
            ${evenement.inschrijvingenAan ? `<button class="action-btn" style="background:#e8f5e9;color:#2e7d32;" id="viewInschrijv_${evenement.id}">Inschrijvingen</button>` : ''}
            <button class="action-btn edit"><img src="assets/edit.png" class="icon" alt=""></button>
            <button class="action-btn delete"><img src="assets/delete.png" class="icon" alt=""></button>
        </div>
    `;

    card.querySelector('.evenement-info').addEventListener('click', () => editEvenement(evenement));
    card.querySelector('.edit').addEventListener('click', () => editEvenement(evenement));
    card.querySelector('.delete').addEventListener('click', () => deleteEvenement(evenement));
    card.querySelector('.ev-pin-checkbox').addEventListener('change', (e) => {
        togglePinEvenement(evenement, e.target.checked);
    });

    if (evenement.inschrijvingenAan) {
        loadInschrijvingenCount(evenement.id, evenement.extraVelden || []);
        card.querySelector(`#viewInschrijv_${evenement.id}`)
            .addEventListener('click', () => openInschrijvingenModal(evenement));
    }
    
    return card;
}

function editEvenement(evenement) {
    document.getElementById('evenementModalTitle').textContent = 'Evenement Bewerken';
    document.getElementById('evenementId').value = evenement.id;
    document.getElementById('evenementDatum').value    = evenement.datum    || '';
    document.getElementById('evenementEindDatum').value = evenement.eindDatum || '';
    document.getElementById('evenementEindTijd').value  = evenement.eindTijd  || '';
    document.getElementById('evenementTijd').value = evenement.tijd;
    document.getElementById('evenementTitel').value = evenement.titel;
    document.getElementById('evenementLocatie').value = evenement.locatie;
    document.getElementById('evenementBeschrijving').value = evenement.beschrijving;
    document.getElementById('evenementAfbeelding').value = evenement.afbeeldingNaam || '';
    
    const linkField = document.getElementById('evenementLink');
    if (linkField) linkField.value = evenement.link || '';

    const inschrijvCb = document.getElementById('evenementInschrijvingen');
    if (inschrijvCb) inschrijvCb.checked = !!evenement.inschrijvingenAan;
    const opties = document.getElementById('inschrijfOpties');
    if (opties) opties.style.display = evenement.inschrijvingenAan ? '' : 'none';
    const maxField = document.getElementById('evenementMaxDeelnemers');
    if (maxField) maxField.value = evenement.maxDeelnemers || '';
    const inschrijfBeschrijvingField = document.getElementById('evenementInschrijfBeschrijving');
    if (inschrijfBeschrijvingField) inschrijfBeschrijvingField.value = evenement.inschrijfBeschrijving || '';
    loadExtraVelden(evenement.extraVelden || []);

    evenementModal.classList.add('active');
}

async function deleteEvenement(evenement) {
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete = document.getElementById('confirmDelete');
    const confirmCancel = document.getElementById('confirmCancel');
    
    confirmMessage.textContent = `Weet je zeker dat je het evenement "${evenement.titel}" wilt verwijderen?`;
    confirmModal.classList.add('active');
    
    confirmCancel.onclick = () => {
        confirmModal.classList.remove('active');
    };
    
    confirmDelete.onclick = async () => {
        try {
            await deleteDoc(doc(db, 'evenementen', evenement.id));
            confirmModal.classList.remove('active');
            await loadEvenementen();
        } catch (error) {
            console.error('Error deleting evenement:', error);
            showToast('Fout bij verwijderen: ' + error.message, 'error');
        }
    };
}

async function loadInschrijvingenCount(evenementId, extraVelden = []) {
    try {
        const snap = await getDocs(collection(db, 'evenementen', evenementId, 'inschrijvingen'));
        const badge = document.getElementById(`badge_${evenementId}`);
        if (badge) {
            const aantalLeden = snap.size;
            let totaalExtra = 0;
            snap.forEach(d => {
                (d.data().extraAntwoorden || []).forEach(ant => {
                    totaalExtra += parseInt(ant.waarde) || 0;
                });
            });
            const totaal = aantalLeden + totaalExtra;
            badge.textContent = totaalExtra > 0
                ? `${aantalLeden} leden · ${totaal} aanwezigen`
                : `${aantalLeden} ingeschreven`;
        }
    } catch (e) { console.error('Count error:', e); }
}

async function openInschrijvingenModal(evenement) {
    const modal    = document.getElementById('inschrijvingenModal');
    const title    = document.getElementById('inschrijvingenModalTitle');
    const samenvatting = document.getElementById('inschrijvingenSamenvatting');
    const list     = document.getElementById('inschrijvingenList');
    if (!modal) return;

    title.textContent = `Inschrijvingen — ${evenement.titel}`;
    list.innerHTML = '<p><div class="loader"></div></p>';
    if (samenvatting) samenvatting.innerHTML = '';
    modal.classList.add('active');

    const extraVelden = evenement.extraVelden || [];

    try {
        const snap = await getDocs(collection(db, 'evenementen', evenement.id, 'inschrijvingen'));
        if (snap.empty) {
            list.innerHTML = '<p style="color:#888;">Nog niemand ingeschreven.</p>';
            return;
        }

        const inschrijvingen = [];
        snap.forEach(d => inschrijvingen.push(d.data()));
        inschrijvingen.sort((a, b) => (a.ingeschrevenOp?.toMillis?.() || 0) - (b.ingeschrevenOp?.toMillis?.() || 0));

        const aantalLeden = inschrijvingen.length;
        const veldTotalen = {};
        let totaalExtraPersonen = 0;
        let totaalKosten = 0;

        inschrijvingen.forEach(i => {
            (i.extraAntwoorden || []).forEach(ant => {
                const veld = extraVelden.find(v => v.id === ant.veldId);
                if (!veld) return;
                const aantal = parseInt(ant.waarde) || 0;
                veldTotalen[ant.veldId] = (veldTotalen[ant.veldId] || 0) + aantal;
                totaalExtraPersonen += aantal;
                totaalKosten += aantal * (veld.pricePerUnit || 0);
            });
        });

        const totaalPersonen = aantalLeden + totaalExtraPersonen;

        if (samenvatting) {
            const maxBadge = evenement.maxDeelnemers
                ? `<span style="color:#888;font-size:0.9rem;"> / ${evenement.maxDeelnemers} leden</span>` : '';

            let veldenHtml = extraVelden.map(v => {
                const tot = veldTotalen[v.id] || 0;
                const kost = tot * (v.pricePerUnit || 0);
                return `<div class="inschrijf-stat-card">
                    <div class="inschrijf-stat-value">${tot}</div>
                    <div class="inschrijf-stat-label">${v.label}</div>
                    ${v.pricePerUnit > 0 ? `<div class="inschrijf-stat-sub">€${kost.toFixed(2)}</div>` : ''}
                </div>`;
            }).join('');

            samenvatting.innerHTML = `
                <div class="inschrijf-stats-row">
                    <div class="inschrijf-stat-card primary">
                        <div class="inschrijf-stat-value">${aantalLeden}${maxBadge}</div>
                        <div class="inschrijf-stat-label">Ingeschreven leden</div>
                    </div>
                    ${veldenHtml}
                    <div class="inschrijf-stat-card">
                        <div class="inschrijf-stat-value">${totaalPersonen}</div>
                        <div class="inschrijf-stat-label">Totaal aanwezigen</div>
                    </div>
                    ${totaalKosten > 0 ? `<div class="inschrijf-stat-card accent">
                        <div class="inschrijf-stat-value">€${totaalKosten.toFixed(2)}</div>
                        <div class="inschrijf-stat-label">Te innen</div>
                    </div>` : ''}
                </div>
            `;
        }

        list.innerHTML = inschrijvingen.map((i, idx) => {
            const extraHtml = (i.extraAntwoorden || []).map(ant => {
                const veld = extraVelden.find(v => v.id === ant.veldId);
                if (!veld || !ant.waarde) return '';
                const aantal = parseInt(ant.waarde) || 0;
                if (aantal === 0) return '';
                const kost = aantal * (veld.pricePerUnit || 0);
                return `<span style="font-size:0.82rem;color:#555;margin-top:2px;display:block;">
                    ${veld.label}: <strong>${aantal}</strong>
                    ${veld.pricePerUnit > 0 ? `<span style="color:#1565c0;">(€${kost.toFixed(2)})</span>` : ''}
                </span>`;
            }).join('');

            const datum = i.ingeschrevenOp
                ? new Date(i.ingeschrevenOp.toMillis?.() || i.ingeschrevenOp).toLocaleDateString('nl-BE')
                : '';

            return `
                <div style="display:flex;align-items:flex-start;gap:0.75rem;padding:0.65rem 0;border-bottom:1px solid #f0f0f0;">
                    <span style="width:24px;height:24px;border-radius:50%;background:#e3f2fd;color:#1565c0;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;flex-shrink:0;margin-top:2px;">${idx + 1}</span>
                    <div style="flex:1;">
                        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                            <strong>${i.naam || '—'}</strong>
                            <span style="color:#888;font-size:0.85rem;">${i.email || ''}</span>
                            ${datum ? `<span style="color:#aaa;font-size:0.8rem;">${datum}</span>` : ''}
                        </div>
                        ${extraHtml}
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        list.innerHTML = '<p style="color:red;">Fout bij laden: ' + e.message + '</p>';
    }
}

const inschrijvingenModalClose = document.getElementById('inschrijvingenModalClose');
if (inschrijvingenModalClose) {
    inschrijvingenModalClose.addEventListener('click', () => {
        document.getElementById('inschrijvingenModal').classList.remove('active');
    });
}

// ===============================================
// CONTACTBERICHTEN MANAGEMENT
// FIX 2: Berichten gesorteerd van OUDSTE naar NIEUWSTE
// ===============================================

let currentFilter = 'all';

async function loadContactberichten() {
    console.log('Loading contactberichten...');
    const container = document.getElementById('contactberichtenList');
    
    if (!container) {
        console.error('Container not found');
        return;
    }
    
    container.innerHTML = '<div class="loading"><div class="loader"></div></div>';
    
    try {
        let snapshot;
        try {
            // Probeer met ordering — als index ontbreekt, vallen we terug op zonder
            const berichtenQuery = query(
                collection(db, 'contactberichten'),
                orderBy('datum', 'asc')   // ← oudste eerst
            );
            snapshot = await getDocs(berichtenQuery);
        } catch (orderError) {
            console.warn('Could not order by datum, loading without ordering:', orderError.message);
            const berichtenQuery = collection(db, 'contactberichten');
            snapshot = await getDocs(berichtenQuery);
        }
        
        if (snapshot.empty) {
            container.innerHTML = `
                <div class="messages-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                    <h3>Geen berichten</h3>
                    <p>Er zijn nog geen contactberichten ontvangen.</p>
                </div>
            `;
            updateMessageStats(0, 0);
            return;
        }
        
        const berichten = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            berichten.push({ 
                id: docSnap.id, 
                ...data
            });
        });
        
        // FIX 2: Sorteer OUDSTE eerst (ascending)
        berichten.sort((a, b) => {
            const dateA = a.datum?.toDate ? a.datum.toDate() : new Date(a.createdAt || 0);
            const dateB = b.datum?.toDate ? b.datum.toDate() : new Date(b.createdAt || 0);
            return dateA - dateB; // ← ascending (oudste eerst)
        });
        
        console.log('Loaded', berichten.length, 'contactberichten (oldest first)');
        
        const unreadCount = berichten.filter(b => !b.gelezen).length;
        updateMessageStats(berichten.length, unreadCount);
        
        displayContactberichten(berichten);
        setupFilterButtons(berichten);
        
    } catch (error) {
        console.error('Error loading contactberichten:', error);
        
        let errorHTML = '<div class="error-message"><p class="error">Fout bij laden van berichten.</p>';
        
        if (error.code === 'permission-denied') {
            errorHTML += '<p>Je hebt geen toegang tot de contactberichten. Controleer je Firestore regels.</p>';
        } else if (error.code === 'failed-precondition' || error.message.includes('index')) {
            errorHTML += '<p>Er is een database index vereist. Klik op de link in de browser console om deze aan te maken.</p>';
        }
        
        errorHTML += '<button onclick="location.reload()" class="retry-btn">Opnieuw proberen</button></div>';
        container.innerHTML = errorHTML;
    }
}

function updateMessageStats(total, unread) {
    const totalEl = document.getElementById('totalMessages');
    const unreadEl = document.getElementById('unreadMessages');
    
    if (totalEl) totalEl.textContent = total;
    if (unreadEl) unreadEl.textContent = unread;
}

function setupFilterButtons(berichten) {
    const filterButtons = document.querySelectorAll('.filter-btn');
    
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            currentFilter = btn.getAttribute('data-filter');
            displayContactberichten(berichten);
        });
    });
}

function displayContactberichten(berichten) {
    const container = document.getElementById('contactberichtenList');
    if (!container) return;
    
    let filtered = berichten;
    if (currentFilter === 'unread') {
        filtered = berichten.filter(b => !b.gelezen);
    } else if (currentFilter === 'read') {
        filtered = berichten.filter(b => b.gelezen);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="messages-empty">
                <p>Geen berichten in deze categorie.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    filtered.forEach(bericht => {
        const card = createMessageCard(bericht);
        container.appendChild(card);
    });
}

function createMessageCard(bericht) {
    const card = document.createElement('div');
    card.className = `message-card ${bericht.gelezen ? 'read' : 'unread'}`;
    
    const datum = bericht.datum?.toDate 
        ? bericht.datum.toDate().toLocaleString('nl-BE', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
        : 'Onbekende datum';
    
    const isLongMessage = bericht.bericht.length > 200;
    
    card.innerHTML = `
        <div class="message-header">
            <div class="message-info">
                <a class="message-email" href="mailto:${bericht.email}" title="Reageer via e-mail">${bericht.email}</a>
                <div class="message-date">${datum}</div>
            </div>
            <span class="message-badge ${bericht.gelezen ? 'read' : 'unread'}">
                ${bericht.gelezen ? 'Gelezen' : 'Nieuw'}
            </span>
        </div>
        <div class="message-content ${isLongMessage ? 'collapsed' : ''}" data-full-text="${bericht.bericht.replace(/"/g, '&quot;')}">${bericht.bericht}</div>
        ${isLongMessage ? '<div class="message-expand-hint">Klik om volledig bericht te tonen</div>' : ''}
        <div class="message-actions">
            ${!bericht.gelezen ? `
                <button class="message-action-btn mark-read" data-id="${bericht.id}">
                    ✓ Markeer als gelezen
                </button>
            ` : ''}
            <button class="message-action-btn delete" data-id="${bericht.id}">
                <img src="assets/delete.png" class="icon-lg" alt=""> Verwijderen
            </button>
        </div>
    `;
    
    if (isLongMessage) {
        const messageContent = card.querySelector('.message-content');
        const expandHint = card.querySelector('.message-expand-hint');
        
        messageContent.addEventListener('click', () => {
            if (messageContent.classList.contains('collapsed')) {
                messageContent.classList.remove('collapsed');
                messageContent.classList.add('expanded');
                if (expandHint) expandHint.style.display = 'none';
            } else {
                messageContent.classList.add('collapsed');
                messageContent.classList.remove('expanded');
                if (expandHint) expandHint.style.display = 'block';
            }
        });
    }
    
    const markReadBtn = card.querySelector('.mark-read');
    if (markReadBtn) {
        markReadBtn.addEventListener('click', () => markAsRead(bericht.id));
    }
    
    const deleteBtn = card.querySelector('.delete');
    deleteBtn.addEventListener('click', () => deleteMessage(bericht.id));
    
    return card;
}

async function markAsRead(berichtId) {
    try {
        await updateDoc(doc(db, 'contactberichten', berichtId), {
            gelezen: true
        });
        await loadContactberichten();
        await updateContactberichtenBadge();
    } catch (error) {
        console.error('Error marking message as read:', error);
        showToast('Fout bij markeren: ' + error.message, 'error');
    }
}

async function deleteMessage(berichtId) {
    if (!confirm('Weet je zeker dat je dit bericht wilt verwijderen?')) {
        return;
    }
    
    try {
        await deleteDoc(doc(db, 'contactberichten', berichtId));
        await loadContactberichten();
        await updateContactberichtenBadge();
    } catch (error) {
        console.error('Error deleting message:', error);
        showToast('Fout bij verwijderen: ' + error.message, 'error');
    }
}

// ===============================================
// RANKING MANAGEMENT
// ===============================================

document.querySelectorAll('.ranking-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.ranking-subtab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.ranking-subtab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.subtab).classList.add('active');

        if (btn.dataset.subtab === 'currentTab') {
            loadCurrentRankingView();
        }
    });
});

function showRankingStatus(elId, type, message) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = `ranking-status ${type}`;
    el.textContent = message;
    el.style.display = 'block';
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function parseRankingInput(input) {
    const lines = input.trim().split('\n');
    const rankingArray = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        let parts = trimmedLine.split('\t').filter(p => p.trim());
        if (parts.length !== 10) parts = trimmedLine.split(/\s+/);
        if (parts.length !== 10) continue;

        try {
            const pos = parseInt(parts[0]);
            if (isNaN(pos)) continue;

            let teamName = parts[1].replace(/^Logo\s*/i, '').trim();

            const concatMatch = teamName.match(/^(.+)\1$/);
            if (concatMatch) {
                teamName = concatMatch[1].trim();
            } else {
                const words = teamName.split(/\s+/).filter(w => w.trim());
                const half  = Math.floor(words.length / 2);
                if (words.length > 0 && words.length % 2 === 0 && half > 0) {
                    const a = words.slice(0, half).join(' ');
                    const b = words.slice(half).join(' ');
                    if (a === b) teamName = a;
                }
            }

            const played      = parseInt(parts[2]);
            const won         = parseInt(parts[3]);
            const lost        = parseInt(parts[4]);
            const draw        = parseInt(parts[5]);
            const goalsFor    = parseInt(parts[6]);
            const goalsAgainst = parseInt(parts[7]);
            const saldo       = parseInt(parts[8]);
            const pnt         = parseInt(parts[9]);

            if ([played, won, draw, lost, goalsFor, goalsAgainst, saldo, pnt].some(isNaN)) continue;

            rankingArray.push({ pos, team: teamName.trim(), pnt, played, won, draw, lost,
                goals_for: goalsFor, goals_against: goalsAgainst, saldo });
        } catch (_) { continue; }
    }
    return rankingArray;
}

const processRankingBtn = document.getElementById('processRankingBtn');
if (processRankingBtn) {
    processRankingBtn.addEventListener('click', async () => {
        const team  = document.getElementById('rankingTeam').value;
        const input = document.getElementById('rankingInput').value;

        if (!team)        { showRankingStatus('rankingStatus', 'error', 'Selecteer eerst een team!'); return; }
        if (!input.trim()) { showRankingStatus('rankingStatus', 'error', 'Voer rangschikking data in!'); return; }

        processRankingBtn.disabled = true;
        processRankingBtn.textContent = 'Bezig…';

        try {
            const parsed = parseRankingInput(input);
            if (parsed.length === 0) {
                showRankingStatus('rankingStatus', 'error', 'Geen geldige data gevonden. Controleer het formaat!');
                return;
            }

            await setDoc(doc(db, 'ranking', team), {
                teams: parsed,
                updatedAt: serverTimestamp()
            });

            document.getElementById('previewTeamName').textContent =
                team.charAt(0).toUpperCase() + team.slice(1);
            document.getElementById('rankingPreviewContent').textContent =
                JSON.stringify(parsed, null, 2);
            document.getElementById('rankingPreview').style.display = 'block';

            showRankingStatus('rankingStatus', 'success',
                `✅ ${parsed.length} ploegen opgeslagen voor ${team}!`);

            localStorage.removeItem(`vvs_ranking_${team}`);

        } catch (err) {
            console.error('processRanking error:', err);
            showRankingStatus('rankingStatus', 'error', 'Fout bij opslaan: ' + err.message);
        } finally {
            processRankingBtn.disabled = false;
            processRankingBtn.textContent = '🔄 Verwerken & Opslaan in Firebase';
        }
    });
}

const clearRankingBtn = document.getElementById('clearRankingBtn');
if (clearRankingBtn) {
    clearRankingBtn.addEventListener('click', () => {
        document.getElementById('rankingTeam').value = '';
        document.getElementById('rankingInput').value = '';
        document.getElementById('rankingPreview').style.display = 'none';
        showRankingStatus('rankingStatus', 'success', 'Gewist.');
    });
}

const matchResultTeamSel = document.getElementById('matchResultTeam');
if (matchResultTeamSel) {
    matchResultTeamSel.addEventListener('change', async () => {
        const team = matchResultTeamSel.value;
        document.getElementById('matchTeamSelects').style.display  = 'none';
        document.getElementById('matchScoreRow').style.display     = 'none';
        document.getElementById('matchResultActions').style.display = 'none';
        document.getElementById('matchResultPreview').style.display = 'none';
        document.getElementById('matchResultStatus').style.display  = 'none';

        if (!team) return;

        showRankingStatus('matchResultStatus', '', 'Ploegen laden…');
        try {
            const snap = await getDoc(doc(db, 'ranking', team));

            if (!snap.exists()) {
                showRankingStatus('matchResultStatus', 'error',
                    'Geen klassement gevonden voor ' + team + '. Upload het eerst via "Volledig Plakken".');
                return;
            }

            const teams = snap.data().teams || [];
            const home  = document.getElementById('rankingHomeTeam');
            const away  = document.getElementById('rankingAwayTeam');
            [home, away].forEach(sel => {
                sel.innerHTML = '<option value="">Kies ploeg…</option>';
                teams.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.team;
                    opt.textContent = t.team;
                    sel.appendChild(opt);
                });
            });

            document.getElementById('matchTeamSelects').style.display  = '';
            document.getElementById('matchScoreRow').style.display     = '';
            document.getElementById('matchResultActions').style.display = '';
            document.getElementById('matchResultStatus').style.display  = 'none';

        } catch (err) {
            showRankingStatus('matchResultStatus', 'error', 'Fout: ' + err.message);
        }
    });
}

const applyMatchResultBtn = document.getElementById('applyMatchResultBtn');
if (applyMatchResultBtn) {
    applyMatchResultBtn.addEventListener('click', async () => {
        const team      = document.getElementById('matchResultTeam').value;
        const homeName  = document.getElementById('rankingHomeTeam').value;
        const awayName  = document.getElementById('rankingAwayTeam').value;
        const homeScore = parseInt(document.getElementById('rankingHomeScore').value);
        const awayScore = parseInt(document.getElementById('rankingAwayScore').value);

        if (!team || !homeName || !awayName) {
            showRankingStatus('matchResultStatus', 'error', 'Selecteer reeks en beide ploegen.');
            return;
        }
        if (homeName === awayName) {
            showRankingStatus('matchResultStatus', 'error', 'Kies twee verschillende ploegen.');
            return;
        }
        if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
            showRankingStatus('matchResultStatus', 'error', 'Voer geldige scores in (0 of meer).');
            return;
        }

        applyMatchResultBtn.disabled = true;
        applyMatchResultBtn.textContent = 'Bezig…';

        try {
            const snap  = await getDoc(doc(db, 'ranking', team));
            if (!snap.exists()) throw new Error('Klassement niet gevonden.');
            const teams = snap.data().teams.map(t => ({ ...t }));

            const homeTeam = teams.find(t => t.team === homeName);
            const awayTeam = teams.find(t => t.team === awayName);
            if (!homeTeam || !awayTeam) throw new Error('Ploeg niet gevonden in klassement.');

            function applyResult(t, goalsFor, goalsAgainst) {
                t.played = (t.played || 0) + 1;
                t.goals_for     = (t.goals_for     || 0) + goalsFor;
                t.goals_against = (t.goals_against || 0) + goalsAgainst;
                t.saldo = t.goals_for - t.goals_against;
                if (goalsFor > goalsAgainst) {
                    t.won  = (t.won  || 0) + 1;
                    t.pnt  = (t.pnt  || 0) + 3;
                } else if (goalsFor < goalsAgainst) {
                    t.lost = (t.lost || 0) + 1;
                } else {
                    t.draw = (t.draw || 0) + 1;
                    t.pnt  = (t.pnt  || 0) + 1;
                }
            }
            applyResult(homeTeam, homeScore, awayScore);
            applyResult(awayTeam, awayScore, homeScore);

            teams.sort((a, b) =>
                (b.pnt       - a.pnt)       ||
                (b.won       - a.won)       ||
                (b.saldo     - a.saldo)     ||
                (b.goals_for - a.goals_for)
            );
            let pos = 1;
            teams.forEach((t, i) => {
                if (i > 0 &&
                    t.pnt       === teams[i-1].pnt       &&
                    t.won       === teams[i-1].won       &&
                    t.saldo     === teams[i-1].saldo     &&
                    t.goals_for === teams[i-1].goals_for) {
                    t.pos = teams[i-1].pos;
                } else {
                    t.pos = pos;
                }
                pos++;
            });

            await setDoc(doc(db, 'ranking', team), { teams, updatedAt: serverTimestamp() });
            localStorage.removeItem(`vvs_ranking_${team}`);

            const result = homeScore > awayScore ? `${homeName} wint`
                         : homeScore < awayScore ? `${awayName} wint`
                         : 'Gelijkspel';

            document.getElementById('matchResultPreviewContent').textContent =
                `${homeName} ${homeScore} – ${awayScore} ${awayName}\n${result}\n\n` +
                `${homeName}: ${homeTeam.pnt} pnt, ${homeTeam.played} gespeeld\n` +
                `${awayName}: ${awayTeam.pnt} pnt, ${awayTeam.played} gespeeld`;
            document.getElementById('matchResultPreview').style.display = 'block';

            showRankingStatus('matchResultStatus', 'success',
                `✅ Klassement bijgewerkt: ${homeName} ${homeScore}–${awayScore} ${awayName}`);

        } catch (err) {
            console.error('applyMatchResult error:', err);
            showRankingStatus('matchResultStatus', 'error', 'Fout: ' + err.message);
        } finally {
            applyMatchResultBtn.disabled = false;
            applyMatchResultBtn.textContent = '⚽ Resultaat Verwerken & Opslaan';
        }
    });
}

const viewRankingTeamSel = document.getElementById('viewRankingTeam');
if (viewRankingTeamSel) {
    viewRankingTeamSel.addEventListener('change', loadCurrentRankingView);
}

async function loadCurrentRankingView() {
    const team = document.getElementById('viewRankingTeam')?.value;
    const container = document.getElementById('currentRankingTable');
    if (!team || !container) return;

    container.innerHTML = '<div class="loading">Laden…</div>';
    try {
        const snap = await getDoc(doc(db, 'ranking', team));

        if (!snap.exists() || !(snap.data().teams?.length)) {
            container.innerHTML = '<p style="color:#666;margin-top:1rem;">Geen data gevonden. Upload via "Volledig Plakken".</p>';
            return;
        }

        const teams = snap.data().teams;
        const updated = snap.data().updatedAt?.toDate?.()?.toLocaleDateString('nl-BE') || '?';

        container.innerHTML = `
            <p class="ranking-view-meta">
                Laatste update: ${updated} · ${teams.length} ploegen
            </p>
            <div class="ranking-view-scroll">
            <table class="ranking-view-table">
                <thead>
                    <tr>
                        <th class="rv-center">#</th>
                        <th class="rv-left">Ploeg</th>
                        <th class="rv-center" title="Punten">Pnt</th>
                        <th class="rv-center" title="Gespeeld">Sp</th>
                        <th class="rv-center" title="Gewonnen">W</th>
                        <th class="rv-center" title="Gelijk">G</th>
                        <th class="rv-center" title="Verlies">V</th>
                        <th class="rv-center">Voor</th>
                        <th class="rv-center">Tgn</th>
                        <th class="rv-center">Saldo</th>
                    </tr>
                </thead>
                <tbody>
                    ${teams.map((t, i) => {
                        const isVVS = t.team.includes('V.V.S');
                        const rowClass = isVVS ? 'vvs-row' : (i % 2 === 0 ? 'even-row' : 'odd-row');
                        const saldoClass = t.saldo >= 0 ? 'saldo-pos' : 'saldo-neg';
                        return `<tr class="${rowClass}">
                            <td class="rv-center">${t.pos}</td>
                            <td class="rv-left">${t.team}</td>
                            <td class="rv-center rv-bold">${t.pnt}</td>
                            <td class="rv-center">${t.played}</td>
                            <td class="rv-center">${t.won}</td>
                            <td class="rv-center">${t.draw}</td>
                            <td class="rv-center">${t.lost}</td>
                            <td class="rv-center">${t.goals_for}</td>
                            <td class="rv-center">${t.goals_against}</td>
                            <td class="rv-center ${saldoClass}">${t.saldo >= 0 ? '+' : ''}${t.saldo}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>`;

    } catch (err) {
        container.innerHTML = `<p style="color:red;">Fout: ${err.message}</p>`;
    }
}

console.log('Admin.js initialization complete');

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
    let t = document.getElementById('adminToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'adminToast';
        t.style.cssText = `position:fixed;bottom:1.75rem;right:1.75rem;background:var(--text-dark);color:var(--white);
            padding:0.75rem 1.3rem;border-radius:9px;font-size:0.88rem;font-weight:600;z-index:9999;
            transform:translateY(80px);opacity:0;transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);
            box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;max-width:320px;`;
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--text-dark)';
    t.style.transform  = 'translateY(0)';
    t.style.opacity    = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.transform = 'translateY(80px)'; t.style.opacity = '0'; }, 3500);
}

// ── Forfait auto-score listeners ──────────────────────────────────────────────
let _forfaitListenersInit = false;
function initForfaitListeners() {
    if (_forfaitListenersInit) return;
    _forfaitListenersInit = true;

    const scoreFieldsEl = document.getElementById('scoreFields');
    const homeScoreEl   = document.getElementById('matchHomeScore');
    const awayScoreEl   = document.getElementById('matchAwayScore');

    function applyForfait(e) {
        const val = e.target.value;
        if (val === 'thuis') {
            if (scoreFieldsEl) scoreFieldsEl.style.display = 'flex';
            if (homeScoreEl) homeScoreEl.value = 0;
            if (awayScoreEl) awayScoreEl.value = 5;
        } else if (val === 'uit') {
            if (scoreFieldsEl) scoreFieldsEl.style.display = 'flex';
            if (homeScoreEl) homeScoreEl.value = 5;
            if (awayScoreEl) awayScoreEl.value = 0;
        }
    }

    document.querySelectorAll('input[name="matchForfait"]').forEach(r => {
        r.addEventListener('change', applyForfait);
    });
}

// ── Modal buiten-klik sluiten ─────────────────────────────────────────────────
(function initModalOutsideClick() {
    const modals = [
        document.getElementById('memberModal'),
        document.getElementById('matchModal'),
        document.getElementById('evenementModal'),
    ];
    modals.forEach(modal => {
        if (!modal) return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    });
})();
// ===============================================
// RETRO WEDSTRIJD INVOER WIZARD
// ===============================================

let retroMatch        = null;
let retroAvailable    = [];
let retroSelectedUids = new Set();
let retroStarters     = new Set();
let retroBench        = new Set();
let retroEvents       = [];
let retroCurrentStep  = 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

function retroHalfDur() { return retroMatch?.team === 'veteranen' ? 35 : 45; }
function retroFullDur() { return retroHalfDur() * 2; }
function retroVvsSide() {
    return (retroMatch?.thuisploeg || '').toLowerCase().includes('rotselaar') ? 'home' : 'away';
}

/**
 * Parseer minuut-input. Ondersteunt:
 *   - Gewone getallen:  "67"  → { min: 67, extra: 0 }
 *   - Plusnotatie:     "45+2" → { min: 45, extra: 2 }
 *   - Verlengingen:    "45+2", "90+3", maar ook "93" (gewone verlenging)
 * Geeft null terug bij ongeldige input.
 */
function parseMinuut(raw) {
    const s = (raw || '').trim();
    const plusMatch = s.match(/^(\d{1,3})\+(\d{1,2})$/);
    if (plusMatch) {
        return { min: parseInt(plusMatch[1]), extra: parseInt(plusMatch[2]), raw: s };
    }
    const plain = parseInt(s);
    if (!isNaN(plain) && plain >= 0) {
        return { min: plain, extra: 0, raw: s };
    }
    return null;
}

/**
 * Bepaal de half op basis van base-minuut + plusnotatie.
 * - 45+x  → half 1 (nog in eerste helft, extra tijd)
 * - 90+x  → half 2 (nog in tweede helft, extra tijd)
 * - Gewone waarde ≤ hd  → half 1
 * - Gewone waarde ≤ fd  → half 2
 * - Daarna → verlengingen (half 3/4)
 */
function calcHalfFromParsed(parsed) {
    const hd = retroHalfDur(), fd = retroFullDur();
    const { min, extra } = parsed;
    if (extra > 0) {
        // Plus-notatie: half bepaald door de basis-minuut
        if (min === hd)  return 1;
        if (min === fd)  return 2;
        if (min === fd + 15) return 3;
    }
    // Gewone minuut
    if (min <= hd)       return 1;
    if (min <= fd)       return 2;
    if (min <= fd + 15)  return 3;
    return 4;
}

/** Effectieve minuut voor sortering (45+2 → 47) */
function effectiveMin(parsed) {
    return parsed.min + parsed.extra;
}

function halvesLabel(half) {
    return ['', '1e helft', '2e helft', 'VT 1e helft', 'VT 2e helft'][half] || `Half ${half}`;
}

// ── Modal aanmaken ────────────────────────────────────────────────────────────

function getRetroModal() {
    let m = document.getElementById('retroModal');
    if (m) return m;
    m = document.createElement('div');
    m.id        = 'retroModal';
    m.className = 'modal';
    m.innerHTML = `
        <div class="modal-content retro-modal-content">
            <button class="modal-close-x" id="retroClose">&times;</button>
            <h3 id="retroTitle">Wedstrijd Tijdslijn Invoeren</h3>
            <div class="retro-steps-bar" id="retroStepsBar">
                <div class="retro-step-dot active" data-s="1"><span class="retro-dot-num">1</span><span class="retro-step-label">Aanwezigen</span></div>
                <div class="retro-step-dot" data-s="2"><span class="retro-dot-num">2</span><span class="retro-step-label">Opstelling</span></div>
                <div class="retro-step-dot" data-s="3"><span class="retro-dot-num">3</span><span class="retro-step-label">Tijdslijn</span></div>
            </div>
            <div id="retroContent" class="retro-content"></div>
            <div class="retro-footer">
                <button class="modal-btn cancel" id="retroBack" style="display:none">← Vorige</button>
                <button class="modal-btn confirm" id="retroNext">Volgende →</button>
            </div>
        </div>`;
    document.body.appendChild(m);
    m.querySelector('#retroClose').addEventListener('click', () => m.classList.remove('active'));
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('active'); });
    m.querySelector('#retroBack').addEventListener('click', () => retroNav(-1));
    m.querySelector('#retroNext').addEventListener('click', () => retroNav(+1));
    return m;
}

// ── Wizard openen ─────────────────────────────────────────────────────────────

async function openRetroWizard(match) {
    retroMatch        = match;
    retroAvailable    = [];
    retroSelectedUids = new Set();
    retroStarters     = new Set();
    retroBench        = new Set();
    retroEvents       = [];
    retroCurrentStep  = 1;

    const modal = getRetroModal();
    modal.querySelector('#retroTitle').textContent =
        `Tijdslijn invoeren — ${match.thuisploeg} ${match.scoreThuis ?? 0}–${match.scoreUit ?? 0} ${match.uitploeg}`;
    modal.classList.add('active');
    await renderRetroStep(1);
}

// ── Stap renderen ─────────────────────────────────────────────────────────────

async function renderRetroStep(step) {
    retroCurrentStep = step;
    const content  = document.getElementById('retroContent');
    const backBtn  = document.getElementById('retroBack');
    const nextBtn  = document.getElementById('retroNext');
    const stepsBar = document.getElementById('retroStepsBar');

    stepsBar.querySelectorAll('.retro-step-dot').forEach(d => {
        const s = parseInt(d.dataset.s);
        d.classList.toggle('active', s === step);
        d.classList.toggle('done',   s < step);
    });

    backBtn.style.display = step > 1 ? '' : 'none';
    nextBtn.style.display = step < 3 ? '' : 'none';
    nextBtn.disabled      = false;

    content.innerHTML = '<div class="loading"><div class="loader"></div></div>';

    if (step === 1) await renderRetroStep1(content);
    if (step === 2) renderRetroStep2(content);
    if (step === 3) renderRetroStep3(content);
}

// ── Navigatie ─────────────────────────────────────────────────────────────────

async function retroNav(dir) {
    const next = retroCurrentStep + dir;
    if (next < 1 || next > 3) return;
    if (retroCurrentStep === 1 && dir === 1) {
        const modal   = document.getElementById('retroModal');
        const checked = modal.querySelectorAll('.retro-avail-cb:checked');
        retroSelectedUids = new Set(Array.from(checked).map(cb => cb.value));
    }
    await renderRetroStep(next);
}

// ── Stap 1: Aanwezigen ────────────────────────────────────────────────────────

async function renderRetroStep1(content) {
    try {
        const snap = await getDocs(collection(db, 'matches', retroMatch.id, 'availability'));
        retroAvailable = [];
        snap.forEach(d => {
            const data = d.data();
            if (!data.available) return;
            const name = data.displayName || data.naam || d.id;
            retroAvailable.push({ uid: d.id, name, isExternal: !!data.isExternalPlayer });
        });
        retroAvailable.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { console.error('Error loading availability:', e); }

    content.innerHTML = `
        <div class="retro-step-body">
            <p class="retro-step-desc">
                ${retroAvailable.length === 0
                    ? '<strong>Geen beschikbaarheidslijst gevonden.</strong> Voeg spelers handmatig toe.'
                    : `<strong>${retroAvailable.length} beschikbare speler(s)</strong> geladen uit de beschikbaarheidslijst.`}
            </p>
            <div id="retroAvailList" class="retro-avail-list">
                ${retroAvailable.map(p => `
                    <label class="retro-player-row">
                        <input type="checkbox" class="retro-avail-cb" value="${p.uid}" checked>
                        <span>${p.name}${p.isExternal ? ' <em class="retro-extern-badge">extern</em>' : ''}</span>
                    </label>`).join('')}
                ${retroAvailable.length === 0 ? '<p class="retro-empty">Geen spelers. Voeg ze hieronder handmatig toe.</p>' : ''}
            </div>
            <div class="retro-manual-add-row">
                <button class="action-btn" id="retroToggleManualAdd">+ Speler handmatig toevoegen</button>
                <div id="retroManualAddForm" style="display:none;gap:0.5rem;flex-wrap:wrap;">
                    <input type="text" id="retroManualName" class="modal-input-manual" placeholder="Naam speler" style="flex:1;min-width:160px;">
                    <button class="action-btn edit" id="retroManualAddBtn">Toevoegen</button>
                </div>
            </div>
        </div>`;

    content.querySelector('#retroToggleManualAdd').addEventListener('click', () => {
        const f = content.querySelector('#retroManualAddForm');
        f.style.display = f.style.display === 'none' ? 'flex' : 'none';
    });
    content.querySelector('#retroManualAddBtn').addEventListener('click', () => {
        const input = content.querySelector('#retroManualName');
        const name  = input.value.trim();
        if (!name) return;
        const safe = name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
        const uid  = `manual_${safe}_${Date.now()}`;
        retroAvailable.push({ uid, name, isExternal: true });
        const list = content.querySelector('#retroAvailList');
        list.querySelector('.retro-empty')?.remove();
        const row = document.createElement('label');
        row.className = 'retro-player-row';
        row.innerHTML = `<input type="checkbox" class="retro-avail-cb" value="${uid}" checked>
            <span>${name} <em class="retro-extern-badge">handmatig</em></span>`;
        list.appendChild(row);
        input.value = '';
    });
}

// ── Stap 2: Opstelling ────────────────────────────────────────────────────────

function renderRetroStep2(content) {
    const players = retroAvailable.filter(p => retroSelectedUids.has(p.uid));
    if (retroStarters.size === 0 && retroBench.size === 0 && retroMatch.lineupDraft) {
        Object.entries(retroMatch.lineupDraft).forEach(([uid, info]) => {
            if (players.find(p => p.uid === uid)) {
                if (info.status === 'starter') retroStarters.add(uid);
                else if (info.status === 'bench') retroBench.add(uid);
            }
        });
    }
    const MAX_START = 11, MAX_BENCH = 5;

    content.innerHTML = `
        <div class="retro-step-body">
            <p class="retro-step-desc">Klik een speler om hem van <em>Aanwezig</em> naar <strong>Basis</strong> of <strong>Bank</strong> te sturen. Klik opnieuw om terug te plaatsen. Basis = exact 11 spelers.</p>
            <div style="margin-bottom:0.5rem;">
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;">
                    <span style="font-size:0.8rem;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.04em;">👥 Aanwezig</span>
                    <span class="retro-lineup-badge retro-badge--gray" id="retroAvailCount">0</span>
                </div>
                <div id="retroAvailChips" class="retro-avail-chips"></div>
            </div>
            <div class="retro-2col-grid">
                <div class="retro-lineup-col retro-col--start">
                    <div class="retro-lineup-col-hdr">
                        <span>⚽ Basis</span>
                        <span class="retro-lineup-badge retro-badge--blue" id="retroStartCount">0</span>
                        <span class="retro-lineup-max">/11</span>
                    </div>
                    <div id="retroStartColList" class="retro-lineup-list"></div>
                    <p class="retro-lineup-sub">Klik speler om te verplaatsen</p>
                </div>
                <div class="retro-lineup-col retro-col--bench">
                    <div class="retro-lineup-col-hdr">
                        <span>🔄 Bank</span>
                        <span class="retro-lineup-badge retro-badge--orange" id="retroBenchCount">0</span>
                        <span class="retro-lineup-max">/5</span>
                    </div>
                    <div id="retroBenchColList" class="retro-lineup-list"></div>
                    <p class="retro-lineup-sub">Klik speler om terug te plaatsen</p>
                </div>
            </div>
            <div class="retro-lineup-hint" id="retroLineupHint"></div>
        </div>`;

    function refresh() {
        const chipsEl   = document.getElementById('retroAvailChips');
        const startList = document.getElementById('retroStartColList');
        const benchList = document.getElementById('retroBenchColList');
        const hintEl    = document.getElementById('retroLineupHint');
        const nextBtn   = document.getElementById('retroNext');
        if (!chipsEl) return;
        [chipsEl, startList, benchList].forEach(l => l.innerHTML = '');
        const sc = retroStarters.size, bc = retroBench.size;
        const valid = sc === MAX_START;
        document.getElementById('retroAvailCount').textContent = players.length - sc - bc;
        document.getElementById('retroStartCount').textContent = sc;
        document.getElementById('retroBenchCount').textContent = bc;
        if (nextBtn) { nextBtn.disabled = !valid; nextBtn.textContent = valid ? 'Volgende →' : `Volgende (${sc}/11 basis)`; }
        if (hintEl) {
            hintEl.textContent = valid
                ? (bc === 0 ? '✓ Basis volledig. Voeg optioneel wisselspelers toe.' : `✓ Klaar — ${sc} basis, ${bc} wissel${bc!==1?'s':''}. `)
                : `Nog ${MAX_START - sc} basisspeler${MAX_START-sc!==1?'s':''} nodig.`;
            hintEl.style.color = valid ? '#28a745' : '#e65100';
        }
        if (sc === 0) { const e=document.createElement('p'); e.className='retro-empty'; e.textContent='Nog geen basisspelers'; startList.appendChild(e); }
        if (bc === 0) { const e=document.createElement('p'); e.className='retro-empty'; e.textContent='Nog geen wisselspelers'; benchList.appendChild(e); }
        players.forEach(p => {
            const isStart = retroStarters.has(p.uid), isBench = retroBench.has(p.uid);
            const btn = document.createElement('button');
            btn.textContent = p.name;
            btn.className = 'retro-player-pill ' + (isStart ? 'pill--start' : isBench ? 'pill--bench' : 'pill--avail');
            btn.title = isStart ? 'Klik: naar bank of terug' : isBench ? 'Klik: terug naar aanwezig' : sc < MAX_START ? 'Klik: naar basis' : 'Klik: naar bank';
            if (isStart) startList.appendChild(btn);
            else if (isBench) benchList.appendChild(btn);
            else chipsEl.appendChild(btn);
            btn.addEventListener('click', () => {
                if (isStart)      { retroStarters.delete(p.uid); if (retroBench.size < MAX_BENCH) retroBench.add(p.uid); }
                else if (isBench) { retroBench.delete(p.uid); }
                else              { if (retroStarters.size < MAX_START) retroStarters.add(p.uid); else if (retroBench.size < MAX_BENCH) retroBench.add(p.uid); }
                refresh();
            });
        });
        const noAvail = players.filter(p => !retroStarters.has(p.uid) && !retroBench.has(p.uid)).length === 0;
        if (noAvail && players.length > 0) { const e=document.createElement('p'); e.className='retro-empty'; e.style.fontSize='0.8rem'; e.textContent='Alle spelers zijn ingedeeld'; chipsEl.appendChild(e); }
    }
    refresh();
}

// ── Stap 3: Tijdslijn ─────────────────────────────────────────────────────────

function renderRetroStep3(content) {
    const hd  = retroHalfDur(), fd = retroFullDur();
    const vvs = retroVvsSide(), oppSide = vvs === 'home' ? 'away' : 'home';
    const allLineuped = retroAvailable.filter(p => retroStarters.has(p.uid) || retroBench.has(p.uid));

    function playerOpts(empty = '— Selecteer speler —') {
        return `<option value="">${empty}</option>` +
            allLineuped.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    }

    function refreshEventsList() {
        const list = document.getElementById('retroEventsList');
        if (!list) return;
        if (retroEvents.length === 0) {
            list.innerHTML = '<p class="retro-empty">Nog geen events. Gebruik het formulier hierboven.</p>';
            return;
        }
        const TYPE_LABELS = {
            goal:'⚽ Goal', penalty:'⚽ Penalty', 'penalty-missed':'❌ Penalty gemist',
            'own-goal':'↩️ Eigen doel', yellow:'🟡 Gele kaart',
            yellow2red:'🟥 2e Gele/Rood', red:'🔴 Rode kaart', substitution:'🔄 Wissel'
        };
        const sorted = [...retroEvents].map((ev,i) => ({...ev,i}))
            .sort((a,b) => effectiveMin(a.parsed) - effectiveMin(b.parsed));
        list.innerHTML = sorted.map(ev => {
            let detail = ev.speler || '';
            if (ev.assist) detail += ` (assist: ${ev.assist})`;
            if (ev.spelersUit?.length) detail = `Uit: ${ev.spelersUit.join(', ')} → In: ${ev.spelersIn?.join(', ')||'—'}`;
            const sideLabel = ev.ploeg === vvs
                ? `<span class="retro-ev-vvs">VVS</span>`
                : `<span class="retro-ev-opp">Teg.</span>`;
            const minLabel = ev.parsed.extra > 0
                ? `${ev.parsed.min}+${ev.parsed.extra}'`
                : `${ev.parsed.min}'`;
            return `<div class="retro-event-row">
                <span class="retro-event-min">${minLabel} <small>(${halvesLabel(ev.half)})</small></span>
                ${sideLabel}
                <span class="retro-event-type">${TYPE_LABELS[ev.type]||ev.type}</span>
                <span class="retro-event-detail">${detail}</span>
                <button class="retro-delete-event" data-idx="${ev.i}">✕</button>
            </div>`;
        }).join('');
        list.querySelectorAll('.retro-delete-event').forEach(btn => {
            btn.addEventListener('click', () => {
                retroEvents.splice(parseInt(btn.dataset.idx), 1);
                refreshEventsList();
                document.getElementById('retroEventsCount').textContent = retroEvents.length;
            });
        });
    }

    content.innerHTML = `
        <div class="retro-step-body retro-timeline-body">
            <p class="retro-step-desc">Voeg wedstrijdevents toe. <em>Aftrap (0'), rust (${hd}') en einde (${fd}') worden automatisch aangemaakt bij opslaan.</em></p>

            <div class="retro-minuut-info">
                <div class="rmi-header">
                    <span class="rmi-icon">📋</span>
                    <span class="rmi-title">Minuut invoeren</span>
                </div>
                <div class="rmi-rows">
                    <div class="rmi-row rmi-row--normal">
                        <span class="rmi-badge">1e / 2e helft</span>
                        <span class="rmi-desc">Gewone minuut, bijv.</span>
                        <code class="rmi-code">${Math.round(fd * 0.75)}</code>
                        <span class="rmi-arrow">→</span>
                        <span class="rmi-result">${Math.round(fd * 0.75)}e minuut, 2e helft</span>
                    </div>
                    <div class="rmi-row rmi-row--extra">
                        <span class="rmi-badge">Extra tijd 1e</span>
                        <span class="rmi-desc">Plus-notatie, bijv.</span>
                        <code class="rmi-code">${hd}+2</code>
                        <span class="rmi-arrow">→</span>
                        <span class="rmi-result">Nog in de 1e helft</span>
                    </div>
                    <div class="rmi-row rmi-row--extra">
                        <span class="rmi-badge">Extra tijd 2e</span>
                        <span class="rmi-desc">Plus-notatie, bijv.</span>
                        <code class="rmi-code">${fd}+3</code>
                        <span class="rmi-arrow">→</span>
                        <span class="rmi-result">Nog in de 2e helft</span>
                    </div>
                    <div class="rmi-row rmi-row--vt">
                        <span class="rmi-badge">Verlengingen</span>
                        <span class="rmi-desc">Gewone minuut, bijv.</span>
                        <code class="rmi-code">${fd + 3}</code>
                        <span class="rmi-arrow">→</span>
                        <span class="rmi-result">Automatisch VT</span>
                    </div>
                </div>
            </div>

            <div class="retro-add-event-form">
                <div class="retro-form-row">
                    <div class="form-group" style="flex:2;min-width:140px;">
                        <label>Type *</label>
                        <select id="retroEvType">
                            <option value="goal">⚽ Goal</option>
                            <option value="penalty">⚽ Penalty</option>
                            <option value="penalty-missed">❌ Penalty gemist</option>
                            <option value="own-goal">↩️ Eigen doelpunt</option>
                            <option value="yellow">🟡 Gele kaart</option>
                            <option value="yellow2red">🟥 2e Gele / Rood</option>
                            <option value="red">🔴 Rode kaart</option>
                            <option value="substitution">🔄 Wissel</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex:0 0 110px;">
                        <label>Minuut *</label>
                        <input type="text" id="retroEvMin" placeholder="bijv. 45+2" autocomplete="off">
                    </div>
                    <div class="form-group" style="flex:2;min-width:140px;">
                        <label>Ploeg *</label>
                        <select id="retroEvPloeg">
                            <option value="${vvs}">${vvs === 'home' ? retroMatch.thuisploeg : retroMatch.uitploeg} (VVS)</option>
                            <option value="${oppSide}">${oppSide === 'home' ? retroMatch.thuisploeg : retroMatch.uitploeg} (Teg.)</option>
                        </select>
                    </div>
                </div>
                <div id="retroEvSingle">
                    <div class="form-group">
                        <label>Speler</label>
                        <select id="retroEvSpeler">${playerOpts()}</select>
                        <input type="text" id="retroEvSpelerMan" class="modal-input-manual" placeholder="Of typ naam handmatig…">
                    </div>
                    <div class="form-group" id="retroEvAssistGroup">
                        <label>Assist (optioneel)</label>
                        <select id="retroEvAssist">${playerOpts('— Geen assist —')}</select>
                        <input type="text" id="retroEvAssistMan" class="modal-input-manual" placeholder="Of typ naam…">
                    </div>
                </div>
                <div id="retroEvSub" style="display:none;">
                    <div class="form-group">
                        <label>Speler UIT</label>
                        <select id="retroEvSubOut">${playerOpts('— Speler uit —')}</select>
                        <input type="text" id="retroEvSubOutMan" class="modal-input-manual" placeholder="Of typ naam handmatig…">
                    </div>
                    <div class="form-group">
                        <label>Speler IN</label>
                        <select id="retroEvSubIn">${playerOpts('— Speler in —')}</select>
                        <input type="text" id="retroEvSubInMan" class="modal-input-manual" placeholder="Of typ naam handmatig…">
                    </div>
                </div>
                <div id="retroEvMinFeedback" class="retro-min-feedback" style="display:none;"></div>
                <button class="action-btn edit" id="retroAddEventBtn" style="margin-top:0.5rem;">+ Event toevoegen</button>
            </div>

            <hr style="margin:1rem 0;border:none;border-top:1px solid var(--border-color,#e9ecef);">
            <h4 style="margin-bottom:0.5rem;">Toegevoegde events (<span id="retroEventsCount">0</span>)</h4>
            <div id="retroEventsList"></div>

            <div class="retro-finalize-section">
                <p style="color:var(--text-gray);font-size:0.85rem;margin-bottom:0.75rem;">
                    Slaat de <strong>opstelling</strong> en <strong>tijdslijn</strong> op — identiek aan een live wedstrijd.
                </p>
                <button class="modal-btn confirm" id="retroFinalizeBtn">💾 Opslaan in database</button>
            </div>
        </div>`;

    const evType    = content.querySelector('#retroEvType');
    const ploegSel  = content.querySelector('#retroEvPloeg');
    const singleSec = content.querySelector('#retroEvSingle');
    const subSec    = content.querySelector('#retroEvSub');
    const assistGrp = content.querySelector('#retroEvAssistGroup');
    const spelerSel = content.querySelector('#retroEvSpeler');
    const minInput  = content.querySelector('#retroEvMin');
    const feedback  = content.querySelector('#retroEvMinFeedback');

    function updateFormLayout() {
        const t = evType.value, isVvs = ploegSel.value === vvs, isSub = t === 'substitution';
        const hasAssist = t === 'goal' || t === 'penalty';

        if (isSub) {
            singleSec.style.display = 'none';
            subSec.style.display    = '';
            // Wissel: VVS = select+handmatig, tegenstander = enkel handmatig
            const subOutSel = content.querySelector('#retroEvSubOut');
            const subInSel  = content.querySelector('#retroEvSubIn');
            const subOutMan = content.querySelector('#retroEvSubOutMan');
            const subInMan  = content.querySelector('#retroEvSubInMan');
            if (subOutSel) subOutSel.style.display = isVvs ? '' : 'none';
            if (subInSel)  subInSel.style.display  = isVvs ? '' : 'none';
            if (subOutMan) subOutMan.placeholder    = isVvs ? 'Of typ naam handmatig…' : 'Naam speler (handmatig)';
            if (subInMan)  subInMan.placeholder     = isVvs ? 'Of typ naam handmatig…' : 'Naam speler (handmatig)';
        } else {
            singleSec.style.display = '';
            subSec.style.display    = 'none';
            // Speler: VVS = select+handmatig, tegenstander = enkel handmatig tekstveld
            spelerSel.style.display = isVvs ? '' : 'none';
            // Assist: enkel tonen bij goal/penalty EN enkel VVS (tegenstander heeft nooit assist-select)
            assistGrp.style.display = hasAssist ? '' : 'none';
            if (hasAssist) {
                const assistSel = content.querySelector('#retroEvAssist');
                const assistMan = content.querySelector('#retroEvAssistMan');
                if (assistSel) assistSel.style.display = isVvs ? '' : 'none';
                if (assistMan) assistMan.placeholder    = isVvs ? 'Of typ naam…' : 'Naam speler (handmatig)';
            }
        }
    }
    evType.addEventListener('change', updateFormLayout);
    ploegSel.addEventListener('change', updateFormLayout);
    updateFormLayout();

    // Live minuut-feedback
    minInput.addEventListener('input', () => {
        const parsed = parseMinuut(minInput.value);
        if (!parsed) { feedback.style.display = 'none'; return; }
        const half = calcHalfFromParsed(parsed);
        const effMin = effectiveMin(parsed);
        const halfLabel = halvesLabel(half);
        let msg, cls;
        if (parsed.extra > 0) {
            msg = `→ Extra tijd: minuut ${parsed.min}+${parsed.extra}' valt in de <strong>${halfLabel}</strong> (effectief: ${effMin}')`;
            cls = 'retro-min-feedback--info';
        } else if (half >= 3) {
            msg = `→ Verlengingen: minuut ${parsed.min}' valt in de <strong>${halfLabel}</strong>`;
            cls = 'retro-min-feedback--vt';
        } else {
            msg = `→ Minuut ${parsed.min}' — <strong>${halfLabel}</strong>`;
            cls = 'retro-min-feedback--ok';
        }
        feedback.innerHTML = msg;
        feedback.className = `retro-min-feedback ${cls}`;
        feedback.style.display = '';
    });

    const getVal = (selId, manId) => {
        const sel = content.querySelector('#'+selId), man = content.querySelector('#'+manId);
        return (sel?.value) || (man?.value.trim() || '');
    };

    content.querySelector('#retroAddEventBtn').addEventListener('click', () => {
        const type   = evType.value;
        const parsed = parseMinuut(minInput.value);
        if (!parsed) { showToast('Voer een geldige minuut in (bijv. 67 of 45+2).', 'error'); return; }
        const half   = calcHalfFromParsed(parsed);
        const minuut = effectiveMin(parsed);
        const ploeg  = ploegSel.value;
        const isVvs  = ploeg === vvs;

        if (type === 'substitution') {
            const spelerUit = getVal('retroEvSubOut','retroEvSubOutMan');
            const spelerIn  = getVal('retroEvSubIn','retroEvSubInMan');
            retroEvents.push({ type:'substitution', minuut, half, ploeg, speler:'',
                spelerUit, spelerIn, spelersUit: spelerUit?[spelerUit]:[], spelersIn: spelerIn?[spelerIn]:[], multiSub:false, parsed });
        } else {
            const speler = isVvs ? getVal('retroEvSpeler','retroEvSpelerMan') : (content.querySelector('#retroEvSpelerMan')?.value.trim()||'');
            const assist = (type==='goal'||type==='penalty') ? (isVvs ? getVal('retroEvAssist','retroEvAssistMan') : '') : '';
            const ev = { type, minuut, half, ploeg, speler, parsed };
            if (assist) ev.assist = assist;
            retroEvents.push(ev);
        }

        refreshEventsList();
        document.getElementById('retroEventsCount').textContent = retroEvents.length;
        ['retroEvMin','retroEvSpelerMan','retroEvAssistMan','retroEvSubOutMan','retroEvSubInMan'].forEach(id => { const el=content.querySelector('#'+id); if(el) el.value=''; });
        ['retroEvSpeler','retroEvAssist','retroEvSubOut','retroEvSubIn'].forEach(id => { const el=content.querySelector('#'+id); if(el) el.value=''; });
        feedback.style.display = 'none';
    });

    refreshEventsList();
    document.getElementById('retroNext').style.display = 'none';
    content.querySelector('#retroFinalizeBtn').addEventListener('click', retroFinalize);
}

// ── Finaliseren ───────────────────────────────────────────────────────────────

async function retroFinalize() {
    const btn = document.getElementById('retroFinalizeBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }
    try {
        const matchId  = retroMatch.id;
        const matchRef = doc(db, 'matches', matchId);
        const hd = retroHalfDur(), fd = retroFullDur();

        // lineupDraft
        const lineupDraft = {};
        retroAvailable.forEach(p => {
            let status = 'niet_geselecteerd';
            if (retroStarters.has(p.uid)) status = 'starter';
            else if (retroBench.has(p.uid)) status = 'bench';
            lineupDraft[p.uid] = { name: p.name, status };
        });
        const lineup = Object.fromEntries(Object.entries(lineupDraft).map(([uid,v]) => [uid,{...v}]));

        const matchDT   = new Date(`${retroMatch.datum}T${retroMatch.uur}`);
        const startedAt = Timestamp.fromDate(matchDT);
        const resumeAt  = Timestamp.fromDate(new Date(matchDT.getTime() + hd * 60000));

        const hasET    = retroEvents.some(e => e.half >= 3);
        const has2ndET = retroEvents.some(e => e.half === 4);

        await updateDoc(matchRef, {
            lineupDraft, lineupDraftConfirmed: true, lineupConfirmed: true, lineup,
            startedAt, resumeStartedAt: resumeAt,
            phase: has2ndET ? 4 : (hasET ? 3 : 2),
            halfTimeReached: true, extraTimeStarted: hasET, etHalfTimeReached: has2ndET, pausedAt: null,
        });

        // playerMinutes voor basisspelers
        await Promise.all(Object.entries(lineup)
            .filter(([uid,info]) => !uid.startsWith('manual_') && info.status === 'starter')
            .map(([uid,info]) => setDoc(doc(db,'matches',matchId,'playerMinutes',uid),
                { uid, name: info.name, minuteOn: 0, minuteOff: null, totalMinutes: fd })));

        // Verwijder bestaande events
        const existSnap = await getDocs(query(collection(db,'events'), where('matchId','==',matchId)));
        await Promise.all(existSnap.docs.map(d => deleteDoc(d.ref)));

        // Bouw events array (exact live.js formaat)
        const allEvDocs = [
            { matchId, minuut: 0,  half: 1, type: 'aftrap', ploeg: 'center', speler: '' },
            { matchId, minuut: hd, half: 1, type: 'rust',   ploeg: 'center', speler: '' },
        ];
        retroEvents.forEach(ev => {
            const evDoc = { matchId, minuut: ev.minuut, half: ev.half, type: ev.type, ploeg: ev.ploeg, speler: ev.speler||'' };
            if (ev.assist)     evDoc.assist     = ev.assist;
            if (ev.spelerUit)  evDoc.spelerUit  = ev.spelerUit;
            if (ev.spelerIn)   evDoc.spelerIn   = ev.spelerIn;
            if (ev.spelersUit) evDoc.spelersUit = ev.spelersUit;
            if (ev.spelersIn)  evDoc.spelersIn  = ev.spelersIn;
            if (ev.multiSub !== undefined) evDoc.multiSub = ev.multiSub;
            allEvDocs.push(evDoc);
        });
        if (hasET) {
            allEvDocs.push({ matchId, minuut: fd,      half: 2, type: 'einde-regulier', ploeg: 'center', speler: '' });
            allEvDocs.push({ matchId, minuut: fd + 15, half: 3, type: 'rust',           ploeg: 'center', speler: '' });
        }
        allEvDocs.push({
            matchId, ploeg: 'center', speler: '',
            minuut: has2ndET ? fd+30 : (hasET ? fd+15 : fd),
            half:   has2ndET ? 4      : (hasET ? 3      : 2),
            type:  'einde',
        });

        await Promise.all(allEvDocs.map(ev => addDoc(collection(db,'events'), {...ev, timestamp: serverTimestamp()})));

        showToast('✅ Opstelling en tijdslijn opgeslagen!', 'success');
        document.getElementById('retroModal').classList.remove('active');
        await loadMatches();
    } catch(e) {
        console.error('retroFinalize error:', e);
        showToast('Fout bij opslaan: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '💾 Opslaan in database'; }
    }
}
// ===============================================
// ADMIN TOUR / RONDLEIDING  (spotlight versie)
// Pagina 1 van 2. Vervolg op admin2.html?tour=1
// ===============================================

const TOUR_KEY = 'vvs_admin_tour_v2';

// Helper: open evenement-modal programmatisch (voor tour stap)
function _tourOpenEvenementModal() {
    const btn = document.getElementById('addEvenementBtn');
    if (btn) btn.click();          // triggert de bestaande listener die reset + opent
}
function _tourCloseEvenementModal() {
    const cancel = document.getElementById('evenementModalCancel');
    if (cancel) cancel.click();
}
function _tourEnableInschrijvingen() {
    const cb = document.getElementById('evenementInschrijvingen');
    const opties = document.getElementById('inschrijfOpties');
    if (cb && !cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));   // toont #inschrijfOpties
    }
    if (opties) opties.style.display = '';
}

const TOUR_STEPS = [
    // ── 0: Welkom ─────────────────────────────────────────────────────────
    {
        icon: '👋',
        title: 'Welkom bij de Admin rondleiding!',
        desc:  'In deze gids overlopen we samen alle onderdelen van het beheerpaneel. Gebruik de pijltoetsen of de knoppen om te navigeren. Via de <strong>"Gids"</strong> knop kan je de rondleiding altijd opnieuw starten.',
        tab: null, target: null,
    },

    // ── LEDEN ─────────────────────────────────────────────────────────────
    {
        icon: '', title: 'Leden',
        desc: 'De Leden-tab is je startpunt voor ledenbeheer. Hier zie je alle clubleden in één overzicht.',
        tab: 'members', target: '.tab-btn[data-tab="members"]',
    },
    {
        icon: '', title: 'Aanvragen behandelen',
        desc: 'Nieuwe leden kunnen een account aanvragen via de website. Die aanvragen verschijnen hier. Je kan ze <strong>goedkeuren</strong> (account wordt aangemaakt) of <strong>weigeren</strong>. Het oranje bolletje toont het aantal wachtende aanvragen.',
        tab: 'members', target: '#manageRequestsBtn',
    },
    {
        icon: '', title: 'Nieuw lid toevoegen',
        desc: 'Maak handmatig een nieuw account aan. Handig voor leden die geen accountaanvraag via de website kunnen indienen.',
        tab: 'members', target: '#addMemberBtn',
    },
    {
        icon: '', title: 'Tijdelijk account',
        desc: 'Maak een account aan met een specifieke geldigheidsperiode. Het account vervalt automatisch na de ingestelde einddatum — ideaal voor evenementen of tijdelijke helpers.',
        tab: 'members', target: '#addTempAccountBtn',
    },
    {
        icon: '', title: 'Ledenzoekbalk',
        desc: 'Zoek snel op naam, e-mailadres of ploeg. De lijst filtert live terwijl je typt. Klik het kruisje om de zoekterm te wissen.',
        tab: 'members', target: '.member-search-wrap',
    },
    {
        icon: '', title: 'Spelerkaart',
        desc: 'Elk account heeft een profiel met naam, ploeg en rol. Klik <strong>Bewerken</strong> om gegevens aan te passen of <strong>Verwijderen</strong> om een account te wissen.',
        tab: 'members', target: '#membersList .member-card',
    },

    // ── WEDSTRIJDEN ───────────────────────────────────────────────────────
    {
        icon: '', title: 'Wedstrijden',
        desc: 'Beheer alle wedstrijden van de club. Voeg nieuwe wedstrijden toe, werk resultaten bij of registreer de opstelling.',
        tab: 'matches', target: '.tab-btn[data-tab="matches"]',
    },
    {
        icon: '', title: 'Nieuwe wedstrijd toevoegen',
        desc: 'Maak een nieuwe wedstrijd aan met datum, tegenstander, thuis/uit en ploeg. Wanneer een wedstrijd niet live gevolgd werd kan je het resultaat, de opstelling en tijdslijn handmatig invoeren.',
        tab: 'matches', target: '#addMatchBtn',
    },
    {
        icon: '', title: 'Wedstrijdkaart',
        desc: 'Elke wedstrijd toont ploegen, datum, locatie en score. Geplande wedstrijden hebben een <strong>Bewerken</strong>-knop. Afgelopen wedstrijden (die niet live gevolgd werden) tonen een <strong>Tijdslijn invoeren</strong>-knop om opstelling en gebeurtenissen in te geven.',
        tab: 'matches', target: '#matchesList .match-card',
    },

    // ── RANGSCHIKKING ─────────────────────────────────────────────────────
    {
        icon: '', title: 'Rangschikking',
        desc: 'Werk het klassement bij via drie methodes: plak de volledige tabel van de RBFA-website, voer een matchresultaat manueel in, of bekijk het huidig opgeslagen klassement.',
        tab: 'ranking', target: '.tab-btn[data-tab="ranking"]',
    },
    {
        icon: '', title: 'Subtabs rangschikking',
        desc: '<strong>Volledig plakken:</strong> kopieer de tabel van de RBFA-website en plak ze hier. <strong>Matchresultaat:</strong> voer één resultaat in om de stand te herberekenen. <strong>Huidig klassement:</strong> bekijk de opgeslagen stand.',
        tab: 'ranking', target: '.ranking-subtabs',
    },

    // ── EVENEMENTEN ───────────────────────────────────────────────────────
    {
        icon: '', title: 'Evenementen',
        desc: 'Maak clubevenementen aan met datum, locatie en omschrijving. Evenementen verschijnen op de publieke evenementenpagina en in de clubkalender.',
        tab: 'evenementen', target: '.tab-btn[data-tab="evenementen"]',
    },
    {
        icon: '', title: 'Nieuw evenement aanmaken',
        desc: 'Klik hier om een nieuw evenement aan te maken. Je vult naam, datum, locatie en beschrijving in. Hieronder zoomen we in op de inschrijvingsopties onderaan het formulier.',
        tab: 'evenementen', target: '#addEvenementBtn',
    },
    {
        icon: '', title: 'Inschrijvingen inschakelen',
        desc: 'Met de toggle geef je ingelogde leden de optie zich inschrijven voor het evenement. Eenmaal ingeschakeld verschijnen extra opties: een maximum aantal deelnemers (leeg = onbeperkt) en een beschrijving die getoond wordt in het inschrijfvenster van de spelers.',
        tab: 'evenementen', target: '#evenementInschrijvingen',
        onEnter() { _tourOpenEvenementModal(); },
        onLeave() { /* modal blijft open voor volgende stap */ },
    },
    {
        icon: '', title: 'Extra velden',
        desc: 'Via <strong>"+ Veld toevoegen"</strong> voeg je extra vragen toe aan het inschrijfformulier. Ideaal voor bijhorende vragen, zoals: "Neem je vrienden/familie mee?".',
        tab: 'evenementen', target: '#addExtraVeldBtn',
        onEnter() { _tourEnableInschrijvingen(); },
        onLeave() { _tourCloseEvenementModal(); },
    },

    // ── CONTACTBERICHTEN ──────────────────────────────────────────────────
    {
        icon: '', title: 'Contactberichten',
        desc: 'Alle berichten ingediend via het contactformulier op de website komen hier binnen. Markeer berichten als gelezen of verwijder ze. Het bolletje toont het aantal ongelezen berichten.',
        tab: 'contactberichten', target: '.tab-btn[data-tab="contactberichten"]',
    },

    // ── AANKONDIGINGEN ────────────────────────────────────────────────────
    {
        icon: '', title: 'Aankondigingsbanner',
        desc: 'Hier pas je de <strong>horizontale tekstbalk bovenaan de homepagina</strong> aan. Kies een icoon en typ een korte boodschap — bv. "Bier van de maand: ...". De preview toont meteen hoe de banner er op de website uitziet.',
        tab: 'announcements', target: '.tab-btn[data-tab="announcements"]',
    },

    // ── NAAR PAGINA 2 ─────────────────────────────────────────────────────
    {
        icon: '➡️', title: 'Verder naar pagina 2',
        desc: 'Pagina 1 zit erop! Klik op <strong>Volgende</strong> om door te gaan naar de tweede adminpagina, waar we werklijsten, training, sponsors, galerij en meldingen bekijken.',
        tab: null, target: null,
        isRedirect: true,          // speciale vlag: volgende-knop redirect naar admin2
        redirectTo: 'admin2.html',
    },
];

// ── State ──────────────────────────────────────────────────────────────────
let tourStep = 0;
let _tourResizeHandler = null;

// ── Helpers ────────────────────────────────────────────────────────────────
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function switchToTab(tabName) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn && !btn.classList.contains('active')) btn.click();
}

function getTargetEl(selector) {
    if (!selector) return null;
    try {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return el;
    } catch (e) { return null; }
}

// ── Spotlight positioning ──────────────────────────────────────────────────
const SPOT_PAD = 8;
const CARD_GAP = 14;
const CARD_W   = 360;

function _applySpotlight(el) {
    const spot = document.getElementById('tourSpotlight');
    if (!spot || !el) return;
    const r = el.getBoundingClientRect();
    spot.style.top    = (r.top    - SPOT_PAD) + 'px';
    spot.style.left   = (r.left   - SPOT_PAD) + 'px';
    spot.style.width  = (r.width  + SPOT_PAD * 2) + 'px';
    spot.style.height = (r.height + SPOT_PAD * 2) + 'px';
    spot.style.boxShadow =
        '0 0 0 9999px rgba(0,0,0,0.50),' +
        '0 0 0 2.5px var(--primary-blue, #0047AB),' +
        '0 0 12px 4px rgba(0,71,171,0.25)';
    spot.style.display = 'block';
}

function _positionCard(el) {
    const card = document.getElementById('adminTourCard');
    if (!card || !el) return;
    const r  = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = Math.min(CARD_W, vw - 32);
    const cardH = card.offsetHeight || 260;
    const spotT = r.top    - SPOT_PAD;
    const spotB = r.bottom + SPOT_PAD;
    const spotL = r.left   - SPOT_PAD;
    const spotR = r.right  + SPOT_PAD;

    let pos = 'bottom';
    if (spotB + cardH + CARD_GAP + 16 > vh && spotT - cardH - CARD_GAP - 16 >= 0) pos = 'top';
    else if (spotB + cardH + CARD_GAP + 16 > vh && spotR + cardW + CARD_GAP + 16 <= vw) pos = 'right';

    const cx = r.left + r.width  / 2;
    const cy = r.top  + r.height / 2;
    let top, left;
    if (pos === 'bottom')      { top = spotB + CARD_GAP; left = _clamp(cx - cardW/2, 16, vw-cardW-16); }
    else if (pos === 'top')    { top = spotT - CARD_GAP - cardH; left = _clamp(cx - cardW/2, 16, vw-cardW-16); }
    else                       { top = _clamp(cy - cardH/2, 16, vh-cardH-16); left = spotR + CARD_GAP; }

    top = _clamp(top, 16, vh - cardH - 16);
    card.style.position  = 'fixed';
    card.style.top       = top + 'px';
    card.style.left      = left + 'px';
    card.style.width     = cardW + 'px';
    card.style.maxWidth  = cardW + 'px';
    card.style.transform = 'none';
    card.style.display   = 'block';
}

function _centerCard() {
    const card = document.getElementById('adminTourCard');
    if (!card) return;
    card.style.position  = 'fixed';
    card.style.top       = '50%';
    card.style.left      = '50%';
    card.style.width     = 'min(440px, calc(100vw - 2rem))';
    card.style.maxWidth  = '';
    card.style.transform = 'translate(-50%, -50%)';
    card.style.display   = 'block';
}

// ── Tour rendering ─────────────────────────────────────────────────────────
function buildTourDots() {
    const c = document.getElementById('tourProgress');
    if (!c) return;
    c.innerHTML = '';
    TOUR_STEPS.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'tour-dot'
            + (i < tourStep  ? ' done'   : '')
            + (i === tourStep ? ' active' : '');
        dot.setAttribute('aria-label', `Stap ${i + 1}`);
        dot.addEventListener('click', () => goToTourStep(i));
        c.appendChild(dot);
    });
}

function _updateNavButtons() {
    const isFirst = tourStep === 0;
    const isLast  = tourStep === TOUR_STEPS.length - 1;
    const step    = TOUR_STEPS[tourStep];
    const isRedirect = !!(step && step.isRedirect);
    const prev    = document.getElementById('tourPrevBtn');
    const next    = document.getElementById('tourNextBtn');
    const finish  = document.getElementById('tourFinishBtn');
    if (prev)   prev.style.display   = isFirst ? 'none' : '';
    // On redirect step: show "Volgende" (which will navigate), hide Klaar
    if (next)   next.style.display   = (isLast && !isRedirect) ? 'none' : '';
    if (finish) finish.style.display = (isLast && !isRedirect) ? ''     : 'none';
}

function renderTourStep() {
    const step = TOUR_STEPS[tourStep];
    if (!step) return;

    document.getElementById('tourStepIcon').textContent  = step.icon  || '';
    document.getElementById('tourStepTitle').textContent = step.title || '';
    document.getElementById('tourStepDesc').innerHTML    = step.desc  || '';
    _updateNavButtons();
    buildTourDots();

    document.querySelectorAll('.tab-btn.tour-tab-highlight')
        .forEach(b => b.classList.remove('tour-tab-highlight'));

    if (step.tab) switchToTab(step.tab);

    const overlay   = document.getElementById('adminTourOverlay');
    const spotlight = document.getElementById('tourSpotlight');

    requestAnimationFrame(() => {
        // Run onEnter callback if present (e.g. open a modal)
        if (step.onEnter) step.onEnter();

        // Wait step.delay ms (or two rAFs) so modal animations can settle
        const _afterDelay = () => {
            const targetEl = getTargetEl(step.target);

            if (targetEl) {
                if (overlay) { overlay.style.background = 'transparent'; overlay.style.display = 'block'; }
                targetEl.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
                requestAnimationFrame(() => {
                    _applySpotlight(targetEl);
                    _positionCard(targetEl);
                    if (step.tab) {
                        const tabBtn = document.querySelector(`.tab-btn[data-tab="${step.tab}"]`);
                        if (tabBtn) tabBtn.classList.add('tour-tab-highlight');
                    }
                    _setupResizeHandler(targetEl);
                });
            } else {
                if (spotlight) spotlight.style.display = 'none';
                if (overlay)  { overlay.style.background = 'rgba(0,0,0,0.50)'; overlay.style.display = 'block'; }
                _centerCard();
                if (step.tab) {
                    const tabBtn = document.querySelector(`.tab-btn[data-tab="${step.tab}"]`);
                    if (tabBtn) tabBtn.classList.add('tour-tab-highlight');
                }
                _setupResizeHandler(null);
            }
        };
        const _delay = step.delay || 0;
        if (_delay > 0) setTimeout(_afterDelay, _delay);
        else requestAnimationFrame(_afterDelay);
    });
}

function _setupResizeHandler(targetEl) {
    if (_tourResizeHandler) window.removeEventListener('resize', _tourResizeHandler);
    if (!targetEl) { _tourResizeHandler = null; return; }
    _tourResizeHandler = () => { _applySpotlight(targetEl); _positionCard(targetEl); };
    window.addEventListener('resize', _tourResizeHandler);
}

// ── Public API ────────────────────────────────────────────────────────────
function goToTourStep(newIndex) {
    const prev = TOUR_STEPS[tourStep];
    if (prev && prev.onLeave) prev.onLeave();
    tourStep = Math.max(0, Math.min(TOUR_STEPS.length - 1, newIndex));
    const cur = TOUR_STEPS[tourStep];
    // Redirect step: clicking "Volgende" sends to admin2 with tour flag
    if (cur && cur.isRedirect && newIndex > tourStep - 1) {
        // we arrived at redirect step normally – just render it
    }
    renderTourStep();
}

function _advanceTour() {
    const cur = TOUR_STEPS[tourStep];
    if (cur && cur.isRedirect) {
        // Persist progress, then navigate
        localStorage.setItem(TOUR_KEY, 'p2');   // "p2" = continue on page 2
        window.location.href = cur.redirectTo + '?tour=1';
        return;
    }
    if (tourStep < TOUR_STEPS.length - 1) goToTourStep(tourStep + 1);
    else closeTour(true);
}

function openTour() {
    tourStep = 0;
    const overlay  = document.getElementById('adminTourOverlay');
    const card     = document.getElementById('adminTourCard');
    const spotlight = document.getElementById('tourSpotlight');
    if (overlay)   overlay.style.display   = 'block';
    if (card)      card.style.display      = 'block';
    if (spotlight) spotlight.style.display = 'none';
    renderTourStep();
}

function closeTour(markDone = true) {
    const cur = TOUR_STEPS[tourStep];
    if (cur && cur.onLeave) cur.onLeave();
    ['adminTourOverlay', 'adminTourCard', 'tourSpotlight'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    document.querySelectorAll('.tab-btn.tour-tab-highlight')
        .forEach(b => b.classList.remove('tour-tab-highlight'));
    if (_tourResizeHandler) { window.removeEventListener('resize', _tourResizeHandler); _tourResizeHandler = null; }
    if (markDone) localStorage.setItem(TOUR_KEY, '1');
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // "Volgende" uses _advanceTour so redirect steps work
    document.getElementById('tourNextBtn')  ?.addEventListener('click', _advanceTour);
    document.getElementById('tourPrevBtn')  ?.addEventListener('click', () => goToTourStep(tourStep - 1));
    document.getElementById('tourFinishBtn')?.addEventListener('click', () => closeTour(true));
    document.getElementById('tourSkipBtn')  ?.addEventListener('click', () => closeTour(true));
    document.getElementById('adminTourBtn') ?.addEventListener('click', openTour);

    document.getElementById('adminTourOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('adminTourOverlay')) closeTour(true);
    });

    document.addEventListener('keydown', e => {
        const card = document.getElementById('adminTourCard');
        if (!card || card.style.display === 'none') return;
        if (e.key === 'ArrowRight' || e.key === 'Enter') _advanceTour();
        if (e.key === 'ArrowLeft') goToTourStep(tourStep - 1);
        if (e.key === 'Escape')    closeTour(true);
    });

    // Auto-show: first visit OR returning from page 2 (shouldn't happen, but safeguard)
    const tourFlag = localStorage.getItem(TOUR_KEY);
    if (!tourFlag) {
        setTimeout(openTour, 900);
    }
    // "p2" flag means tour was in progress going to admin2 – nothing to do on page 1
});