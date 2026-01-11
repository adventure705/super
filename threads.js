// --- Global State ---
const state = {
    allPosts: [],
    filteredPosts: [],
    sessions: [],
    categories: [],
    activeSessionId: null,
    sortOrder: 'desc',
    visiblePosts: 20,
};

let db;
let postsUnsubscribe = null;

const COLLECTION_NAME = 'threads_sessions';
const CATEGORY_COLLECTION = 'threads_categories';
const DEFAULT_CAT_ID = 'uncategorized_default';

// --- Firebase Configuration (Shared) ---
const firebaseConfig = {
    apiKey: "AIzaSyDdk_axp2Q9OANqleknWeYWK9DrxKWKeY4",
    authDomain: "template-3530f.firebaseapp.com",
    projectId: "template-3530f",
    storageBucket: "template-3530f.firebasestorage.app",
    messagingSenderId: "891098188622",
    appId: "1:891098188622:web:392c0121a17f1cd4402c1f"
};

// UI Elements (Delayed Init for DOM Safety)
let els = {};

function initElements() {
    els = {
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
        sidebarContent: document.getElementById('sidebar-content'),
        dateNavigator: document.getElementById('date-navigator'),
        toast: document.getElementById('toast'),
        mobileMenuToggle: document.getElementById('mobile-menu-toggle'),
        sidebar: document.querySelector('.sidebar'),
        sidebarOverlay: document.getElementById('sidebar-overlay'),
        addCategoryBtn: document.getElementById('add-category-btn'),
        imageModal: document.getElementById('image-modal'),
        modalImg: document.getElementById('modal-img'),
        closeModal: document.querySelector('.close-modal'),
        contentView: document.querySelector('.content-view'),
    };
}

// --- Initialization ---
async function init() {
    initElements();
    setupEventListeners();

    try {
        // Initialize Firebase with fallback strategy
        let config = firebaseConfig;
        try {
            if (window.location.protocol.startsWith('http')) {
                const response = await fetch('firebase-config.json');
                if (response.ok) config = await response.json();
            }
        } catch (e) {
            console.warn("Config fetch failed, using internal manifest.");
        }

        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }
        db = firebase.firestore();

        console.log("Threads Analyzer: Real-time Cloud Mode");

        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                console.log("Firebase Authenticated - UserID:", user.uid);
                showToast("최신 데이터를 동기화하는 중...", 1500);
                updateSyncStatus(true);

                // Concurrent data loading
                await Promise.all([
                    loadCategoriesFromFirestore(),
                    loadSessionsFromFirestore()
                ]);
            } else {
                console.log("Signing in anonymously...");
                await firebase.auth().signInAnonymously();
            }
        });

        // Connection status monitoring
        db.collection(COLLECTION_NAME).limit(1).onSnapshot({ includeMetadataChanges: true }, (snap) => {
            updateSyncStatus(!snap.metadata.fromCache);
        }, (err) => {
            updateSyncStatus(false);
        });

    } catch (e) {
        console.error("Init Error:", e);
        showToast("초기화 중 오류 발생: " + e.message);
    }
}

function setupEventListeners() {
    if (els.uploadBtn) els.uploadBtn.addEventListener('click', () => els.fileInput.click());
    if (els.fileInput) els.fileInput.addEventListener('change', handleFileUpload);
    if (els.searchInput) els.searchInput.addEventListener('input', updateUI);
    if (els.startDateFilter) els.startDateFilter.addEventListener('change', updateUI);
    if (els.endDateFilter) els.endDateFilter.addEventListener('change', updateUI);
    if (els.resetFilters) els.resetFilters.addEventListener('click', resetFilters);
    if (els.sortToggle) els.sortToggle.addEventListener('click', toggleSort);

    if (els.mobileMenuToggle) els.mobileMenuToggle.addEventListener('click', () => toggleSidebar(true));
    if (els.sidebarOverlay) els.sidebarOverlay.addEventListener('click', () => toggleSidebar(false));
    if (els.addCategoryBtn) els.addCategoryBtn.addEventListener('click', addNewCategory);

    if (els.closeModal) els.closeModal.onclick = closeModal;
    if (els.imageModal) els.imageModal.onclick = (e) => { if (e.target === els.imageModal) closeModal(); };
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && els.imageModal.style.display === 'flex') closeModal();
    });

    if (els.contentView) els.contentView.addEventListener('scroll', handleScroll);
}

