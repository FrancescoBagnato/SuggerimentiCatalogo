// ============================================
// CONFIGURAZIONE FIREBASE
// ============================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import {
    getDatabase, ref, push, onValue,
    update, remove, get, set
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js';

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

// Password admin: confronto via SHA-256 — la password in chiaro non è nel codice
// Per cambiare password: calcola il nuovo SHA-256 su https://emn178.github.io/online-tools/sha256.html
// e aggiorna il valore su Firebase: Admin → adminHash
async function hashPassword(str) {
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

const app          = initializeApp(firebaseConfig);
const db           = getDatabase(app);
const requestsRef  = ref(db, 'requests');
const evasedRef    = ref(db, 'evased');
const catalogRef   = ref(db, 'catalog');
const suggestedRef     = ref(db, 'suggested');
const watchlistRef     = ref(db, 'watchlist');
const catalogStructRef = ref(db, 'catalogStructure');
const countersRef      = ref(db, 'counters');

// ============================================
// STATO GLOBALE
// ============================================
let allRequests   = [];
let allEvased     = [];
let allSuggested  = [];
let catalogData   = {};
let currentTab      = 'date';
let currentCatalogTab  = 'catalog';
let catalogStructure   = { serietv: [], film: [] };  // dati da Firebase
let watchlistData   = {};           // { titleKey: true } per il nick corrente
let currentSuggSort = 'rank';   // default: Classifica
let isAdminMode     = false;

// ============================================
// UTILITY
// ============================================
function esc(text) {
    const d = document.createElement('div');
    d.textContent = text ?? '';
    return d.innerHTML;
}
function titleToKey(title) { return title.replace(/[.#$\/\[\]]/g, '_'); }

function checkAdmin()  { return localStorage.getItem('isAdmin') === 'true'; }
function getNickname() { return localStorage.getItem('catalogNick') || ''; }
function saveNickname(n) { if (n) localStorage.setItem('catalogNick', n.trim()); }

// Voti consigliati: { id: score } salvati in localStorage
function getSuggRatings()          { return JSON.parse(localStorage.getItem('suggRatings') || '{}'); }
function saveSuggRating(id, score) { const r = getSuggRatings(); r[id] = score; localStorage.setItem('suggRatings', JSON.stringify(r)); }
function getSuggRating(id)         { return getSuggRatings()[id] || 0; }
function hasSuggVoted(id)          { return !!getSuggRatings()[id]; }

function showFormError(formId, msg) {
    const old = document.querySelector('#' + formId + ' .form-error');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'form-error';
    el.textContent = '⚠ ' + msg;
    const form = document.getElementById(formId);
    if (form) form.insertBefore(el, form.firstChild);
    setTimeout(() => el.remove(), 3500);
}

function showToast(msg = 'Fatto!') {
    const old = document.querySelector('.success-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'success-toast';
    t.innerHTML = `<span class="success-toast-icon">✓</span>${esc(msg)}`;
    const form = document.getElementById('requestForm');
    form.parentNode.insertBefore(t, form);
    setTimeout(() => t.remove(), 3200);
}

// ============================================
// STELLE HELPER (rating 0.5..10, step 0.5)
// ============================================
function starSvgInline(type, sz) {
    const uid  = 'hc' + Math.random().toString(36).slice(2, 7);
    const pts  = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';
    const base = `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">`;
    if (type === 'full')
        return base + `<polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    if (type === 'empty')
        return base + `<polygon points="${pts}" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    return base
        + `<defs><clipPath id="${uid}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>`
        + `<polygon points="${pts}" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linejoin="round"/>`
        + `<polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round" clip-path="url(#${uid})"/>`
        + `</svg>`;
}

function starsHtml(rating, size = 12) {
    if (!rating) return '';
    let s = '';
    for (let i = 1; i <= 10; i++) {
        if (rating >= i)            s += starSvgInline('full', size);
        else if (rating >= i - 0.5) s += starSvgInline('half', size);
        else                        s += starSvgInline('empty', size);
    }
    return `<span style="display:inline-flex;align-items:center;gap:1px;vertical-align:middle">${s}<span style="margin-left:4px;font-size:${size}px;color:#cbd5e1;font-weight:600">${rating.toFixed(1)}</span></span>`;
}

function avgRating(users) {
    if (!users) return null;
    const ratings = Object.values(users).map(u => u.rating).filter(r => r && r > 0);
    if (!ratings.length) return null;
    return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 2) / 2;
}

// ============================================
// ADMIN
// ============================================
async function enableAdmin() {
    const pwd = prompt('Inserisci la password admin:');
    if (pwd === null) return;
    try {
        const snap = await get(ref(db, 'adminHash'));
        const storedHash = snap.val();
        if (!storedHash) { alert('Hash admin non configurato su Firebase.'); return; }
        const inputHash = await hashPassword(pwd);
        if (inputHash === storedHash) {
            localStorage.setItem('isAdmin', 'true');
            isAdminMode = true;
            renderAdminBtn(); redraw(); renderSuggested(allSuggested);
            openAdminPanel();
        } else {
            alert('Password errata.');
        }
    } catch(e) { alert('Errore verifica password: ' + e.message); }
}
function disableAdmin() {
    localStorage.removeItem('isAdmin');
    isAdminMode = false;
    const panel = document.getElementById('adminPanelOverlay');
    if (panel) panel.remove();
    renderAdminBtn(); redraw(); renderSuggested(allSuggested);
}
function renderAdminBtn() {
    const btn = document.getElementById('adminToggle');
    if (!btn) return;
    btn.textContent = isAdminMode ? '🔓 Admin attivo' : 'Admin';
    btn.classList.toggle('admin-active', isAdminMode);
}

// ============================================
// EVADI RICHIESTA
// ============================================
async function evade(id, title) {
    if (!isAdminMode) return;
    if (!confirm(`Evadere "${title}"?`)) return;
    try {
        const snap = await get(ref(db, `requests/${id}`));
        const data = snap.val();
        if (!data) { alert('Richiesta non trovata.'); return; }
        await push(evasedRef, { ...data, status: 'evasa', evadedAt: new Date().toLocaleDateString('it-IT'), evadedTimestamp: Date.now() });
        await remove(ref(db, `requests/${id}`));
    } catch (e) { alert('Errore: ' + e.message); }
}



// ============================================
// RENDER RICHIESTE
// ============================================
function renderRequests(list) {
    const el    = document.getElementById('requestsList');
    const badge = document.getElementById('requestCount');
    if (!list || !list.length) {
        badge.textContent = '0';
        el.innerHTML = `<div class="state-empty"><span class="state-empty-icon">🎬</span>Nessuna richiesta ancora.<br>Sii il primo!</div>`;
        return;
    }
    badge.textContent = list.length;
    const sorted = [...list].sort((a, b) => b.timestamp - a.timestamp);
    el.innerHTML = sorted.map(req => `
        <div class="req-card">
            <div class="req-top">
                <span class="req-title">${esc(req.title)}</span>
                <span class="badge badge-type">${esc(req.type)}</span>
            </div>
            <div class="req-meta">
                <span>👤 <strong>${esc(req.requester)}</strong></span>
                <span>📅 ${esc(req.date)}</span>
            </div>
            ${req.notes ? `<div class="req-notes">${esc(req.notes)}</div>` : ''}
            ${isAdminMode ? `
            <div class="req-footer">
                <button class="btn-evade" data-id="${req.id}" data-title="${esc(req.title)}">Evadi ✓</button>
            </div>` : ''}
        </div>
    `).join('');
    if (isAdminMode) {
        el.querySelectorAll('.btn-evade').forEach(b =>
            b.addEventListener('click', () => evade(b.dataset.id, b.dataset.title))
        );
    }
}

// ============================================
// RENDER EVASE
// ============================================
function renderEvased(list) {
    const el    = document.getElementById('requestsList');
    const badge = document.getElementById('requestCount');
    if (!list || !list.length) {
        badge.textContent = '0';
        el.innerHTML = `<div class="state-empty"><span class="state-empty-icon">✅</span>Nessuna richiesta evasa ancora.</div>`;
        return;
    }
    badge.textContent = list.length;
    const sorted = [...list].sort((a, b) => b.evadedTimestamp - a.evadedTimestamp);
    el.innerHTML = sorted.map(req => `
        <div class="req-card evased">
            <div class="req-top">
                <span class="req-title">${esc(req.title)}</span>
                <div class="req-badges">
                    <span class="badge badge-done">✓ Aggiunto</span>
                    <span class="badge badge-type">${esc(req.type)}</span>
                </div>
            </div>
            <div class="req-meta">
                <span>👤 <strong>${esc(req.requester)}</strong></span>
                <span>✓ ${esc(req.evadedAt)}</span>
                <span>👍 ${req.votes || 0} voti</span>
            </div>
            ${req.notes ? `<div class="req-notes">${esc(req.notes)}</div>` : ''}
        </div>
    `).join('');
}

function redraw() {
    if (currentTab === 'evased') renderEvased(allEvased);
    else renderRequests(allRequests);
}

// ============================================
// FIREBASE — RICHIESTE
// ============================================
onValue(requestsRef, snap => {
    const raw = snap.val();
    allRequests = raw ? Object.entries(raw).map(([id, val]) => ({ id, ...val })) : [];
    if (currentTab !== 'evased') renderRequests(allRequests);
    if (window._apRenderReq) window._apRenderReq();
});

onValue(evasedRef, snap => {
    const raw = snap.val();
    allEvased = raw ? Object.entries(raw).map(([id, val]) => ({ id, ...val })) : [];
    if (currentTab === 'evased') renderEvased(allEvased);
    if (window._apRenderEv) window._apRenderEv();
});

// ============================================
// FORM SUBMIT RICHIESTA
// ============================================
document.getElementById('requestForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = this.querySelector('.btn-submit');
    btn.disabled = true;
    btn.querySelector('.btn-submit-text').textContent = 'Invio…';
    const titleVal     = document.getElementById('title').value.trim();
    const typeVal      = document.getElementById('type').value;
    const requesterVal = document.getElementById('requester').value.trim();

    // Validazione campi obbligatori
    let reqError = '';
    if (!titleVal)     reqError = 'Inserisci il titolo.';
    else if (!typeVal) reqError = 'Seleziona il tipo (Film o Serie TV).';
    else if (!requesterVal) reqError = 'Inserisci il tuo nickname.';
    if (reqError) {
        showFormError('requestForm', reqError);
        btn.disabled = false;
        btn.querySelector('.btn-submit-text').textContent = 'Invia richiesta';
        return;
    }

    const payload = {
        title:     titleVal,
        type:      typeVal,
        requester: requesterVal,
        notes:     document.getElementById('notes').value.trim(),
        date:      new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
        timestamp: Date.now()
    };
    try {
        await push(requestsRef, payload);
        this.reset();
        showToast('Richiesta inviata con successo!');
        // Notifica email (se EmailJS configurato)
        if (typeof window.sendNewRequestEmail === 'function') {
            window.sendNewRequestEmail(payload.title, payload.type, payload.requester, payload.notes);
        }
    } catch (err) {
        alert('Errore: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.querySelector('.btn-submit-text').textContent = 'Invia richiesta';
    }
});

// ============================================
// TAB BAR RICHIESTE
// ============================================
document.querySelectorAll('.tab[data-sort]').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.tab[data-sort]').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentTab = this.dataset.sort;
        redraw();
    });
});

