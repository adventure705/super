
// 100% LOCAL STORAGE MODE (Reliability First)
const CATEGORIES = [
    "영화/애니메이션", "자동차/교통", "음악", "애완동물/동물", "스포츠",
    "여행/이벤트", "게임", "인물/블로그", "코미디", "엔터테인먼트",
    "뉴스/정치", "노하우/스타일", "교육", "과학/기술", "비영리/사회운동"
];

const STORAGE_KEY = 'api_keys_v1';
const CATEGORY_IDS = {
    "영화/애니메이션": "1", "자동차/교통": "2", "음악": "10", "애완동물/동물": "15",
    "스포츠": "17", "여행/이벤트": "19", "게임": "20", "인물/블로그": "22",
    "코미디": "23", "엔터테인먼트": "24", "뉴스/정치": "25", "노하우/스타일": "26",
    "교육": "27", "과학/기술": "28", "비영리/사회운동": "29"
};

// Initialize App
function initApp() {
    setupUI();
    loadApiKeys();

    // Status Indicator
    const statusMsg = document.getElementById('status-message');
    if (statusMsg) {
        statusMsg.innerText = "단독 실행 모드 (빠른 속도)";
        statusMsg.style.color = "#4dabf7";
    }
    console.log("App initialized in Local Mode");
}

function setupUI() {
    // 1. Categories
    const catList = document.getElementById('categories-list');
    catList.innerHTML = '';
    CATEGORIES.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = 'category-pill';
        btn.innerText = cat;
        btn.onclick = () => selectCategory(cat);
        catList.appendChild(btn);
    });

    // 2. Search
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

    // 3. API Modal
    const modal = document.getElementById('api-modal');
    document.getElementById('api-btn').addEventListener('click', () => {
        modal.style.display = "block";
        resetForm();
    });
    document.querySelector('.close').onclick = () => modal.style.display = "none";
    window.onclick = (e) => { if (e.target == modal) modal.style.display = "none"; };

    // 4. Save/Cancel
    document.getElementById('save-key-btn').addEventListener('click', saveApiKey);
    document.getElementById('cancel-edit-btn').addEventListener('click', resetForm);
}

// --- LOCAL DATA MANAGEMENT ---

function getLocalKeys() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
        return [];
    }
}

function saveLocalKeys(keys) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    renderKeys(keys);
}

function loadApiKeys() {
    const keys = getLocalKeys();
    renderKeys(keys);
}

