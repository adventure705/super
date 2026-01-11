// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDdk_axp2Q9OANqleknWeYWK9DrxKWKeY4",
    authDomain: "template-3530f.firebaseapp.com",
    projectId: "template-3530f",
    storageBucket: "template-3530f.firebasestorage.app",
    messagingSenderId: "891098188622",
    appId: "1:891098188622:web:392c0121a17f1cd4402c1f"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const COLLECTION_NAME = 'threads_sessions';

const state = {
    allPosts: [],
    filteredPosts: [],
    sessions: [],
    activeSessionId: null,
    sortOrder: 'desc',
};

// UI Elements
const els = {
    fileInput: document.getElementById('file-input'),
    uploadBtn: document.getElementById('upload-btn'),
    postsFeed: document.getElementById('posts-feed'),
    searchInput: document.getElementById('global-search'),
    startDateFilter: document.getElementById('start-date-filter'),
    endDateFilter: document.getElementById('end-date-filter'),
    resetFilters: document.getElementById('reset-filters'),
    sortToggle: document.getElementById('sort-toggle'),
    sortIcon: document.getElementById('sort-icon'),
    sortText: document.getElementById('sort-text'),
    totalPosts: document.getElementById('total-posts'),
    totalImages: document.getElementById('total-images'),
    userList: document.getElementById('user-list'),
    dateNavigator: document.getElementById('date-navigator'),
    toast: document.getElementById('toast'),
};

// --- Initialization ---
async function init() {
    els.uploadBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', handleFileUpload);
    els.searchInput.addEventListener('input', updateUI);
    els.startDateFilter.addEventListener('change', updateUI);
    els.endDateFilter.addEventListener('change', updateUI);
    els.resetFilters.addEventListener('click', resetFilters);
    els.sortToggle.addEventListener('click', toggleSort);

    // Initial Load from Firestore
    await loadSessionsFromFirestore();
    initSortable();

    if (state.sessions.length > 0) {
        switchSession(state.sessions[0].id);
    }
}

function initSortable() {
    new Sortable(els.userList, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        handle: '.drag-handle',
        onEnd: async (evt) => {
            const movedItem = state.sessions.splice(evt.oldIndex, 1)[0];
            state.sessions.splice(evt.newIndex, 0, movedItem);

            // Update order in Firestore
            const batch = db.batch();
            state.sessions.forEach((session, index) => {
                const ref = db.collection(COLLECTION_NAME).doc(session.id);
                batch.update(ref, { order: index });
            });
            await batch.commit();
        }
    });
}

// --- Firestore Data Handling ---
async function loadSessionsFromFirestore() {
    try {
        const snapshot = await db.collection(COLLECTION_NAME).orderBy('order', 'asc').get();
        state.sessions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        renderSessionList();
    } catch (e) {
        console.error("Firestore Load Error:", e);
        showToast("데이터를 불러오는데 실패했습니다.");
    }
}

