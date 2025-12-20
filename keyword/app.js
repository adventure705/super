const CATEGORIES = [
    "영화/애니메이션", "자동차/교통", "음악", "애완동물/동물", "스포츠",
    "여행/이벤트", "게임", "인물/블로그", "코미디", "엔터테인먼트",
    "뉴스/정치", "노하우/스타일", "교육", "과학/기술", "비영리/사회운동"
];

let db;
let auth;
let currentUnsubscribe = null;
let globalConfig = null;

async function loadConfig() {
    try {
        // Try loading from root first (GitHub Pages structure) or fallback to current dir
        let response = await fetch('../firebase-config.json');
        if (!response.ok) {
            response = await fetch('./firebase-config.json');
        }
        if (!response.ok) throw new Error("Failed to load config");
        return await response.json();
    } catch (e) {
        console.error("Error loading config:", e);
        // Alert suppress or helpful message
        console.log("Connect to a web server to load config.");
        return null;
    }
}

async function initApp() {
    setupUI(); // Render UI immediately regardless of config status

    globalConfig = await loadConfig();
    if (!globalConfig) {
        console.warn("Config not loaded. Some features may not work.");
        return;
    }

    firebase.initializeApp(globalConfig);
    auth = firebase.auth();
    db = firebase.database();

    // Anonymous Auth
    auth.signInAnonymously().catch(error => {
        console.error("Auth failed:", error);
    });

    auth.onAuthStateChanged(user => {
        if (user) {
            console.log("Logged in as:", user.uid);
            // Start listening to data
            setupRealtimeListener();
        }
    });
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

    // API Button logic:
    // 1. If key is in firebase-config.json (e.g. "custom_api_key"), use it or show it.
    // 2. Or allow user to input and save to DB.
    document.getElementById('api-btn').addEventListener('click', () => {
        const currentKey = globalConfig.custom_api_key || "설정된 키 없음";
        const key = prompt(`현재 Config Key: ${currentKey}\n새로운 Google/Translation API Key를 입력하세요 (DB 저장):`);
        if (key) {
            db.ref('shared_api_key').set(key);
            alert("API Key가 저장되었습니다.");
        }
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
    // 1. Generate mocking data (100 items)
    // In a real app, we would call an API here using the key from db.ref('shared_api_key')

    const results = [];

    // Create somewhat dynamic mock data based on query/category
    for (let i = 1; i <= 100; i++) {
        results.push({
            rank: i,
            korean: `[${category}] ${query} 관련 주제 ${i}`,
            english: `[${category}] ${query} topic ${i}`,
            japanese: `[${category}] ${query} トピック ${i}`,
            chinese: `[${category}] ${query} 话题 ${i}`,
            spanish: `[${category}] ${query} tema ${i}`,
            hindi: `[${category}] ${query} विषय ${i}`,
            russian: `[${category}] ${query} тема ${i}`
        });
    }

    const state = {
        query: query,
        selectedCategory: category,
        results: results,
        timestamp: Date.now()
    };

    // Save to DB -> triggers listener -> updates UI everywhere
    db.ref('global_search_state').update(state);
}

function getCurrentCategory() {
    const active = document.querySelector('.category-pill.active');
    return active ? active.innerText : CATEGORIES[0];
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