// ============================================
// ADMIN TOGGLE
// ============================================
document.getElementById('adminToggle').addEventListener('click', () => {
    if (!isAdminMode) { enableAdmin(); return; }
    // se già admin: toggle pannello
    const existing = document.getElementById('adminPanelOverlay');
    if (existing) existing.remove();
    else openAdminPanel();
});

// ============================================
// CATALOGO — POPUP
// ============================================
let popupCurrentTitle   = null;
let popupSelectedStatus = null;
let popupSelectedRating = 0;

// ============================================
// POPUP CARTELLA — applica a tutti i figli
// ============================================
function openFolderPopup(folder) {
    const folderTitle = folder.dataset.title;
    const subitems    = Array.from(folder.querySelectorAll('.catalog-subitem'));
    if (!subitems.length) {
        // Nessun figlio — apri popup normale sulla cartella stessa
        openCatalogPopup(folderTitle);
        return;
    }

    let selectedStatus = null;
    let selectedRating = 0;

    const overlay = document.getElementById('catalogPopupOverlay');
    const pts = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';

    overlay.innerHTML = `
        <div class="popup-box" id="popupBox">
            <div class="popup-handle"></div>
            <div class="popup-title">${esc(folderTitle)}</div>
            <div class="popup-subtitle">Applica a tutto il contenuto della cartella</div>

            <div class="popup-nick-row">
                <div class="field" style="flex:1;gap:5px">
                    <label style="font-size:12px">Nickname</label>
                    <input type="text" id="popupNick" placeholder="Lorem Ipsum" value="${esc(getNickname())}" autocomplete="off" maxlength="20">
                </div>
            </div>

            <div class="popup-stars-label">Stato per tutti i titoli</div>
            <div class="popup-status-row">
                <button class="status-btn" data-status="seen"><span class="sb-icon">✅</span> Visto</button>
                <button class="status-btn" data-status="watching"><span class="sb-icon">▶️</span> In corso</button>
                <button class="status-btn status-btn-reset" data-status="none"><span class="sb-icon">✕</span> Resetta</button>
            </div>

            <div class="popup-stars-label">Voto uguale per tutti <span style="font-size:10px;color:var(--low);font-weight:400;text-transform:none;letter-spacing:0">(opzionale)</span></div>
            <div class="popup-stars" id="popupStars">
                ${Array.from({length:10}, (_, i) => {
                    const val = i + 1;
                    const uid = 'fp_' + Math.random().toString(36).slice(2,7);
                    return '<button class="star-btn" data-val="' + val + '" title="' + val + '/10">'
                        + '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
                        + '<defs><clipPath id="' + uid + '"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>'
                        + '<polygon class="star-full" points="' + pts + '"/>'
                        + '<polygon class="star-half" points="' + pts + '" clip-path="url(#' + uid + ')"/>'
                        + '</svg></button>';
                }).join('')}
            </div>

            <div class="popup-actions">
                <button class="btn-popup-cancel" id="popupCancel">Annulla</button>
                <button class="btn-popup-save" id="popupSave">Applica a tutti</button>
            </div>
            <button class="btn-watchlist-toggle" id="popupFolderWatchlist">♡ Aggiungi cartella alla watchlist</button>
        </div>`;

    overlay.style.display = 'flex';
    overlay.classList.remove('closing');
    addSwipeToClose(overlay);

    // Stato cuore watchlist cartella
    function refreshFolderWlBtn() {
        const btn = overlay.querySelector('#popupFolderWatchlist');
        if (!btn) return;
        const inWl = isInWatchlist(folderTitle);
        btn.textContent = inWl ? '♥ In watchlist' : '♡ Aggiungi cartella alla watchlist';
        btn.classList.toggle('btn-watchlist-toggle-active', inWl);
    }
    refreshFolderWlBtn();

    overlay.querySelector('#popupFolderWatchlist').addEventListener('click', async () => {
        const nick = document.getElementById('popupNick').value.trim();
        if (!nick) { alert('Inserisci prima il tuo nickname.'); return; }
        saveNickname(nick);
        const btn  = overlay.querySelector('#popupFolderWatchlist');
        btn.disabled = true; btn.textContent = 'Salvataggio…';
        try {
            await toggleWatchlist(folderTitle, folderTitle);
            refreshFolderWlBtn();
        } catch(e) { alert('Errore: ' + e.message); }
        finally { btn.disabled = false; }
    });

    // Stelle
    function applyStarClasses(btns, activeRating) {
        btns.forEach(b => {
            const v = parseFloat(b.dataset.val);
            b.classList.remove('lit','half-lit');
            if (activeRating >= v)            b.classList.add('lit');
            else if (activeRating >= v - 0.5) b.classList.add('half-lit');
        });
    }
    const starBtns = Array.from(overlay.querySelectorAll('.star-btn'));
    starBtns.forEach(btn => {
        btn.addEventListener('click', e => {
            const v = parseFloat(btn.dataset.val);
            const rect = btn.getBoundingClientRect();
            const half = (e.clientX - rect.left) < rect.width / 2;
            const chosen = half ? v - 0.5 : v;
            selectedRating = (selectedRating === chosen) ? 0 : chosen;
            applyStarClasses(starBtns, selectedRating);
        });
        btn.addEventListener('mousemove', e => {
            const v = parseFloat(btn.dataset.val);
            const rect = btn.getBoundingClientRect();
            applyStarClasses(starBtns, (e.clientX - rect.left) < rect.width / 2 ? v - 0.5 : v);
        });
        btn.addEventListener('mouseleave', () => applyStarClasses(starBtns, selectedRating));
    });

    // Stato
    overlay.querySelectorAll('.status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const s = btn.dataset.status;
            selectedStatus = s === 'none' ? null : s;
            overlay.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active-seen','active-watching'));
            if (selectedStatus === 'seen')     btn.classList.add('active-seen');
            if (selectedStatus === 'watching') btn.classList.add('active-watching');
        });
    });

    // Salva — applica a tutti i figli
    overlay.querySelector('#popupSave').addEventListener('click', async () => {
        const nick = document.getElementById('popupNick').value.trim();
        if (!nick) { alert('Inserisci il tuo nickname.'); return; }
        saveNickname(nick);

        const saveBtn = overlay.querySelector('#popupSave');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvataggio…';

        try {
            const updates = {};
            for (const li of subitems) {
                const subTitle  = li.dataset.title;
                const fbTitle   = folderTitle + ' — ' + subTitle;
                const key       = titleToKey(fbTitle);
                const userPath  = 'catalog/' + key + '/users/' + nick;
                if (!selectedStatus) {
                    await remove(ref(db, userPath));
                } else {
                    updates[userPath] = {
                        status:    selectedStatus,
                        rating:    selectedRating || null,
                        updatedAt: Date.now()
                    };
                }
            }
            for (const [path, val] of Object.entries(updates)) {
                await set(ref(db, path), val);
            }
            closePopup();
        } catch(e) {
            alert('Errore: ' + e.message);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Applica a tutti';
        }
    });

    overlay.querySelector('#popupCancel').addEventListener('click', closePopup);
    overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });
}

