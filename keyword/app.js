
const CATEGORIES = [
    "영화/애니메이션", "자동차/교통", "음악", "애완동물/동물", "스포츠",
    "여행/이벤트", "게임", "인물/블로그", "코미디", "엔터테인먼트",
    "뉴스/정치", "노하우/스타일", "교육", "과학/기술", "비영리/사회운동"
];

let db;
let auth;

// Config: Using Realtime Database for speed and reliability
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

async function initApp() {
    setupUI();

    // [KEY FEATURE] 1. Instant Load from Cache (Speed 0.1s)
    loadCachedApiKeys();

    try {
        // 2. Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.database();
        console.log("Firebase initialized");

        // 3. Connection Status Monitor
        db.ref(".info/connected").on("value", (snap) => {
            const statusIndicator = document.getElementById('status-message');
            if (snap.val() === true) {
                if (statusIndicator) {
                    statusIndicator.innerText = "서버 동기화 중";
                    statusIndicator.style.color = "#4dabf7";
                }
            } else {
                if (statusIndicator) {
                    statusIndicator.innerText = "연결 대기 중 (저장은 가능)";
                    statusIndicator.style.color = "#aaa";
                }
            }
        });

        // 4. Background Auth & Sync
        auth.signInAnonymously().catch(error => console.warn("Auth warning:", error));

        auth.onAuthStateChanged(user => {
            if (user) {
                // Once logged in, start reliable sync
                syncApiKeys();
                setupRealtimeListener();
            }
        });
    } catch (e) {
        console.error("Firebase Init Error:", e);
        alert("서버 연결에 실패했습니다. 캐시된 데이터로 동작합니다.");
    }
}

// --- HYBRID DATA SYSTEM (Cache + Cloud) ---

function loadCachedApiKeys() {
    try {
        const cached = localStorage.getItem('cached_api_keys');
        if (cached) {
            console.log("Loaded keys from cache (Fast)");
            renderKeys(JSON.parse(cached));
        }
    } catch (e) { console.warn("Cache empty"); }
}

function syncApiKeys() {
    if (!db) return;

    // Using .on() ensures we get updates from other devices instantly
    db.ref(DB_KEY_PATH).on('value', snapshot => {
        const keys = snapshot.val() || {};

        // 1. Save to Local Cache (for next time)
        localStorage.setItem('cached_api_keys', JSON.stringify(keys));

        // 2. Update Screen
        renderKeys(keys);

        const statusIndicator = document.getElementById('status-message');
        if (statusIndicator) statusIndicator.innerText = "최신 데이터 동기화 완료";
    }, err => {
        console.error("Sync Error:", err);
    });
}

function setupUI() {
    const catList = document.getElementById('categories-list');
    catList.innerHTML = '';
    CATEGORIES.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = 'category-pill';
        btn.innerText = cat;
        btn.onclick = () => selectCategory(cat);
        catList.appendChild(btn);
    });

    document.getElementById('search-btn').addEventListener('click', () => {
        performSearch(document.getElementById('keyword-input').value, getCurrentCategory());
    });

    document.getElementById('keyword-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch(e.target.value, getCurrentCategory());
    });

    const modal = document.getElementById('api-modal');
    document.getElementById('api-btn').addEventListener('click', () => {
        modal.style.display = "block";
        resetForm();
    });
    document.querySelector('.close').onclick = () => modal.style.display = "none";
    window.onclick = (e) => { if (e.target == modal) modal.style.display = "none"; };

    document.getElementById('save-key-btn').addEventListener('click', saveApiKey);
    document.getElementById('cancel-edit-btn').addEventListener('click', resetForm);
}

function resetForm() {
    document.getElementById('new-key-name').value = "";
    document.getElementById('new-key-value').value = "";
    document.getElementById('new-key-type').value = "youtube";
    document.getElementById('edit-key-id').value = "";
    const saveBtn = document.getElementById('save-key-btn');
    saveBtn.innerText = "저장하기";
    saveBtn.disabled = false;
    document.getElementById('cancel-edit-btn').style.display = "none";
}

