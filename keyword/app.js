
const CATEGORIES = [
    "영화/애니메이션", "자동차/교통", "음악", "애완동물/동물", "스포츠",
    "여행/이벤트", "게임", "인물/블로그", "코미디", "엔터테인먼트",
    "뉴스/정치", "노하우/스타일", "교육", "과학/기술", "비영리/사회운동"
];

let db;
let auth;

// Config: RESTORED RTDB URL for maximum compatibility
const firebaseConfig = {
    apiKey: "AIzaSyDdk_axp2Q9OANqleknWeYWK9DrxKWKeY4",
    authDomain: "template-3530f.firebaseapp.com",
    databaseURL: "https://template-3530f.firebaseio.com",
    projectId: "template-3530f",
    storageBucket: "template-3530f.firebasestorage.app",
    messagingSenderId: "891098188622",
    appId: "1:891098188622:web:392c0121a17f1cd4402c1f"
};

// Use a shared path that is likely to have open rules or we can use generic
const DB_KEY_PATH = 'shared_api_keys';

async function initApp() {
    setupUI();

    try {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.database(); // Revert to Realtime Database
        console.log("Firebase initialized (RTDB Mode)");

        // 1. Connection Monitor
        db.ref(".info/connected").on("value", (snap) => {
            const statusIndicator = document.getElementById('status-message');
            if (snap.val() === true) {
                console.log("Connected to Firebase");
                if (statusIndicator && statusIndicator.innerText.includes("재연결")) {
                    statusIndicator.innerText = "서버에 연결되었습니다.";
                    statusIndicator.style.color = "#4dabf7";
                }
            } else {
                console.log("Disconnected");
                if (statusIndicator) {
                    statusIndicator.innerText = "서버 연결 끊김. 재연결 시도 중...";
                    statusIndicator.style.color = "#ff4444";
                }
            }
        });

        // 2. Auth
        auth.signInAnonymously().catch(error => {
            console.error("Auth failed:", error);
            alert("로그인 오류: " + error.message);
        });

        auth.onAuthStateChanged(user => {
            if (user) {
                console.log("Logged in as:", user.uid);
                setupRealtimeListener();
                loadApiKeys();
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
    catList.innerHTML = '';
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

    // API Button
    const modal = document.getElementById('api-modal');
    const closeBtn = document.querySelector('.close');

    document.getElementById('api-btn').addEventListener('click', () => {
        if (!auth || !auth.currentUser) {
            alert("서버 연결 중입니다. 잠시만 기다려주세요.");
            return;
        }
        modal.style.display = "block";
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

    // Save
    document.getElementById('save-key-btn').addEventListener('click', () => {
        const nameInput = document.getElementById('new-key-name');
        const keyInput = document.getElementById('new-key-value');
        const typeInput = document.getElementById('new-key-type');
        const idInput = document.getElementById('edit-key-id');

        saveApiKey(idInput.value, nameInput.value.trim(), keyInput.value.trim(), typeInput.value);
    });

    // Cancel
    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
        resetForm();
    });
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

// RTDB LISTENER
function loadApiKeys() {
    if (!db) return;
    const listContainer = document.getElementById('key-list');

    // Use .on('value') for robust syncing
    // No server-side sorting to avoid index requirements
    db.ref(DB_KEY_PATH).on('value', snapshot => {
        const keys = snapshot.val() || {};
        renderKeys(keys);
    }, err => {
        console.error("Load Error:", err);
        listContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#ff4444;">데이터 로딩 실패<br>(' + err.code + ')<br>권한 설정을 확인해주세요.</div>';
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

    // Client-side Sorting
    keys.sort((a, b) => {
        const timeA = a[1].createdAt || 0;
        const timeB = b[1].createdAt || 0;
        return timeB - timeA;
    });

    keys.forEach(([id, data]) => {
        const isActive = data.active !== false;
        const created = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : '방금 전';
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
                <div class="key-value" title="${data.key}" style="margin: 5px 0 0 0;">${visibleKey}</div>
                <div class="key-meta" style="margin-left: 0;">${created}</div>
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
        alert("서버 연결 확인 필요");
        return;
    }
    if (!name || !key) {
        alert("이름과 키 값을 모두 입력해주세요.");
        return;
    }

    const data = {
        name: name,
        key: key,
        type: type || 'youtube',
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };

    if (id) {
        db.ref(`${DB_KEY_PATH}/${id}`).update(data)
            .then(() => alert("수정되었습니다."))
            .catch(err => alert("수정 실패: " + err.message));
    } else {
        data.active = true;
        data.createdAt = firebase.database.ServerValue.TIMESTAMP;
        db.ref(DB_KEY_PATH).push(data)
            .then(() => {
                alert("추가되었습니다.");
                resetForm();
            })
            .catch(err => alert("추가 실패: " + err.message));
    }
}

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
    db.ref(`${DB_KEY_PATH}/${id}/active`).set(isActive);
};

window.deleteKey = function (id) {
    if (confirm("정말로 삭제하시겠습니까?")) {
        db.ref(`${DB_KEY_PATH}/${id}`).remove();
    }
};

function getActiveApiKey(type = 'youtube') {
    return db.ref(DB_KEY_PATH).orderByChild('active').equalTo(true).once('value')
        .then(snapshot => {
            const keysVal = snapshot.val();
            if (!keysVal) return null;
            const keys = Object.values(keysVal).filter(k => (k.type || 'youtube') === type);
            if (keys.length === 0) return null;
            return keys[Math.floor(Math.random() * keys.length)].key;
        });
}

function setupRealtimeListener() {
    db.ref('global_search_state').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) updateUI(data);
    });
}

function selectCategory(category) {
    performSearch(null, category);
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

function getCurrentCategory() {
    const active = document.querySelector('.category-pill.active');
    return active ? active.innerText : "엔터테인먼트";
}

async function performSearch(query, category) {
    const statusMsg = document.getElementById('status-message');

    // 1. Check API Keys
    const youtubeKey = await getActiveApiKey('youtube');
    const translateKey = await getActiveApiKey('translate');

    if (!youtubeKey) {
        alert("API 키가 없습니다. 설정에서 YouTube API 키를 추가해주세요.");
        return;
    }

    statusMsg.innerText = "데이터 검색 중...";
    statusMsg.style.color = "#4dabf7";

    try {
        let keywords = [];

        if (query) {
            // --- KEYWORD SEARCH MODE ---
            // Fetch 2 pages for ~100 results
            try {
                const part1 = await fetchYouTubeSearch(query, youtubeKey, null);
                const part2 = part1.nextPageToken ? await fetchYouTubeSearch(query, youtubeKey, part1.nextPageToken) : { items: [] };
                keywords = [...part1.items, ...part2.items].map(i => i.snippet.title);
            } catch (searchErr) {
                throw new Error("검색 실패: " + searchErr.message);
            }
        } else {
            // --- CATEGORY TRENDING MODE ---
            const catId = CATEGORY_IDS[category];

            try {
                if (!catId) throw new Error("No Category ID");

                // Try Trending First
                const part1 = await fetchYouTubePopular(catId, youtubeKey, null);
                const part2 = part1.nextPageToken ? await fetchYouTubePopular(catId, youtubeKey, part1.nextPageToken) : { items: [] };
                keywords = [...part1.items, ...part2.items].map(i => i.snippet.title);

            } catch (trendingErr) {
                console.warn("Trending failed, using fallback:", trendingErr);
                statusMsg.innerText = `'${category}' 인기 영상이 없어 검색으로 대체합니다...`;

                // Fallback: Search by Category Name
                const part1 = await fetchYouTubeSearch(category, youtubeKey, null);
                const part2 = part1.nextPageToken ? await fetchYouTubeSearch(category, youtubeKey, part1.nextPageToken) : { items: [] };
                keywords = [...part1.items, ...part2.items].map(i => i.snippet.title);
            }
        }

        // Deduplicate & Limit
        keywords = [...new Set(keywords)].slice(0, 100);
        if (keywords.length === 0) throw new Error("검색 결과가 없습니다.");

        // Translation
        let translated = { en: [], ja: [], 'zh-CN': [], es: [], hi: [], ru: [] };
        if (translateKey) {
            statusMsg.innerText = `키워드 번역 중... (${keywords.length}개)`;
            translated = await translateKeywords(keywords, translateKey);
        } else {
            statusMsg.innerText = "번역 API 없음 (생략)";
        }

        // Build Results
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

        // IMMEDIATE LOCAL UPDATE (Fast UI)
        updateUI(state);
        statusMsg.innerText = "검색 완료!";
        statusMsg.style.color = "#aaa";

        // SYNC TO DB (Background)
        db.ref('global_search_state').update(state).catch(e => console.error("Sync failed:", e));

    } catch (err) {
        console.error(err);
        statusMsg.innerText = "오류: " + err.message;
        statusMsg.style.color = "#ff4444";
        alert("오류 발생: " + err.message);
    }
}

async function fetchYouTubeSearch(query, apiKey, pageToken) {
    const max = 50;
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${max}&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json()).error?.message || "YouTube API Error");
    return await res.json();
}

async function fetchYouTubePopular(catId, apiKey, pageToken) {
    const max = 50;
    let url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=KR&videoCategoryId=${catId}&maxResults=${max}&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json()).error?.message || "YouTube API Error");
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
            if (!res.ok) return new Array(texts.length).fill("실패");
            return (await res.json()).data.translations.map(t => t.translatedText);
        } catch { return new Array(texts.length).fill("에러"); }
    };
    await Promise.all(targets.map(async t => results[t] = await batch(t)));
    return results;
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
    if (data.results) {
        data.results.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.rank}</td>
                <td style="color:#fff;">${row.korean}</td>
                <td>${row.english}</td>
                <td>${row.japanese}</td>
                <td>${row.chinese}</td>
                <td>${row.spanish}</td>
                <td>${row.hindi}</td>
                <td>${row.russian}</td>
            `;
            tbody.appendChild(tr);
        });
        document.getElementById('status-message').innerText = "최신 데이터 로드됨 (" + new Date().toLocaleTimeString() + ")";
    }
}

initApp();