function openCatalogPopup(title, parentTitle = null) {
    // Per i sub-item (stagioni), usa 'Parent — Titolo' come chiave Firebase
    const firebaseTitle = parentTitle ? parentTitle + ' — ' + title : title;
    popupCurrentTitle   = firebaseTitle;  // chiave univoca per Firebase
    popupSelectedStatus = null;
    popupSelectedRating = 0;

    const key       = titleToKey(firebaseTitle);
    const titleData = catalogData[key] || {};
    const users     = titleData.users || {};
    const myNick    = getNickname();
    const myData    = myNick ? (users[myNick] || {}) : {};

    if (myData.status) popupSelectedStatus = myData.status;
    if (myData.rating) popupSelectedRating = myData.rating;

    const avg       = avgRating(users);
    const seenList  = Object.entries(users).filter(([, u]) => u.status === 'seen');
    const watchList = Object.entries(users).filter(([, u]) => u.status === 'watching');

    const overlay = document.getElementById('catalogPopupOverlay');
    const pts = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';

    overlay.innerHTML = `
        <div class="popup-box" id="popupBox">
            <div class="popup-handle"></div>
            <div class="popup-title">${esc(parentTitle ? parentTitle + ' — ' + title : title)}</div>
            <div class="popup-subtitle">${avg ? `Media voti: ${starsHtml(avg, 11)}` : 'Nessun voto ancora'}</div>

            <div class="popup-nick-row">
                <div class="field" style="flex:1;gap:5px">
                    <label style="font-size:12px">Nickname</label>
                    <input type="text" id="popupNick" placeholder="Lorem Ipsum" value="${esc(myNick)}" autocomplete="off" maxlength="20">
                </div>
            </div>

            <div class="popup-stars-label">Il tuo stato</div>
            <div class="popup-status-row">
                <button class="status-btn ${popupSelectedStatus === 'seen' ? 'active-seen' : ''}" data-status="seen">
                    <span class="sb-icon">✅</span> Visto
                </button>
                <button class="status-btn ${popupSelectedStatus === 'watching' ? 'active-watching' : ''}" data-status="watching">
                    <span class="sb-icon">▶️</span> In corso
                </button>
                <button class="status-btn status-btn-reset" data-status="none">
                    <span class="sb-icon">✕</span> Resetta
                </button>
            </div>

            <div class="popup-stars-label">Il tuo voto <span style="font-size:10px;color:var(--low);font-weight:400;text-transform:none;letter-spacing:0">(½ cliccando la metà sinistra)</span></div>
            <div class="popup-stars" id="popupStars">
                ${Array.from({ length: 10 }, (_, i) => {
                    const val = i + 1;
                    const uid = 'sp_' + Math.random().toString(36).slice(2,9);
                    let cls = '';
                    if (popupSelectedRating >= val)            cls = 'lit';
                    else if (popupSelectedRating >= val - 0.5) cls = 'half-lit';
                    return `<button class="star-btn ${cls}" data-val="${val}" title="${val}/10">`
                        + `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">`
                        + `<defs><clipPath id="${uid}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>`
                        + `<polygon class="star-full" points="${pts}"/>`
                        + `<polygon class="star-half" points="${pts}" clip-path="url(#${uid})"/>`
                        + `</svg></button>`;
                }).join('')}
            </div>

            <div class="popup-actions">
                <button class="btn-popup-cancel" id="popupCancel">Annulla</button>
                <button class="btn-popup-save" id="popupSave">Salva</button>
            </div>
            <button class="btn-watchlist-toggle" id="popupWatchlist"
                data-firebase-title="${esc(firebaseTitle)}">
                ${isInWatchlist(firebaseTitle) ? '♥ Nella watchlist' : '♡ Aggiungi alla watchlist'}
            </button>

            ${(seenList.length || watchList.length) ? `
            <div class="popup-users-section">
                ${seenList.length ? `<div class="popup-users-title">Chi l'ha visto</div>` : ''}
                ${seenList.map(([nick, u]) => `
                    <div class="popup-user-row">
                        <div class="puf-avatar puf-seen">${esc(nick[0].toUpperCase())}</div>
                        <div class="puf-info">
                            <div class="puf-name">${esc(nick)}</div>
                            <div class="puf-meta">${u.rating ? `Voto: ${starsHtml(u.rating, 11)}` : 'Nessun voto'}</div>
                        </div>
                    </div>`).join('')}
                ${watchList.length ? `<div class="popup-users-title" style="margin-top:14px">In corso</div>` : ''}
                ${watchList.map(([nick, u]) => `
                    <div class="popup-user-row">
                        <div class="puf-avatar puf-watching">${esc(nick[0].toUpperCase())}</div>
                        <div class="puf-info">
                            <div class="puf-name">${esc(nick)}</div>
                            <div class="puf-meta">${u.rating ? `Voto: ${starsHtml(u.rating, 11)}` : 'Nessun voto'}</div>
                        </div>
                    </div>`).join('')}
            </div>` : ''}
        </div>`;

    overlay.style.display = 'flex';
    overlay.classList.remove('closing');
    addSwipeToClose(overlay);

    // Stelle
    function applyStarClasses(btns, activeRating) {
        btns.forEach(b => {
            const v = parseFloat(b.dataset.val);
            b.classList.remove('lit', 'half-lit');
            if (activeRating >= v)          b.classList.add('lit');
            else if (activeRating >= v - 0.5) b.classList.add('half-lit');
        });
    }
    const starBtns = Array.from(overlay.querySelectorAll('.star-btn'));
    applyStarClasses(starBtns, popupSelectedRating);
    starBtns.forEach(btn => {
        btn.addEventListener('click', e => {
            const v    = parseFloat(btn.dataset.val);
            const rect = btn.getBoundingClientRect();
            const half = (e.clientX - rect.left) < rect.width / 2;
            const chosen = half ? v - 0.5 : v;
            popupSelectedRating = (popupSelectedRating === chosen) ? 0 : chosen;
            applyStarClasses(starBtns, popupSelectedRating);
        });
        btn.addEventListener('mousemove', e => {
            const v    = parseFloat(btn.dataset.val);
            const rect = btn.getBoundingClientRect();
            const half = (e.clientX - rect.left) < rect.width / 2;
            applyStarClasses(starBtns, half ? v - 0.5 : v);
        });
        btn.addEventListener('mouseleave', () => applyStarClasses(starBtns, popupSelectedRating));
    });

    // Stato
    overlay.querySelectorAll('.status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const s = btn.dataset.status;
            popupSelectedStatus = (s === 'none') ? null : s;
            overlay.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active-seen', 'active-watching'));
            if (popupSelectedStatus === 'seen')     btn.classList.add('active-seen');
            if (popupSelectedStatus === 'watching') btn.classList.add('active-watching');
        });
    });

    overlay.querySelector('#popupSave').addEventListener('click', saveCatalogEntry);
    overlay.querySelector('#popupCancel').addEventListener('click', closePopup);
    overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });

    // Cuore watchlist
    const wlBtn = overlay.querySelector('#popupWatchlist');
    if (wlBtn) {
        wlBtn.addEventListener('click', async () => {
            const ft = wlBtn.dataset.firebaseTitle;
            const displayT = parentTitle ? parentTitle + ' — ' + title : title;
            await toggleWatchlist(ft, displayT);
            wlBtn.textContent = isInWatchlist(ft) ? '♥ Nella watchlist' : '♡ Aggiungi alla watchlist';
            wlBtn.classList.toggle('btn-watchlist-toggle-active', isInWatchlist(ft));
        });
        wlBtn.classList.toggle('btn-watchlist-toggle-active', isInWatchlist(firebaseTitle));
    }
}

function closePopup() {
    const overlay = document.getElementById('catalogPopupOverlay');
    overlay.classList.add('closing');
    setTimeout(() => { overlay.style.display = 'none'; overlay.classList.remove('closing'); }, 220);
}

function addSwipeToClose(overlay) {
    const box = overlay.querySelector('.popup-box');
    if (!box) return;
    let startY = 0, startX = 0, isDragging = false;

    box.addEventListener('touchstart', e => {
        // Solo se il tocco inizia nella zona superiore (handle o titolo)
        const touch = e.touches[0];
        startY = touch.clientY;
        startX = touch.clientX;
        isDragging = true;
        box.style.transition = 'none';
    }, { passive: true });

    box.addEventListener('touchmove', e => {
        if (!isDragging) return;
        const dy = e.touches[0].clientY - startY;
        const dx = Math.abs(e.touches[0].clientX - startX);
        if (dy > 0 && dx < 50) {
            box.style.transform = `translateY(${dy}px)`;
            box.style.opacity   = Math.max(0, 1 - dy / 300);
        }
    }, { passive: true });

    box.addEventListener('touchend', e => {
        if (!isDragging) return;
        isDragging = false;
        const dy = e.changedTouches[0].clientY - startY;
        box.style.transition = '';
        box.style.transform  = '';
        box.style.opacity    = '';
        if (dy > 80) closePopup();
    }, { passive: true });
}

async function saveCatalogEntry() {
    const nick = document.getElementById('popupNick').value.trim();
    if (!nick) { alert('Inserisci Nickname.'); return; }
    saveNickname(nick);
    const key     = titleToKey(popupCurrentTitle);
    const userRef = ref(db, `catalog/${key}/users/${nick}`);
    const saveBtn = document.getElementById('popupSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvataggio…';
    try {
        if (!popupSelectedStatus) {
            await remove(userRef);
        } else {
            await set(userRef, { status: popupSelectedStatus, rating: popupSelectedRating || null, updatedAt: Date.now() });
        }
        closePopup();
    } catch (e) {
        alert('Errore: ' + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salva';
    }
}

// ============================================
// CATALOGO — AGGIORNA CARTELLA UI (media sub-item)
// ============================================
function updateFolderUI(folder) {
    const parent    = folder.dataset.title;
    const key       = titleToKey(parent);
    const subitems  = Array.from(folder.querySelectorAll('.catalog-subitem'));

    // Calcola media voti tra tutti i sub-item
    let allRatings = [];
    let seenNicks  = new Set();
    let watchNicks = new Set();

    subitems.forEach(li => {
        const subFbTitle = parent + ' — ' + li.dataset.title;
        const subKey     = titleToKey(subFbTitle);
        const subData    = catalogData[subKey] || {};
        const users   = subData.users || {};
        Object.entries(users).forEach(([nick, u]) => {
            if (u.rating) allRatings.push(u.rating);
            if (u.status === 'seen')     seenNicks.add(nick);
            if (u.status === 'watching') watchNicks.add(nick);
        });
    });

    const avg = allRatings.length
        ? Math.round((allRatings.reduce((a,b)=>a+b,0)/allRatings.length)*2)/2
        : null;

    // Aggiorna ci-main della cartella
    const ciMain = folder.querySelector(':scope > .ci-main');
    const nameSpan = ciMain.querySelector('.ci-name');
    const plainName = nameSpan.textContent;
    const toggle = folder.classList.contains('folder-open') ? '▼' : '▶';

    // Aggiorna stelle media
    let starsEl = ciMain.querySelector('.ci-stars');
    if (!starsEl) {
        starsEl = document.createElement('span');
        starsEl.className = 'ci-stars';
        const toggleEl = ciMain.querySelector('.ci-folder-toggle');
        if (toggleEl) ciMain.insertBefore(starsEl, toggleEl);
        else ciMain.appendChild(starsEl);
    }
    starsEl.textContent = avg ? avg.toFixed(1) + '★' : '';

    // Avatar (iniziali) nella cartella — solo icone, niente colore di sfondo
    let avatarDiv = folder.querySelector(':scope > .ci-folder-avatars');
    if (!avatarDiv) {
        avatarDiv = document.createElement('div');
        avatarDiv.className = 'ci-folder-avatars';
        // Inserisci dopo ci-main
        const folderList = folder.querySelector('.ci-folder-list');
        folder.insertBefore(avatarDiv, folderList);
    }
    const allSeen    = [...seenNicks];
    const allWatch   = [...watchNicks];
    if (allSeen.length || allWatch.length) {
        avatarDiv.innerHTML = [
            ...allSeen.map(n  => `<div class="ci-avatar seen"    title="${esc(n)} — Visto">${esc(n[0].toUpperCase())}</div>`),
            ...allWatch.map(n => `<div class="ci-avatar watching" title="${esc(n)} — In corso">${esc(n[0].toUpperCase())}</div>`)
        ].join('');
    } else {
        avatarDiv.innerHTML = '';
    }
}

// ============================================
// CATALOGO — AGGIORNA ITEM UI
// ============================================
function updateCatalogItemUI(li) {
    const title     = li.dataset.title;
    const parent    = li.dataset.parent || null;
    const fbTitle   = parent ? parent + ' — ' + title : title;
    const key       = titleToKey(fbTitle);
    const data      = catalogData[key] || {};
    const users     = data.users || {};
    const avg       = avgRating(users);
    const seenUsers = Object.entries(users).filter(([, u]) => u.status === 'seen');
    const watchUsers= Object.entries(users).filter(([, u]) => u.status === 'watching');

    const ciMain   = li.querySelector('.ci-main');
    const nameSpan = ciMain.querySelector('.ci-name');
    const plainName = nameSpan.textContent;

    ciMain.innerHTML = `
        <span class="ci-name">${esc(plainName)}</span>
        ${avg ? `<span class="ci-stars">${avg.toFixed(1)}★</span>` : ''}
    `;

    let avatarDiv = li.querySelector('.ci-avatars');
    if (!avatarDiv) { avatarDiv = document.createElement('div'); avatarDiv.className = 'ci-avatars'; li.appendChild(avatarDiv); }
    avatarDiv.innerHTML = [...seenUsers.map(([n]) => `<div class="ci-avatar seen" title="${esc(n)} — Visto">${esc(n[0].toUpperCase())}</div>`),
        ...watchUsers.map(([n]) => `<div class="ci-avatar watching" title="${esc(n)} — In corso">${esc(n[0].toUpperCase())}</div>`)
    ].join('');
}

// ============================================
// FIREBASE — CATALOGO
// ============================================
onValue(catalogRef, snap => {
    catalogData = snap.val() || {};
    // Aggiorna item normali e sub-item
    document.querySelectorAll('.catalog-item:not(.catalog-folder)').forEach(li => updateCatalogItemUI(li));
    // Aggiorna cartelle (media dai sub-item)
    document.querySelectorAll('.catalog-folder').forEach(folder => updateFolderUI(folder));
});

// ============================================
// FIREBASE — CONSIGLIATI
// ============================================
onValue(suggestedRef, snap => {
    const raw = snap.val();
    allSuggested = raw ? Object.entries(raw).map(([id, val]) => ({ id, ...val })) : [];
    renderSuggested(allSuggested);
    if (window._apRenderSugg) window._apRenderSugg();
});

// ============================================
// POPUP VOTANTI CONSIGLIATI
// ============================================
function openSuggVotersPopup(item) {
    const ratings = item.ratings ? Object.entries(item.ratings) : [];
    if (!ratings.length) return;

    // Ordina per voto decrescente
    ratings.sort((a, b) => b[1] - a[1]);

    const overlay = document.getElementById('catalogPopupOverlay');
    overlay.innerHTML = `
        <div class="popup-box">
            <div class="popup-handle"></div>
            <div class="popup-title">${esc(item.title)}</div>
            <div class="popup-subtitle">Voti ricevuti — ${ratings.length} vot${ratings.length === 1 ? 'o' : 'i'}</div>
            <div class="voters-list">
                ${ratings.map(([nick, score]) => `
                    <div class="voter-row">
                        <div class="voter-avatar">${esc(nick[0].toUpperCase())}</div>
                        <span class="voter-nick">${esc(nick)}</span>
                        <span class="voter-score">${suggStarsHtml(score, 11)}</span>
                        <span class="voter-num">${score}/10</span>
                    </div>`).join('')}
            </div>
            <div class="popup-actions" style="margin-top:16px">
                <button class="btn-popup-cancel" id="votersClose" style="flex:1">Chiudi</button>
            </div>
        </div>`;

    overlay.style.display = 'flex';
    overlay.classList.remove('closing');
    addSwipeToClose(overlay);
    overlay.querySelector('#votersClose').addEventListener('click', closePopup);
    overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });
}

