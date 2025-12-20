const CATEGORIES = [
    "영화/애니메이션", "자동차/교통", "음악", "애완동물/동물", "스포츠",
    "여행/이벤트", "게임", "인물/블로그", "코미디", "엔터테인먼트",
    "뉴스/정치", "노하우/스타일", "교육", "과학/기술", "비영리/사회운동"
];

let db;
let auth;
let currentUnsubscribe = null;
let globalConfig = null;

// Hardcoded Config to prevent loading errors
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
        db = firebase.database();
        console.log("Firebase initialized");

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
        const idInput = document.getElementById('edit-key-id');

        const name = nameInput.value.trim();
        const key = keyInput.value.trim();
        const id = idInput.value;

        if (!name || !key) {
            alert("이름과 키 값을 모두 입력해주세요.");
            return;
        }

        saveApiKey(id, name, key);
        resetForm();
    });

    // Cancel Edit
    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
        resetForm();
    });
}

function resetForm() {
    document.getElementById('new-key-name').value = "";
    document.getElementById('new-key-value').value = "";
    document.getElementById('edit-key-id').value = "";
    document.getElementById('save-key-btn').innerText = "저장";
    document.getElementById('cancel-edit-btn').style.display = "none";
}

function loadApiKeys() {
    if (!db) return;
    const listContainer = document.getElementById('key-list');

    db.ref('api_keys').once('value').then(snapshot => {
        const keys = snapshot.val() || {};
        renderKeys(keys);
    }).catch(err => {
        console.error(err);
        listContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#ff4444;">데이터를 불러오지 못했습니다.<br>로그인 상태나 권한을 확인해주세요.</div>';
    });
}

