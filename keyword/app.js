
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, onValue, update, push, set, remove, serverTimestamp, query, orderByChild, equalTo, get } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyDdk_axp2Q9OANqleknWeYWK9DrxKWKeY4",
    authDomain: "template-3530f.firebaseapp.com",
    databaseURL: "https://template-3530f.firebaseio.com",
    projectId: "template-3530f",
    storageBucket: "template-3530f.firebasestorage.app",
    messagingSenderId: "891098188622",
    appId: "1:891098188622:web:392c0121a17f1cd4402c1f"
};

const DB_KEY_PATH = 'shared_api_keys';

const CATEGORIES = [
    "영화/애니메이션", "자동차/교통", "음악", "애완동물/동물", "스포츠",
    "여행/이벤트", "게임", "인물/블로그", "코미디", "엔터테인먼트",
    "뉴스/정치", "노하우/스타일", "교육", "과학/기술", "비영리/사회운동"
];

const CATEGORY_IDS = {
    "영화/애니메이션": "1", "자동차/교통": "2", "음악": "10", "애완동물/동물": "15",
    "스포츠": "17", "여행/이벤트": "19", "게임": "20", "인물/블로그": "22",
    "코미디": "23", "엔터테인먼트": "24", "뉴스/정치": "25", "노하우/스타일": "26",
    "교육": "27", "과학/기술": "28", "비영리/사회운동": "29"
};

// --- STATE ---
let db;
let auth;

// --- INITIALIZATION ---
async function initApp() {
    setupUI();

    // 1. INSTANT CACHE LOAD
    loadCachedApiKeys();

    try {
        console.log("Initializing Firebase (Modular)...");
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getDatabase(app);

        // 2. Connection Monitor
        const connectedRef = ref(db, ".info/connected");
        onValue(connectedRef, (snap) => {
            const statusIndicator = document.getElementById('status-message');
            if (snap.val() === true) {
                console.log("Connected to Firebase");
                if (statusIndicator) {
                    statusIndicator.innerText = "서버 연결됨";
                    statusIndicator.style.color = "#4dabf7";
                }
            } else {
                console.log("Disconnected (or Connecting...)");
                if (statusIndicator) {
                    statusIndicator.innerText = "연결 중...";
                    statusIndicator.style.color = "#aaa";
                }
            }
        });

        // 3. Auth & Sync
        signInAnonymously(auth).catch(e => console.error("Auth Fail:", e));

        onAuthStateChanged(auth, user => {
            if (user) {
                console.log("User Authenticated:", user.uid);
                startDataSync();
            }
        });

    } catch (e) {
        console.error("Init Error:", e);
        alert("앱 초기화 오류: " + e.message);
    }
}

// --- DATA SYNC ---
function startDataSync() {
    // Sync API Keys
    const keysRef = ref(db, DB_KEY_PATH);
    onValue(keysRef, (snapshot) => {
        const val = snapshot.val() || {};
        localStorage.setItem('cached_api_keys', JSON.stringify(val)); // Update Cache
        renderKeys(val);
    }, (err) => {
        console.warn("Read Error:", err);
    });

    // Sync Search State
    const searchStateRef = ref(db, 'global_search_state');
    onValue(searchStateRef, (snapshot) => {
        const val = snapshot.val();
        if (val) updateUI(val);
    });
}

function loadCachedApiKeys() {
    try {
        const cached = localStorage.getItem('cached_api_keys');
        if (cached) renderKeys(JSON.parse(cached));
    } catch { }
}

// --- DATA OPERATIONS ---
window.saveApiKey = function () { // Modified to attach to window for HTML onclick
    const name = document.getElementById('new-key-name').value.trim();
    const key = document.getElementById('new-key-value').value.trim();
    const type = document.getElementById('new-key-type').value;
    const id = document.getElementById('edit-key-id').value;

    if (!name || !key) return alert("입력값을 확인해주세요.");
    if (!db) return alert("서버 연결 대기 중...");

    const data = {
        name, key, type,
        updatedAt: serverTimestamp()
    };

    let promise;
    if (id) {
        // Update
        promise = update(ref(db, `${DB_KEY_PATH}/${id}`), data);
    } else {
        // Create
        data.active = true;
        data.createdAt = serverTimestamp();
        promise = push(ref(db, DB_KEY_PATH), data);
    }

    promise.then(() => {
        alert(id ? "수정됨" : "저장됨");
        resetForm();
    }).catch(e => alert("실패: " + e.message));
};