// ============================================
// POPUP VOTO CONSIGLIATI
// ============================================
function openSuggVotePopup(id, title) {
    const overlay = document.getElementById('catalogPopupOverlay');
    const pts = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';
    let selectedScore = 0;

    overlay.innerHTML = `
        <div class="popup-box">
            <div class="popup-handle"></div>
            <div class="popup-title">${esc(title)}</div>
            <div class="popup-subtitle">Dai il tuo voto (1–10)</div>

            <div class="popup-nick-row">
                <div class="field" style="flex:1;gap:5px">
                    <label style="font-size:12px">Nickname</label>
                    <input type="text" id="svpNick" placeholder="Lorem Ipsum" value="${esc(getNickname())}" autocomplete="off" maxlength="20">
                </div>
            </div>

            <div class="popup-stars-label">Il tuo voto <span style="font-size:10px;color:var(--low);font-weight:400;text-transform:none;letter-spacing:0">½ cliccando la metà sinistra</span></div>
            <div class="popup-stars" id="svpStars">
                ${Array.from({length:10}, (_, i) => {
                    const val = i + 1;
                    const uid = 'svp_' + Math.random().toString(36).slice(2,7);
                    return '<button class="star-btn" data-val="' + val + '" title="' + val + '/10">'
                        + '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
                        + '<defs><clipPath id="' + uid + '"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>'
                        + '<polygon class="star-full" points="' + pts + '"/>'
                        + '<polygon class="star-half" points="' + pts + '" clip-path="url(#' + uid + ')"/>'
                        + '</svg></button>';
                }).join('')}
            </div>

            <div class="popup-actions">
                <button class="btn-popup-cancel" id="svpCancel">Annulla</button>
                <button class="btn-popup-save" id="svpSave" disabled>Salva voto</button>
            </div>
        </div>`;

    overlay.style.display = 'flex';
    overlay.classList.remove('closing');
    addSwipeToClose(overlay);

    // Stelle
    function applyStars(btns, val) {
        btns.forEach(b => {
            const v = parseFloat(b.dataset.val);
            b.classList.remove('lit','half-lit');
            if (val >= v)          b.classList.add('lit');
            else if (val >= v-0.5) b.classList.add('half-lit');
        });
    }
    const starBtns = Array.from(overlay.querySelectorAll('.star-btn'));
    starBtns.forEach(btn => {
        btn.addEventListener('click', e => {
            const v = parseFloat(btn.dataset.val);
            const half = (e.clientX - btn.getBoundingClientRect().left) < btn.getBoundingClientRect().width / 2;
            selectedScore = half ? v - 0.5 : v;
            applyStars(starBtns, selectedScore);
            overlay.querySelector('#svpSave').disabled = false;
        });
        btn.addEventListener('mousemove', e => {
            const v = parseFloat(btn.dataset.val);
            const half = (e.clientX - btn.getBoundingClientRect().left) < btn.getBoundingClientRect().width / 2;
            applyStars(starBtns, half ? v - 0.5 : v);
        });
        btn.addEventListener('mouseleave', () => applyStars(starBtns, selectedScore));
    });

    overlay.querySelector('#svpSave').addEventListener('click', async () => {
        const nick = overlay.querySelector('#svpNick').value.trim();
        if (!nick) { alert('Inserisci il tuo nickname.'); return; }
        if (!selectedScore) { alert('Seleziona un voto.'); return; }
        saveNickname(nick);
        const saveBtn = overlay.querySelector('#svpSave');
        saveBtn.disabled = true; saveBtn.textContent = 'Salvataggio…';
        await voteSuggested(id, selectedScore);
        closePopup();
    });

    overlay.querySelector('#svpCancel').addEventListener('click', closePopup);
    overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });
}

// ============================================
// CONSIGLIATI — VOTA (score 1-10)
// ============================================
async function voteSuggested(id, score) {
    const myNick = getNickname();
    if (!myNick) { alert('Imposta prima il tuo Nickname!'); return; }
    const item = allSuggested.find(s => s.id === id);
    if (!item) return;
    if (item.nick === myNick) { alert('Non puoi votare un tuo consiglio!'); return; }

    // Salva il voto sotto suggested/{id}/ratings/{nick}
    try {
        await set(ref(db, `suggested/${id}/ratings/${myNick}`), score);
        saveSuggRating(id, score);
    } catch (e) { alert('Errore: ' + e.message); }
}

// ============================================
// CONSIGLIATI — MEDIA VOTI
// ============================================
function suggAvg(item) {
    const ratings = item.ratings ? Object.values(item.ratings) : [];
    if (!ratings.length) return null;
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    // arrotonda al mezzo punto più vicino per le stelle
    const rounded = Math.round(avg * 2) / 2;
    return { avg: Math.round(avg * 10) / 10, rounded, count: ratings.length };
}

// Genera 10 stelline SVG inline con supporto mezze stelle (step 0.5)
function suggStarsHtml(score, size = 11) {
    if (!score) return '';
    const pts = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';
    let s = '';
    for (let i = 1; i <= 10; i++) {
        if (score >= i) {
            // stella piena
            s += `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
        } else if (score >= i - 0.5) {
            // mezza stella — clipPath
            const uid = 'sg' + i + Math.random().toString(36).slice(2,5);
            s += `<svg width="${size}" height="${size}" viewBox="0 0 24 24">`
               + `<defs><clipPath id="${uid}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>`
               + `<polygon points="${pts}" fill="none" stroke="#475569" stroke-width="1.5" stroke-linejoin="round"/>`
               + `<polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round" clip-path="url(#${uid})"/>`
               + `</svg>`;
        } else {
            // stella vuota
            s += `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><polygon points="${pts}" fill="none" stroke="#475569" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
        }
    }
    return `<span style="display:inline-flex;align-items:center;gap:1px">${s}</span>`;
}

// ============================================
// CONSIGLIATI — RENDER
// ============================================
function renderSuggested(list) {
    const el    = document.getElementById('suggestedList');
    const badge = document.getElementById('suggestedCount');
    if (!el) return;
    badge.textContent = list.length;

    if (!list.length) {
        el.innerHTML = '<div class="sugg-empty">Nessun consiglio ancora.<br>Sii il primo!</div>';
        return;
    }

    const myNick = getNickname();

    // ── CLASSIFICA ──
    if (currentSuggSort === 'rank') {
        // Calcola media per ogni item, ordina: media desc → a parità timestamp asc
        const withAvg = list.map(item => ({ ...item, _avg: suggAvg(item) }));
        const sorted  = withAvg.sort((a, b) => {
            const aAvg = a._avg ? a._avg.avg : -1;
            const bAvg = b._avg ? b._avg.avg : -1;
            return bAvg !== aAvg ? bAvg - aAvg : (a.timestamp || 0) - (b.timestamp || 0);
        });
        const medals     = ['🥇', '🥈', '🥉'];
        const showMedals = sorted.length >= 1;  // medaglie sempre visibili

        el.innerHTML = sorted.map((item, idx) => {
            const rank     = idx + 1;
            const isTop    = showMedals && rank <= 3;
            const medal    = isTop ? medals[idx] : '';
            const isOwn    = myNick && item.nick === myNick;
            // Controlla sia localStorage che ratings Firebase (per chi ha votato al momento dell'inserimento)
            const myScore  = getSuggRating(item.id) || (myNick && item.ratings && item.ratings[myNick]) || 0;
            const voted    = myScore > 0;
            // Se il voto è in Firebase ma non in localStorage, salvalo
            if (myNick && item.ratings && item.ratings[myNick] && !getSuggRating(item.id)) {
                saveSuggRating(item.id, item.ratings[myNick]);
            }
            const avgData  = item._avg;

            return `
                <div class="sugg-item ${isTop ? 'sugg-top sugg-top-' + rank : ''}">
                    <div class="sugg-item-top">
                        ${medal ? `<span class="sugg-medal">${medal}</span>` : `<span class="sugg-rank">${rank}</span>`}
                        <div class="sugg-title-wrap">
                            <span class="sugg-title">${esc(item.title)}</span>
                            <span class="sugg-by">${esc(item.nick)}</span>
                        </div>
                        ${(isAdminMode || item.nick === myNick) ? `<button class="sugg-delete" data-id="${item.id}" title="Rimuovi">✕</button>` : ''}
                    </div>
                    <div class="sugg-item-bottom">
                        <div class="sugg-avg-wrap">
                            ${avgData
                                ? `<span class="sugg-avg">${suggStarsHtml(avgData.rounded, 11)} <span class="sugg-avg-num">${avgData.avg.toFixed(1)}/10</span> <button class="sugg-votes-btn" data-id="${item.id}" title="Vedi chi ha votato">(${avgData.count} vot${avgData.count === 1 ? 'o' : 'i'})</button></span>`
                                : `<span class="sugg-avg sugg-avg-none">nessun voto ancora</span>`}
                        </div>
                        <div class="sugg-score-wrap">
                            ${isOwn && !voted
                                ? `<span class="sugg-own-badge">tuo</span>`
                                : voted
                                    ? `<span class="sugg-voted-score"><span style="font-size:11px;color:var(--teal-light)">Voto: ${myScore}/10</span></span>`
                                    : isOwn
                                        ? `<span class="sugg-own-badge">tuo</span>`
                                        : `<button class="btn-sugg-vote-open" data-id="${item.id}" data-title="${esc(item.title)}" data-nick="${esc(item.nick)}">Vota</button>`
                            }
                        </div>
                    </div>
                </div>`;
        }).join('');

    // ── A → Z ──
    } else if (currentSuggSort === 'alpha') {
        const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title, 'it'));
        el.innerHTML = sorted.map(item => `
            <div class="sugg-item">
                <div class="sugg-info">
                    <span class="sugg-title">${esc(item.title)}</span>
                    <span class="sugg-by">${esc(item.nick)}</span>
                </div>
                ${(isAdminMode || item.nick === myNick) ? `<button class="sugg-delete" data-id="${item.id}" title="Rimuovi">✕</button>` : ''}
            </div>`).join('');

    }

    // Listener contatore voti — mostra chi ha votato
    el.querySelectorAll('.sugg-votes-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const item = allSuggested.find(s => s.id === btn.dataset.id);
            if (!item) return;
            openSuggVotersPopup(item);
        });
    });

    // Listener bottone Vota — apre popup stelline
    el.querySelectorAll('.btn-sugg-vote-open').forEach(btn => {
        btn.addEventListener('click', () => openSuggVotePopup(btn.dataset.id, btn.dataset.title));
    });

    // Listener stelline voto 1-10 con mezze stelle (non più usato in classifica ma mantenuto per compatibilità)
    el.querySelectorAll('.sugg-stars-input').forEach(wrap => {
        const id   = wrap.dataset.id;
        const btns = Array.from(wrap.querySelectorAll('.ssb'));
        const pts  = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';

        function renderPreview(hoverScore) {
            btns.forEach((b, i) => {
                const v = i + 1;
                if (hoverScore >= v) {
                    b.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24"><polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
                } else if (hoverScore >= v - 0.5) {
                    const uid = 'ph' + i;
                    b.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24">`
                        + `<defs><clipPath id="${uid}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>`
                        + `<polygon points="${pts}" fill="none" stroke="#475569" stroke-width="1.5" stroke-linejoin="round"/>`
                        + `<polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round" clip-path="url(#${uid})"/>`
                        + `</svg>`;
                } else {
                    b.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24"><polygon points="${pts}" fill="none" stroke="#475569" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
                }
            });
        }

        function resetStars() {
            btns.forEach(b => { b.innerHTML = '★'; b.style.color = '#475569'; });
        }

        // Inizializza stelle come testo (★) — più leggero
        resetStars();

        btns.forEach((btn, i) => {
            btn.addEventListener('mousemove', e => {
                const rect = btn.getBoundingClientRect();
                const half = (e.clientX - rect.left) < rect.width / 2;
                const score = half ? i + 0.5 : i + 1;
                renderPreview(score);
                btn.dataset.currentScore = score;
            });
            btn.addEventListener('mouseleave', () => {
                resetStars();
                delete btn.dataset.currentScore;
            });
            btn.addEventListener('click', e => {
                const rect  = btn.getBoundingClientRect();
                const half  = (e.clientX - rect.left) < rect.width / 2;
                const score = half ? i + 0.5 : i + 1;
                voteSuggested(id, score);
            });
        });

        wrap.addEventListener('mouseleave', resetStars);
    });
    // Listener elimina
    el.querySelectorAll('.sugg-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Rimuovere questo consiglio?')) return;
            try { await remove(ref(db, 'suggested/' + btn.dataset.id)); }
            catch (e) { alert('Errore: ' + e.message); }
        });
    });
}