function renderKeys(keysData) {
    const listContainer = document.getElementById('key-list');
    listContainer.innerHTML = '';

    const keys = Object.entries(keysData);
    if (keys.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">등록된 API Key가 없습니다.</div>';
        return;
    }

    keys.forEach(([id, data]) => {
        const isActive = data.active !== false;
        const created = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : '-';

        const item = document.createElement('div');
        item.className = 'key-item';
        // Mask key for display
        const visibleKey = data.key.length > 10 ? data.key.substring(0, 6) + "..." + data.key.substring(data.key.length - 4) : data.key;

        item.innerHTML = `
            <div class="key-info">
                <div style="font-weight:bold; color:#fff; font-size:1rem;">${data.name || '이름 없음'}</div>
                <div class="key-value" title="${data.key}">${visibleKey}</div>
                <div class="key-meta">${created}</div>
            </div>
            <div class="key-actions">
                <button class="btn-delete" style="border-color:#4dabf7; color:#4dabf7;" onclick="prepareEdit('${id}', '${data.name || ''}', '${data.key}')" title="수정">✏️</button>
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

function saveApiKey(id, name, key) {
    if (!db) {
        alert("데이터베이스 연결 실패. 새로고침 해주세요.");
        return;
    }

    if (!auth.currentUser) {
        alert("로그인되지 않았습니다. 잠시 기다린 후 다시 시도하거나 새로고침 하세요.");
        return;
    }

    const data = {
        name: name,
        key: key,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };

    console.log("Saving API Key...", id ? "Update" : "Create", data);

    if (id) {
        // Update
        db.ref(`api_keys/${id}`).update(data)
            .then(() => {
                alert("수정되었습니다.");
                loadApiKeys();
            })
            .catch(error => {
                console.error("Save Error:", error);
                alert("저장 실패: " + error.message + "\n(데이터베이스 규칙을 확인하세요)");
            });
    } else {
        // Create
        data.active = true;
        data.createdAt = firebase.database.ServerValue.TIMESTAMP;

        db.ref('api_keys').push(data)
            .then(() => {
                alert("추가되었습니다.");
                loadApiKeys();
            })
            .catch(error => {
                console.error("Save Error:", error);
                alert("저장 실패: " + error.message + "\n(데이터베이스 규칙을 확인하세요)");
            });
    }
}

// Global scope functions
window.prepareEdit = function (id, name, key) {
    document.getElementById('new-key-name').value = name;
    document.getElementById('new-key-value').value = key;
    document.getElementById('edit-key-id').value = id;
    document.getElementById('save-key-btn').innerText = "수정 완료";
    document.getElementById('cancel-edit-btn').style.display = "block";
};

window.toggleKey = function (id, isActive) {
    db.ref(`api_keys/${id}/active`).set(isActive).then(() => loadApiKeys());
};

window.deleteKey = function (id) {
    if (confirm("정말로 삭제하시겠습니까?")) {
        db.ref(`api_keys/${id}`).remove().then(() => loadApiKeys());
    }
};

function getActiveApiKey() {
    // Return a promise that resolves to a random active key
    return db.ref('api_keys').orderByChild('active').equalTo(true).once('value')
        .then(snapshot => {
            const keysVal = snapshot.val();
            if (!keysVal) return null;
            const keys = Object.values(keysVal);
            if (keys.length === 0) return null;
            // Pick random
            const random = keys[Math.floor(Math.random() * keys.length)];
            return random.key;
        });
}

function setupRealtimeListener() {
    const stateRef = db.ref('global_search_state');

    stateRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            updateUI(data);
        }
    });
}

function selectCategory(category) {
    // When category is selected:
    // 1. Update visual selection immediately (optional for responsiveness)
    // 2. Clear search input or update it? User said "Select category... 100 keywords appear"
    //    so we treat the category name itself as the seed for keywords if no other input.
    //    Or we expect the user to type?
    //    The prompt says "Each selection -> 100 related keywords".
    //    So we will trigger a search using the Category name itself as the 'query' context.

    performSearch(category, category);
}

function performSearch(query, category) {
    // Mock Search with Sub-category structure
    const results = [];

    // Generate realistic looking sub-topics based on category
    const subTopics = [
        "기초/입문", "심화/응용", "최신 트렌드", "필수 장비/도구", "유명 유튜버/사례",
        "수익화 전략", "문제 해결 팁", "Q&A 모음", "비하인드 스토리", "관련 뉴스"
    ];

    for (let i = 1; i <= 100; i++) {
        const subIndex = Math.floor((i - 1) / 10); // Change sub-topic every 10 items
        const subTopic = subTopics[subIndex % subTopics.length];

        results.push({
            rank: i,
            korean: `[${category}] ${subTopic} > ${query} 관련 주제 ${i}`, // Sub-topic emphasized
            english: `[${category}] ${subTopic} > ${query} topic ${i}`,
            japanese: `[${category}] ${subTopic} > ${query} トピック ${i}`,
            chinese: `[${category}] ${subTopic} > ${query} 话题 ${i}`,
            spanish: `[${category}] ${subTopic} > ${query} tema ${i}`,
            hindi: `[${category}] ${subTopic} > ${query} विषय ${i}`,
            russian: `[${category}] ${subTopic} > ${query} тема ${i}`
        });
    }

    const state = {
        query: query,
        selectedCategory: category,
        results: results,
        timestamp: Date.now()
    };

    db.ref('global_search_state').update(state);
}

function getCurrentCategory() {
    const active = document.querySelector('.category-pill.active');
    return active ? active.innerText : CATEGORIES[0];
}

// Ensure ./firebase-config.json is tried first or directly
async function loadConfig() {
    try {
        let response = await fetch('./firebase-config.json');
        if (!response.ok) response = await fetch('../firebase-config.json');

        if (!response.ok) throw new Error("Failed to load config");
        return await response.json();
    } catch (e) {
        console.error("Config error:", e);
        console.log("Connect to a web server to load config.");
        return null;
    }
}

function updateUI(data) {
    // Update Input
    if (document.getElementById('keyword-input').value !== data.query) {
        document.getElementById('keyword-input').value = data.query || "";
    }

    // Update Category Selection
    document.querySelectorAll('.category-pill').forEach(btn => {
        if (btn.innerText === data.selectedCategory) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update Results Table
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';

    if (data.results && Array.isArray(data.results)) {
        data.results.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.rank}</td>
                <td>${row.korean}</td>
                <td>${row.english}</td>
                <td>${row.japanese}</td>
                <td>${row.chinese}</td>
                <td>${row.spanish}</td>
                <td>${row.hindi}</td>
                <td>${row.russian}</td>
            `;
            tbody.appendChild(tr);
        });
        document.getElementById('status-message').innerText = "데이터가 동기화되었습니다. (검색어: " + data.query + ")";
    }
}

// Start
initApp();
