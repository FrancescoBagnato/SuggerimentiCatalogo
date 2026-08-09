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
const recentRef        = ref(db, 'recentlyAdded');
const playtimeRef      = ref(db, 'playtime');

let allRequests   = [];
let allEvased     = [];
let allSuggested  = [];
let catalogData   = {};
let currentTab      = 'date';
let currentCatalogTab  = 'catalog';
let recentItems        = [];
let catalogStructure   = { serietv: [], film: [] };
let watchlistData   = {};
let currentSuggSort = 'rank';
let isAdminMode     = false;

function esc(text) {
    const d = document.createElement('div');
    d.textContent = text ?? '';
    return d.innerHTML;
}

function unesc(text) {
    const d = document.createElement('div');
    d.innerHTML = text ?? '';
    return d.textContent;
}
function titleToKey(title) { return title.replace(/[.#$\/\[\]]/g, '_'); }

function sanitize(text, maxLen = 200) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/<[^>]*>/g, '')
        .replace(/[<>"'`]/g, '')
        .trim()
        .slice(0, maxLen);
}

function allowedValue(val, allowed) {
    return allowed.includes(val) ? val : '';
}

const _rateLimits = {};
function rateLimited(key, maxCount = 3, intervalMs = 60000) {
    const now = Date.now();
    if (!_rateLimits[key]) _rateLimits[key] = [];
    _rateLimits[key] = _rateLimits[key].filter(t => now - t < intervalMs);
    if (_rateLimits[key].length >= maxCount) return true;
    _rateLimits[key].push(now);
    return false;
}

function checkAdmin()  { return localStorage.getItem('isAdmin') === 'true'; }
function getNickname() { return localStorage.getItem('catalogNick') || ''; }
function saveNickname(n) { if (n) localStorage.setItem('catalogNick', n.trim()); }

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

async function evade(id, title) {
    if (!isAdminMode) return;

    const snap = await get(ref(db, `requests/${id}`));
    const data = snap.val();

    if (!data) {
        alert('Richiesta non trovata.');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'evade-overlay';

    overlay.innerHTML = `
        <div class="evade-modal">
            <h3>Evadi richiesta</h3>
            <p class="evade-subtitle">
                Vuoi aggiungere questo titolo alla sezione “Aggiunti di recente”?
            </p>

            <label>
                Titolo
                <input id="evadeTitle" type="text"
                    value="${esc(data.title || title)}">
            </label>

            <label>
                Tipo
                <select id="evadeType">
                    <option value="serie-completa">Serie TV completa</option>
                    <option value="serie-stagione">Stagione singola</option>
                    <option value="film-cartella">Raccolta Film</option>
                    <option value="film-singolo">Film singolo</option>
                </select>
            </label>

            <label>
                Note
                <textarea id="evadeNotes"
                    placeholder="Note opzionali">${esc(data.notes || '')}</textarea>
            </label>

            <label class="evade-check">
                <input id="evadeRecent" type="checkbox" checked>
                <span>Aggiungi agli “Aggiunti di recente”</span>
            </label>

            <div class="evade-actions">
                <button id="evadeCancel" class="ap-btn">
                    Annulla
                </button>
                <button id="evadeConfirm" class="ap-btn-add">
                    Conferma
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const titleInput = overlay.querySelector('#evadeTitle');
    const typeInput = overlay.querySelector('#evadeType');
    const notesInput = overlay.querySelector('#evadeNotes');
    const recentInput = overlay.querySelector('#evadeRecent');

    const originalType = data.type || '';

    if (originalType === 'Film') {
        typeInput.value = 'film-singolo';
    } else if (originalType === 'Serie TV') {
        typeInput.value = 'serie-completa';
    }

    const close = () => overlay.remove();

    overlay.querySelector('#evadeCancel').addEventListener('click', close);

    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });

    overlay.querySelector('#evadeConfirm').addEventListener('click', async () => {
        const finalTitle = titleInput.value.trim();
        const finalType = typeInput.value;
        const finalNotes = notesInput.value.trim();

        if (!finalTitle) {
            titleInput.focus();
            return;
        }

        const confirmButton = overlay.querySelector('#evadeConfirm');
        confirmButton.disabled = true;
        confirmButton.textContent = 'Salvataggio…';

        try {
            await push(evasedRef, {
                ...data,
                title: finalTitle,
                type: finalType,
                notes: finalNotes,
                status: 'evasa',
                evadedAt: new Date().toLocaleDateString('it-IT'),
                evadedTimestamp: Date.now()
            });

            if (recentInput.checked) {
                await push(recentRef, {
                    title: finalTitle,
                    type: finalType,
                    notes: finalNotes,
                    addedAt: Date.now()
                });
            }

            await remove(ref(db, `requests/${id}`));
            close();
        } catch (error) {
            alert('Errore: ' + error.message);
            confirmButton.disabled = false;
            confirmButton.textContent = 'Conferma';
        }
    });
}

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

document.getElementById('requestForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = this.querySelector('.btn-submit');
    btn.disabled = true;
    btn.querySelector('.btn-submit-text').textContent = 'Invio…';
    const titleVal     = sanitize(document.getElementById('title').value, 120);
    const typeVal      = allowedValue(document.getElementById('type').value, ['Film', 'Serie TV']);
    const requesterVal = sanitize(document.getElementById('requester').value, 30);

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
    if (rateLimited('request', 10, 60000)) {
        showFormError('requestForm', 'Troppi invii. Aspetta un minuto.');
        btn.disabled = false;
        btn.querySelector('.btn-submit-text').textContent = 'Invia richiesta';
        return;
    }

    const payload = {
        title:     titleVal,
        type:      typeVal,
        requester: requesterVal,
        notes:     sanitize(document.getElementById('notes').value, 300),
        date:      new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
        timestamp: Date.now()
    };
    try {
        await push(requestsRef, payload);
        this.reset();
        showToast('Richiesta inviata con successo!');

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

document.querySelectorAll('.tab[data-sort]').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.tab[data-sort]').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentTab = this.dataset.sort;
        redraw();
    });
});

document.getElementById('adminToggle').addEventListener('click', () => {
    if (!isAdminMode) { enableAdmin(); return; }

    const existing = document.getElementById('adminPanelOverlay');
    if (existing) existing.remove();
    else openAdminPanel();
});

let popupCurrentTitle   = null;
let popupSelectedStatus = null;
let popupSelectedRating = 0;

function openFolderPopup(folder) {
    const folderTitle = folder.dataset.title;
    const subitems    = Array.from(folder.querySelectorAll('.catalog-subitem'));
    if (!subitems.length) {

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

    overlay.querySelectorAll('.status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const s = btn.dataset.status;
            selectedStatus = s === 'none' ? null : s;
            overlay.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active-seen','active-watching'));
            if (selectedStatus === 'seen')     btn.classList.add('active-seen');
            if (selectedStatus === 'watching') btn.classList.add('active-watching');
        });
    });

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
                        source:    'manual',
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

    const firebaseTitle = parentTitle ? parentTitle + ' — ' + title : title;
    popupCurrentTitle   = firebaseTitle;
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
            await set(userRef, { status: popupSelectedStatus, rating: popupSelectedRating || null, source: 'manual', updatedAt: Date.now() });
        }
        closePopup();
    } catch (e) {
        alert('Errore: ' + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salva';
    }
}

function updateFolderUI(folder) {
    const parent = folder.dataset.title;
    const subitems = Array.from(
        folder.querySelectorAll(':scope > .ci-folder-list > .catalog-subitem')
    );

    const usersByNick = {};

    subitems.forEach(li => {
        const subTitle = li.dataset.title;
        const firebaseTitle = parent + ' — ' + subTitle;
        const key = titleToKey(firebaseTitle);
        const users = (catalogData[key] || {}).users || {};

        Object.entries(users).forEach(([nick, user]) => {
            if (!usersByNick[nick]) usersByNick[nick] = [];
            if (user.status === 'seen' || user.status === 'watching') {
                usersByNick[nick].push(user.status);
            }
        });
    });

    const seenNicks = [];
    const watchNicks = [];

    Object.entries(usersByNick).forEach(([nick, statuses]) => {
        if (!statuses.length) return;

        // Verde solo se tutti i figli risultano visti.
        if (
            statuses.length === subitems.length &&
            statuses.every(status => status === 'seen')
        ) {
            seenNicks.push(nick);
        } else {
            // Se almeno un figlio ha uno stato, ma non sono tutti visti:
            // un solo ticker giallo.
            watchNicks.push(nick);
        }
    });

    const ciMain = folder.querySelector(':scope > .ci-main');
    if (!ciMain) return;

    const toggle = folder.classList.contains('folder-open') ? '▼' : '▶';

    const toggleEl = ciMain.querySelector('.ci-folder-toggle');
    if (toggleEl) {
        toggleEl.textContent = toggle;
    }

    let avatarDiv = folder.querySelector(':scope > .ci-folder-avatars');

    if (!avatarDiv) {
        avatarDiv = document.createElement('div');
        avatarDiv.className = 'ci-folder-avatars';

        const folderList = folder.querySelector(':scope > .ci-folder-list');
        folder.insertBefore(avatarDiv, folderList);
    }

    avatarDiv.innerHTML = [
        ...seenNicks.map(nick =>
            `<div class="ci-avatar seen"
                title="${esc(nick)} — Visto"
                data-tooltip="${esc(nick)}">${esc(nick[0].toUpperCase())}</div>`
        ),
        ...watchNicks.map(nick =>
            `<div class="ci-avatar watching"
                title="${esc(nick)} — In corso"
                data-tooltip="${esc(nick)}">${esc(nick[0].toUpperCase())}</div>`
        )
    ].join('');
}

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
        <span class="ci-name">${plainName}</span>
        ${avg ? `<span class="ci-stars">${avg.toFixed(1)}★</span>` : ''}
    `;

    let avatarDiv = li.querySelector('.ci-avatars');
    if (!avatarDiv) { avatarDiv = document.createElement('div'); avatarDiv.className = 'ci-avatars'; li.appendChild(avatarDiv); }
    avatarDiv.innerHTML = [...seenUsers.map(([n]) => `<div class="ci-avatar seen" title="${esc(n)} — Visto" data-tooltip="${esc(n)}">${esc(n[0].toUpperCase())}</div>`),
        ...watchUsers.map(([n]) => `<div class="ci-avatar watching" title="${esc(n)} — In corso" data-tooltip="${esc(n)}">${esc(n[0].toUpperCase())}</div>`)
    ].join('');
}

onValue(catalogRef, snap => {
    catalogData = snap.val() || {};

    document.querySelectorAll('.catalog-item:not(.catalog-folder)').forEach(li => updateCatalogItemUI(li));

    document.querySelectorAll('.catalog-folder').forEach(folder => updateFolderUI(folder));
});

onValue(suggestedRef, snap => {
    const raw = snap.val();
    allSuggested = raw ? Object.entries(raw).map(([id, val]) => ({ id, ...val })) : [];
    renderSuggested(allSuggested);
    if (window._apRenderSugg) window._apRenderSugg();
});

function openSuggVotersPopup(item) {
    const ratings = item.ratings ? Object.entries(item.ratings) : [];
    if (!ratings.length) return;

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

async function voteSuggested(id, score) {
    const myNick = getNickname();
    if (!myNick) { alert('Imposta prima il tuo Nickname!'); return; }
    const item = allSuggested.find(s => s.id === id);
    if (!item) return;
    if (item.nick === myNick) { alert('Non puoi votare un tuo consiglio!'); return; }

    try {
        await set(ref(db, `suggested/${id}/ratings/${myNick}`), score);
        saveSuggRating(id, score);
    } catch (e) { alert('Errore: ' + e.message); }
}

function suggAvg(item) {
    const ratings = item.ratings ? Object.values(item.ratings) : [];
    if (!ratings.length) return null;
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;

    const rounded = Math.round(avg * 2) / 2;
    return { avg: Math.round(avg * 10) / 10, rounded, count: ratings.length };
}

function suggStarsHtml(score, size = 11) {
    if (!score) return '';
    const pts = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';
    let s = '';
    for (let i = 1; i <= 10; i++) {
        if (score >= i) {

            s += `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
        } else if (score >= i - 0.5) {

            const uid = 'sg' + i + Math.random().toString(36).slice(2,5);
            s += `<svg width="${size}" height="${size}" viewBox="0 0 24 24">`
               + `<defs><clipPath id="${uid}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>`
               + `<polygon points="${pts}" fill="none" stroke="#475569" stroke-width="1.5" stroke-linejoin="round"/>`
               + `<polygon points="${pts}" fill="#fbbf24" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round" clip-path="url(#${uid})"/>`
               + `</svg>`;
        } else {

            s += `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><polygon points="${pts}" fill="none" stroke="#475569" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
        }
    }
    return `<span style="display:inline-flex;align-items:center;gap:1px">${s}</span>`;
}

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

    if (currentSuggSort === 'rank') {

        const withAvg = list.map(item => ({ ...item, _avg: suggAvg(item) }));
        const sorted  = withAvg.sort((a, b) => {
            const aAvg = a._avg ? a._avg.avg : -1;
            const bAvg = b._avg ? b._avg.avg : -1;
            return bAvg !== aAvg ? bAvg - aAvg : (a.timestamp || 0) - (b.timestamp || 0);
        });
        const medals     = ['🥇', '🥈', '🥉'];
        const showMedals = sorted.length >= 1;

        el.innerHTML = sorted.map((item, idx) => {
            const rank     = idx + 1;
            const isTop    = showMedals && rank <= 3;
            const medal    = isTop ? medals[idx] : '';
            const isOwn    = myNick && item.nick === myNick;

            const myScore  = getSuggRating(item.id) || (myNick && item.ratings && item.ratings[myNick]) || 0;
            const voted    = myScore > 0;

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

    el.querySelectorAll('.sugg-votes-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const item = allSuggested.find(s => s.id === btn.dataset.id);
            if (!item) return;
            openSuggVotersPopup(item);
        });
    });

    el.querySelectorAll('.btn-sugg-vote-open').forEach(btn => {
        btn.addEventListener('click', () => openSuggVotePopup(btn.dataset.id, btn.dataset.title));
    });

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

    el.querySelectorAll('.sugg-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Rimuovere questo consiglio?')) return;
            try { await remove(ref(db, 'suggested/' + btn.dataset.id)); }
            catch (e) { alert('Errore: ' + e.message); }
        });
    });
}

function initSuggFormStars() {
    const wrap        = document.getElementById('suggFormStars');
    const ratingInput = document.getElementById('suggFormRating');
    if (!wrap) return;

    const pts = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';
    let currentRating = 0;
    let hoverRating   = 0;

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
    const title    = sanitize(titleEl.value, 120);
    const nick     = sanitize(nickEl.value, 30);
    const rating   = Math.min(10, Math.max(0, parseFloat(ratingEl?.value || 0) || 0));

    let suggError = '';
    if (!title)  suggError = 'Inserisci il titolo del consiglio.';
    else if (!nick)   suggError = 'Inserisci il tuo nickname.';
    else if (!rating) suggError = 'Inserisci il tuo voto (1–10).';
    if (suggError) {
        showFormError('suggForm', suggError);
        return;
    }
    if (rateLimited('suggest', 10, 60000)) {
        showFormError('suggForm', 'Troppi invii. Aspetta un minuto.');
        return;
    }
    saveNickname(nick);
    const btn = document.getElementById('suggSubmit');
    btn.disabled = true;
    btn.querySelector('.btn-submit-text').textContent = 'Invio…';
    try {
        const payload = { title, nick, votes: 0, timestamp: Date.now() };

        if (rating > 0) {
            if (!payload.ratings) payload.ratings = {};
            payload.ratings[nick] = rating;
        }
        await push(suggestedRef, payload);
        titleEl.value = '';

        if (ratingEl) ratingEl.value = 0;
        initSuggFormStars();
    } catch (e) { alert('Errore: ' + e.message); }
    finally {
        btn.disabled = false;
        btn.querySelector('.btn-submit-text').textContent = 'Aggiungi consiglio';
    }
});

document.querySelectorAll('[data-sugg-sort]').forEach(tab => {
    tab.addEventListener('click', function () {
        document.querySelectorAll('[data-sugg-sort]').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentSuggSort = this.dataset.suggSort;
        renderSuggested(allSuggested);
    });
});

function initCatalog() {

}

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

    attachCatalogEvents();

    updateAllCategoryCounters();
}

function buildCategoryHTML(catId, catName, dotClass, countId, foldersId, episodesId, items) {

    const sortedItems = [...items].sort((a, b) => a.title.localeCompare(b.title, 'it', {sensitivity:'base'}));
    const listHTML = sortedItems.map(item => {
        const safe    = esc(item.title);
        const display = item.title;
        if (item.type === 'folder') {
            const subsHTML = (item.children || []).map(sub => {
                const safeSub    = esc(sub);
                const displaySub = sub;
                return `<li class="catalog-item catalog-subitem" data-title="${safeSub}" data-parent="${safe}"><div class="ci-main"><span class="ci-name">${displaySub}</span></div></li>`;
            }).join('');
            return `<li class="catalog-item catalog-folder" data-title="${safe}" data-type="folder">
                <div class="ci-main"><span class="ci-name">${display}</span><span class="ci-folder-toggle">▶</span></div>
                <ul class="ci-folder-list">${subsHTML}</ul>
            </li>`;
        } else {
            return `<li class="catalog-item" data-title="${safe}"><div class="ci-main"><span class="ci-name">${display}</span></div></li>`;
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

    document.querySelectorAll('.catalog-folder').forEach(folder => {
        folder.classList.remove('folder-open');
    });

    const catalogContainer = document.getElementById('catalogContainer');
    if (catalogContainer) {

        const newContainer = catalogContainer.cloneNode(true);
        catalogContainer.parentNode.replaceChild(newContainer, catalogContainer);

        newContainer.addEventListener('click', e => {

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

            const nameSpan = e.target.closest('.catalog-folder > .ci-main .ci-name');
            if (nameSpan) {
                e.stopPropagation();
                const folder = nameSpan.closest('.catalog-folder');
                if (folder) openFolderPopup(folder);
                return;
            }

            const subitem = e.target.closest('.catalog-subitem');
            if (subitem) {
                e.stopPropagation();
                openCatalogPopup(subitem.dataset.title, subitem.dataset.parent || null);
                return;
            }

            const single = e.target.closest('.catalog-item:not(.catalog-folder):not(.catalog-subitem)');
            if (single) {
                openCatalogPopup(single.dataset.title);
            }
        });

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

    document.querySelectorAll('.catalog-item').forEach(li => {
        li.dataset.plainName = li.querySelector('.ci-name')?.textContent || '';
    });

    const searchInput = document.getElementById('catalogSearch');
    const noResults   = document.getElementById('catalogNoResults');
    if (searchInput) {

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

                document.querySelectorAll('.catalog-folder').forEach(folder => {
                    folder.classList.remove('folder-open');
                    updateFolderUI(folder);
                });

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

                        // Se coincide il nome della cartella, mostra tutti i figli.
                        if (li.classList.contains('catalog-folder')) {
                            li.querySelectorAll('.catalog-subitem').forEach(sub => {
                                sub.classList.remove('hidden');
                            });
                        }

                        const idx2 = plain.toLowerCase().indexOf(q);
                        nameEl.innerHTML =
                            esc(plain.slice(0,idx2)) + '<mark>' + esc(plain.slice(idx2, idx2+q.length)) + '</mark>' + esc(plain.slice(idx2+q.length));

                        if (li.classList.contains('catalog-subitem')) {
                            const folder = li.closest('.catalog-folder');
                            if (folder) folder.classList.add('folder-open');
                        }
                    } else {
                        nameEl.innerHTML = esc(plain);
                    }
                });

                cat.querySelectorAll('.catalog-folder').forEach(folder => {
                    const hasVisible = Array.from(folder.querySelectorAll('.catalog-subitem'))
                        .some(s => !s.classList.contains('hidden'));
                    if (hasVisible) {
                        folder.classList.add('folder-open');
                        folder.classList.remove('hidden');
                        catHasMatch = true; anyVisible = true;
                    }
                });
                cat.querySelectorAll('.catalog-folder').forEach(folder => {
                    updateFolderUI(folder);
                });

                panel.classList.toggle('open', catHasMatch);
                catBtn.setAttribute('aria-expanded', catHasMatch ? 'true' : 'false');
            });
            if (noResults) noResults.style.display = anyVisible ? 'none' : 'block';
        });
    }

    document.querySelectorAll('.catalog-item:not(.catalog-folder)').forEach(li => updateCatalogItemUI(li));
    document.querySelectorAll('.catalog-folder').forEach(folder => updateFolderUI(folder));

    initAvatarTooltips(document.getElementById('catalogContainer'));
}

function initAvatarTooltips(container) {
    if (!container) return;
    container.addEventListener('click', e => {
        const avatar = e.target.closest('.ci-avatar');
        if (!avatar) {
            document.querySelectorAll('.ci-avatar.tooltip-visible').forEach(a => a.classList.remove('tooltip-visible'));
            return;
        }
        e.stopPropagation();
        const isVisible = avatar.classList.contains('tooltip-visible');
        document.querySelectorAll('.ci-avatar.tooltip-visible').forEach(a => a.classList.remove('tooltip-visible'));
        if (!isVisible) {
            avatar.classList.add('tooltip-visible');

            const rect = avatar.getBoundingClientRect();
            const tooltipEstimatedWidth = 80;
            if (rect.left + tooltipEstimatedWidth > window.innerWidth - 8) {
                avatar.style.setProperty('--tooltip-left', 'auto');
                avatar.classList.add('tooltip-right-align');
            } else {
                avatar.classList.remove('tooltip-right-align');
            }
        }
    });
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

function openAdminPanel() {
    const existing = document.getElementById('adminPanelOverlay');
    if (existing) { existing.remove(); return; }

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
                <button class="admin-tab" data-panel="novita">Aggiunti di recente</button>
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

            <!-- NOVITÀ -->
            <div class="admin-section" id="ap-novita">
                <p class="admin-hint">Ultimi titoli aggiunti — max 10 visibili. Ordine: dal più recente.</p>
                <div class="ap-add-form" style="flex-direction:column;gap:8px">
                    <input type="text" id="apRecentTitle" placeholder="Es: La Casa di Carta" autocomplete="off">
                    <select id="apRecentType">
                        <option value="serie-completa">Serie TV completa</option>
                        <option value="serie-stagione">Stagione singola</option>
                        <option value="film-cartella">Raccolta Film</option>
                        <option value="film-singolo">Film singolo</option>
                    </select>
                    <button id="apAddRecent" class="ap-btn-add">+ Aggiungi</button>
                </div>
                <div id="ap-recent-list" class="ap-list" style="margin-top:12px"></div>
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

    overlay.querySelector('#adminPanelClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            overlay.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            overlay.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
            this.classList.add('active');
            overlay.querySelector('#ap-' + this.dataset.panel).classList.add('active');
        });
    });

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
    renderApRecent();

    function renderApRecent() {
        const el = overlay.querySelector('#ap-recent-list');
        if (!el) return;
        if (!recentItems.length) { el.innerHTML = '<div class="ap-empty">Nessuna novità inserita.</div>'; return; }
        el.innerHTML = recentItems.map(item => {
            const t = TYPE_LABELS[item.type] || { icon: '', label: '' };
            return `<div class="ap-item" data-key="${esc(item._key)}">
                <div class="ap-item-info">
                    <span class="ap-item-title">${esc(item.title)}</span>
                    <span class="ap-item-meta">${t.label}</span>
                </div>
                <div class="ap-item-actions">
                    <button class="ap-btn ap-btn-edit" data-key="${esc(item._key)}" title="Modifica">✏️</button>
                    <button class="ap-btn ap-btn-del"  data-key="${esc(item._key)}" title="Rimuovi">✕</button>
                </div>
            </div>
            <div class="ap-inline-edit" id="edit-${esc(item._key)}" style="display:none">
                <input type="text" class="ap-edit-title" value="${esc(item.title)}" placeholder="Titolo">
                <select class="ap-edit-type">
                    <option value="serie-completa" ${item.type==='serie-completa'?'selected':''}>Serie TV completa</option>
                    <option value="serie-stagione" ${item.type==='serie-stagione'?'selected':''}>Stagione singola</option>
                    <option value="film-cartella"  ${item.type==='film-cartella' ?'selected':''}>Raccolta Film</option>
                    <option value="film-singolo"   ${item.type==='film-singolo'  ?'selected':''}>Film singolo</option>
                </select>
                <div style="display:flex;gap:6px;margin-top:4px">
                    <button class="ap-btn-add ap-edit-save"   data-key="${esc(item._key)}" data-addedat="${item.addedAt||0}" style="flex:1">Salva</button>
                    <button class="ap-btn    ap-edit-cancel"  data-key="${esc(item._key)}" style="flex:0.5">Annulla</button>
                </div>
            </div>`;
        }).join('');

        el.querySelectorAll('.ap-btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                el.querySelectorAll('.ap-inline-edit').forEach(d => d.style.display = 'none');
                const editDiv = el.querySelector('#edit-' + btn.dataset.key);
                if (editDiv) editDiv.style.display = 'block';
            });
        });
        el.querySelectorAll('.ap-edit-cancel').forEach(btn => {
            btn.addEventListener('click', () => {
                const editDiv = el.querySelector('#edit-' + btn.dataset.key);
                if (editDiv) editDiv.style.display = 'none';
            });
        });
        el.querySelectorAll('.ap-edit-save').forEach(btn => {
            btn.addEventListener('click', async () => {
                const editDiv  = el.querySelector('#edit-' + btn.dataset.key);
                const newTitle = editDiv.querySelector('.ap-edit-title').value.trim();
                const newType  = editDiv.querySelector('.ap-edit-type').value;
                if (!newTitle) { editDiv.querySelector('.ap-edit-title').focus(); return; }
                try {
                    await set(ref(db, 'recentlyAdded/' + btn.dataset.key), {
                        title: newTitle, type: newType,
                        addedAt: parseInt(btn.dataset.addedat) || Date.now()
                    });
                    editDiv.style.display = 'none';
                } catch(e) { alert('Errore: ' + e.message); }
            });
        });
        el.querySelectorAll('.ap-btn-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Rimuovere questa novità?')) return;
                try { await remove(ref(db, 'recentlyAdded/' + btn.dataset.key)); }
                catch(e) { alert('Errore: ' + e.message); }
            });
        });
    }

    overlay.querySelector('#apAddRecent')?.addEventListener('click', async () => {
        const titleInput = overlay.querySelector('#apRecentTitle');
        const typeInput  = overlay.querySelector('#apRecentType');
        const title      = titleInput.value.trim();
        const type       = typeInput.value;
        if (!title) { titleInput.focus(); return; }
        try {
            await push(recentRef, { title, type, addedAt: Date.now() });
            titleInput.value = '';
        } catch(e) { alert('Errore: ' + e.message); }
    });

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

    overlay.querySelectorAll('.ap-counter-save').forEach(btn => {
        btn.addEventListener('click', async () => {
            const input  = overlay.querySelector('#' + btn.dataset.input);
            const target = document.getElementById(btn.dataset.target);
            if (!input || !target) return;
            const val = input.value.trim();
            if (!val) return;

            const numOnly = val.replace(/[^0-9]/g, '');
            const sfx = { 'folders-serietv':' cart.','episodes-serietv':' ep.','folders-film':' cart.','episodes-film':' titoli' };
            target.textContent = numOnly + (sfx[btn.dataset.key] || '');
            try { await set(ref(db, 'counters/' + btn.dataset.key), numOnly); }
            catch(e) { alert('Errore salvataggio: ' + e.message); }
        });
    });

    overlay.querySelectorAll('.ap-filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            overlay.querySelectorAll('.ap-filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const search = overlay.querySelector('#apCatSearch');
            if (search) search.value = '';
            renderApCatalog(this.dataset.filter);
        });
    });

    const apCatSearch = overlay.querySelector('#apCatSearch');
    if (apCatSearch) {
        apCatSearch.addEventListener('input', function() {
            const q         = this.value.trim().toLowerCase();
            const filterCat = overlay.querySelector('.ap-filter-btn.active')?.dataset.filter || '';
            renderApCatalog(filterCat, q);
        });
    }

    window._apRenderReq  = renderApRequests;
    window._apRenderEv   = renderApEvased;
    window._apRenderSugg = renderApSugg;
}

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

            const num = String(data[key]).replace(/[^0-9]/g, '');
            el.textContent = num + (suffixes[key] || '');
        }
    });
});

let watchlistUnsubscribe = null;

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

    if (watchlistUnsubscribe) { watchlistUnsubscribe(); watchlistUnsubscribe = null; }
    if (!nick) return;

    const nickRef = ref(db, 'watchlist/' + nick);
    watchlistUnsubscribe = onValue(nickRef, snap => {
        watchlistData = snap.val() || {};
        renderWatchlist(nick);

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

document.querySelectorAll('.catalog-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.catalog-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentCatalogTab = this.dataset.ctab;
        const catView  = document.getElementById('catalogView');
        const wlEl     = document.getElementById('watchlistContainer');
        const recentEl = document.getElementById('recentContainer');
        const ptEl     = document.getElementById('playtimeContainer');

        if (catView)  catView.style.display  = 'none';
        if (wlEl)     wlEl.style.display     = 'none';
        if (recentEl) recentEl.style.display = 'none';
        if (ptEl)     ptEl.style.display     = 'none';

        if (currentCatalogTab === 'watchlist') {
            if (wlEl) wlEl.style.display = 'block';
            const inp = document.getElementById('watchlistNickInput');
            const nick = getNickname();
            if (nick && inp) { inp.value = nick; loadWatchlist(nick); }
        } else if (currentCatalogTab === 'recent') {
            if (recentEl) recentEl.style.display = 'block';
            renderRecent();
        } else if (currentCatalogTab === 'playtime') {
            if (ptEl) ptEl.style.display = 'block';
            renderPlaytime();
        } else {
            if (catView) catView.style.display = 'block';
        }
    });
});

document.getElementById('watchlistNickBtn')?.addEventListener('click', () => {
    const nick = document.getElementById('watchlistNickInput')?.value.trim();
    if (!nick) return;
    saveNickname(nick);
    loadWatchlist(nick);
});

onValue(recentRef, snap => {
    const raw = snap.val();
    recentItems = raw
        ? Object.entries(raw)
            .map(([k,v]) => ({...v, _key: k}))
            .sort((a,b) => (b.addedAt||0) - (a.addedAt||0))
            .slice(0,10)
        : [];
    if (currentCatalogTab === 'recent') renderRecent();

    const apList = document.querySelector('#ap-recent-list');
    if (apList && typeof renderApRecent === 'function') renderApRecent();
});

const TYPE_LABELS = {
    'film-singolo':   { icon: '', label: 'Film singolo' },
    'film-cartella':  { icon: '', label: 'Raccolta Film' },
    'serie-completa': { icon: '', label: 'Serie TV' },
    'serie-stagione': { icon: '', label: 'Stagione' },
};

function renderRecent() {
    const el = document.getElementById('recentList');
    if (!el) return;
    if (!recentItems.length) {
        el.innerHTML = '<div class="catalog-empty">Nessuna novità ancora.<br>Aggiungile dal pannello admin.</div>';
        return;
    }
    el.innerHTML = recentItems.map(item => {
        const t = TYPE_LABELS[item.type] || { icon: '🎬', label: item.type || '' };
        return `<div class="recent-item">
            ${t.icon ? `<span class="recent-icon">${t.icon}</span>` : ''}
            <div class="recent-info">
                <span class="recent-title">${esc(item.title)}</span>
                <span class="recent-meta">
                    <span class="recent-type-badge">${t.label}</span>
                </span>
            </div>
        </div>`;
    }).join('');
}

let playtimeData  = null;
let currentPtTab  = 'all_time';

onValue(playtimeRef, (snap) => {
    playtimeData = snap.val();
    if (currentCatalogTab === 'playtime') renderPlaytime();
});

let currentPtSubTab = 'all_time';

function renderPlaytime() {
    const content = document.getElementById('playtimeContent');
    const updated = document.getElementById('playtimeUpdated');
    if (!content) return;

    if (!playtimeData) {
        content.innerHTML = '<div class="catalog-empty">Nessun dato disponibile ancora.</div>';
        return;
    }

    const isMonth  = currentPtTab === 'this_month';
    const isAvg    = currentPtTab === 'average';

    if (isMonth && !currentPtSubTab.startsWith('this_month')) currentPtSubTab = 'this_month';
    if (!isMonth && !isAvg && currentPtSubTab.startsWith('this_month')) currentPtSubTab = 'all_time';
    if (isAvg && !currentPtSubTab.startsWith('average')) currentPtSubTab = 'average_raw';
    if (!isAvg && currentPtSubTab.startsWith('average')) currentPtSubTab = isMonth ? 'this_month' : 'all_time';

    const dataKey = currentPtSubTab;
    const section = playtimeData[dataKey] || {};
    const total   = section['_total'] || 0;
    const label   = isAvg
        ? (currentPtSubTab === 'average_raw'
            ? 'Calcolata su tutti i giorni dal primo utilizzo ad oggi'
            : 'Calcolata solo sui giorni di utilizzo')
        : isMonth
            ? (playtimeData.month_label || 'Questo mese')
            : 'All time';

    const minHours = (isMonth && !isAvg) ? 0.5 : 0;
    const users = Object.entries(section)
        .filter(([k, v]) => k !== '_total' && v >= minHours)
        .sort((a, b) => b[1] - a[1]);

    const maxHours = users.length ? users[0][1] : 1;
    const medals = ['🥇', '🥈', '🥉'];

    const tabBar = `
        <div class="tab-bar" id="ptTabBar" style="margin-bottom:12px">
            <button class="tab ${(!isMonth && !isAvg) ? 'active' : ''}" data-pt="all_time">All time</button>
            <button class="tab ${isMonth ? 'active' : ''}" data-pt="this_month">Questo mese</button>
            <button class="tab ${isAvg ? 'active' : ''}" data-pt="average">Media</button>
        </div>`;

    const allSubTabs = isAvg
        ? [['average_raw','Media Grezza'],['average_active','Media Attiva']]
        : !isMonth
            ? [['all_time','Totale'],['all_time_film','Film'],['all_time_tv','Serie TV']]
            : [['this_month','Totale'],['this_month_film','Film'],['this_month_tv','Serie TV']];
    const subTabBar = `
        <div class="tab-bar pt-subtab-bar" style="margin-bottom:16px">
            ${allSubTabs.map(([key, label]) =>
                `<button class="tab ${currentPtSubTab === key ? 'active' : ''}" data-ptsub="${key}">${label}</button>`
            ).join('')}
        </div>`;

    const formatValue = isAvg ? formatAvgHours : formatHours;

    content.innerHTML = tabBar + subTabBar + `
        <div class="pt-total">
            <span class="pt-total-label">${isAvg ? label : label + ' — NULLAFACENZA'}</span>
            <span class="pt-total-value">${formatValue(total)}</span>
        </div>
        <div class="pt-users">
            ${users.length === 0
                ? '<div class="catalog-empty">Nessuna visione registrata.</div>'
                : users.map(([name, hours], i) => {
                    const pct = Math.round((hours / maxHours) * 100);
                    return `<div class="pt-row">
                        <div class="pt-row-top">
                            <span class="pt-medal">${medals[i] || ''}</span>
                            <span class="pt-name">${esc(name)}</span>
                            <span class="pt-hours">${formatValue(hours)}</span>
                        </div>
                        <div class="pt-bar-track">
                            <div class="pt-bar-fill" style="width:${pct}%"></div>
                        </div>
                    </div>`;
                }).join('')
            }
        </div>`;

    content.querySelectorAll('[data-pt]').forEach(btn => {
        btn.addEventListener('click', function() {
            currentPtTab = this.dataset.pt;
            renderPlaytime();
        });
    });

    content.querySelectorAll('[data-ptsub]').forEach(btn => {
        btn.addEventListener('click', function() {
            currentPtSubTab = this.dataset.ptsub;
            renderPlaytime();
        });
    });

    if (updated && playtimeData.updated_at) {
        const dayOnly = playtimeData.updated_at.split(' ')[0];
        updated.textContent = `Aggiornato il ${dayOnly}`;
    }
}

function formatHours(h) {
    if (h < 1) return `${Math.round(h * 60)} min`;
    const totalH = Math.floor(h);
    const giorni = Math.floor(totalH / 24);
    const oreRim = totalH % 24;
    if (giorni > 0) {
        return `${totalH} h (${giorni} g ${oreRim} h)`;
    }
    return `${totalH} h`;
}

function formatAvgHours(h) {
    if (h < 1) return `${Math.round(h * 60)} min/giorno`;
    const wholeH = Math.floor(h);
    const mins   = Math.round((h - wholeH) * 60);
    if (mins === 0) return `${wholeH} h/giorno`;
    return `${wholeH} h ${mins} min/giorno`;
}

isAdminMode = checkAdmin();
renderAdminBtn();
initCatalog();

const savedNick = getNickname();
if (savedNick) {
    const sn = document.getElementById('suggNick');
    if (sn) sn.value = savedNick;
    loadWatchlist(savedNick);
}

initSuggFormStars();