// --- App Control Functions ---
function autoSelectFirstSession() {
    if (state.activeSessionId || state.sessions.length === 0) return;

    let firstSessionId = null;
    const sortedCats = [...state.categories].sort((a, b) => (a.order || 0) - (b.order || 0));

    for (const cat of sortedCats) {
        const catSessions = state.sessions
            .filter(s => s.categoryId === cat.id)
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        if (catSessions.length > 0) {
            firstSessionId = catSessions[0].id;
            break;
        }
    }

    if (!firstSessionId && state.sessions.length > 0) firstSessionId = state.sessions[0].id;
    if (firstSessionId) switchSession(firstSessionId);
}

function handleScroll() {
    const { scrollTop, scrollHeight, clientHeight } = els.contentView;
    if (scrollTop + clientHeight >= scrollHeight - 300) {
        if (state.visiblePosts < state.filteredPosts.length) {
            state.visiblePosts += 20;
            renderPosts(true);
        }
    }
}

function toggleSidebar(open) {
    if (open) {
        els.sidebar.classList.add('open');
        els.sidebarOverlay.classList.add('show');
    } else {
        els.sidebar.classList.remove('open');
        els.sidebarOverlay.classList.remove('show');
    }
}

function initSortable() {
    if (!els.sidebarContent) return;
    new Sortable(els.sidebarContent, {
        animation: 150,
        handle: '.category-header',
        ghostClass: 'sortable-ghost',
        onEnd: async () => {
            const categoryOrder = Array.from(els.sidebarContent.querySelectorAll('.category-section')).map(el => el.dataset.id).filter(id => id !== 'uncategorized');
            const batch = db.batch();
            categoryOrder.forEach((id, index) => {
                const ref = db.collection(CATEGORY_COLLECTION).doc(id);
                batch.update(ref, { order: index });
                const cat = state.categories.find(c => c.id === id);
                if (cat) cat.order = index;
            });
            await batch.commit();
        }
    });

    document.querySelectorAll('.session-list').forEach(listEl => {
        new Sortable(listEl, {
            group: 'sessions',
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            onEnd: async (evt) => {
                const sessionId = evt.item.dataset.id;
                const newCategoryId = evt.to.dataset.categoryId;
                const sessionEls = Array.from(evt.to.querySelectorAll('li'));
                const batch = db.batch();
                sessionEls.forEach((el, index) => {
                    const sid = el.dataset.id;
                    const ref = db.collection(COLLECTION_NAME).doc(sid);
                    const updateData = { order: index };
                    if (sid === sessionId) {
                        updateData.categoryId = newCategoryId;
                        const sess = state.sessions.find(s => s.id === sid);
                        if (sess) sess.categoryId = newCategoryId;
                    }
                    batch.update(ref, updateData);
                });
                await batch.commit();
            }
        });
    });
}

// --- Category Management ---
async function loadCategoriesFromFirestore() {
    return new Promise((resolve) => {
        db.collection(CATEGORY_COLLECTION).orderBy('order', 'asc').onSnapshot((snapshot) => {
            state.categories = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Auto-create default category if literal zero segments exist
            if (state.categories.length === 0 && !snapshot.metadata.fromCache) {
                addNewCategoryUI('미분류', DEFAULT_CAT_ID);
            }

            renderSidebarContent();
            resolve();
        }, (e) => {
            console.error("Categories Auth/Sync Error:", e);
            resolve();
        });
    });
}