function renderKeys(keysData) {
    const listContainer = document.getElementById('key-list');
    listContainer.innerHTML = '';

    const keys = Object.entries(keysData);
    if (keys.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding:40px; color:#666;">등록된 API Key가 없습니다.</div>';
        return;
    }

    // Sort: Newest First
    keys.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

    keys.forEach(([id, data]) => {
        const isActive = data.active !== false;
        const created = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : '방금 전';
        const type = data.type || 'youtube';
        const typeIcon = type === 'translate' ? '🌐' : '📺';

        const item = document.createElement('div');
        item.className = 'key-item';
        // Mask Key
        const visibleKey = data.key.length > 10 ? data.key.substring(0, 6) + "..." + data.key.substring(data.key.length - 4) : data.key;

        item.innerHTML = `
            <div class="key-info">
                <div style="font-weight:bold; color:#fff; font-size:1rem; display:flex; gap:8px; align-items:center;">
                    <span>${typeIcon}</span> ${data.name} 
                    <span style="font-size:0.75em; background:#444; padding:2px 8px; border-radius:10px; color:#ccc;">${type}</span>
                </div>
                <div class="key-value">${visibleKey}</div>
                <div class="key-meta">${created}</div>
            </div>
            <div class="key-actions">
                <button class="btn-delete" style="border-color:#4dabf7; color:#4dabf7;" onclick="prepareEdit('${id}', '${data.name}', '${data.key}', '${type}')">✏️</button>
                <label class="toggle-switch">
                    <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleKey('${id}', this.checked)">
                    <span class="slider"></span>
                </label>
                <button class="btn-delete" onclick="deleteKey('${id}')">🗑️</button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

function saveApiKey() {
    const name = document.getElementById('new-key-name').value.trim();
    const key = document.getElementById('new-key-value').value.trim();
    const type = document.getElementById('new-key-type').value;
    const id = document.getElementById('edit-key-id').value;

    if (!name || !key) {
        alert("정보를 모두 입력해주세요.");
        return;
    }

    if (!db) {
        alert("서버 연결 중입니다. 잠시 후 다시 시도해주세요.");
        return;
    }

    const data = {
        name, key, type,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };

    if (id) {
        db.ref(`${DB_KEY_PATH}/${id}`).update(data)
            .then(() => alert("수정 완료 (서버 동기화됨)"))
            .catch(e => alert("오류: " + e.message));
    } else {
        data.active = true;
        data.createdAt = firebase.database.ServerValue.TIMESTAMP;
        db.ref(DB_KEY_PATH).push(data)
            .then(() => {
                alert("저장 완료 (서버 동기화됨)");
                resetForm();
            })
            .catch(e => alert("오류: " + e.message));
    }
}

window.prepareEdit = function (id, name, key, type) {
    document.getElementById('new-key-name').value = name;
    document.getElementById('new-key-value').value = key;
    document.getElementById('new-key-type').value = type;
    document.getElementById('edit-key-id').value = id;
    const saveBtn = document.getElementById('save-key-btn');
    saveBtn.innerText = "수정 완료";
    document.getElementById('cancel-edit-btn').style.display = "block";
};

window.toggleKey = function (id, isActive) {
    if (db) db.ref(`${DB_KEY_PATH}/${id}/active`).set(isActive);
};

window.deleteKey = function (id) {
    if (confirm("삭제하시겠습니까?")) {
        if (db) db.ref(`${DB_KEY_PATH}/${id}`).remove();
    }
};

// --- DATA LOGIC ---

function getActiveApiKey(type = 'youtube') {
    // Strategy: Try Cache FIRST (Instant), then DB (Fresh)
    // Actually, asking DB directly ensures validity, but to be fast we trust cache if sync is pending
    // But for Search safety, let's look at the in-memory keys from renderKeys? 
    // Easier: Just Query DB (it has local cache in SDK usually, or use our localStorage)

    // We use localStorage for READ speed
    try {
        const cached = localStorage.getItem('cached_api_keys');
        if (cached) {
            const keysVal = JSON.parse(cached);
            const keys = Object.values(keysVal).filter(k => (k.type || 'youtube') === type && k.active !== false);
            if (keys.length > 0) return Promise.resolve(keys[Math.floor(Math.random() * keys.length)].key);
        }
    } catch (e) { }

    // Fallback or Empty Cache
    if (!db) return Promise.resolve(null);
    return db.ref(DB_KEY_PATH).orderByChild('active').equalTo(true).once('value')
        .then(snap => {
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

const CATEGORY_IDS = {
    "영화/애니메이션": "1", "자동차/교통": "2", "음악": "10", "애완동물/동물": "15",
    "스포츠": "17", "여행/이벤트": "19", "게임": "20", "인물/블로그": "22",
    "코미디": "23", "엔터테인먼트": "24", "뉴스/정치": "25", "노하우/스타일": "26",
    "교육": "27", "과학/기술": "28", "비영리/사회운동": "29"
};

function getCurrentCategory() {
    const active = document.querySelector('.category-pill.active');
    return active ? active.innerText : "엔터테인먼트";
}

function selectCategory(category) {
    performSearch(null, category);
}

async function performSearch(query, category) {
    const statusMsg = document.getElementById('status-message');
    const youtubeKey = await getActiveApiKey('youtube');
    const translateKey = await getActiveApiKey('translate');

    if (!youtubeKey) {
        alert("사용 가능한 YouTube API Key가 없습니다.");
        return;
    }

    statusMsg.innerText = "검색 중...";
    statusMsg.style.color = "#4dabf7";

    try {
        let keywords = [];

        if (query) {
            const part1 = await fetchYouTubeSearch(query, youtubeKey, null);
            keywords = part1.items.map(i => i.snippet.title);
            if (part1.nextPageToken) {
                const part2 = await fetchYouTubeSearch(query, youtubeKey, part1.nextPageToken);
                keywords = keywords.concat(part2.items.map(i => i.snippet.title));
            }
        } else {
            const catId = CATEGORY_IDS[category];
            try {
                const part1 = await fetchYouTubePopular(catId, youtubeKey, null);
                keywords = part1.items.map(i => i.snippet.title);
                if (part1.nextPageToken) {
                    const part2 = await fetchYouTubePopular(catId, youtubeKey, part1.nextPageToken);
                    keywords = keywords.concat(part2.items.map(i => i.snippet.title));
                }
            } catch (e) {
                statusMsg.innerText = "대체 검색 중...";
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
            rank: i + 1,
            korean: k,
            english: translated.en[i] || '-',
            japanese: translated.ja[i] || '-',
            chinese: translated['zh-CN'][i] || '-',
            spanish: translated.es[i] || '-',
            hindi: translated.hi[i] || '-',
            russian: translated.ru[i] || '-'
        }));

        const state = {
            query: query || category,
            selectedCategory: category,
            results: results,
            timestamp: Date.now()
        };

        // Cache + Sync
        updateUI(state);
        statusMsg.innerText = "완료";
        statusMsg.style.color = "#aaa";

        if (db) db.ref('global_search_state').update(state);

    } catch (e) {
        console.error(e);
        statusMsg.innerText = "오류: " + e.message;
        statusMsg.style.color = "#ff4444";
        alert(e.message);
    }
}

async function fetchYouTubeSearch(query, apiKey, pageToken) {
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=50&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("YouTube API Error");
    return await res.json();
}

async function fetchYouTubePopular(catId, apiKey, pageToken) {
    let url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=KR&videoCategoryId=${catId}&maxResults=50&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("YouTube API Error");
    return await res.json();
}

async function translateKeywords(texts, apiKey) {
    const targets = ['en', 'ja', 'zh-CN', 'es', 'hi', 'ru'];
    const results = {};
    const batch = async (lang) => {
        try {
            const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: texts, target: lang, format: 'text' })
            });
            return (await res.json()).data.translations.map(t => t.translatedText);
        } catch { return new Array(texts.length).fill("실패"); }
    };
    await Promise.all(targets.map(async t => results[t] = await batch(t)));
    return results;
}

function updateUI(data) {
    const input = document.getElementById('keyword-input');
    if (input.value !== (data.query || "") && data.query) input.value = data.query;

    document.querySelectorAll('.category-pill').forEach(btn => {
        if (btn.innerText === data.selectedCategory) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';

    if (data.results) {
        data.results.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.rank}</td><td style="color:#fff;">${row.korean}</td><td>${row.english}</td><td>${row.japanese}</td><td>${row.chinese}</td><td>${row.spanish}</td><td>${row.hindi}</td><td>${row.russian}</td>`;
            tbody.appendChild(tr);
        });
    }
}

initApp();
