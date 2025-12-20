
const CATEGORIES = [
    "영화/애니메이션", "자동차/교통", "음악", "애완동물/동물", "스포츠",
    "여행/이벤트", "게임", "인물/블로그", "코미디", "엔터테인먼트",
    "뉴스/정치", "노하우/스타일", "교육", "과학/기술", "비영리/사회운동"
];

// Configuration
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

// --- INITIALIZATION (Concurrent & Prioritized) ---

let db;
let auth;

// 1. Initialize Firebase IMMEDIATELY (Highest Priority)
try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.database();
    console.log("Firebase Init Started");

    // 2. Start Auth Immediately (Background)
    auth.signInAnonymously().catch(e => console.warn("Auth retry needed:", e));

    // 3. Start Connection Monitoring Immediately
    db.ref(".info/connected").on("value", snap => {
        const el = document.getElementById('status-message');
        if (snap.val() === true) {
            console.log("Connected!");
            if (el) { el.innerText = "서버 연결됨"; el.style.color = "#4dabf7"; }
        } else {
            console.log("Disconnected (or Connecting...)");
            if (el && !el.innerText.includes("모드")) {
                el.innerText = "연결 중...";
                el.style.color = "#aaa";
            }
        }
    });

} catch (e) {
    console.error("Critical Init Error:", e);
    // Even if critical error, we can run safely in UI-only mode? No, just alert.
}

// 4. Start App Logic (Wait for DOM)
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    setupUI();

    // 5. CACHE FAST LOAD (Instant UX)
    loadCachedApiKeys();

    if (auth && db) {
        // 6. Bind Realtime Listeners (Once Auth is ready/changed)
        auth.onAuthStateChanged(user => {
            if (user) {
                console.log("User ready, syncing...");
                syncApiKeys();
                setupRealtimeListener();
            }
        });
    } else {
        alert("Firebase 로드 실패. 오프라인 모드로 동작합니다.");
    }
}

// --- CORE SYNC LOGIC ---

function syncApiKeys() {
    // Priority: Cloud -> Local (Sync Down)
    db.ref(DB_KEY_PATH).on('value', snapshot => {
        const keys = snapshot.val() || {};
        localStorage.setItem('cached_api_keys', JSON.stringify(keys)); // Update Cache
        renderKeys(keys); // Render
        const el = document.getElementById('status-message');
        if (el) el.innerText = "동기화 완료";
    }, err => {
        console.warn("Sync Read Error (Offline?):", err);
        // Do nothing, keep showing cache
    });
}

function loadCachedApiKeys() {
    try {
        const cached = localStorage.getItem('cached_api_keys');
        if (cached) renderKeys(JSON.parse(cached));
    } catch (e) { }
}

const CATEGORY_IDS = {
    "영화/애니메이션": "1", "자동차/교통": "2", "음악": "10", "애완동물/동물": "15",
    "스포츠": "17", "여행/이벤트": "19", "게임": "20", "인물/블로그": "22",
    "코미디": "23", "엔터테인먼트": "24", "뉴스/정치": "25", "노하우/스타일": "26",
    "교육": "27", "과학/기술": "28", "비영리/사회운동": "29"
};

// --- DATA LOGIC ---

// Optimistic Save
function saveApiKey() {
    const name = document.getElementById('new-key-name').value.trim();
    const key = document.getElementById('new-key-value').value.trim();
    const type = document.getElementById('new-key-type').value;
    const id = document.getElementById('edit-key-id').value;

    if (!name || !key) return alert("값을 입력해주세요.");

    const data = {
        name, key, type,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };

    // 1. Attempt Cloud Save
    const promise = id
        ? db.ref(`${DB_KEY_PATH}/${id}`).update(data)
        : (data.active = true, data.createdAt = firebase.database.ServerValue.TIMESTAMP, db.ref(DB_KEY_PATH).push(data));

    promise
        .then(() => {
            alert("저장되었습니다.");
            resetForm();
        })
        .catch(e => {
            alert("저장 실패 (네트워크 확인): " + e.message);
        });
}

// Read Keys: Hybrid (Cache First)
function getActiveApiKey(type = 'youtube') {
    // 1. Try Cache Immediately
    try {
        const cached = JSON.parse(localStorage.getItem('cached_api_keys') || '{}');
        const keys = Object.values(cached).filter(k => (k.type || 'youtube') === type && k.active !== false);
        if (keys.length > 0) return Promise.resolve(keys[Math.floor(Math.random() * keys.length)].key);
    } catch (e) { }

    // 2. Fallback to Server if Cache Empty (Rare)
    return db.ref(DB_KEY_PATH).orderByChild('active').equalTo(true).once('value').then(snap => {
        const val = snap.val();
        if (!val) return null;
        const keys = Object.values(val).filter(k => (k.type || 'youtube') === type);
        return keys.length ? keys[Math.floor(Math.random() * keys.length)].key : null;
    });
}