function updateSyncStatus(isSynced) {
    const logoIcon = document.querySelector('.logo-icon');
    if (logoIcon) {
        logoIcon.style.boxShadow = isSynced ? '0 0 10px #4caf50' : '0 0 10px #f44336';
        logoIcon.style.transition = 'box-shadow 0.3s ease';
        logoIcon.title = isSynced ? '서버와 실시간 연동됨' : '로컬 캐시 사용 중/오프라인 모드';
    }
}

async function addNewCategory() {
    const name = prompt('새 카테고리 이름을 입력하세요:');
    if (name && name.trim()) {
        await addNewCategoryUI(name.trim());
        renderSidebarContent();
    }
}

async function addNewCategoryUI(name, fixedId = null) {
    const id = fixedId || db.collection(CATEGORY_COLLECTION).doc().id;
    const category = { name: name, order: state.categories.length };
    await db.collection(CATEGORY_COLLECTION).doc(id).set(category, { merge: true });
    if (!state.categories.find(c => c.id === id)) state.categories.push({ id, ...category });
}

window.renameCategory = async (id) => {
    const category = state.categories.find(c => c.id === id);
    if (!category) return;
    const newName = prompt('카테고리 이름 변경:', category.name);
    if (newName && newName.trim()) {
        category.name = newName.trim();
        await db.collection(CATEGORY_COLLECTION).doc(id).update({ name: category.name });
        renderSidebarContent();
    }
};

window.deleteCategory = async (id) => {
    const sessCount = state.sessions.filter(s => s.categoryId === id).length;
    if (sessCount > 0) return alert('해당 카테고리에 세션이 있어 삭제할 수 없습니다.');
    if (!confirm('카테고리를 삭제하시겠습니까?')) return;
    await db.collection(CATEGORY_COLLECTION).doc(id).delete();
    state.categories = state.categories.filter(c => c.id !== id);
    renderSidebarContent();
};

// --- Session Handling ---
async function loadSessionsFromFirestore() {
    return new Promise((resolve) => {
        db.collection(COLLECTION_NAME).onSnapshot((snapshot) => {
            state.sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            state.sessions.sort((a, b) => (a.order || 0) - (b.order || 0));
            renderSidebarContent();
            if (!state.activeSessionId && state.sessions.length > 0) autoSelectFirstSession();
            resolve();
        }, (e) => {
            console.error("Sessions Load Error:", e);
            resolve();
        });
    });
}