window.toggleKey = function (id, isActive) {
    if (db) set(ref(db, `${DB_KEY_PATH}/${id}/active`), isActive);
};

window.deleteKey = function (id) {
    if (confirm("삭제?")) {
        if (db) remove(ref(db, `${DB_KEY_PATH}/${id}`));
    }
};

window.prepareEdit = function (id, name, key, type) {
    document.getElementById('new-key-name').value = name;
    document.getElementById('new-key-value').value = key;
    document.getElementById('new-key-type').value = type;
    document.getElementById('edit-key-id').value = id;
    document.getElementById('save-key-btn').innerText = "수정 완료";
    document.getElementById('cancel-edit-btn').style.display = "block";
};

// --- READ KEYS (Hybrid) ---
async function getActiveApiKey(type = 'youtube') {
    // 1. Cache
    try {
        const cached = JSON.parse(localStorage.getItem('cached_api_keys') || '{}');
        const keys = Object.values(cached).filter(k => (k.type || 'youtube') === type && k.active !== false);
        if (keys.length > 0) return keys[Math.floor(Math.random() * keys.length)].key;
    } catch { }

    // 2. Server
    if (!db) return null;
    try {
        const q = query(ref(db, DB_KEY_PATH), orderByChild('active'), equalTo(true));
        const snap = await get(q);
        const val = snap.val();
        if (!val) return null;
        const keys = Object.values(val).filter(k => (k.type || 'youtube') === type);
        return keys.length ? keys[Math.floor(Math.random() * keys.length)].key : null;
    } catch (e) {
        console.warn("DB Read Fail", e);
        return null;
    }
}

// --- SEARCH LOGIC ---
async function performSearch(queryText, category) {
    const statusMsg = document.getElementById('status-message');
    const youtubeKey = await getActiveApiKey('youtube');
    const translateKey = await getActiveApiKey('translate');

    if (!youtubeKey) return alert("API 키가 없습니다.");

    statusMsg.innerText = "데이터 요청 중...";
    statusMsg.style.color = "#4dabf7";

    try {
        let keywords = [];

        if (queryText) {
            // Keyword
            const p1 = await fetchYouTubeSearch(queryText, youtubeKey, null);
            keywords = p1.items.map(i => i.snippet.title);
            if (p1.nextPageToken) {
                const p2 = await fetchYouTubeSearch(queryText, youtubeKey, p1.nextPageToken);
                keywords = [...keywords, ...p2.items.map(i => i.snippet.title)];
            }
        } else {
            // Category
            const catId = CATEGORY_IDS[category];
            try {
                if (!catId) throw new Error("ID Missing");
                const p1 = await fetchYouTubePopular(catId, youtubeKey, null);
                keywords = p1.items.map(i => i.snippet.title);
                if (p1.nextPageToken) {
                    const p2 = await fetchYouTubePopular(catId, youtubeKey, p1.nextPageToken);
                    keywords = [...keywords, ...p2.items.map(i => i.snippet.title)];
                }
            } catch (e) {
                // Fallback
                console.warn("Trending Fail -> Search Fallback");
                const p1 = await fetchYouTubeSearch(category, youtubeKey, null);
                keywords = p1.items.map(i => i.snippet.title);
            }
        }

        keywords = [...new Set(keywords)].slice(0, 100);

        // Translate
        let translated = { en: [], ja: [], 'zh-CN': [], es: [], hi: [], ru: [] };
        if (translateKey) {
            statusMsg.innerText = "번역 중...";
            translated = await translateKeywords(keywords, translateKey);
        }

        const results = keywords.map((k, i) => ({
            rank: i + 1, korean: k,
            english: translated.en[i] || '-', japanese: translated.ja[i] || '-',
            chinese: translated['zh-CN'][i] || '-', spanish: translated.es[i] || '-',
            hindi: translated.hi[i] || '-', russian: translated.ru[i] || '-'
        }));

        const state = {
            query: queryText || category,
            selectedCategory: category,
            results: results,
            timestamp: Date.now()
        };

        updateUI(state);
        statusMsg.innerText = "완료";
        statusMsg.style.color = "#aaa";

        if (db) update(ref(db, 'global_search_state'), state).catch(() => { });

    } catch (e) {
        statusMsg.innerText = "오류: " + e.message;
        statusMsg.style.color = "#ff4444";
        alert(e.message);
    }
}