function renderKeys(keys) {
    const listContainer = document.getElementById('key-list');
    listContainer.innerHTML = '';

    if (keys.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding:40px; color:#666;">등록된 API Key가 없습니다.<br>아래에서 키를 추가해주세요.</div>';
        return;
    }

    // Sort by Date Desc
    keys.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    keys.forEach(data => {
        const isActive = data.active !== false;
        const created = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : '방금 전';
        const typeIcon = data.type === 'translate' ? '🌐' : '📺';
        const typeLabel = data.type === 'translate' ? 'Translate' : 'YouTube';
        // Mask Key
        const visibleKey = data.key.length > 10 ? data.key.substring(0, 6) + "..." + data.key.substring(data.key.length - 4) : data.key;

        const item = document.createElement('div');
        item.className = 'key-item';
        item.innerHTML = `
            <div class="key-info">
                <div style="font-weight:bold; color:#fff; font-size:1rem; display:flex; gap:8px; align-items:center;">
                    <span>${typeIcon}</span> ${data.name} 
                    <span style="font-size:0.75em; background:#444; padding:2px 8px; border-radius:10px; color:#ccc;">${typeLabel}</span>
                </div>
                <div class="key-value" title="${data.key}" style="margin: 5px 0 0 0;">${visibleKey}</div>
                <div class="key-meta" style="margin-left: 0;">${created}</div>
            </div>
            <div class="key-actions">
                <button class="btn-delete" style="border-color:#4dabf7; color:#4dabf7;" onclick="prepareEdit('${data.id}')" title="수정">✏️</button>
                <label class="toggle-switch" title="활성화/비활성화">
                    <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleKey('${data.id}', this.checked)">
                    <span class="slider"></span>
                </label>
                <button class="btn-delete" onclick="deleteKey('${data.id}')" title="삭제">🗑️</button>
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
        alert("이름과 키 값을 모두 입력해주세요.");
        return;
    }

    let keys = getLocalKeys();

    if (id) {
        // Update
        const idx = keys.findIndex(k => k.id === id);
        if (idx !== -1) {
            keys[idx] = { ...keys[idx], name, key, type, updatedAt: Date.now() };
            alert("수정되었습니다.");
        }
    } else {
        // Add New
        keys.push({
            id: 'key_' + Date.now(),
            name,
            key,
            type,
            active: true,
            createdAt: Date.now()
        });
        alert("추가되었습니다.");
    }

    saveLocalKeys(keys);
    resetForm();
}

// Global functions for HTML onclick
window.prepareEdit = function (id) {
    const keys = getLocalKeys();
    const data = keys.find(k => k.id === id);
    if (!data) return;

    document.getElementById('new-key-name').value = data.name;
    document.getElementById('new-key-value').value = data.key;
    document.getElementById('new-key-type').value = data.type || 'youtube';
    document.getElementById('edit-key-id').value = data.id;

    const saveBtn = document.getElementById('save-key-btn');
    saveBtn.innerText = "수정 완료";
    document.getElementById('cancel-edit-btn').style.display = "block";
};

window.toggleKey = function (id, isActive) {
    const keys = getLocalKeys();
    const idx = keys.findIndex(k => k.id === id);
    if (idx !== -1) {
        keys[idx].active = isActive;
        saveLocalKeys(keys);
    }
};

window.deleteKey = function (id) {
    if (confirm("정말로 삭제하시겠습니까?")) {
        const keys = getLocalKeys().filter(k => k.id !== id);
        saveLocalKeys(keys);
    }
};

function resetForm() {
    document.getElementById('new-key-name').value = "";
    document.getElementById('new-key-value').value = "";
    document.getElementById('new-key-type').value = "youtube";
    document.getElementById('edit-key-id').value = "";
    const saveBtn = document.getElementById('save-key-btn');
    saveBtn.innerText = "저장하기";
    document.getElementById('cancel-edit-btn').style.display = "none";
}

// --- SEARCH LOGIC ---

function getActiveApiKey(type = 'youtube') {
    const keys = getLocalKeys().filter(k => (k.type || 'youtube') === type && k.active !== false);
    if (keys.length === 0) return null;
    return keys[Math.floor(Math.random() * keys.length)].key;
}

function getCurrentCategory() {
    const active = document.querySelector('.category-pill.active');
    return active ? active.innerText : "엔터테인먼트";
}

function selectCategory(category) {
    performSearch(null, category);
}

// Main Search Function
async function performSearch(query, category) {
    const statusMsg = document.getElementById('status-message');
    const youtubeKey = getActiveApiKey('youtube');
    const translateKey = getActiveApiKey('translate');

    if (!youtubeKey) {
        alert("활성화된 [YouTube Data API] 키가 없습니다. API 메뉴에서 등록해주세요.");
        return;
    }

    statusMsg.innerText = "데이터 검색 중...";
    statusMsg.style.color = "#4dabf7";

    try {
        let keywords = [];

        // 1. Fetch Keywords
        if (query) {
            keywords = await getKeywordsBySearch(query, youtubeKey);
        } else {
            keywords = await getKeywordsByTrending(category, youtubeKey);
        }

        keywords = [...new Set(keywords)].slice(0, 100);
        if (keywords.length === 0) throw new Error("검색 결과가 없습니다.");

        // 2. Translate
        let translated = { en: [], ja: [], 'zh-CN': [], es: [], hi: [], ru: [] };
        if (translateKey) {
            statusMsg.innerText = `번역 중... (${keywords.length}개)`;
            translated = await translateKeywords(keywords, translateKey);
        }

        // 3. Build State
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

        updateUI({
            query: query || category,
            selectedCategory: category,
            results: results
        });

        statusMsg.innerText = "검색 및 번역 완료!";
        statusMsg.style.color = "#aaa";

    } catch (err) {
        console.error(err);
        statusMsg.innerText = "오류: " + err.message;
        statusMsg.style.color = "#ff4444";
        alert("오류 발생: " + err.message);
    }
}

// --- API HELPERS ---

async function getKeywordsBySearch(query, apiKey) {
    try {
        const part1 = await fetchYouTubeSearch(query, apiKey, null);
        let items = part1.items;
        if (part1.nextPageToken) {
            const part2 = await fetchYouTubeSearch(query, apiKey, part1.nextPageToken);
            items = items.concat(part2.items);
        }
        return items.map(i => i.snippet.title);
    } catch (e) {
        throw new Error("검색 실패: " + e.message);
    }
}

async function getKeywordsByTrending(category, apiKey) {
    const catId = CATEGORY_IDS[category];
    try {
        if (!catId) throw new Error("No Cat ID");
        const part1 = await fetchYouTubePopular(catId, apiKey, null);
        let items = part1.items;
        if (part1.nextPageToken) {
            const part2 = await fetchYouTubePopular(catId, apiKey, part1.nextPageToken);
            items = items.concat(part2.items);
        }
        return items.map(i => i.snippet.title);
    } catch (err) {
        console.warn("Trending failed, fallback to search", err);
        return await getKeywordsBySearch(category, apiKey);
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
    // 1. Input Update
    const input = document.getElementById('keyword-input');
    if (input.value !== (data.query || "") && data.query) {
        input.value = data.query;
    }

    // 2. Category Update
    document.querySelectorAll('.category-pill').forEach(btn => {
        if (btn.innerText === data.selectedCategory) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    // 3. Table Update
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';

    if (data.results && data.results.length > 0) {
        data.results.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.rank}</td>
                <td style="color:#fff; font-weight:bold;">${row.korean}</td>
                <td>${row.english}</td>
                <td>${row.japanese}</td>
                <td>${row.chinese}</td>
                <td>${row.spanish}</td>
                <td>${row.hindi}</td>
                <td>${row.russian}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px;">검색 결과가 없습니다.</td></tr>`;
    }
}

// Start
initApp();
