// ============================================
// CONFIGURAZIONE FIREBASE
// ============================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getDatabase, ref, push, onValue, query, orderByChild, limitToLast, update, remove, get } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js';

const firebaseConfig = {
    apiKey: "AIzaSyCVI_TP1LaLIUDc3QLaJtapvoeZ7mOFqcI",
    authDomain: "suggerimenticatalogo.firebaseapp.com",
    databaseURL: "https://suggerimenticatalogo-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "suggerimenticatalogo",
    storageBucket: "suggerimenticatalogo.firebasestorage.app",
    messagingSenderId: "331103414090",
    appId: "1:331103414090:web:f387d3033a8c5ed9ffc3b3",
    measurementId: "G-LNZ45LZE6N"
};

// ============================================
// PASSWORD ADMIN (CAMBIALA!)
// ============================================
const ADMIN_PASSWORD = "Psw1!";

// Inizializza Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const requestsRef = ref(database, 'requests');
const evasedRef = ref(database, 'evased');

// ============================================
// VARIABILI GLOBALI
// ============================================
let allRequests = [];
let allEvased = [];
let currentSort = 'priority';
let isAdminMode = false;

// ============================================
// FUNZIONI UTILITY
// ============================================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getVotedRequests() {
    return JSON.parse(localStorage.getItem('votedRequests')) || [];
}

function saveVote(requestId) {
    const voted = getVotedRequests();
    voted.push(requestId);
    localStorage.setItem('votedRequests', JSON.stringify(voted));
}

function hasVoted(requestId) {
    return getVotedRequests().includes(requestId);
}

function checkAdminMode() {
    return localStorage.getItem('isAdmin') === 'true';
}

// ============================================
// FUNZIONI ADMIN
// ============================================
function enableAdminMode() {
    const password = prompt('🔐 Inserisci la password admin:');
    if (password === ADMIN_PASSWORD) {
        localStorage.setItem('isAdmin', 'true');
        isAdminMode = true;
        updateAdminButton();
        displayRequests(allRequests);
        alert('✅ Modalità admin attivata!');
    } else if (password !== null) {
        alert('❌ Password errata!');
    }
}

function disableAdminMode() {
    localStorage.removeItem('isAdmin');
    isAdminMode = false;
    updateAdminButton();
    displayRequests(allRequests);
}

function updateAdminButton() {
    const adminBtn = document.getElementById('adminToggle');
    if (adminBtn) {
        if (isAdminMode) {
            adminBtn.innerHTML = '🔓 Modalità Admin Attiva';
            adminBtn.classList.add('admin-active');
        } else {
            adminBtn.innerHTML = '🔐 Accedi come Admin';
            adminBtn.classList.remove('admin-active');
        }
    }
}

// ============================================
// SPOSTA IN EVASE
// ============================================
async function moveToEvase(requestId, title) {
    if (!isAdminMode) {
        alert('❌ Devi essere in modalità admin per evadere richieste!');
        return;
    }

    const confirmed = window.confirm(`Evadere "${title}"?\n\n✅ Verrà spostata nella sezione "Richieste Evase" visibile a tutti.`);
    if (!confirmed) return;

    try {
        const requestSnapshot = await get(ref(database, `requests/${requestId}`));
        const requestData = requestSnapshot.val();

        if (!requestData) {
            alert('❌ Richiesta non trovata!');
            return;
        }

        const evadedData = {
            ...requestData,
            status: 'evasa',
            evadedAt: new Date().toLocaleDateString('it-IT'),
            evadedTimestamp: Date.now()
        };

        await push(evasedRef, evadedData);
        await remove(ref(database, `requests/${requestId}`));

    } catch (error) {
        alert('❌ Errore durante l\'evasione: ' + error.message);
    }
}

// ============================================
// VOTO
// ============================================
async function voteRequest(requestId) {
    if (hasVoted(requestId)) {
        alert('✋ Hai già votato per questa richiesta!');
        return;
    }

    const requestToUpdate = allRequests.find(req => req.id === requestId);
    if (!requestToUpdate) return;

    const newVotes = (requestToUpdate.votes || 0) + 1;
    const newPriority = (requestToUpdate.priority || 0) + 1;

    try {
        await update(ref(database, `requests/${requestId}`), {
            votes: newVotes,
            priority: newPriority
        });
        saveVote(requestId);
    } catch (error) {
        alert('❌ Errore durante il voto: ' + error.message);
    }
}

// ============================================
// ORDINAMENTO
// ============================================
function sortRequests(requests) {
    if (currentSort === 'priority') {
        return [...requests].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    } else {
        return [...requests].sort((a, b) => b.timestamp - a.timestamp);
    }
}

