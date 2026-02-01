// ============================================
// CONFIGURAZIONE FIREBASE
// ============================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getDatabase, ref, push, onValue, query, orderByChild, limitToLast, update } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js';

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

// Inizializza Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const requestsRef = ref(database, 'requests');

// ============================================
// VARIABILI GLOBALI
// ============================================
let allRequests = [];
let currentSort = 'votes';

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

// Vota una richiesta
async function voteRequest(requestId) {
    if (hasVoted(requestId)) {
        alert('Hai già votato per questa richiesta!');
        return;
    }
    
    const requestToUpdate = allRequests.find(req => req.id === requestId);
    if (!requestToUpdate) return;
    
    const newVotes = (requestToUpdate.votes || 0) + 1;
    
    try {
        await update(ref(database, `requests/${requestId}`), {
            votes: newVotes
        });
        saveVote(requestId);
    } catch (error) {
        alert('Errore durante il voto: ' + error.message);
    }
}

// Ordina richieste
function sortRequests(requests) {
    if (currentSort === 'votes') {
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
                    <span class="priority-badge">Priorità ${req.priority}</span>
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
                <button class="vote-btn" data-request-id="${req.id}" ${hasVoted(req.id) ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
                    👍 ${hasVoted(req.id) ? 'Votato' : 'Vota'}
                </button>
                <span class="vote-count">🔥 ${req.votes || 0} voti</span>
            </div>
        </div>
    `).join('');
    
    // Aggiungi event listener ai pulsanti di voto
    document.querySelectorAll('.vote-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const requestId = this.getAttribute('data-request-id');
            voteRequest(requestId);
        });
    });
}

// Mostra messaggio di successo
function showSuccessMessage() {
    const form = document.getElementById('requestForm');
    const message = document.createElement('div');
    message.className = 'success-message';
    message.textContent = '✅ Richiesta inviata con successo!';
    form.parentElement.insertBefore(message, form);
    
    setTimeout(() => {
        message.remove();
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
