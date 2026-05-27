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
    const payload = {
        title:     document.getElementById('title').value.trim(),
        type:      document.getElementById('type').value,
        requester: document.getElementById('requester').value.trim(),
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

    // Aggiorna solo stelle media (non toccare il toggle che è gestito da CSS)
    let starsEl = ciMain.querySelector('.ci-stars');
    if (!starsEl) {
        starsEl = document.createElement('span');
        starsEl.className = 'ci-stars';
        const toggleEl = ciMain.querySelector('.ci-folder-toggle');
        if (toggleEl) ciMain.insertBefore(starsEl, toggleEl);
        else ciMain.appendChild(starsEl);
    }
    starsEl.textContent = avg ? avg.toFixed(1) + '★' : '';

    // Avatar (visti/in corso) sulla cartella
    let avatarDiv = folder.querySelector(':scope > .ci-avatars');
    if (!avatarDiv) { avatarDiv = document.createElement('div'); avatarDiv.className = 'ci-avatars'; folder.insertBefore(avatarDiv, folder.querySelector('.ci-folder-list')); }
    avatarDiv.innerHTML = [
        ...[...seenNicks].map(n => `<div class="ci-avatar seen" title="${esc(n)} — Visto">${esc(n[0].toUpperCase())}</div>`),
        ...[...watchNicks].map(n => `<div class="ci-avatar watching" title="${esc(n)} — In corso">${esc(n[0].toUpperCase())}</div>`)
    ].join('');
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
                    ${medal ? `<span class="sugg-medal">${medal}</span>` : `<span class="sugg-rank">${rank}</span>`}
                    <div class="sugg-info">
                        <span class="sugg-title">${esc(item.title)}</span>
                        <span class="sugg-by">${esc(item.nick)}</span>
                        ${avgData
                            ? `<span class="sugg-avg">${suggStarsHtml(avgData.rounded)} <span class="sugg-avg-num">${avgData.avg.toFixed(1)}/10</span> <span class="sugg-avg-ct">(${avgData.count} vot${avgData.count === 1 ? 'o' : 'i'})</span></span>`
                            : `<span class="sugg-avg sugg-avg-none">nessun voto</span>`}
                    </div>
                    <div class="sugg-score-wrap">
                        ${isOwn && !voted
                            ? `<span class="sugg-own-badge">tuo</span>`
                            : voted
                                ? `<span class="sugg-voted-score">${suggStarsHtml(myScore, 10)}<br><span style="font-size:10px;color:var(--teal-light)">Hai votato ${myScore}/10</span></span>`
                                : isOwn
                                    ? `<span class="sugg-own-badge">tuo</span>`
                                    : `<div class="sugg-stars-input" data-id="${item.id}">
                                        ${Array.from({length:10},(_,i)=>`<button class="ssb" data-score="${i+1}" title="${i+1}/10">★</button>`).join('')}
                                       </div>`
                        }
                    </div>
                    ${(isAdminMode || item.nick === myNick) ? `<button class="sugg-delete" data-id="${item.id}" title="Rimuovi">✕</button>` : ''}
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

    // Listener stelline voto 1-10 con mezze stelle
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
    if (!title) { titleEl.focus(); return; }
    if (!nick)  { nickEl.focus();  return; }
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
    const listHTML = items.map(item => {
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
    // Accordion
    document.querySelectorAll('.catalog-cat-btn').forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', function() {
            const id    = this.dataset.target;
            const panel = document.getElementById(id);
            const open  = panel.classList.contains('open');
            document.querySelectorAll('.catalog-panel').forEach(p => p.classList.remove('open'));
            document.querySelectorAll('.catalog-cat-btn').forEach(b => b.setAttribute('aria-expanded','false'));
            if (!open) { panel.classList.add('open'); this.setAttribute('aria-expanded','true'); }
        });
    });

    // Cartelle
    document.querySelectorAll('.catalog-folder').forEach(folder => {
        folder.classList.remove('folder-open');
        folder.querySelector('.ci-main').addEventListener('click', e => {
            e.stopPropagation();
            folder.classList.toggle('folder-open');
            updateFolderUI(folder);
        });
    });

    // Click sub-item
    document.querySelectorAll('.catalog-subitem').forEach(li => {
        li.addEventListener('click', e => {
            e.stopPropagation();
            openCatalogPopup(li.dataset.title, li.dataset.parent || null);
        });
    });

    // Click item singolo
    document.querySelectorAll('.catalog-item:not(.catalog-folder):not(.catalog-subitem)').forEach(li => {
        li.addEventListener('click', () => openCatalogPopup(li.dataset.title));
    });

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
                    if (match) {
                        catHasMatch = true; anyVisible = true;
                        const idx = plain.toLowerCase().indexOf(q);
                        li.querySelector('.ci-name').innerHTML =
                            esc(plain.slice(0,idx)) + '<mark>' + esc(plain.slice(idx, idx+q.length)) + '</mark>' + esc(plain.slice(idx+q.length));
                    } else {
                        li.querySelector('.ci-name').innerHTML = esc(plain);
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
                        <div class="ap-sidebar-title">Aggiungi</div>
                        <button id="apImportCatalog" class="ap-btn-add ap-btn-full ap-btn-import" title="Carica i titoli originali su Firebase (solo prima volta)">⬆ Import iniziale</button>
                        <div class="ap-sidebar-divider"></div>

                        <div class="ap-sidebar-group">
                            <label class="ap-sidebar-label">Titolo</label>
                            <input type="text" id="apNewTitle" placeholder="Es: Inception" autocomplete="off">
                        </div>
                        <div class="ap-sidebar-group">
                            <label class="ap-sidebar-label">Categoria</label>
                            <select id="apNewCat">
                                <option value="cat-serietv">📺 Serie TV</option>
                                <option value="cat-film">🎬 Film</option>
                            </select>
                        </div>
                        <div class="ap-sidebar-group">
                            <label class="ap-sidebar-label">Tipo</label>
                            <select id="apNewType">
                                <option value="single">Titolo singolo</option>
                                <option value="folder">📁 Cartella</option>
                            </select>
                        </div>
                        <button id="apAddTitle" class="ap-btn-add ap-btn-full">+ Aggiungi</button>

                        <div class="ap-sidebar-divider"></div>

                        <div class="ap-sidebar-title">Aggiungi a cartella</div>
                        <div class="ap-sidebar-group">
                            <label class="ap-sidebar-label">Cartella</label>
                            <select id="apSubFolder"></select>
                        </div>
                        <div class="ap-sidebar-group">
                            <label class="ap-sidebar-label">Titolo</label>
                            <input type="text" id="apSubTitle" placeholder="Es: Avatar 3" autocomplete="off">
                        </div>
                        <button id="apAddSub" class="ap-btn-add ap-btn-full ap-btn-secondary">+ Aggiungi sub-titolo</button>
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

    // Import iniziale da dati hardcoded
    overlay.querySelector('#apImportCatalog')?.addEventListener('click', async () => {
        if (!confirm('Importare tutti i titoli originali su Firebase?\nQuesto sovrascrive la struttura attuale.')) return;
        const importData = {"serietv": [{"type": "folder", "title": "Abbott Elementary", "children": ["Stagione 1"]}, {"type": "folder", "title": "American Crime Story", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "American Horror Story", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6", "Stagione 7"]}, {"type": "folder", "title": "Avvocato di Difesa", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4"]}, {"type": "folder", "title": "Band of Brothers", "children": ["Stagione 1"]}, {"type": "folder", "title": "Barry", "children": ["Stagione 1"]}, {"type": "folder", "title": "Better Call Saul", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Big Little Lies", "children": ["Stagione 1"]}, {"type": "folder", "title": "Black Bird", "children": ["Stagione 1"]}, {"type": "folder", "title": "Black Mirror", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Breaking Bad", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Chernobyl", "children": ["Stagione 1"]}, {"type": "folder", "title": "Chiamatemi Anna", "children": ["Stagione 1"]}, {"type": "folder", "title": "DAHMER - Mostro: La storia di Jeffrey Dahmer", "children": ["Stagione 1"]}, {"type": "folder", "title": "Dark", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "Dexter", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6", "Stagione 7", "Stagione 8"]}, {"type": "folder", "title": "Diavoli", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Domina", "children": ["Stagione 1"]}, {"type": "folder", "title": "Dove nessuno guarda - Il caso di Elisa Claps", "children": ["Stagione 1"]}, {"type": "folder", "title": "Downton Abbey", "children": ["Stagione 1"]}, {"type": "folder", "title": "Dune Prophecy", "children": ["Stagione 1"]}, {"type": "folder", "title": "Euphoria", "children": ["Speciale", "Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Fallout", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Fargo", "children": ["Stagione 1"]}, {"type": "folder", "title": "Fleabag", "children": ["Stagione 1"]}, {"type": "folder", "title": "Fondazione", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "For All Mankind", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Fringe", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5"]}, {"type": "folder", "title": "Good Omens", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Grey's Anatomy", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6", "Stagione 7", "Stagione 8", "Stagione 10", "Stagione 11", "Stagione 12", "Stagione 13", "Stagione 14", "Stagione 15", "Stagione 16", "Stagione 17"]}, {"type": "folder", "title": "Haunting of Hill House", "children": ["Stagione 1"]}, {"type": "folder", "title": "His Dark Material", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Homeland", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6", "Stagione 7", "Stagione 8"]}, {"type": "folder", "title": "House of Cards", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6"]}, {"type": "folder", "title": "House of the dragon", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "I Soprano", "children": ["Stagione 1"]}, {"type": "folder", "title": "Il racconto dell'ancella", "children": ["Stagione 1"]}, {"type": "folder", "title": "Il Trono di Spade", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6", "Stagione 7", "Stagione 8"]}, {"type": "folder", "title": "Invasion", "children": ["Stagione 1"]}, {"type": "folder", "title": "Inventing Anna", "children": ["Stagione 1"]}, {"type": "folder", "title": "IT: Welcome to Derry", "children": ["Stagione 1"]}, {"type": "folder", "title": "Jane the Virgin", "children": ["Stagione 1"]}, {"type": "folder", "title": "Killing Eve", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "L'uomo nell'alto castello", "children": ["Stagione 1"]}, {"type": "folder", "title": "La casa di carta", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "La regina degli scacchi", "children": ["Stagione 1"]}, {"type": "folder", "title": "Le regole del delitto perfetto", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6"]}, {"type": "folder", "title": "Locke &amp; Key", "children": ["Stagione 1"]}, {"type": "folder", "title": "Lost", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6"]}, {"type": "folder", "title": "Lucifer", "children": ["Stagione 1"]}, {"type": "folder", "title": "Lupin", "children": ["Stagione 1"]}, {"type": "folder", "title": "Mad Men", "children": ["Stagione 1"]}, {"type": "folder", "title": "Malice", "children": ["Stagione 1"]}, {"type": "folder", "title": "Mercoledì", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Mr. Robot", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4"]}, {"type": "folder", "title": "Narcos", "children": ["Stagione 1"]}, {"type": "folder", "title": "New Girl", "children": ["Stagione 1"]}, {"type": "folder", "title": "One Piece", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Only Murders in the Building", "children": ["Stagione 1"]}, {"type": "folder", "title": "Orange is the New Black", "children": ["Stagione 1"]}, {"type": "folder", "title": "Outlander", "children": ["Stagione 1"]}, {"type": "folder", "title": "Ozark", "children": ["Stagione 1"]}, {"type": "folder", "title": "Peaky Blinders", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Penny dreadful", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "Percy Jackson e gli dei dell'Olimpo", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Prison Break", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5"]}, {"type": "folder", "title": "Reacher", "children": ["Stagione 1"]}, {"type": "folder", "title": "Romulus", "children": ["Stagione 1"]}, {"type": "folder", "title": "Scissione", "children": ["Stagione 1"]}, {"type": "folder", "title": "Sense8", "children": ["Stagione 1"]}, {"type": "folder", "title": "Sex Education", "children": ["Stagione 1"]}, {"type": "folder", "title": "Shadowhunters: The Mortal Instruments", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "Sherlock", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4"]}, {"type": "folder", "title": "Shogun", "children": ["Stagione 1"]}, {"type": "folder", "title": "Silo", "children": ["Stagione 1"]}, {"type": "folder", "title": "Six Feet Under", "children": ["Stagione 1"]}, {"type": "folder", "title": "Slow Horses", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "Snowpiercer", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "Sons of Anarchy", "children": ["Stagione 1"]}, {"type": "folder", "title": "Spartacus", "children": ["Stagione 0", "Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "Spartacus: House of Ashur", "children": ["Stagione 1"]}, {"type": "folder", "title": "Squid Game", "children": ["Stagione 1"]}, {"type": "folder", "title": "Station Eleven", "children": ["Stagione 1"]}, {"type": "folder", "title": "Stranger Things", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5"]}, {"type": "folder", "title": "Succession", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4"]}, {"type": "folder", "title": "Suits", "children": ["Stagione 1"]}, {"type": "folder", "title": "Suits LA", "children": ["Stagione 1"]}, {"type": "folder", "title": "Teen Wolf", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6"]}, {"type": "folder", "title": "The 100", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "The Crown", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6"]}, {"type": "folder", "title": "The Diplomat", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "The Flight Attendant", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Gentlemen", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Good Doctor", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "The Last of Us", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "The Leftovers", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Morning Show", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Night Agent", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Night Of", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Office", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Pitt", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "The Recruit", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Regime - Il palazzo del potere", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Sandman", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "The Umbrella Academy", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Walking Dead", "children": ["Stagione 1", "Stagione 2"]}, {"type": "folder", "title": "The White Lotus", "children": ["Stagione 1", "Stagione 2", "Stagione 3"]}, {"type": "folder", "title": "The Wire", "children": ["Stagione 1"]}, {"type": "folder", "title": "The Witcher", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4"]}, {"type": "folder", "title": "The Young Pope", "children": ["Stagione 1"]}, {"type": "folder", "title": "Tredici", "children": ["Stagione 1"]}, {"type": "folder", "title": "True Detective", "children": ["Stagione 1"]}, {"type": "folder", "title": "Tulsa King", "children": ["Stagione 1"]}, {"type": "folder", "title": "Vikings", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4", "Stagione 5", "Stagione 6"]}, {"type": "folder", "title": "Virgin River", "children": ["Stagione 1"]}, {"type": "folder", "title": "Vis a vis", "children": ["Stagione 1"]}, {"type": "folder", "title": "Watchmen", "children": ["Stagione 1"]}, {"type": "folder", "title": "Westworld", "children": ["Stagione 1", "Stagione 2", "Stagione 3", "Stagione 4"]}, {"type": "folder", "title": "Young Sherlock", "children": ["Stagione 1"]}], "film": [{"type": "folder", "title": "007", "children": ["Casino Royale (2006)", "No Time To Die (2021)", "Quantum of solace (2008)", "Skyfall (2012)", "Spectre (2015)"]}, {"type": "folder", "title": "Alien", "children": ["Alien 3", "Alien - La clonazione", "Alien", "Aliens - Scontro finale"]}, {"type": "folder", "title": "Animali Fantastici", "children": ["Animali fantastici e dove trovarli", "Animali fantastici - I crimini di Grindelwald (2018)", "Animali Fantastici - I Segreti di Silente (2022)"]}, {"type": "folder", "title": "Assassinio sullOrient Express", "children": ["Assassinio a Venezia (2023)", "Assassinio sul Nilo", "Assassinio sull'Orient Express"]}, {"type": "folder", "title": "Attacco al potere", "children": ["Attacco al potere 1 Olympus Has Fallen (2013)", "Attacco al potere 2 London Has Fallen (2016)", "Attacco al potere 3 Angel Has Fallen (2019)"]}, {"type": "folder", "title": "Avatar", "children": ["Avatar", "Avatar - Fuoco e cenere", "Avatar - La via dell'acqua"]}, {"type": "folder", "title": "Batman - Il Cavaliere Oscuro", "children": ["Batman Begins", "Il Cavaliere Oscuro - Il Ritorno", "Il Cavaliere Oscuro"]}, {"type": "folder", "title": "Cattivissimo Me", "children": ["Cattivissimo Me 1", "Cattivissimo Me 2", "Cattivissimo Me 3", "Cattivissimo Me 4"]}, {"type": "folder", "title": "DC Universe", "children": ["Aquaman (2018)", "Batman v Superman Dawn of Justice (2016)", "Birds of prey e la fantasmagorica rinascita di Harley Quinn (2020)", "Justice League (2017)", "L'uomo d'acciaio - Man of Steel (2013)", "Shazam (2019)", "Suicide Squad (2016)", "The Suicide Squad (2021)", "Wonder Woman 1984 (2020)", "Wonder Woman (2017)", "Zack Snyder's Justice League (2021)", "Superman", "Joker (2019)", "Joker: Folie a deux", "The Batman (2022)", "ELSEWORLDS"]}, {"type": "folder", "title": "Downton Abbey", "children": ["Downton Abbey 1", "Downton Abbey 2 - Una nuova era", "Downton Abbey - Il gran finale"]}, {"type": "folder", "title": "Dune", "children": ["Dune 2021 Part 1", "Dune - Parte Due"]}, {"type": "folder", "title": "Fast &amp; Furious Collection", "children": ["2 Fast 2 Furious (2003)", "Fast and Furious 4 (2009)", "Fast and Furious 5 (2011)", "Fast and Furious 6 (2013)", "Fast and Furious 7 (2015)", "Fast and Furious 8 (2017)", "Fast &amp; Furious (2001)", "Fast &amp; Furious 9", "Fast &amp; Furious - Hobbs &amp; Shaw", "Fast X", "The Fast and the Furious: Tokyo Drift (2006)"]}, {"type": "folder", "title": "Frozen", "children": ["Frozen 1", "Frozen 2"]}, {"type": "folder", "title": "Greenland", "children": ["Greenland 2: Migration", "Greenland"]}, {"type": "folder", "title": "Harry Potter", "children": ["Harry Potter e i doni della morte: Parte 1", "Harry Potter e i Doni della Morte - Parte 2", "Harry Potter e il calice di fuoco", "Harry Potter e il prigioniero di Azkaban", "Harry Potter e il principe mezzosangue", "Harry Potter e la camera dei segreti", "Harry Potter e la pietra filosofale", "Harry Potter e l'Ordine della Fenice"]}, {"type": "folder", "title": "Hunger Games", "children": ["1. Hunger Games", "2. Hunger games - La ragazza di fuoco", "3. Hunger Games - Il canto della rivolta parte 1", "4. Hunger Games - Il canto della rivolta parte 2", "Hunger Games - La ballata dell'usignolo e del serpente"]}, {"type": "folder", "title": "Il signore degli anelli", "children": ["Il ritorno del re", "La compagnia dell'anello", "Le due torri", "Lo Hobbit 1 Un viaggio inaspettato (2012)", "Lo Hobbit 2 La desolazione di Smaug (2013)", "Lo Hobbit 3 La battaglia delle cinque armate (2014)"]}, {"type": "folder", "title": "Indiana Jones", "children": ["Indiana Jones 1 I predatori dell'arca perduta (1981)", "Indiana Jones 2 Il tempio maledetto (1984)", "Indiana Jones 3 L'ultima crociata (1989)", "Indiana Jones 4 Il regno del teschio di cristallo (2008)"]}, {"type": "folder", "title": "Inside Out", "children": ["Inside Out 1", "Inside Out 2"]}, {"type": "folder", "title": "John Wick", "children": ["John Wick 1", "John Wick 2", "John Wick 3", "John Wick 4"]}, {"type": "folder", "title": "Jumanji", "children": ["Jumanji - Benvenuti nella giungla", "Jumanji: The Next Level"]}, {"type": "folder", "title": "Jurassic Park", "children": ["Jurassic Park (1993)", "Jurassic Park 2 - Il mondo perduto (1997)", "Jurassic Park 3 (2001)", "Jurassic World (2015)", "Jurassic World - Il regno distrutto (2018)", "Jurassic World Rebirth"]}, {"type": "folder", "title": "Kung Fu Panda", "children": ["Kung Fu Panda 1", "Kung Fu Panda 2", "Kung Fu Panda 3", "Kung Fu Panda 4"]}, {"type": "folder", "title": "L'Era Glaciale", "children": ["L'era glaciale 2 - Il disgelo", "L'era glaciale 3 - L'alba dei dinosauri", "L'era glaciale 4 - Continenti alla deriva", "L'era glaciale - In rotta di collisione", "L'era glaciale - Le avventure di Buck", "L'era glaciale"]}, {"type": "folder", "title": "Le Cronache di Narnia", "children": ["Le cronache di Narnia - Il leone, la strega e l'armadio", "Le cronache di Narnia - Il principe Caspian", "Le cronache di Narnia - Il viaggio del veliero"]}, {"type": "folder", "title": "Madagascar", "children": ["I pinguini di Madagascar", "Madagascar 1", "Madagascar 2", "Madagascar 3"]}, {"type": "folder", "title": "Marvel Cinematic Universe (MCU)", "children": ["Captain America - Il primo Vendicatore", "Iron Man 2", "Iron Man", "L'incredibile Hulk", "The Avengers", "Thor", "Ant-Man (2015)", "Avengers - Age of Ultron (2015)", "Captain America - The Winter Soldier", "Guardiani della galassia - Vol.1 (2014)", "Iron man 3 (2013)", "Thor - The Dark World", "Ant-Man and the Wasp", "Avengers - Endgame", "Avengers - Infinity War (2018)", "Black Panther (2018)", "Captain America - Civil War", "Captain Marvel (2019)", "Doctor Strange", "Guardiani della Galassia Vol.2 (2017)", "Spider-Man Far from Home (2019)", "Spider-Man Homecoming (2017)", "Spider-Man No Way Home", "Thor Ragnarok (2017)", "Black Panther - Wakanda Forever", "Black Widow", "Doctor Strange - Nel Multiverso della Follia", "Eternals", "Shang-Chi e la leggenda dei dieci anelli", "Thor Love and Thunder", "Ant Man and the Wasp - Quantumania (2023)", "Captain America: Brave New World", "Deadpool &amp; Wolverine", "Guardiani della Galassia Vol.3", "The Marvels", "Thunderbolts", "I Fantastici Quattro: Gli inizi", "Deadpool 2", "Deadpool", "Logan - The Wolverine", "The New Mutants", "Wolverine - L'immortale", "X-Men 1", "X-Men 2", "X-Men - Apocalisse", "X-Men - Conflitto finale", "X-Men - Dark Phoenix", "X-Men - Giorni di un futuro passato", "X-Men: Le origini - Wolverine", "X-Men - L'inizio", "Fase 4", "Fase 5"]}, {"type": "folder", "title": "Matrix", "children": ["Matrix", "Matrix Reloaded", "Matrix Resurrections", "Matrix Revolutions"]}, {"type": "folder", "title": "Mission Impossible", "children": ["1. Mission Impossible I", "2. Mission Impossible II", "3. Mission Impossible III", "4. Mission Impossible - Protocollo Fantasma", "5. Mission Impossible - Rogue Nation", "6. Mission Impossible - Fallout", "Mission: Impossible - Dead Reckoning Parte uno", "Mission: Impossible - The Final Reckoning"]}, {"type": "folder", "title": "Nou You See Me", "children": ["Nou You See Me 1", "Now You See Me 2", "Now You See me 3"]}, {"type": "folder", "title": "Pirati dei Caraibi", "children": ["Pirati Dei Caraibi 1", "Pirati Dei Caraibi 2", "Pirati Dei Caraibi 3", "Pirati Dei Caraibi 4", "Pirati Dei Caraibi 5"]}, {"type": "folder", "title": "Professor Langdon", "children": ["Angeli e Demoni", "Il codice da Vinci", "Inferno"]}, {"type": "folder", "title": "Re Leone", "children": ["Il re leone (1994)", "Il re leone (2019)", "Il re leone 2", "Il re leone 3", "Mufasa - Il re leone"]}, {"type": "folder", "title": "Sherlock Holmes", "children": ["Sherlock Holmes 1", "Sherlock Holmes: Gioco di ombre"]}, {"type": "folder", "title": "Shrek", "children": ["Il gatto con gli stivali 1", "Il gatto con gli stivali 2", "Shrek 1", "Shrek 2", "Shrek 3", "Shrek 4", "Shrekkati per le feste"]}, {"type": "folder", "title": "Star Wars", "children": ["Star Wars 1 La minaccia fantasma (1999)", "Star Wars 2 L'attacco dei cloni (2002)", "Star Wars 3 La vendetta dei Sith (2005)", "Star Wars 4 Una nuova speranza (1977)", "Star Wars 5 L'impero colpisce ancora (1980)", "Star Wars 6 Il ritorno dello Jedi (1983)", "Star Wars 7 Il risveglio della Forza (2015)", "Star Wars 8 Gli ultimi Jedi (2017)"]}, {"type": "folder", "title": "The Croods", "children": ["The Croods 1", "The Croods 2"]}, {"type": "folder", "title": "The Maze Runner", "children": ["1. Maze Runner - Il labirinto (2014)", "2. Maze Runner - La fuga (2015)", "3. Maze Runner - La rivelazione (2018)"]}, {"type": "folder", "title": "Transformers", "children": ["Bumblebee", "Transformers 3", "Transformers 4: L'Era Dell'Estinzione", "Transformers - Il risveglio", "Transformers - La vendetta del caduto", "Transformers L'ultimo Cavaliere", "Transformers"]}, {"type": "folder", "title": "Underworld", "children": ["Underworld 1 (2003)", "Underworld 2 Evolution (2006)", "Underworld 3 La ribellione dei Lycans (2009)", "Underworld 4 Il risveglio (2012)", "Underworld 5 Blood Wars (2016)"]}, {"type": "folder", "title": "Wicked", "children": ["Wicked 2", "Wicked"]}, {"type": "folder", "title": "Zootopia", "children": ["Zootopia 2", "Zootopia"]}, {"type": "single", "title": "21"}, {"type": "single", "title": "Arrival (2016)"}, {"type": "single", "title": "Barbie"}, {"type": "single", "title": "Bird Box"}, {"type": "single", "title": "Black Swan (2010)"}, {"type": "single", "title": "Bohemian Rhapsody"}, {"type": "single", "title": "Bugonia"}, {"type": "single", "title": "Carry-On"}, {"type": "single", "title": "Challengers (2024)"}, {"type": "single", "title": "Damsel"}, {"type": "single", "title": "Don't Look Up"}, {"type": "single", "title": "Dracula di Bram Stoker (1999)"}, {"type": "single", "title": "Dramma nel ciclismo: il caso Moriah Wilson"}, {"type": "single", "title": "Edward Mani di Forbice"}, {"type": "single", "title": "Elvis (2022)"}, {"type": "single", "title": "Everything Everywhere All At Once (2022)"}, {"type": "single", "title": "F1: Il Film"}, {"type": "single", "title": "Gravity"}, {"type": "single", "title": "House of Gucci"}, {"type": "single", "title": "I peccatori"}, {"type": "single", "title": "Il Curioso Caso Di Benjamin Button (2008)"}, {"type": "single", "title": "Il diavolo veste Prada"}, {"type": "single", "title": "Il Lato Positivo - Silver Linings Playbook"}, {"type": "single", "title": "In Time (2011)"}, {"type": "single", "title": "Inception (2010)"}, {"type": "single", "title": "Interstellar"}, {"type": "single", "title": "Io, robot"}, {"type": "single", "title": "Jojo Rabbit (2019)"}, {"type": "single", "title": "L'avvocato del diavolo (1997)"}, {"type": "single", "title": "L'ultima missione: Project Hail Mary"}, {"type": "single", "title": "La fabbrica di cioccolato"}, {"type": "single", "title": "La grande scommessa"}, {"type": "single", "title": "La teoria del tutto"}, {"type": "single", "title": "Les Miserables"}, {"type": "single", "title": "Minecraft"}, {"type": "single", "title": "Minority Report (2002)"}, {"type": "single", "title": "Mr and Mrs Smith"}, {"type": "single", "title": "Ocean's 8 (2018)"}, {"type": "single", "title": "Operation Fortune"}, {"type": "single", "title": "Oppenheimer"}, {"type": "single", "title": "Passengers (2016)"}, {"type": "single", "title": "Peaky Blinders: The Immortal Man"}, {"type": "single", "title": "Rampage: furia animale"}, {"type": "single", "title": "Red Notice"}, {"type": "single", "title": "Seven Sisters"}, {"type": "single", "title": "Split (2017)"}, {"type": "single", "title": "Super Mario Bros - Il film"}, {"type": "single", "title": "Super Mario Galaxy - Il Film"}, {"type": "single", "title": "Sweeney Todd"}, {"type": "single", "title": "Teen Wolf - The Movie (2023)"}, {"type": "single", "title": "Tenet (2020)"}, {"type": "single", "title": "The Adam Project"}, {"type": "single", "title": "The Danish Girl (2016)"}, {"type": "single", "title": "The Father (2020)"}, {"type": "single", "title": "The Gray Man"}, {"type": "single", "title": "The Menu"}, {"type": "single", "title": "The Phantom of the Opera at Royal Albert Hall"}, {"type": "single", "title": "The Post (2017)"}, {"type": "single", "title": "The Smashing Machine"}, {"type": "single", "title": "The Social Network (2010)"}, {"type": "single", "title": "The Whale (2022)"}, {"type": "single", "title": "The Wolf of Wall Street"}, {"type": "single", "title": "Titanic"}, {"type": "single", "title": "Top Gun: Maverick"}, {"type": "single", "title": "TÁR"}, {"type": "single", "title": "Una battaglia dopo l'altra"}, {"type": "single", "title": "Una poltrona per due"}]};
        try {
            await set(ref(db, 'catalogStructure'), importData);
            alert('Import completato! ' + importData.serietv.length + ' serie TV e ' + importData.film.length + ' film.');
            renderApCatalog();
        } catch(e) { alert('Errore import: ' + e.message); }
    });

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
