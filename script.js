// ============================================
// CONFIGURAZIONE FIREBASE
// ============================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getDatabase, ref, push, onValue, query, orderByChild, limitToLast, update, remove } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js';

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
const ADMIN_PASSWORD = "Psw1!"; // CAMBIA QUESTA PASSWORD!

// Inizializza Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const requestsRef = ref(database, 'requests');

// ============================================
// VARIABILI GLOBALI
// ============================================
let allRequests = [];
let currentSort = 'priority'; // Ordina per priorità di default
let isAdminMode = false;

// ============================================
// FUNZIONI
// ============================================

// Escape HTML per sicurezza
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Ottieni voti salvati in localStorage
function getVotedRequests() {
    return JSON.parse(localStorage.getItem('votedRequests')) || [];
}

// Salva voto in localStorage
function saveVote(requestId) {
    const voted = getVotedRequests();
    voted.push(requestId);
    localStorage.setItem('votedRequests', JSON.stringify(voted));
}

// Controlla se l'utente ha già votato
function hasVoted(requestId) {
    return getVotedRequests().includes(requestId);
}

// Controlla se è admin
function checkAdminMode() {
    return localStorage.getItem('isAdmin') === 'true';
}

// Attiva modalità admin
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

// Disattiva modalità admin
function disableAdminMode() {
    localStorage.removeItem('isAdmin');
    isAdminMode = false;
    updateAdminButton();
    displayRequests(allRequests);
}

// Aggiorna pulsante admin
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

// Elimina richiesta
async function deleteRequest(requestId, title) {
    if (!isAdminMode) {
        alert('❌ Devi essere in modalità admin per eliminare richieste!');
        return;
    }
    
    const confirmed = window.confirm(`Eliminare "${title}"?\n\n⚠️ Questa azione è irreversibile.`);
    if (!confirmed) return;
    
    try {
        await remove(ref(database, `requests/${requestId}`));
        // Non serve chiamare displayRequests, Firebase onValue lo fa automaticamente
    } catch (error) {
        alert('❌ Errore durante l\'eliminazione: ' + error.message);
    }
}

// Vota una richiesta (aumenta priorità di +1)
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

// Ordina richieste
function sortRequests(requests) {
    if (currentSort === 'priority') {
        return [...requests].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    } else if (currentSort === 'votes') {
        return [...requests].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    } else {
        return [...requests].sort((a, b) => b.timestamp - a.timestamp);
    }
}

// Mostra richieste
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
                ${isAdminMode ? `<button class="delete-btn" data-request-id="${req.id}" data-title="${escapeHtml(req.title)}">🗑️ Elimina</button>` : ''}
            </div>
        </div>
    `).join('');
    
    // Aggiungi event listener ai pulsanti di voto
    document.querySelectorAll('.vote-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', function() {
            const requestId = this.getAttribute('data-request-id');
            voteRequest(requestId);
        });
    });
    
    // Aggiungi event listener ai pulsanti elimina
    if (isAdminMode) {
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const requestId = this.getAttribute('data-request-id');
                const title = this.getAttribute('data-title');
                deleteRequest(requestId, title);
            });
        });
    }
}

// Mostra messaggio di successo
function showSuccessMessage(message = '✅ Richiesta inviata con successo!') {
    const formSection = document.querySelector('.form-section');
    if (!formSection) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'success-message';
    messageDiv.textContent = message;
    formSection.insertBefore(messageDiv, formSection.firstChild);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

// ============================================
// ASCOLTA RICHIESTE IN TEMPO REALE
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
// GESTISCI INVIO FORM
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
// GESTISCI ORDINAMENTO
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
// Controlla se già in modalità admin al caricamento
isAdminMode = checkAdminMode();
updateAdminButton();

// Aggiungi event listener al pulsante admin quando il DOM è pronto
setTimeout(() => {
    const adminBtn = document.getElementById('adminToggle');
    if (adminBtn) {
        adminBtn.addEventListener('click', function() {
            if (isAdminMode) {
                disableAdminMode();
            } else {
                enableAdminMode();
            }
        });
    }
}, 100);