// ============================================
// CONSIGLIATI — FORM SUBMIT
// ============================================
function initSuggFormStars() {
    const wrap        = document.getElementById('suggFormStars');
    const ratingInput = document.getElementById('suggFormRating');
    if (!wrap) return;

    const pts = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';
    let currentRating = 0;
    let hoverRating   = 0;

    // Crea i 10 bottoni stelle una volta sola
    wrap.innerHTML = '';
    const starBtns = Array.from({length: 10}, (_, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.idx = i;
        btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:1px;line-height:1';
        wrap.appendChild(btn);
        return btn;
    });
    const label = document.createElement('span');
    label.style.cssText = 'font-size:13px;color:#cbd5e1;font-weight:600;margin-left:6px;display:none';
    wrap.appendChild(label);
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = '✕';
    clearBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;color:#64748b;margin-left:4px;display:none';
    wrap.appendChild(clearBtn);

    function starSVG(type) {
        const uid = 'sfs_' + Math.random().toString(36).slice(2,7);
        if (type === 'full')
            return `<svg width="18" height="18" viewBox="0 0 24 24"><polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
        if (type === 'half')
            return `<svg width="18" height="18" viewBox="0 0 24 24"><defs><clipPath id="${uid}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs><polygon points="${pts}" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linejoin="round"/><polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round" clip-path="url(#${uid})"/></svg>`;
        return `<svg width="18" height="18" viewBox="0 0 24 24"><polygon points="${pts}" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    }

    function refreshStars(active) {
        starBtns.forEach((btn, i) => {
            const v = i + 1;
            if (active >= v)          btn.innerHTML = starSVG('full');
            else if (active >= v-0.5) btn.innerHTML = starSVG('half');
            else                      btn.innerHTML = starSVG('empty');
        });
        if (active > 0) {
            label.textContent = active.toFixed(1) + '/10';
            label.style.display = '';
            clearBtn.style.display = '';
        } else {
            label.style.display = 'none';
            clearBtn.style.display = 'none';
        }
    }

    refreshStars(0);

    starBtns.forEach((btn, i) => {
        btn.addEventListener('mousemove', e => {
            const rect = btn.getBoundingClientRect();
            hoverRating = (e.clientX - rect.left) < rect.width / 2 ? i + 0.5 : i + 1;
            refreshStars(hoverRating);
        });
        btn.addEventListener('mouseleave', () => {
            hoverRating = 0;
            refreshStars(currentRating);
        });
        btn.addEventListener('click', e => {
            const rect = btn.getBoundingClientRect();
            currentRating = (e.clientX - rect.left) < rect.width / 2 ? i + 0.5 : i + 1;
            if (ratingInput) ratingInput.value = currentRating;
            refreshStars(currentRating);
        });
    });

    clearBtn.addEventListener('click', () => {
        currentRating = 0;
        if (ratingInput) ratingInput.value = 0;
        refreshStars(0);
    });
}

document.getElementById('suggSubmit').addEventListener('click', async () => {
    const titleEl  = document.getElementById('suggTitle');
    const nickEl   = document.getElementById('suggNick');
    const ratingEl = document.getElementById('suggFormRating');
    const title    = titleEl.value.trim();
    const nick     = nickEl.value.trim();
    const rating   = parseFloat(ratingEl?.value || 0) || 0;

    // Validazione campi obbligatori
    let suggError = '';
    if (!title)  suggError = 'Inserisci il titolo del consiglio.';
    else if (!nick)   suggError = 'Inserisci il tuo nickname.';
    else if (!rating) suggError = 'Inserisci il tuo voto (1–10).';
    if (suggError) {
        showFormError('suggForm', suggError);
        return;
    }
    saveNickname(nick);
    const btn = document.getElementById('suggSubmit');
    btn.disabled = true;
    btn.querySelector('.btn-submit-text').textContent = 'Invio…';
    try {
        const payload = { title, nick, votes: 0, timestamp: Date.now() };
        // Se ha messo un voto, lo aggiungiamo subito come suo rating
        if (rating > 0) {
            if (!payload.ratings) payload.ratings = {};
            payload.ratings[nick] = rating;
        }
        await push(suggestedRef, payload);
        titleEl.value = '';
        // Reset stelle
        if (ratingEl) ratingEl.value = 0;
        initSuggFormStars();
    } catch (e) { alert('Errore: ' + e.message); }
    finally {
        btn.disabled = false;
        btn.querySelector('.btn-submit-text').textContent = 'Aggiungi consiglio';
    }
});

// ============================================
// CONSIGLIATI — TAB SORT
// ============================================
document.querySelectorAll('[data-sugg-sort]').forEach(tab => {
    tab.addEventListener('click', function () {
        document.querySelectorAll('[data-sugg-sort]').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentSuggSort = this.dataset.suggSort;
        renderSuggested(allSuggested);
    });
});

// ============================================
// CATALOGO — ACCORDION + RICERCA + CLICK POPUP
// ============================================
function initCatalog() {
    // Ora vuota — il catalogo è renderizzato da renderCatalogFromFirebase()
    // Lasciata per compatibilità con eventuali chiamate residue
}

// ============================================
// CATALOGO — RENDER DA FIREBASE
// ============================================
function renderCatalogFromFirebase() {
    const container = document.getElementById('catalogContainer');
    if (!container) return;

    const tv   = catalogStructure.serietv || [];
    const film = catalogStructure.film    || [];

    if (!tv.length && !film.length) {
        container.innerHTML = '<div class="catalog-empty">Nessun titolo nel catalogo.<br>Aggiungili dal pannello admin → 🗂️ Catalogo.</div>';
        return;
    }

    container.innerHTML = buildCategoryHTML('cat-serietv', 'Serie TV', 'dot-tv', 'count-serietv', 'folders-serietv', 'episodes-serietv', tv)
                        + buildCategoryHTML('cat-film',    'Film',     'dot-film','count-film',    'folders-film',    'episodes-film',    film)
                        + '<div id="catalogNoResults" class="catalog-empty" style="display:none">Nessun titolo trovato.</div>';

    // Aggancia eventi
    attachCatalogEvents();

    // Aggiorna contatori
    updateAllCategoryCounters();
}

function buildCategoryHTML(catId, catName, dotClass, countId, foldersId, episodesId, items) {
    // Ordina items alfabeticamente per titolo (cartelle e singoli misti)
    const sortedItems = [...items].sort((a, b) => a.title.localeCompare(b.title, 'it', {sensitivity:'base'}));
    const listHTML = sortedItems.map(item => {
        const safe = esc(item.title);
        if (item.type === 'folder') {
            const subsHTML = (item.children || []).map(sub => {
                const safeSub = esc(sub);
                return `<li class="catalog-item catalog-subitem" data-title="${safeSub}" data-parent="${safe}"><div class="ci-main"><span class="ci-name">${safeSub}</span></div></li>`;
            }).join('');
            return `<li class="catalog-item catalog-folder" data-title="${safe}" data-type="folder">
                <div class="ci-main"><span class="ci-name">${safe}</span><span class="ci-folder-toggle">▶</span></div>
                <ul class="ci-folder-list">${subsHTML}</ul>
            </li>`;
        } else {
            return `<li class="catalog-item" data-title="${safe}"><div class="ci-main"><span class="ci-name">${safe}</span></div></li>`;
        }
    }).join('');

    return `<div class="catalog-category">
        <button class="catalog-cat-btn" data-target="${catId}" aria-expanded="false">
            <span class="cat-left">
                <span class="cat-dot ${dotClass}"></span>
                <span class="cat-name">${catName}</span>
                <span class="cat-count cat-count-folders" id="${foldersId}"></span>
                <span class="cat-episodes" id="${episodesId}"></span>
                <span style="display:none" id="${countId}">0</span>
            </span>
            <span class="cat-chevron"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </button>
        <div class="catalog-panel" id="${catId}">
            <ul class="catalog-list">${listHTML}</ul>
        </div>
    </div>`;
}