async function saveSessionToFirestore(session) {
    const { id, ...data } = session;
    await db.collection(COLLECTION_NAME).doc(id).set({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

function renderSidebarContent() {
    if (!els.sidebarContent) return;

    const categoryHtml = state.categories.map(category => {
        const catSessions = state.sessions.filter(s => s.categoryId === category.id)
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        return `
            <div class="category-section" data-id="${category.id}">
                <div class="category-header">
                    <span class="category-title">${category.name}</span>
                    <div class="category-actions" onclick="event.stopPropagation()">
                        <button class="action-btn" onclick="renameCategory('${category.id}')">✎</button>
                        <button class="action-btn delete" onclick="deleteCategory('${category.id}')">✕</button>
                    </div>
                </div>
                <ul class="session-list" data-category-id="${category.id}">
                    ${catSessions.map(session => `
                        <li class="${state.activeSessionId === session.id ? 'active' : ''}" data-id="${session.id}" onclick="switchSession('${session.id}')">
                            <span class="drag-handle">☰</span>
                            <span class="session-name" title="${session.name}">${session.name}</span>
                            <div class="session-actions" onclick="event.stopPropagation()">
                                <button class="action-btn" onclick="renameSession('${session.id}')">✎</button>
                                <button class="action-btn delete" onclick="deleteSession('${session.id}')">✕</button>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }).join('');

    const categoryIds = state.categories.map(c => c.id);
    const uncategorizedSessions = state.sessions.filter(s => !s.categoryId || !categoryIds.includes(s.categoryId))
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    let uncategorizedHtml = '';
    if (uncategorizedSessions.length > 0) {
        uncategorizedHtml = `
            <div class="category-section" data-id="uncategorized">
                <div class="category-header"><span class="category-title">미분류 항목</span></div>
                <ul class="session-list" data-category-id="default">
                    ${uncategorizedSessions.map(session => `
                        <li class="${state.activeSessionId === session.id ? 'active' : ''}" data-id="${session.id}" onclick="switchSession('${session.id}')">
                            <span class="drag-handle">☰</span>
                            <span class="session-name" title="${session.name}">${session.name}</span>
                            <div class="session-actions" onclick="event.stopPropagation()">
                                <button class="action-btn" onclick="renameSession('${session.id}')">✎</button>
                                <button class="action-btn delete" onclick="deleteSession('${session.id}')">✕</button>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    if (state.categories.length === 0 && uncategorizedSessions.length === 0) {
        els.sidebarContent.innerHTML = `<div class="empty-lib">분석 데이터가 없습니다</div>`;
    } else {
        els.sidebarContent.innerHTML = categoryHtml + uncategorizedHtml;
    }
    initSortable();
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => await parseAndSyncMarkdown(event.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
}

async function parseAndSyncMarkdown(md, filename) {
    try {
        showToast("파일 분석 중...", 0, 0);
        const chunks = md.split('---');
        const newPosts = [];

        chunks.forEach((chunk, i) => {
            let dateMatch = chunk.match(/## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
            let time = '00:00', date = '';
            if (dateMatch) { date = dateMatch[1]; time = dateMatch[2]; }
            else { dateMatch = chunk.match(/## (\d{4}-\d{2}-\d{2})/); if (!dateMatch) return; date = dateMatch[1]; }

            const imageRegex = /!\[[\s\S]*?\]\((https?:\/\/[^\)]+)\)/g;
            let images = [];
            let m;
            while ((m = imageRegex.exec(chunk)) !== null) images.push(m[1].trim());

            let content = chunk
                .replace(/## \d{4}-\d{2}-\d{2}( \d{2}:\d{2})?/, '')
                .replace(/!\[[\s\S]*?\]\(.*?\)/g, '')
                .replace(/^\//gm, '')
                .trim();

            if (content || images.length > 0) {
                const contentKey = content.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '');
                newPosts.push({ id: `${date}_${images.length}_${content.length}_${contentKey}`, date, time, index: i, content, images });
            }
        });

        const sessionRefName = filename.replace('.md', '').replace(/_part\d+$/, '').replace(/\s*\(\d+\)$/, '').replace(/\s+\d+$/, '');
        let session = state.sessions.find(s => (s.refName === sessionRefName) || (s.name === sessionRefName));
        let sessionId = session ? session.id : db.collection(COLLECTION_NAME).doc().id;

        if (!session) {
            session = {
                id: sessionId,
                name: sessionRefName,
                refName: sessionRefName,
                order: state.sessions.length > 0 ? Math.min(...state.sessions.map(s => s.order || 0)) - 1 : 0,
                categoryId: state.categories[0]?.id || DEFAULT_CAT_ID,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await db.collection(COLLECTION_NAME).doc(sessionId).set(session);
        }

        const batchSize = 500;
        let savedCount = 0;
        for (let i = 0; i < newPosts.length; i += batchSize) {
            const batch = db.batch();
            newPosts.slice(i, i + batchSize).forEach(post => {
                const safeId = post.id.replace(/\//g, '_').replace(/\./g, '_');
                const ref = db.collection(COLLECTION_NAME).doc(sessionId).collection('posts').doc(safeId);
                batch.set(ref, post, { merge: true });
            });
            await batch.commit();
            savedCount += Math.min(batchSize, newPosts.length - i);
            showToast(`업로드 중... ${Math.round((savedCount / newPosts.length) * 100)}%`, 0, Math.round((savedCount / newPosts.length) * 100));
        }

        await db.collection(COLLECTION_NAME).doc(sessionId).update({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        showToast("업로드 완료!", 3000, 100);
        await switchSession(sessionId);
    } catch (e) {
        console.error(e);
        showToast("파일 처리 중 오류가 발생했습니다.");
    }
}

window.refreshSidebar = async () => {
    showToast("데이터를 동기화하는 중...", 1000);
    await Promise.all([loadCategoriesFromFirestore(), loadSessionsFromFirestore()]);
};

window.switchSession = async (id) => {
    if (postsUnsubscribe) { postsUnsubscribe(); postsUnsubscribe = null; }
    state.activeSessionId = id;
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;

    showToast("포스트를 불러오는 중...", 0, 50);

    postsUnsubscribe = db.collection(COLLECTION_NAME).doc(id).collection('posts').onSnapshot((snapshot) => {
        let subPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        let legacyPosts = session.posts || [];
        const allPostsMap = new Map();

        legacyPosts.forEach(p => allPostsMap.set(p.id || `${p.date}_${p.content.substring(0, 30)}`, p));
        subPosts.forEach(p => allPostsMap.set(p.id, p));

        state.allPosts = Array.from(allPostsMap.values());
        updateUI();
        showToast("동기화 완료", 800);
    }, (e) => {
        console.error("Posts Sync Error:", e);
    });

    if (window.innerWidth <= 1024) toggleSidebar(false);
    renderSidebarContent();
};

window.renameSession = async (id) => {
    const s = state.sessions.find(x => x.id === id);
    const n = prompt('이름 변경:', s.name);
    if (n && n.trim()) {
        s.name = n.trim();
        await db.collection(COLLECTION_NAME).doc(id).update({ name: s.name });
        renderSidebarContent();
    }
};

window.deleteSession = async (id) => {
    if (!confirm('세션을 삭제하시겠습니까?')) return;
    try {
        await db.collection(COLLECTION_NAME).doc(id).delete();
        state.sessions = state.sessions.filter(s => s.id !== id);
        if (state.activeSessionId === id) { state.allPosts = []; state.activeSessionId = null; updateUI(); }
        renderSidebarContent();
    } catch (e) { showToast("삭제 중 오류가 발생했습니다."); }
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
    if (els.sortIcon) els.sortIcon.textContent = state.sortOrder === 'desc' ? '↓' : '↑';
    if (els.sortText) els.sortText.textContent = state.sortOrder === 'desc' ? '최신순' : '과거순';
}

function updateUI() {
    const query = (els.searchInput?.value || '').toLowerCase();
    const startDate = els.startDateFilter?.value || '';
    const endDate = els.endDateFilter?.value || '';

    state.filteredPosts = state.allPosts.filter(post => {
        const matchesSearch = post.content.toLowerCase().includes(query) || post.date.includes(query);
        const matchesStart = startDate ? post.date >= startDate : true;
        const matchesEnd = endDate ? post.date <= endDate : true;
        return matchesSearch && matchesStart && matchesEnd;
    });

    state.filteredPosts.sort((a, b) => {
        const dateA = new Date(a.date + (a.time ? 'T' + a.time : ''));
        const dateB = new Date(b.date + (b.time ? 'T' + b.time : ''));
        if (dateA - dateB !== 0) return state.sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        return (a.index || 0) - (b.index || 0);
    });

    state.visiblePosts = 20;
    renderPosts();
    updateStats();
    renderDateNavigator();
}

function renderDateNavigator() {
    if (!els.dateNavigator) return;
    if (state.allPosts.length === 0) { els.dateNavigator.innerHTML = ''; return; }

    const dateMap = {};
    state.allPosts.forEach(p => {
        const [y, m] = p.date.split('-');
        if (!dateMap[y]) dateMap[y] = new Set();
        dateMap[y].add(m);
    });

    const years = Object.keys(dateMap).sort((a, b) => b - a);
    els.dateNavigator.innerHTML = years.map(y => {
        const months = Array.from(dateMap[y]).sort((a, b) => b - a);
        return `
            <div class="year-group">
                <span class="year-label">${y}</span>
                <div class="month-list">
                    ${months.map(m => `<button class="month-btn ${els.startDateFilter.value.startsWith(`${y}-${m}`) ? 'active' : ''}" onclick="filterByMonth('${y}', '${m}')">${parseInt(m)}월</button>`).join('')}
                </div>
            </div>`;
    }).join('');
}

window.filterByMonth = (y, m) => {
    const f = `${y}-${m}-01`;
    const l = new Date(y, m, 0).toISOString().split('T')[0];
    if (els.startDateFilter.value === f) { els.startDateFilter.value = ''; els.endDateFilter.value = ''; }
    else { els.startDateFilter.value = f; els.endDateFilter.value = l; }
    updateUI();
};

function renderPosts(append = false) {
    if (!els.postsFeed) return;
    if (state.allPosts.length === 0 && state.sessions.length > 0) {
        els.postsFeed.innerHTML = `<div class="empty-state"><h2>파일을 선택하여 분석을 시작하세요</h2></div>`;
        return;
    }
    if (state.filteredPosts.length === 0) {
        els.postsFeed.innerHTML = `<div class="empty-state"><h2>검색 결과가 없습니다</h2></div>`;
        return;
    }

    const postsToShow = state.filteredPosts.slice(0, state.visiblePosts);
    const html = postsToShow.map((p, idx) => `
        <article class="post-card" style="animation-delay: ${idx % 20 * 0.02}s">
            <div class="post-header">
                <span class="post-date">${p.date} ${p.time || ''}</span>
                <button class="btn-icon" onclick="copyContent('${p.id || idx}')">📋</button>
            </div>
            <div class="post-content">${p.content.replace(new RegExp(`(${els.searchInput.value})`, 'gi'), '<mark>$1</mark>')}</div>
            ${p.images && p.images.length > 0 ? `<div class="post-images">${p.images.map(img => `<img src="https://wsrv.nl/?url=${encodeURIComponent(img)}&w=800&q=80" loading="lazy" onclick="openModal(this.src)">`).join('')}</div>` : ''}
        </article>`).join('');

    if (append) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        while (temp.firstChild) els.postsFeed.appendChild(temp.firstChild);
    } else {
        els.postsFeed.innerHTML = html;
    }
}

function updateStats() {
    if (els.totalPosts) els.totalPosts.textContent = state.filteredPosts.length.toLocaleString();
    if (els.totalImages) {
        const ic = state.filteredPosts.reduce((acc, p) => acc + (p.images ? p.images.length : 0), 0);
        els.totalImages.textContent = ic.toLocaleString();
    }
}

function showToast(m, d = 3000, p = null) {
    if (!els.toast) return;
    els.toast.innerHTML = `<span class="toast-text">${m}</span>${p !== null ? `<div class="toast-progress-bar"><div class="toast-progress-fill" style="width: ${p}%"></div></div>` : ''}`;
    els.toast.classList.add('show');
    if (d > 0) setTimeout(() => els.toast.classList.remove('show'), d);
}

function openModal(u) { if (els.modalImg) els.modalImg.src = u; els.imageModal.style.display = 'flex'; setTimeout(() => els.imageModal.classList.add('show'), 10); document.body.style.overflow = 'hidden'; }
function closeModal() { els.imageModal.classList.remove('show'); setTimeout(() => { els.imageModal.style.display = 'none'; document.body.style.overflow = 'auto'; }, 300); }

window.copyContent = (id) => {
    const p = state.allPosts.find(x => (x.id || '') === id);
    if (p) { navigator.clipboard.writeText(p.content); showToast('내용이 복사되었습니다.'); }
};

// --- Entry Point ---
document.addEventListener('DOMContentLoaded', init);
if (document.readyState === 'interactive' || document.readyState === 'complete') init();