async function saveSessionToFirestore(session) {
    try {
        const { id, ...data } = session;
        await db.collection(COLLECTION_NAME).doc(id).set({
            ...data,
            refName: data.refName || data.name, // Ensure refName exists
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.error("Firestore Save Error:", e);
        showToast("데이터 저장에 실패했습니다.");
    }
}

function renderSessionList() {
    if (state.sessions.length === 0) {
        els.userList.innerHTML = `<li class="empty-lib">라이브러리가 비어있습니다</li>`;
        return;
    }

    els.userList.innerHTML = state.sessions.map((session) => `
        <li class="${state.activeSessionId === session.id ? 'active' : ''}" onclick="switchSession('${session.id}')">
            <span class="drag-handle">☰</span>
            <span class="session-name" title="${session.name}">${session.name}</span>
            <div class="session-actions" onclick="event.stopPropagation()">
                <button class="action-btn" onclick="renameSession('${session.id}')" title="이름 변경">✎</button>
                <button class="action-btn delete" onclick="deleteSession('${session.id}')" title="삭제">✕</button>
            </div>
        </li>
    `).join('');
}

// --- File Handling & Parsing ---
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    showToast("파일 분석 중...");
    const reader = new FileReader();
    reader.onload = async (event) => {
        const content = event.target.result;
        await parseAndSyncMarkdown(content, file.name);
    };
    reader.readAsText(file);
}

async function parseAndSyncMarkdown(md, filename) {
    const chunks = md.split('---');
    const newPosts = [];

    chunks.forEach(chunk => {
        const dateMatch = chunk.match(/## (\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) return;

        const date = dateMatch[1];
        const imageRegex = /!\[[\s\S]*?\]\((https?:\/\/[^\)]+)\)/g;
        let images = [];
        let m;
        while ((m = imageRegex.exec(chunk)) !== null) {
            images.push(m[1].trim());
        }

        let content = chunk
            .replace(/## \d{4}-\d{2}-\d{2}/, '')
            .replace(/!\[[\s\S]*?\]\(.*?\)/g, '')
            .replace(/^\//gm, '')
            .trim();

        if (content || images.length > 0) {
            newPosts.push({ id: Math.random().toString(36).substr(2, 9), date, content, images });
        }
    });

    const sessionRefName = filename.replace('.md', '');
    // Match by internal refName (the original file name)
    let session = state.sessions.find(s => (s.refName || s.name) === sessionRefName);

    if (session) {
        // Cumulative update
        const existingPosts = session.posts;
        const postMap = new Map();
        existingPosts.forEach(p => {
            const key = p.date + p.content.substring(0, 100);
            postMap.set(key, p);
        });

        let addedCount = 0;
        newPosts.forEach(p => {
            const key = p.date + p.content.substring(0, 100);
            if (!postMap.has(key)) {
                postMap.set(key, p);
                addedCount++;
            }
        });

        session.posts = Array.from(postMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
        await saveSessionToFirestore(session);
        showToast(`${addedCount}개의 새로운 포스트가 추가되었습니다.`);
    } else {
        // Create new session
        const newId = db.collection(COLLECTION_NAME).doc().id;
        session = {
            id: newId,
            name: sessionRefName, // Initial display name
            refName: sessionRefName, // Hidden internal match key
            posts: newPosts.sort((a, b) => new Date(b.date) - new Date(a.date)),
            order: state.sessions.length
        };
        state.sessions.unshift(session);
        await saveSessionToFirestore(session);
        showToast(`'${sessionRefName}' 라이브러리에 추가되었습니다.`);
    }

    switchSession(session.id);
    renderSessionList();
}

// --- App Functions ---
window.switchSession = (id) => {
    state.activeSessionId = id;
    const session = state.sessions.find(s => s.id === id);
    if (session) {
        state.allPosts = session.posts;
        renderDateNavigator();
        updateUI();
        renderSessionList();
    }
};

window.renameSession = async (id) => {
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;
    const newName = prompt('새 이름을 입력하세요:', session.name);
    if (newName && newName.trim()) {
        session.name = newName.trim();
        await saveSessionToFirestore(session);
        renderSessionList();
        showToast('이름이 변경되었습니다.');
    }
};

window.deleteSession = async (id) => {
    if (!confirm('이 라이브러리 항목을 삭제하시겠습니까?')) return;
    try {
        await db.collection(COLLECTION_NAME).doc(id).delete();
        state.sessions = state.sessions.filter(s => s.id !== id);
        if (state.activeSessionId === id) {
            state.allPosts = [];
            state.activeSessionId = null;
            updateUI();
        }
        renderSessionList();
        showToast('삭제되었습니다.');
    } catch (e) {
        showToast("삭제에 실패했습니다.");
    }
};

function resetFilters() {
    els.searchInput.value = '';
    els.startDateFilter.value = '';
    els.endDateFilter.value = '';
    state.sortOrder = 'desc';
    updateSortUI();
    renderDateNavigator();
    updateUI();
}

function toggleSort() {
    state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
    updateSortUI();
    updateUI();
}

function updateSortUI() {
    if (state.sortOrder === 'desc') {
        els.sortIcon.textContent = '↓';
        els.sortText.textContent = '최신순';
    } else {
        els.sortIcon.textContent = '↑';
        els.sortText.textContent = '과거순';
    }
}

function updateUI() {
    const query = els.searchInput.value.toLowerCase();
    const startDate = els.startDateFilter.value;
    const endDate = els.endDateFilter.value;

    state.filteredPosts = state.allPosts.filter(post => {
        const matchesSearch = post.content.toLowerCase().includes(query) || post.date.includes(query);
        const postDate = post.date;
        const matchesStart = startDate ? postDate >= startDate : true;
        const matchesEnd = endDate ? postDate <= endDate : true;
        return matchesSearch && matchesStart && matchesEnd;
    });

    state.filteredPosts.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return state.sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    renderPosts();
    updateStats();
    updateDateNavigatorActive();
}

function renderDateNavigator() {
    if (state.allPosts.length === 0) {
        els.dateNavigator.innerHTML = '';
        return;
    }

    const dateMap = {}; // { year: [month1, month2] }
    state.allPosts.forEach(post => {
        const [year, month] = post.date.split('-');
        if (!dateMap[year]) dateMap[year] = new Set();
        dateMap[year].add(month);
    });

    const years = Object.keys(dateMap).sort((a, b) => b - a);

    els.dateNavigator.innerHTML = years.map(year => {
        const months = Array.from(dateMap[year]).sort((a, b) => b - a);
        return `
            <div class="year-group">
                <span class="year-label">${year}</span>
                <div class="month-list">
                    ${months.map(month => `
                        <button class="month-btn" onclick="filterByMonth('${year}', '${month}')" data-date="${year}-${month}">
                            ${parseInt(month)}월
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function updateDateNavigatorActive() {
    const startDate = els.startDateFilter.value;
    const endDate = els.endDateFilter.value;

    document.querySelectorAll('.month-btn').forEach(btn => {
        const btnDate = btn.getAttribute('data-date');
        const [year, month] = btnDate.split('-');

        const firstDay = `${year}-${month}-01`;
        const lastDay = new Date(year, month, 0).toISOString().split('T')[0];

        if (startDate === firstDay && endDate === lastDay) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

window.filterByMonth = (year, month) => {
    const firstDay = `${year}-${month}-01`;
    const lastDay = new Date(year, month, 0).toISOString().split('T')[0];

    // Toggle if already selected
    if (els.startDateFilter.value === firstDay && els.endDateFilter.value === lastDay) {
        els.startDateFilter.value = '';
        els.endDateFilter.value = '';
    } else {
        els.startDateFilter.value = firstDay;
        els.endDateFilter.value = lastDay;
    }

    updateUI();
};

function renderPosts() {
    if (state.allPosts.length === 0 && state.sessions.length > 0) {
        els.postsFeed.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><h2>라이브러리에서 파일을 선택해주세요</h2></div>`;
        return;
    }
    if (state.filteredPosts.length === 0) {
        els.postsFeed.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><h2>검색 결과가 없습니다</h2></div>`;
        return;
    }

    els.postsFeed.innerHTML = state.filteredPosts.map((post, idx) => `
        <article class="post-card" style="animation-delay: ${idx * 0.01}s">
            <div class="post-header">
                <span class="post-date">${post.date}</span>
                <button class="btn-icon" onclick="copyContent('${post.id}')" title="내용 복사">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
            </div>
            <div class="post-content">${highlightText(post.content, els.searchInput.value)}</div>
            ${post.images.length > 0 ? `
                <div class="post-images">
                    ${post.images.map(img => {
        const escapedImg = img.replace(/'/g, "\\'");
        const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(img)}&default=https://via.placeholder.com/400x300?text=이미지+로드+중...`;
        return `<img src="${proxyUrl}" alt="Post image" loading="lazy" 
                            onerror="this.onerror=null; this.src='https://via.placeholder.com/400x300?text=이미지+로드+실패+(클릭하여+확인)';"
                            onclick="window.open('${escapedImg}', '_blank')">`;
    }).join('')}
                </div>
            ` : ''}
        </article>
    `).join('');
}

function updateStats() {
    els.totalPosts.textContent = state.filteredPosts.length.toLocaleString();
    const imgCount = state.filteredPosts.reduce((acc, p) => acc + p.images.length, 0);
    els.totalImages.textContent = imgCount.toLocaleString();
}

function highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark style="background: rgba(59, 130, 246, 0.4); color: white; border-radius: 2px;">$1</mark>');
}

function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 3000);
}

window.copyContent = (id) => {
    const post = state.allPosts.find(p => p.id === id);
    if (post) {
        navigator.clipboard.writeText(post.content);
        showToast('내용이 복사되었습니다!');
    }
};

init();