function attachCatalogEvents() {
    // Accordion — gestito dalla delegazione sopra

    // Cartelle — tutte chiuse di default
    document.querySelectorAll('.catalog-folder').forEach(folder => {
        folder.classList.remove('folder-open');
    });

    // Delegazione eventi sul container — funziona anche durante la ricerca
    const catalogContainer = document.getElementById('catalogContainer');
    if (catalogContainer) {
        // Rimuovi vecchi listener clonando
        const newContainer = catalogContainer.cloneNode(true);
        catalogContainer.parentNode.replaceChild(newContainer, catalogContainer);

        newContainer.addEventListener('click', e => {
            // Toggle ▶ espandi/chiudi
            const toggle = e.target.closest('.ci-folder-toggle');
            if (toggle) {
                e.stopPropagation();
                const folder = toggle.closest('.catalog-folder');
                if (folder) {
                    folder.classList.toggle('folder-open');
                    updateFolderUI(folder);
                }
                return;
            }

            // Click sul nome cartella → popup
            const nameSpan = e.target.closest('.catalog-folder > .ci-main .ci-name');
            if (nameSpan) {
                e.stopPropagation();
                const folder = nameSpan.closest('.catalog-folder');
                if (folder) openFolderPopup(folder);
                return;
            }

            // Click su sub-item
            const subitem = e.target.closest('.catalog-subitem');
            if (subitem) {
                e.stopPropagation();
                openCatalogPopup(subitem.dataset.title, subitem.dataset.parent || null);
                return;
            }

            // Click su item singolo
            const single = e.target.closest('.catalog-item:not(.catalog-folder):not(.catalog-subitem)');
            if (single) {
                openCatalogPopup(single.dataset.title);
            }
        });

        // Ri-aggancia accordion categorie sul nuovo container
        newContainer.querySelectorAll('.catalog-cat-btn').forEach(btn => {
            btn.setAttribute('aria-expanded', 'false');
            btn.addEventListener('click', function() {
                const id    = this.dataset.target;
                const panel = document.getElementById(id);
                const open  = panel?.classList.contains('open');
                newContainer.querySelectorAll('.catalog-panel').forEach(p => p.classList.remove('open'));
                newContainer.querySelectorAll('.catalog-cat-btn').forEach(b => b.setAttribute('aria-expanded','false'));
                if (!open && panel) { panel.classList.add('open'); this.setAttribute('aria-expanded','true'); }
            });
        });
    }

    // Click su item e sub-item — gestiti dalla delegazione sopra

    // Salva plainName per ricerca
    document.querySelectorAll('.catalog-item').forEach(li => {
        li.dataset.plainName = li.querySelector('.ci-name')?.textContent || '';
    });

    // Ricerca
    const searchInput = document.getElementById('catalogSearch');
    const noResults   = document.getElementById('catalogNoResults');
    if (searchInput) {
        // Rimuovi vecchi listener clonando
        const newSearch = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearch, searchInput);
        newSearch.addEventListener('input', function() {
            const q = this.value.trim().toLowerCase();
            if (!q) {
                document.querySelectorAll('.catalog-item').forEach(li => {
                    li.classList.remove('hidden');
                    li.querySelector('.ci-name').innerHTML = esc(li.dataset.plainName);
                });
                document.querySelectorAll('.catalog-panel').forEach(p => p.classList.remove('open'));
                document.querySelectorAll('.catalog-cat-btn').forEach(b => b.setAttribute('aria-expanded','false'));
                if (noResults) noResults.style.display = 'none';
                return;
            }
            let anyVisible = false;
            document.querySelectorAll('.catalog-category').forEach(cat => {
                const panel  = cat.querySelector('.catalog-panel');
                const catBtn = cat.querySelector('.catalog-cat-btn');
                let catHasMatch = false;
                cat.querySelectorAll('.catalog-item').forEach(li => {
                    const plain = li.dataset.plainName || '';
                    const match = plain.toLowerCase().includes(q);
                    li.classList.toggle('hidden', !match);
                    const nameEl = li.querySelector('.ci-name');
                    if (!nameEl) return;
                    if (match) {
                        catHasMatch = true; anyVisible = true;
                        const idx2 = plain.toLowerCase().indexOf(q);
                        nameEl.innerHTML =
                            esc(plain.slice(0,idx2)) + '<mark>' + esc(plain.slice(idx2, idx2+q.length)) + '</mark>' + esc(plain.slice(idx2+q.length));
                        // Se è un sub-item, apri la cartella padre
                        if (li.classList.contains('catalog-subitem')) {
                            const folder = li.closest('.catalog-folder');
                            if (folder) folder.classList.add('folder-open');
                        }
                    } else {
                        nameEl.innerHTML = esc(plain);
                    }
                });
                // Apri anche le cartelle che hanno sub-item visibili
                cat.querySelectorAll('.catalog-folder').forEach(folder => {
                    const hasVisible = Array.from(folder.querySelectorAll('.catalog-subitem'))
                        .some(s => !s.classList.contains('hidden'));
                    if (hasVisible) {
                        folder.classList.add('folder-open');
                        folder.classList.remove('hidden');
                        catHasMatch = true; anyVisible = true;
                    }
                });
                panel.classList.toggle('open', catHasMatch);
                catBtn.setAttribute('aria-expanded', catHasMatch ? 'true' : 'false');
            });
            if (noResults) noResults.style.display = anyVisible ? 'none' : 'block';
        });
    }

    // Aggiorna voti/stati dal catalogData Firebase
    document.querySelectorAll('.catalog-item:not(.catalog-folder)').forEach(li => updateCatalogItemUI(li));
    document.querySelectorAll('.catalog-folder').forEach(folder => updateFolderUI(folder));
}

function updateAllCategoryCounters() {
    ['serietv','film'].forEach(key => {
        const panel     = document.getElementById('cat-' + key);
        const countEl   = document.getElementById('count-' + key);
        const foldersEl = document.getElementById('folders-' + key);
        if (!panel) return;
        if (countEl) {
            const singles  = panel.querySelectorAll('.catalog-item:not(.catalog-folder):not(.catalog-subitem)').length;
            const subitems = panel.querySelectorAll('.catalog-subitem').length;
            countEl.textContent = singles + subitems;
        }
        if (foldersEl) {
            const n = panel.querySelectorAll('.catalog-folder').length;
            if (n > 0) foldersEl.textContent = n + ' cart.';
        }
    });
}

// ============================================
// FIREBASE — STRUTTURA CATALOGO
// ============================================
// Firebase salva gli array come oggetti {0:{...},1:{...}} — convertiamo
function fbToArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return Object.values(val).map(item => {
        if (item && item.children && !Array.isArray(item.children)) {
            item.children = Object.values(item.children);
        }
        return item;
    });
}

onValue(catalogStructRef, snap => {
    const data = snap.val();
    if (data) {
        catalogStructure.serietv = fbToArray(data.serietv);
        catalogStructure.film    = fbToArray(data.film);
                }
    renderCatalogFromFirebase();
    // Ricarica counters Firebase dopo render
    const countersSnap = get(ref(db, 'counters'));
    countersSnap.then(s => {
        if (!s.exists()) return;
        const d = s.val();
        const suffixes2 = {
            'folders-serietv':  ' cart.',
            'episodes-serietv': ' ep.',
            'folders-film':     ' cart.',
            'episodes-film':    ' titoli'
        };
        const map = { 'folders-serietv':'folders-serietv','episodes-serietv':'episodes-serietv','folders-film':'folders-film','episodes-film':'episodes-film' };
        Object.entries(map).forEach(([k,elId]) => {
            const el = document.getElementById(elId);
            if (el && d[k]) {
                const num = String(d[k]).replace(/[^0-9]/g, '');
                el.textContent = num + (suffixes2[k] || '');
            }
        });
    });
});