function setupRealtimeListener() {
    db.ref('global_search_state').on('value', snap => {
        const data = snap.val();
        if (data) updateUI(data);
    });
}

async function performSearch(query, category) {
    const statusMsg = document.getElementById('status-message');

    // Get Key
    const youtubeKey = await getActiveApiKey('youtube');
    const translateKey = await getActiveApiKey('translate');

    if (!youtubeKey) return alert("API 키가 없습니다.");

    statusMsg.innerText = "검색 중...";
    statusMsg.style.color = "#4dabf7";

    try {
        let keywords = [];

        if (query) {
            // Keyword Mode
            const part1 = await fetchYouTubeSearch(query, youtubeKey, null);
            keywords = part1.items.map(i => i.snippet.title);
            if (part1.nextPageToken) {
                const part2 = await fetchYouTubeSearch(query, youtubeKey, part1.nextPageToken);
                keywords = keywords.concat(part2.items.map(i => i.snippet.title));
            }
        } else {
            // Category Mode
            const catId = CATEGORY_IDS[category];
            try {
                if (!catId) throw new Error("NoCat");
                const part1 = await fetchYouTubePopular(catId, youtubeKey, null);
                keywords = part1.items.map(i => i.snippet.title);
                if (part1.nextPageToken) {
                    const part2 = await fetchYouTubePopular(catId, youtubeKey, part1.nextPageToken);
                    keywords = keywords.concat(part2.items.map(i => i.snippet.title));
                }
            } catch (e) {
                // Fallback
                const part1 = await fetchYouTubeSearch(category, youtubeKey, null);
                keywords = part1.items.map(i => i.snippet.title);
            }
        }

        keywords = [...new Set(keywords)].slice(0, 100);

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
            query: query || category,
            selectedCategory: category,
            results: results,
            timestamp: Date.now()
        };

        updateUI(state);
        statusMsg.innerText = "완료";
        statusMsg.style.color = "#aaa";

        // Sync State
        db.ref('global_search_state').update(state).catch(e => console.warn(e));

    } catch (e) {
        statusMsg.innerText = "오류: " + e.message;
        statusMsg.style.color = "#ff4444";
        alert(e.message);
    }
}

// --- HELPERS (UI, API) ---

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

    document.getElementById('search-btn').onclick = () => performSearch(document.getElementById('keyword-input').value, getCurrentCategory());
    document.getElementById('keyword-input').onkeypress = (e) => { if (e.key === 'Enter') performSearch(e.target.value, getCurrentCategory()); };

    // Modal
    const modal = document.getElementById('api-modal');
    document.getElementById('api-btn').onclick = () => { modal.style.display = "block"; resetForm(); };
    document.querySelector('.close').onclick = () => modal.style.display = "none";
    window.onclick = (e) => { if (e.target == modal) modal.style.display = "none"; };

    document.getElementById('save-key-btn').onclick = saveApiKey;
    document.getElementById('cancel-edit-btn').onclick = resetForm;
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

function resetForm() {
    document.getElementById('new-key-name').value = "";
    document.getElementById('new-key-value').value = "";
    document.getElementById('new-key-type').value = "youtube";
    document.getElementById('edit-key-id').value = "";
    document.getElementById('save-key-btn').innerText = "저장하기";
    document.getElementById('cancel-edit-btn').style.display = "none";
}

function getCurrentCategory() {
    return document.querySelector('.category-pill.active')?.innerText || "엔터테인먼트";
}

// Global Actions
window.prepareEdit = (id, n, k, t) => {
    document.getElementById('new-key-name').value = n;
    document.getElementById('new-key-value').value = k;
    document.getElementById('new-key-type').value = t;
    document.getElementById('edit-key-id').value = id;
    document.getElementById('save-key-btn').innerText = "수정 완료";
    document.getElementById('cancel-edit-btn').style.display = "block";
};
window.toggleKey = (id, active) => db.ref(`${DB_KEY_PATH}/${id}/active`).set(active);
window.deleteKey = (id) => { if (confirm("삭제하시겠습니까?")) db.ref(`${DB_KEY_PATH}/${id}`).remove(); };

// API Fetchers
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
    const b = async (l) => { try { const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: tx, target: l, format: 'text' }) }); return (await r.json()).data.translations.map(t => t.translatedText); } catch { return Array(tx.length).fill('x'); } };
    await Promise.all(['en', 'ja', 'zh-CN', 'es', 'hi', 'ru'].map(async l => rs[l] = await b(l)));
    return rs;
}
