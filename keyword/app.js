
const CATEGORIES = [
    "영화/애니메이션", "자동차/교통", "음악", "애완동물/동물", "스포츠",
    "여행/이벤트", "게임", "인물/블로그", "코미디", "엔터테인먼트",
    "뉴스/정치", "노하우/스타일", "교육", "과학/기술", "비영리/사회운동"
];

let db;
let auth;
let currentUnsubscribe = null;

// Firestore Config (databaseURL is not required for Firestore)
const firebaseConfig = {
    apiKey: "AIzaSyDdk_axp2Q9OANqleknWeYWK9DrxKWKeY4",
    authDomain: "template-3530f.firebaseapp.com",
    projectId: "template-3530f",
    storageBucket: "template-3530f.firebasestorage.app",
    messagingSenderId: "891098188622",
    appId: "1:891098188622:web:392c0121a17f1cd4402c1f"
};

async function initApp() {
    setupUI(); // Render UI immediately

    try {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore(); // Use Firestore
        console.log("Firebase initialized (Firestore Mode)");

        // Anonymous Auth
        auth.signInAnonymously().catch(error => {
            console.error("Auth failed:", error);
            alert("로그인 오류: " + error.message);
        });

        auth.onAuthStateChanged(user => {
            if (user) {
                console.log("Logged in as:", user.uid);
                setupRealtimeListener();
            } else {
                console.log("Logged out");
            }
        });
    } catch (e) {
        console.error("Init Error:", e);
        alert("앱 초기화 오류: " + e.message);
    }
}

function setupUI() {
    // Render Categories
    const catList = document.getElementById('categories-list');
    catList.innerHTML = ''; // Clear existing
    CATEGORIES.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = 'category-pill';
        btn.innerText = cat;
        btn.onclick = () => selectCategory(cat);
        catList.appendChild(btn);
    });

    // Search Action
    document.getElementById('search-btn').addEventListener('click', () => {
        const query = document.getElementById('keyword-input').value;
        if (!query) return;
        performSearch(query, getCurrentCategory());
    });

    document.getElementById('keyword-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = e.target.value;
            if (query) performSearch(query, getCurrentCategory());
        }
    });

    // API Button: Open Modal
    const modal = document.getElementById('api-modal');
    const closeBtn = document.querySelector('.close');

    document.getElementById('api-btn').addEventListener('click', () => {
        if (!auth || !auth.currentUser) {
            alert("서버 연결 초기화 중입니다. 잠시 후 다시 시도해주세요.");
            return;
        }
        modal.style.display = "block";
        loadApiKeys();
        resetForm();
    });

    closeBtn.onclick = () => {
        modal.style.display = "none";
    };

    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    };

    // Save (Add/Edit)
    document.getElementById('save-key-btn').addEventListener('click', () => {
        const nameInput = document.getElementById('new-key-name');
        const keyInput = document.getElementById('new-key-value');
        const typeInput = document.getElementById('new-key-type');
        const idInput = document.getElementById('edit-key-id');

        const name = nameInput.value.trim();
        const key = keyInput.value.trim();
        const type = typeInput.value;
        const id = idInput.value;

        if (!name || !key) {
            alert("이름과 키 값을 모두 입력해주세요.");
            return;
        }

        saveApiKey(id, name, key, type);
    });

    // Cancel Edit
    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
        resetForm();
    });
}

function resetForm() {
    document.getElementById('new-key-name').value = "";
    document.getElementById('new-key-value').value = "";
    document.getElementById('new-key-type').value = "youtube"; // Default
    document.getElementById('edit-key-id').value = "";
    const saveBtn = document.getElementById('save-key-btn');
    saveBtn.innerText = "저장하기";
    saveBtn.disabled = false;
    document.getElementById('cancel-edit-btn').style.display = "none";
}

function loadApiKeys() {
    if (!db) return;
    const listContainer = document.getElementById('key-list');
    listContainer.innerHTML = '<div style="text-align:center; color:#888; padding: 20px;">데이터를 불러오는 중...</div>';

    // Firestore Fetch
    db.collection('api_keys').orderBy('createdAt', 'desc').get()
        .then(snapshot => {
            const keys = {};
            snapshot.forEach(doc => {
                keys[doc.id] = doc.data();
            });
            renderKeys(keys);
        })
        .catch(err => {
            console.error(err);
            listContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#ff4444;">데이터를 불러오지 못했습니다.<br>' + err.message + '</div>';
        });
}