// ============================================
// PANNELLO ADMIN
// ============================================
function openAdminPanel() {
    const existing = document.getElementById('adminPanelOverlay');
    if (existing) { existing.remove(); return; }

    // Raccogli titoli catalogo dal DOM
    const catalogItems = Array.from(document.querySelectorAll('.catalog-item')).map(li => ({
        title: li.dataset.title,
        category: li.closest('.catalog-category')?.querySelector('.cat-name')?.textContent || ''
    }));

    const overlay = document.createElement('div');
    overlay.id = 'adminPanelOverlay';
    overlay.className = 'admin-panel-overlay';
    overlay.innerHTML = `
        <div class="admin-panel">
            <div class="admin-panel-header">
                <h2 class="admin-panel-title">🔓 Pannello Admin</h2>
                <button class="admin-panel-close" id="adminPanelClose">✕</button>
            </div>

            <div class="admin-tabs">
                <button class="admin-tab active" data-panel="richieste">📋 Richieste</button>
                <button class="admin-tab" data-panel="evase">✅ Evase</button>
                <button class="admin-tab" data-panel="consigliati">💡 Consigliati</button>
                <button class="admin-tab" data-panel="catalogo">🗂️ Catalogo</button>
                <button class="admin-tab" data-panel="contatori">🔢 Contatori</button>
            </div>

            <!-- RICHIESTE -->
            <div class="admin-section active" id="ap-richieste">
                <p class="admin-hint">Puoi evadere o eliminare ogni richiesta.</p>
                <div id="ap-req-list" class="ap-list"></div>
            </div>

            <!-- EVASE -->
            <div class="admin-section" id="ap-evase">
                <p class="admin-hint">Richieste già evase — puoi eliminarle.</p>
                <div id="ap-ev-list" class="ap-list"></div>
            </div>

            <!-- CONSIGLIATI -->
            <div class="admin-section" id="ap-consigliati">
                <p class="admin-hint">Puoi eliminare qualsiasi consiglio.</p>
                <div id="ap-sugg-list" class="ap-list"></div>
            </div>

            <!-- CONTATORI -->
            <div class="admin-section" id="ap-contatori">
                <p class="admin-hint">I valori vengono salvati su Firebase e persistono al reload.</p>
                <div class="ap-counter-grid">
                    <div class="ap-counter-item">
                        <label>📺 Serie TV — cartelle</label>
                        <div class="ap-counter-row">
                            <input type="text" id="apFoldersTV" placeholder="Es: 122 cart.">
                            <button class="ap-counter-save" data-key="folders-serietv" data-target="folders-serietv" data-input="apFoldersTV">Salva</button>
                        </div>
                    </div>
                    <div class="ap-counter-item">
                        <label>📺 Serie TV — episodi</label>
                        <div class="ap-counter-row">
                            <input type="text" id="apEpisodesTV" placeholder="Es: 3400 ep.">
                            <button class="ap-counter-save" data-key="episodes-serietv" data-target="episodes-serietv" data-input="apEpisodesTV">Salva</button>
                        </div>
                    </div>
                    <div class="ap-counter-item">
                        <label>🎬 Film — cartelle</label>
                        <div class="ap-counter-row">
                            <input type="text" id="apFoldersFilm" placeholder="Es: 42 cart.">
                            <button class="ap-counter-save" data-key="folders-film" data-target="folders-film" data-input="apFoldersFilm">Salva</button>
                        </div>
                    </div>
                    <div class="ap-counter-item">
                        <label>🎬 Film — totale</label>
                        <div class="ap-counter-row">
                            <input type="text" id="apEpisodesFilm" placeholder="Es: 345 tot.">
                            <button class="ap-counter-save" data-key="episodes-film" data-target="episodes-film" data-input="apEpisodesFilm">Salva</button>
                        </div>
                    </div>

                </div>
            </div>

            <!-- CATALOGO -->
            <div class="admin-section" id="ap-catalogo">
                <div class="ap-cat-layout">

                    <!-- Colonna sinistra: form aggiungi -->
                    <div class="ap-cat-sidebar">
                        <div class="ap-sidebar-title">Nuovo titolo</div>
                        <input type="text" id="apNewTitle" placeholder="Titolo…" autocomplete="off" style="margin-bottom:6px">
                        <select id="apNewCat" style="margin-bottom:6px">
                            <option value="cat-serietv">📺 Serie TV</option>
                            <option value="cat-film">🎬 Film</option>
                        </select>
                        <select id="apNewType" style="margin-bottom:8px">
                            <option value="single">Titolo singolo</option>
                            <option value="folder">📁 Cartella</option>
                        </select>
                        <button id="apAddTitle" class="ap-btn-add ap-btn-full">+ Aggiungi</button>

                        <div class="ap-sidebar-divider"></div>

                        <div class="ap-sidebar-title">Sotto-titolo</div>
                        <select id="apSubFolder" style="margin-bottom:6px"></select>
                        <input type="text" id="apSubTitle" placeholder="Es: Stagione 2" autocomplete="off" style="margin-bottom:8px">
                        <button id="apAddSub" class="ap-btn-add ap-btn-full ap-btn-secondary">+ Aggiungi</button>
                    </div>

                    <!-- Colonna destra: lista + filtri -->
                    <div class="ap-cat-main">
                        <div class="ap-filter-bar">
                            <button class="ap-filter-btn active" data-filter="">Tutti</button>
                            <button class="ap-filter-btn" data-filter="cat-serietv">Serie TV</button>
                            <button class="ap-filter-btn" data-filter="cat-film">Film</button>
                        </div>
                        <div class="ap-cat-search-wrap">
                            <input type="search" id="apCatSearch" placeholder="Cerca titolo…" autocomplete="off">
                        </div>
                        <div id="ap-cat-list" class="ap-list ap-cat-list-tall"></div>
                    </div>
                </div>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    // Chiudi
    overlay.querySelector('#adminPanelClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Tab switching
    overlay.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            overlay.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            overlay.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
            this.classList.add('active');
            overlay.querySelector('#ap-' + this.dataset.panel).classList.add('active');
        });
    });

    // ── Popola RICHIESTE ──
    function renderApRequests() {
        const el = overlay.querySelector('#ap-req-list');
        if (!allRequests.length) { el.innerHTML = '<div class="ap-empty">Nessuna richiesta.</div>'; return; }
        const sorted = [...allRequests].sort((a, b) => b.timestamp - a.timestamp);
        el.innerHTML = sorted.map(req => `
            <div class="ap-item">
                <div class="ap-item-info">
                    <span class="ap-item-title">${esc(req.title)}</span>
                    <span class="ap-item-meta">${esc(req.type)} · ${esc(req.requester)} · ${esc(req.date)}</span>
                    ${req.notes ? `<span class="ap-item-notes">${esc(req.notes)}</span>` : ''}
                </div>
                <div class="ap-item-actions">
                    <button class="ap-btn ap-btn-evade" data-id="${req.id}" data-title="${esc(req.title)}">Evadi</button>
                    <button class="ap-btn ap-btn-del" data-id="${req.id}" data-title="${esc(req.title)}" data-type="request">✕</button>
                </div>
            </div>`).join('');
        el.querySelectorAll('.ap-btn-evade').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Evadere "${btn.dataset.title}"?`)) return;
                await evade(btn.dataset.id, btn.dataset.title);
                renderApRequests();
                renderApEvased();
            });
        });
        el.querySelectorAll('.ap-btn-del[data-type="request"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Eliminare definitivamente "${btn.dataset.title}"?`)) return;
                try { await remove(ref(db, 'requests/' + btn.dataset.id)); renderApRequests(); }
                catch(e) { alert('Errore: ' + e.message); }
            });
        });
    }

    // ── Popola EVASE ──
    function renderApEvased() {
        const el = overlay.querySelector('#ap-ev-list');
        if (!allEvased.length) { el.innerHTML = '<div class="ap-empty">Nessuna richiesta evasa.</div>'; return; }
        const sorted = [...allEvased].sort((a, b) => b.evadedTimestamp - a.evadedTimestamp);
        el.innerHTML = sorted.map(req => `
            <div class="ap-item">
                <div class="ap-item-info">
                    <span class="ap-item-title">${esc(req.title)}</span>
                    <span class="ap-item-meta">${esc(req.type)} · ${esc(req.requester)} · Evasa: ${esc(req.evadedAt)}</span>
                </div>
                <div class="ap-item-actions">
                    <button class="ap-btn ap-btn-del" data-id="${req.id}" data-title="${esc(req.title)}">✕</button>
                </div>
            </div>`).join('');
        el.querySelectorAll('.ap-btn-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Eliminare "${btn.dataset.title}" dalle evase?`)) return;
                try { await remove(ref(db, 'evased/' + btn.dataset.id)); renderApEvased(); }
                catch(e) { alert('Errore: ' + e.message); }
            });
        });
    }

    // ── Popola CONSIGLIATI ──
    function renderApSugg() {
        const el = overlay.querySelector('#ap-sugg-list');
        if (!allSuggested.length) { el.innerHTML = '<div class="ap-empty">Nessun consiglio.</div>'; return; }
        const sorted = [...allSuggested].sort((a, b) => a.title.localeCompare(b.title, 'it'));
        el.innerHTML = sorted.map(s => `
            <div class="ap-item">
                <div class="ap-item-info">
                    <span class="ap-item-title">${esc(s.title)}</span>
                    <span class="ap-item-meta">di ${esc(s.nick)}</span>
                </div>
                <div class="ap-item-actions">
                    <button class="ap-btn ap-btn-del" data-id="${s.id}" data-title="${esc(s.title)}">✕</button>
                </div>
            </div>`).join('');
        el.querySelectorAll('.ap-btn-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Eliminare il consiglio "${btn.dataset.title}"?`)) return;
                try { await remove(ref(db, 'suggested/' + btn.dataset.id)); renderApSugg(); }
                catch(e) { alert('Errore: ' + e.message); }
            });
        });
    }

    // ── Popola CATALOGO (da catalogStructure Firebase) ──
    function getFilteredItems(filterCat, searchQ) {
        let items = [];
        if (!filterCat || filterCat === 'cat-serietv') {
            (catalogStructure.serietv || []).forEach(i => items.push({...i, _cat:'serietv', _catLabel:'Serie TV'}));
        }
        if (!filterCat || filterCat === 'cat-film') {
            (catalogStructure.film || []).forEach(i => items.push({...i, _cat:'film', _catLabel:'Film'}));
        }
        if (searchQ) {
            const q = searchQ.toLowerCase();
            items = items.filter(i =>
                i.title.toLowerCase().includes(q) ||
                (i.children || []).some(s => s.toLowerCase().includes(q))
            );
        }
        return items.sort((a,b) => a.title.localeCompare(b.title,'it'));
    }

    async function saveStructureToFirebase() {
        try {
            await set(ref(db, 'catalogStructure'), catalogStructure);
        } catch(e) { alert('Errore salvataggio Firebase: ' + e.message); }
    }

    function renderApCatalog(filterCat = '', searchQ = '') {
        const el = overlay.querySelector('#ap-cat-list');
        const items = getFilteredItems(filterCat, searchQ);
        if (!items.length) { el.innerHTML = '<div class="ap-empty">Nessun risultato.</div>'; return; }

        el.innerHTML = items.map(item => {
            const isFolder = item.type === 'folder';
            const subs     = item.children || [];
            return `<div class="ap-item ${isFolder ? 'ap-item-folder' : ''}">
                <div class="ap-item-info">
                    <span class="ap-item-title">${isFolder ? '📁 ' : ''}${esc(item.title)}</span>
                    <span class="ap-item-meta">${item._catLabel}${isFolder ? ' · ' + subs.length + ' titoli interni' : ''}</span>
                    ${isFolder && subs.length ? '<div class="ap-subitems">' + subs.map(s =>
                        `<span class="ap-subitem-tag">${esc(s)}<button class="ap-subitem-del" data-title="${esc(s)}" data-parent="${esc(item.title)}" data-cat="${item._cat}">&times;</button></span>`
                    ).join('') + '</div>' : ''}
                </div>
                <div class="ap-item-actions">
                    <button class="ap-btn ap-btn-del" data-title="${esc(item.title)}" data-cat="${item._cat}" data-folder="${isFolder}">&times;</button>
                </div>
            </div>`;
        }).join('');

        // Elimina titolo o cartella
        el.querySelectorAll('.ap-btn-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                const title    = btn.dataset.title;
                const cat      = btn.dataset.cat;
                const isFolder = btn.dataset.folder === 'true';
                if (!confirm(`Rimuovere "${title}"?`)) return;
                catalogStructure[cat] = catalogStructure[cat].filter(i => i.title !== title);
                await saveStructureToFirebase();
                renderApCatalog(overlay.querySelector('.ap-filter-btn.active')?.dataset.filter || '', overlay.querySelector('#apCatSearch')?.value || '');
            });
        });

        // Elimina sub-item
        el.querySelectorAll('.ap-subitem-del').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const sub    = btn.dataset.title;
                const parent = btn.dataset.parent;
                const cat    = btn.dataset.cat;
                if (!confirm(`Rimuovere "${sub}" da "${parent}"?`)) return;
                const folder = catalogStructure[cat].find(i => i.title === parent);
                if (folder) folder.children = (folder.children || []).filter(s => s !== sub);
                await saveStructureToFirebase();
                renderApCatalog(overlay.querySelector('.ap-filter-btn.active')?.dataset.filter || '', overlay.querySelector('#apCatSearch')?.value || '');
            });
        });

        refreshFolderSelect();
    }

    function refreshFolderSelect() {
        const sel = overlay.querySelector('#apSubFolder');
        if (!sel) return;
        const allFolders = [
            ...(catalogStructure.serietv || []).filter(i=>i.type==='folder').map(i=>({...i,_cat:'serietv'})),
            ...(catalogStructure.film    || []).filter(i=>i.type==='folder').map(i=>({...i,_cat:'film'}))
        ].sort((a,b)=>a.title.localeCompare(b.title,'it'));
        sel.innerHTML = allFolders.length
            ? allFolders.map(f => `<option value="${esc(f.title)}" data-cat="${f._cat}">${esc(f.title)}</option>`).join('')
            : '<option value="">— nessuna cartella —</option>';
    }

    function updateCategoryCounters() { updateAllCategoryCounters(); }

    // Aggiungi titolo singolo o cartella
    overlay.querySelector('#apAddTitle').addEventListener('click', async () => {
        const titleInput = overlay.querySelector('#apNewTitle');
        const catSel     = overlay.querySelector('#apNewCat');
        const typeSel    = overlay.querySelector('#apNewType');
        const title      = titleInput.value.trim();
        const catKey     = catSel.value === 'cat-serietv' ? 'serietv' : 'film';
        const isFolder   = typeSel.value === 'folder';
        if (!title) { titleInput.focus(); return; }

        const exists = (catalogStructure[catKey] || []).find(i => i.title === title);
        if (exists) { alert('Titolo già presente!'); return; }

        const newItem = isFolder
            ? { type: 'folder', title, children: [] }
            : { type: 'single', title };

        if (!catalogStructure[catKey]) catalogStructure[catKey] = [];
        catalogStructure[catKey].push(newItem);
        catalogStructure[catKey].sort((a,b) => a.title.localeCompare(b.title,'it'));

        await saveStructureToFirebase();
        titleInput.value = '';
        renderApCatalog();
    });

    // Aggiungi sub-item a cartella
    overlay.querySelector('#apAddSub').addEventListener('click', async () => {
        const subInput    = overlay.querySelector('#apSubTitle');
        const folderSel   = overlay.querySelector('#apSubFolder');
        const subTitle    = subInput.value.trim();
        const folderOpt   = folderSel.options[folderSel.selectedIndex];
        const parentTitle = folderOpt?.value;
        const catKey      = folderOpt?.dataset.cat;
        if (!subTitle)    { subInput.focus(); return; }
        if (!parentTitle) { alert('Nessuna cartella disponibile.'); return; }

        const folder = (catalogStructure[catKey] || []).find(i => i.title === parentTitle);
        if (!folder) { alert('Cartella non trovata.'); return; }
        if ((folder.children || []).includes(subTitle)) { alert('Sotto-titolo già presente!'); return; }
        if (!folder.children) folder.children = [];
        folder.children.push(subTitle);

        await saveStructureToFirebase();
        subInput.value = '';
        renderApCatalog();
    });

    renderApRequests();
    renderApEvased();
    renderApSugg();
    renderApCatalog();

    // ── Contatori — precompila con valori da Firebase ──
    const counterKeys = ['folders-serietv','episodes-serietv','folders-film','episodes-film'];
    counterKeys.forEach(async key => {
        try {
            const snap = await get(ref(db, 'counters/' + key));
            if (snap.exists()) {
                const val    = snap.val();
                const target = document.getElementById(key === 'catalog-total' ? 'catalogTotalNum' : key);
                if (target) target.textContent = val;
                const inputMap = {
                    'folders-serietv':  'apFoldersTV',
                    'episodes-serietv': 'apEpisodesTV',
                    'folders-film':     'apFoldersFilm',
                    'episodes-film':    'apEpisodesFilm',
                    'catalog-total':    'apTotalCat'
                };
                const inp = overlay.querySelector('#' + inputMap[key]);
                if (inp) inp.value = val;
            }
        } catch(e) {}
    });

    // Salva contatori su Firebase
    overlay.querySelectorAll('.ap-counter-save').forEach(btn => {
        btn.addEventListener('click', async () => {
            const input  = overlay.querySelector('#' + btn.dataset.input);
            const target = document.getElementById(btn.dataset.target);
            if (!input || !target) return;
            const val = input.value.trim();
            if (!val) return;
            // Salva solo il numero su Firebase, il suffisso è fisso nel codice
            const numOnly = val.replace(/[^0-9]/g, '');
            const sfx = { 'folders-serietv':' cart.','episodes-serietv':' ep.','folders-film':' cart.','episodes-film':' titoli' };
            target.textContent = numOnly + (sfx[btn.dataset.key] || '');
            try { await set(ref(db, 'counters/' + btn.dataset.key), numOnly); }
            catch(e) { alert('Errore salvataggio: ' + e.message); }
        });
    });

    // Filtri categoria catalogo
    overlay.querySelectorAll('.ap-filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            overlay.querySelectorAll('.ap-filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const search = overlay.querySelector('#apCatSearch');
            if (search) search.value = '';
            renderApCatalog(this.dataset.filter);
        });
    });

    // Ricerca nel catalogo admin
    const apCatSearch = overlay.querySelector('#apCatSearch');
    if (apCatSearch) {
        apCatSearch.addEventListener('input', function() {
            const q         = this.value.trim().toLowerCase();
            const filterCat = overlay.querySelector('.ap-filter-btn.active')?.dataset.filter || '';
            renderApCatalog(filterCat, q);
        });
    }

    // Aggiorna il pannello quando cambiano i dati Firebase
    window._apRenderReq  = renderApRequests;
    window._apRenderEv   = renderApEvased;
    window._apRenderSugg = renderApSugg;
}

