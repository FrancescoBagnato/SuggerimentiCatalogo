// ============================================
// CONFIGURAZIONE FIREBASE
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  onValue,
  query,
  orderByChild,
  limitToLast,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCVI_TP1LaLIUDc3QLaJtapvoeZ7mOFqcI",
  authDomain: "suggerimenticatalogo.firebaseapp.com",
  databaseURL:
    "https://suggerimenticatalogo-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "suggerimenticatalogo",
  storageBucket: "suggerimenticatalogo.firebasestorage.app",
  messagingSenderId: "331103414090",
  appId: "1:331103414090:web:f387d3033a8c5ed9ffc3b3",
  measurementId: "G-LNZ45LZE6N",
};

// Inizializza Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const requestsRef = ref(database, "requests");

// ============================================
// FUNZIONI
// ============================================

// Escape HTML per sicurezza
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Mostra richieste
function displayRequests(requests) {
  const requestsList = document.getElementById("requestsList");
  const countBadge = document.getElementById("requestCount");

  if (!requests || requests.length === 0) {
    requestsList.innerHTML =
      '<div class="empty-state">Nessuna richiesta ancora. Sii il primo! 🎬</div>';
    countBadge.textContent = "0";
    return;
  }

  countBadge.textContent = requests.length;

  requestsList.innerHTML = requests
    .map(
      (req) => `
        <div class="request-card">
            <div class="request-header">
                <span class="request-title">${escapeHtml(req.title)}</span>
                <span class="request-type">${escapeHtml(req.type)}</span>
            </div>
            <div class="request-info">
                👤 Richiesto da: <strong>${escapeHtml(req.requester)}</strong>
            </div>
            <div class="request-info">
                📅 ${req.date}
            </div>
            ${
              req.notes
                ? `<div class="request-notes">📝 ${escapeHtml(req.notes)}</div>`
                : ""
            }
        </div>
    `
    )
    .join("");
}

// Mostra messaggio di successo
function showSuccessMessage() {
  const form = document.getElementById("requestForm");
  const message = document.createElement("div");
  message.className = "success-message";
  message.textContent = "✅ Richiesta inviata con successo!";
  form.parentElement.insertBefore(message, form);

  setTimeout(() => {
    message.remove();
  }, 3000);
}

// ============================================
// ASCOLTA RICHIESTE IN TEMPO REALE
// ============================================
const recentRequestsQuery = query(
  requestsRef,
  orderByChild("timestamp"),
  limitToLast(50)
);

onValue(recentRequestsQuery, (snapshot) => {
  const requests = [];
  snapshot.forEach((childSnapshot) => {
    requests.push(childSnapshot.val());
  });
  // Ordina per timestamp decrescente (più recenti prima)
  requests.reverse();
  displayRequests(requests);
});

// ============================================
// GESTISCI INVIO FORM
// ============================================
document
  .getElementById("requestForm")
  .addEventListener("submit", async function (e) {
    e.preventDefault();

    const submitBtn = this.querySelector(".btn-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Invio in corso...";

    const newRequest = {
      title: document.getElementById("title").value.trim(),
      type: document.getElementById("type").value,
      requester: document.getElementById("requester").value.trim(),
      notes: document.getElementById("notes").value.trim(),
      date: new Date().toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: Date.now(),
    };

    try {
      // Salva su Firebase
      await push(requestsRef, newRequest);

      // Reset form
      this.reset();
      showSuccessMessage();
    } catch (error) {
      alert("❌ Errore durante l'invio: " + error.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Invia Richiesta";
    }
  });