function renderKeys(keysData) {
    const listContainer = document.getElementById('key-list');
    listContainer.innerHTML = '';

    const keys = Object.entries(keysData);
    if (keys.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding:40px; color:#666;">등록된 API Key가 없습니다.<br>아래에서 키를 추가해주세요.</div>';
        return;
    }

    // Sort already done by query, but fallback here fine
    keys.forEach(([id, data]) => {
        const isActive = data.active !== false;
        const created = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toLocaleDateString() : (data.createdAt ? new Date(data.createdAt).toLocaleDateString() : '-');
        const type = data.type || 'youtube';
        const typeIcon = type === 'translate' ? '🌐' : '📺';
        const typeLabel = type === 'translate' ? 'Translate' : 'YouTube';

        const item = document.createElement('div');
        item.className = 'key-item';
        const visibleKey = data.key.length > 10 ? data.key.substring(0, 6) + "..." + data.key.substring(data.key.length - 4) : data.key;

        item.innerHTML = `
            <div class="key-info">
                <div style="font-weight:bold; color:#fff; font-size:1rem; display:flex; gap:8px; align-items:center;">
                    <span>${typeIcon}</span> ${data.name || '이름 없음'} 
                    <span style="font-size:0.75em; background:#444; padding:2px 8px; border-radius:10px; color:#ccc;">${typeLabel}</span>
                </div>
                <div class="key-value" title="${data.key}" style="margin: 5px 0 0 28px;">${visibleKey}</div>
                <div class="key-meta" style="margin-left: 28px;">${created}</div>
            </div>
            <div class="key-actions">
                <button class="btn-delete" style="border-color:#4dabf7; color:#4dabf7;" onclick="prepareEdit('${id}', '${data.name || ''}', '${data.key}', '${type}')" title="수정">✏️</button>
                <label class="toggle-switch" title="활성화/비활성화">
                    <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleKey('${id}', this.checked)">
                    <span class="slider"></span>
                </label>
                <button class="btn-delete" onclick="deleteKey('${id}')" title="삭제">🗑️</button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

function saveApiKey(id, name, key, type) {
    if (!db || !auth.currentUser) {
        alert("서버와 연결되지 않았습니다.");
        return;
    }

    const data = {
        name: name,
        key: key,
        type: type || 'youtube',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (id) {
        db.collection('api_keys').doc(id).update(data)
            .then(() => loadApiKeys())
            .catch(handleSaveError);
        alert("수정되었습니다.");
    } else {
        data.active = true;
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        db.collection('api_keys').add(data)
            .then(() => {
                loadApiKeys();
                resetForm();
            })
            .catch(handleSaveError);
        alert("추가되었습니다.");
    }
}

function handleSaveError(error) {
    console.error("Save Error:", error);
    alert("오류 발생: " + error.message);
}

// Global scope functions
window.prepareEdit = function (id, name, key, type) {
    document.getElementById('new-key-name').value = name;
    document.getElementById('new-key-value').value = key;
    document.getElementById('new-key-type').value = type || 'youtube';
    document.getElementById('edit-key-id').value = id;
    const saveBtn = document.getElementById('save-key-btn');
    saveBtn.innerText = "수정 완료";
    saveBtn.disabled = false;
    document.getElementById('cancel-edit-btn').style.display = "block";
};

window.toggleKey = function (id, isActive) {
    db.collection('api_keys').doc(id).update({ active: isActive })
        .then(() => loadApiKeys());
};

window.deleteKey = function (id) {
    if (confirm("정말로 삭제하시겠습니까?")) {
        db.collection('api_keys').doc(id).delete()
            .then(() => loadApiKeys());
    }
};

function getActiveApiKey(type = 'youtube') {
    return db.collection('api_keys')
        .where('active', '==', true)
        .get()
        .then(snapshot => {
            if (snapshot.empty) return null;
            const keys = [];
            snapshot.forEach(doc => {
                const k = doc.data();
                if ((k.type || 'youtube') === type) keys.push(k);
            });
            if (keys.length === 0) return null;
            return keys[Math.floor(Math.random() * keys.length)].key;
        });
}

function setupRealtimeListener() {
    // Shared State via Firestore Document
    db.collection('shared').doc('search_state').onSnapshot((doc) => {
        if (doc.exists) {
            updateUI(doc.data());
        }
    });
}

function selectCategory(category) {
    performSearch(null, category); // Pass null for query to indicate category-only search
}

const CATEGORY_IDS = {
    "영화/애니메이션": "1",
    "자동차/교통": "2",
    "음악": "10",
    "애완동물/동물": "15",
    "스포츠": "17",
    "여행/이벤트": "19",
    "게임": "20",
    "인물/블로그": "22",
    "코미디": "23",
    "엔터테인먼트": "24",
    "뉴스/정치": "25",
    "노하우/스타일": "26",
    "교육": "27",
    "과학/기술": "28",
    "비영리/사회운동": "29"
};

async function performSearch(query, category) {
    const statusMsg = document.getElementById('status-message');

    // 1. Get Active API Keys
    const youtubeKey = await getActiveApiKey('youtube');
    const translateKey = await getActiveApiKey('translate');

    if (!youtubeKey) {
        alert("활성화된 [YouTube Data API] 키가 없습니다. API 메뉴에서 등록해주세요.");
        return;
    }

    statusMsg.innerText = "YouTube 데이터를 불러오는 중... (100개 항목)";
    statusMsg.style.color = "#4dabf7";

    try {
        let keywords = [];

        if (query) {
            const part1 = await fetchYouTubeSearch(query, youtubeKey, null);
            const part2 = part1.nextPageToken ? await fetchYouTubeSearch(query, youtubeKey, part1.nextPageToken) : { items: [] };
            keywords = [...part1.items.map(i => i.snippet.title), ...part2.items.map(i => i.snippet.title)];
        } else {
            const catId = CATEGORY_IDS[category];
            if (!catId) throw new Error("카테고리 ID를 찾을 수 없습니다.");

            const part1 = await fetchYouTubePopular(catId, youtubeKey, null);
            const part2 = part1.nextPageToken ? await fetchYouTubePopular(catId, youtubeKey, part1.nextPageToken) : { items: [] };
            keywords = [...part1.items.map(i => i.snippet.title), ...part2.items.map(i => i.snippet.title)];
        }

        keywords = [...new Set(keywords)].slice(0, 100);
        if (keywords.length === 0) throw new Error("검색 결과가 없습니다.");

        let translatedResults = { en: [], ja: [], 'zh-CN': [], es: [], hi: [], ru: [] };

        if (translateKey) {
            statusMsg.innerText = `키워드 ${keywords.length}개 번역 중...`;
            translatedResults = await translateKeywords(keywords, translateKey);
        } else {
            statusMsg.innerText = "번역 API 키 없음: 번역 생략됨.";
        }

        const results = keywords.map((original, index) => {
            return {
                rank: index + 1,
                korean: original,
                english: translatedResults.en[index] || '-',
                japanese: translatedResults.ja[index] || '-',
                chinese: translatedResults['zh-CN'][index] || '-',
                spanish: translatedResults.es[index] || '-',
                hindi: translatedResults.hi[index] || '-',
                russian: translatedResults.ru[index] || '-'
            };
        });

        const state = {
            query: query || category,
            selectedCategory: category,
            results: results,
            timestamp: Date.now()
        };

        db.collection('shared').doc('search_state').set(state);
        statusMsg.innerText = translateKey ? "검색 및 번역 완료!" : "검색 완료";
        statusMsg.style.color = "#aaa";

    } catch (err) {
        console.error("Search Flow Error:", err);
        statusMsg.innerText = "오류 발생: " + err.message;
        statusMsg.style.color = "#ff4444";
        alert("진행 중 오류가 발생했습니다: " + err.message);
    }
}

async function fetchYouTubeSearch(query, apiKey, pageToken) {
    const maxResults = 50;
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const response = await fetch(url);
    if (!response.ok) {
        const d = await response.json();
        throw new Error(d.error?.message || "YouTube API Error");
    }
    return await response.json();
}

async function fetchYouTubePopular(categoryId, apiKey, pageToken) {
    const maxResults = 50;
    let url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=KR&videoCategoryId=${categoryId}&maxResults=${maxResults}&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const response = await fetch(url);
    if (!response.ok) {
        const d = await response.json();
        throw new Error(d.error?.message || "YouTube Popular API Error");
    }
    return await response.json();
}

async function translateKeywords(texts, apiKey) {
    const targets = ['en', 'ja', 'zh-CN', 'es', 'hi', 'ru'];
    const results = {};
    targets.forEach(lang => results[lang] = []);

    const translateBatch = async (lang) => {
        const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: texts, target: lang, format: 'text' })
        });
        if (!response.ok) {
            console.warn(`Translation failed for ${lang}`);
            return new Array(texts.length).fill("번역 실패");
        }
        const data = await response.json();
        return data.data.translations.map(t => t.translatedText);
    };

    const promises = targets.map(async lang => {
        results[lang] = await translateBatch(lang);
    });
    await Promise.all(promises);
    return results;
}

function getCurrentCategory() {
    const active = document.querySelector('.category-pill.active');
    return active ? active.innerText : CATEGORIES[0];
}

function updateUI(data) {
    if (document.getElementById('keyword-input').value !== (data.query || "")) {
        document.getElementById('keyword-input').value = data.query || "";
    }
    document.querySelectorAll('.category-pill').forEach(btn => {
        if (btn.innerText === data.selectedCategory) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';

    if (data.results && Array.isArray(data.results)) {
        const link = (text) => {
            if (!text || text === '-') return text;
            return `<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(text)}" target="_blank" style="text-decoration:none; color:inherit; display:block;">${text}</a>`;
        };

        data.results.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
            <td>${row.rank}</td>
            <td style="color:#fff;">${link(row.korean)}</td>
            <td>${link(row.english)}</td>
            <td>${link(row.japanese)}</td>
            <td>${link(row.chinese)}</td>
            <td>${link(row.spanish)}</td>
            <td>${link(row.hindi)}</td>
            <td>${link(row.russian)}</td>
        `;
            tbody.appendChild(tr);
        });
        document.getElementById('status-message').innerText = "데이터가 동기화되었습니다. (검색어: " + (data.query || data.selectedCategory) + ")";
    }
}

// Start
initApp();