// ============================================
// CONTATORI — carica da Firebase all'avvio
// ============================================

onValue(countersRef, snap => {
    const data = snap.val() || {};
    const map = {
        'folders-serietv':  'folders-serietv',
        'episodes-serietv': 'episodes-serietv',
        'folders-film':     'folders-film',
        'episodes-film':    'episodes-film',
    };
    const suffixes = {
        'folders-serietv':  ' cart.',
        'episodes-serietv': ' ep.',
        'folders-film':     ' cart.',
        'episodes-film':    ' titoli'
    };
    Object.entries(map).forEach(([key, elId]) => {
        const el = document.getElementById(elId);
        if (el && data[key]) {
            // Salva solo il numero, aggiungi suffisso fisso
            const num = String(data[key]).replace(/[^0-9]/g, '');
            el.textContent = num + (suffixes[key] || '');
        }
    });
});

// ============================================
// WATCHLIST
// ============================================
let watchlistUnsubscribe = null;  // listener Firebase attivo

function isInWatchlist(firebaseTitle) {
    return !!watchlistData[titleToKey(firebaseTitle)];
}

async function toggleWatchlist(firebaseTitle, displayTitle) {
    const nick = getNickname();
    if (!nick) { alert('Inserisci prima il tuo nickname nel popup del titolo.'); return; }
    const key  = titleToKey(firebaseTitle);
    const path = ref(db, 'watchlist/' + nick + '/' + key);
    try {
        if (isInWatchlist(firebaseTitle)) {
            await remove(path);
        } else {
            await set(path, { title: displayTitle, addedAt: Date.now() });
        }
    } catch(e) { alert('Errore watchlist: ' + e.message); }
}

function loadWatchlist(nick) {
    // Rimuovi listener precedente
    if (watchlistUnsubscribe) { watchlistUnsubscribe(); watchlistUnsubscribe = null; }
    if (!nick) return;

    const nickRef = ref(db, 'watchlist/' + nick);
    watchlistUnsubscribe = onValue(nickRef, snap => {
        watchlistData = snap.val() || {};
        renderWatchlist(nick);
        // Aggiorna cuori visibili nel catalogo
        document.querySelectorAll('.ci-heart').forEach(h => {
            const ft = h.dataset.firebaseTitle;
            h.textContent = isInWatchlist(ft) ? '♥' : '♡';
            h.classList.toggle('ci-heart-active', isInWatchlist(ft));
        });
    });
}

function renderWatchlist(nick) {
    const el = document.getElementById('watchlistContent');
    if (!el) return;

    const items = Object.entries(watchlistData)
        .sort((a, b) => (b[1].addedAt || 0) - (a[1].addedAt || 0));

    if (!items.length) {
        el.innerHTML = '<div class="catalog-empty">La tua watchlist è vuota.<br>Aggiungi titoli dal catalogo mettendo un ♥ al titolo scelto.</div>';
        return;
    }

    el.innerHTML = '<ul class="watchlist-list">' +
        items.map(([key, val]) => `
            <li class="watchlist-item">
                <span class="watchlist-title">${esc(val.title || key)}</span>
                <button class="watchlist-remove" data-key="${key}" data-nick="${esc(nick)}" title="Rimuovi dalla watchlist">
                    <span class="wl-remove-icon">♥</span>
                    <span class="wl-remove-label">Rimuovi</span>
                </button>
            </li>`
        ).join('') +
        '</ul>';

    el.querySelectorAll('.watchlist-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            try { await remove(ref(db, 'watchlist/' + btn.dataset.nick + '/' + btn.dataset.key)); }
            catch(e) { alert('Errore: ' + e.message); }
        });
    });
}

// Tab bar catalogo / watchlist
document.querySelectorAll('.catalog-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.catalog-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentCatalogTab = this.dataset.ctab;
        const catEl  = document.getElementById('catalogContainer');
        const catSearch = document.querySelector('.catalog-search-wrap');
        const wlEl   = document.getElementById('watchlistContainer');
        if (currentCatalogTab === 'watchlist') {
            catEl.style.display  = 'none';
            if (catSearch) catSearch.style.display = 'none';
            wlEl.style.display   = 'block';
            // precompila nick se salvato
            const inp = document.getElementById('watchlistNickInput');
            const nick = getNickname();
            if (nick && inp) { inp.value = nick; loadWatchlist(nick); }
        } else {
            catEl.style.display  = 'block';
            if (catSearch) catSearch.style.display = '';
            wlEl.style.display   = 'none';
        }
    });
});

// Bottone "Carica"
document.getElementById('watchlistNickBtn')?.addEventListener('click', () => {
    const nick = document.getElementById('watchlistNickInput')?.value.trim();
    if (!nick) return;
    saveNickname(nick);
    loadWatchlist(nick);
});

// ============================================
// INIT
// ============================================
isAdminMode = checkAdmin();
renderAdminBtn();
initCatalog();

const savedNick = getNickname();
if (savedNick) {
    const sn = document.getElementById('suggNick');
    if (sn) sn.value = savedNick;
    loadWatchlist(savedNick);
}

// Inizializza stelle nel form consigliati
initSuggFormStars();