// --- API FETCHERS ---
async function fetchYouTubeSearch(q, k, pt) {
    let u = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=50&key=${k}`;
    if (pt) u += `&pageToken=${pt}`;
    const r = await fetch(u); if (!r.ok) throw new Error("YouTube API Error"); return r.json();
}
async function fetchYouTubePopular(c, k, pt) {
    let u = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=KR&videoCategoryId=${c}&maxResults=50&key=${k}`;
    if (pt) u += `&pageToken=${pt}`;
    const r = await fetch(u); if (!r.ok) throw new Error("YouTube API Error"); return r.json();
}
async function translateKeywords(tx, k) {
    const rs = {};
    const b = async (l) => { try { const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: tx, target: l, format: 'text' }) }); return (await r.json()).data.translations.map(t => t.translatedText); } catch { return Array(tx.length).fill('-'); } };
    await Promise.all(['en', 'ja', 'zh-CN', 'es', 'hi', 'ru'].map(async l => rs[l] = await b(l)));
    return rs;
}

// --- UI HELPERS ---
function setupUI() {
    const list = document.getElementById('categories-list');
    list.innerHTML = '';
    CATEGORIES.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = 'category-pill';
        btn.innerText = cat;
        btn.onclick = () => performSearch(null, cat);
        list.appendChild(btn);
    });

    document.getElementById('search-btn').addEventListener('click', () => performSearch(document.getElementById('keyword-input').value, getCurrentCategory()));
    document.getElementById('keyword-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(e.target.value, getCurrentCategory()); });

    const modal = document.getElementById('api-modal');
    document.getElementById('api-btn').onclick = () => { modal.style.display = "block"; resetForm(); };
    document.querySelector('.close').onclick = () => modal.style.display = "none";
    window.onclick = (e) => { if (e.target == modal) modal.style.display = "none"; };

    document.getElementById('save-key-btn').addEventListener('click', window.saveApiKey); // Attach
    document.getElementById('cancel-edit-btn').onclick = resetForm;
}

function resetForm() {
    document.getElementById('new-key-name').value = "";
    document.getElementById('new-key-value').value = "";
    document.getElementById('new-key-type').value = "youtube";
    document.getElementById('edit-key-id').value = "";
    document.getElementById('save-key-btn').innerText = "저장하기";
    document.getElementById('cancel-edit-btn').style.display = "none";
}

function renderKeys(keysData) {
    const list = document.getElementById('key-list');
    list.innerHTML = '';
    const keys = Object.entries(keysData);
    if (keys.length === 0) { list.innerHTML = '<div style="padding:20px;text-align:center;color:#666">저장된 키 없음</div>'; return; }

    keys.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

    keys.forEach(([id, d]) => {
        const item = document.createElement('div');
        item.className = 'key-item';
        const vKey = d.key.length > 10 ? d.key.substring(0, 6) + "..." + d.key.substring(d.key.length - 4) : d.key;
        item.innerHTML = `
            <div class="key-info">
                <div style="font-weight:bold;color:#fff;display:flex;align-items:center;gap:8px">
                    ${d.type === 'translate' ? '🌐' : '📺'} ${d.name} <span style="font-size:0.8em;background:#444;border-radius:10px;padding:2px 8px;color:#ccc">${d.type || 'youtube'}</span>
                </div>
                <div class="key-value">${vKey}</div>
            </div>
            <div class="key-actions">
                <button class="btn-delete" style="color:#4dabf7;border-color:#4dabf7" onclick="prepareEdit('${id}','${d.name}','${d.key}','${d.type}')">✏️</button>
                <label class="toggle-switch"><input type="checkbox" ${d.active !== false ? 'checked' : ''} onchange="toggleKey('${id}',this.checked)"><span class="slider"></span></label>
                <button class="btn-delete" onclick="deleteKey('${id}')">🗑️</button>
            </div>
        `;
        list.appendChild(item);
    });
}

function updateUI(data) {
    const input = document.getElementById('keyword-input');
    if (input.value !== (data.query || "") && data.query) input.value = data.query;
    document.querySelectorAll('.category-pill').forEach(b => {
        b.classList.toggle('active', b.innerText === data.selectedCategory);
    });
    const tb = document.querySelector('#results-table tbody');
    tb.innerHTML = '';
    if (data.results) {
        data.results.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.rank}</td><td style="color:#fff">${row.korean}</td><td>${row.english}</td><td>${row.japanese}</td><td>${row.chinese}</td><td>${row.spanish}</td><td>${row.hindi}</td><td>${row.russian}</td>`;
            tb.appendChild(tr);
        });
    }
}

function getCurrentCategory() {
    return document.querySelector('.category-pill.active')?.innerText || "엔터테인먼트";
}

// Start
initApp();