// ============================================
// DISPLAY RICHIESTE
// ============================================
function displayRequests(requests) {
    const requestsList = document.getElementById('requestsList');
    const countBadge = document.getElementById('requestCount');

    if (!requests || requests.length === 0) {
        requestsList.innerHTML = '<div class="empty-state">Nessuna richiesta ancora. Sii il primo! 🎬</div>';
        countBadge.textContent = '0';
        return;
    }

    countBadge.textContent = requests.length;
    const sortedRequests = sortRequests(requests);

    requestsList.innerHTML = sortedRequests.map(req => `
        <div class="request-card">
            <div class="request-header">
                <span class="request-title">${escapeHtml(req.title)}</span>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span class="priority-badge">Priorità ${req.priority || 0}</span>
                    <span class="request-type">${escapeHtml(req.type)}</span>
                </div>
            </div>
            <div class="request-info">
                👤 Richiesto da: <strong>${escapeHtml(req.requester)}</strong>
            </div>
            <div class="request-info">
                📅 ${req.date}
            </div>
            ${req.notes ? `<div class="request-notes">📝 ${escapeHtml(req.notes)}</div>` : ''}
            <div class="vote-section">
                <button class="vote-btn" data-request-id="${req.id}" ${hasVoted(req.id) ? 'disabled' : ''}>
                    ${hasVoted(req.id) ? '✅ Votato' : '👍 Vota (+1 priorità)'}
                </button>
                <span class="vote-count">🔥 ${req.votes || 0} voti</span>
                ${isAdminMode ? `<button class="evade-btn" data-request-id="${req.id}" data-title="${escapeHtml(req.title)}">✅ Evadi</button>` : ''}
            </div>
        </div>
    `).join('');

    document.querySelectorAll('.vote-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', function() {
            voteRequest(this.getAttribute('data-request-id'));
        });
    });

    if (isAdminMode) {
        document.querySelectorAll('.evade-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                moveToEvase(this.getAttribute('data-request-id'), this.getAttribute('data-title'));
            });
        });
    }
}

// ============================================
// DISPLAY EVASE
// ============================================
function displayEvased(evased) {
    const evasedList = document.getElementById('evasedList');
    const countBadge = document.getElementById('evasedCount');

    if (!evased || evased.length === 0) {
        evasedList.innerHTML = '<div class="empty-state">Nessuna richiesta evasa ancora.</div>';
        countBadge.textContent = '0';
        return;
    }

    countBadge.textContent = evased.length;
    const sortedEvased = [...evased].sort((a, b) => b.evadedTimestamp - a.evadedTimestamp);

    evasedList.innerHTML = sortedEvased.map(req => `
        <div class="request-card evased-card">
            <div class="request-header">
                <span class="request-title">${escapeHtml(req.title)}</span>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span class="request-type">${escapeHtml(req.type)}</span>
                    <span class="evased-badge">✅ Evad. ${req.evadedAt}</span>
                </div>
            </div>
            <div class="request-info">
                👤 <strong>${escapeHtml(req.requester)}</strong> | Priorità: ${req.priority || 0}
            </div>
            ${req.notes ? `<div class="request-notes">${escapeHtml(req.notes)}</div>` : ''}
            <div class="request-info small">
                📊 ${req.votes || 0} voti totali
            </div>
        </div>
    `).join('');
}

// ============================================
// MESSAGGIO SUCCESSO
// ============================================
function showSuccessMessage(message = '✅ Richiesta inviata con successo!') {
    const formSection = document.querySelector('.form-section');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'success-message';
    messageDiv.textContent = message;
    formSection.insertBefore(messageDiv, formSection.firstChild);
    setTimeout(() => messageDiv.remove(), 3000);
}

// ============================================
// LISTENER FIREBASE — RICHIESTE
// ============================================
const recentRequestsQuery = query(requestsRef, orderByChild('timestamp'), limitToLast(100));
onValue(recentRequestsQuery, (snapshot) => {
    allRequests = [];
    snapshot.forEach((childSnapshot) => {
        allRequests.push({
            id: childSnapshot.key,
            ...childSnapshot.val()
        });
    });
    displayRequests(allRequests);
});

// ============================================
// LISTENER FIREBASE — EVASE
// ============================================
const evasedQuery = query(evasedRef, orderByChild('evadedTimestamp'), limitToLast(100));
onValue(evasedQuery, (snapshot) => {
    allEvased = [];
    snapshot.forEach((childSnapshot) => {
        allEvased.push({
            id: childSnapshot.key,
            ...childSnapshot.val()
        });
    });
    displayEvased(allEvased);
});

// ============================================
// FORM SUBMIT
// ============================================
document.getElementById('requestForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const submitBtn = this.querySelector('.btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Invio in corso...';

    const newRequest = {
        title: document.getElementById('title').value.trim(),
        type: document.getElementById('type').value,
        priority: parseInt(document.getElementById('priority').value),
        requester: document.getElementById('requester').value.trim(),
        notes: document.getElementById('notes').value.trim(),
        date: new Date().toLocaleDateString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }),
        timestamp: Date.now(),
        votes: 0
    };

    try {
        await push(requestsRef, newRequest);
        this.reset();
        showSuccessMessage();
    } catch (error) {
        alert('❌ Errore durante l\'invio: ' + error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Invia Richiesta';
    }
});

// ============================================
// ORDINAMENTO BOTTONI
// ============================================
document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentSort = this.dataset.sort;
        displayRequests(allRequests);
    });
});

// ============================================
// INIZIALIZZAZIONE
// ============================================
isAdminMode = checkAdminMode();
updateAdminButton();

document.getElementById('adminToggle').addEventListener('click', function() {
    if (isAdminMode) {
        disableAdminMode();
    } else {
        enableAdminMode();
    }
});
