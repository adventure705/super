// --- Global State ---
const state = {
    allPosts: [],
    filteredPosts: [],
    sessions: [],
    categories: [],
    activeSessionId: null,
    sortOrder: 'desc',
    visiblePosts: 20,
    postCache: new Map(), // sessionId -> posts[] memory cache
};
let searchTimeout;

let db;

const COLLECTION_NAME = 'threads_sessions';
const CATEGORY_COLLECTION = 'threads_categories';
const DEFAULT_CAT_ID = 'uncategorized_default';

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDdk_axp2Q9OANqleknWeYWK9DrxKWKeY4",
    authDomain: "template-3530f.firebaseapp.com",
    projectId: "template-3530f",
    storageBucket: "template-3530f.firebasestorage.app",
    messagingSenderId: "891098188622",
    appId: "1:891098188622:web:392c0121a17f1cd4402c1f"
};

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
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();

        // DISABLED Persistence for raw speed with large datasets (5,000+ items)
        // This prevents the browser from hanging while indexing data to disk.

        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                console.log("Authenticated User ID:", user.uid);
                updateSyncStatus(true);
                await refreshData();
            } else {
                console.log("Not authenticated. Signing in anonymously...");
                await firebase.auth().signInAnonymously();
            }
        });
    } catch (e) {
        console.error("Init Error:", e);
        showToast("초기화 실패");
    }
}

async function refreshData() {
    showToast("데이터를 불러오는 중...", 1000);
    await Promise.all([
        loadCategories(),
        loadSessions()
    ]);
}

window.refreshSidebar = refreshData;

function setupEventListeners() {
    if (els.uploadBtn) els.uploadBtn.addEventListener('click', () => els.fileInput.click());
    if (els.fileInput) els.fileInput.addEventListener('change', handleFileUpload);
    if (els.searchInput) els.searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => updateUI(), 300); // 0.3s debounce
    });
    if (els.startDateFilter) els.startDateFilter.addEventListener('change', () => updateUI());
    if (els.endDateFilter) els.endDateFilter.addEventListener('change', () => updateUI());
    if (els.resetFilters) els.resetFilters.addEventListener('click', resetFilters);
    if (els.sortToggle) els.sortToggle.addEventListener('click', toggleSort);
    if (els.mobileMenuToggle) els.mobileMenuToggle.addEventListener('click', () => toggleSidebar(true));
    if (els.sidebarOverlay) els.sidebarOverlay.addEventListener('click', () => toggleSidebar(false));
    if (els.addCategoryBtn) els.addCategoryBtn.addEventListener('click', addNewCategory);
    if (els.closeModal) els.closeModal.onclick = closeModal;
    if (els.imageModal) els.imageModal.onclick = (e) => { if (e.target === els.imageModal) closeModal(); };
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && els.imageModal && getComputedStyle(els.imageModal).display !== 'none') {
            closeModal();
        }
    });
    if (els.contentView) els.contentView.addEventListener('scroll', handleScroll);
}

// --- Data Fetching ---
async function loadCategories() {
    try {
        console.log("Loading categories from Firestore...");
        const snapshot = await db.collection(CATEGORY_COLLECTION).get();
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (docs.length > 0) {
            state.categories = docs.sort((a, b) => (a.order || 0) - (b.order || 0));
            console.log(`Successfully loaded ${state.categories.length} categories.`);
        } else {
            console.warn("No categories found in cloud. Creating default fallback...");
            await addNewCategoryUI('미분류', DEFAULT_CAT_ID);
            const retry = await db.collection(CATEGORY_COLLECTION).get();
            state.categories = retry.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
        }
        renderSidebarContent();
    } catch (e) {
        console.error("Categories fetch error:", e);
        showToast("데이터 연동 중 오류가 발생했습니다.");
    }
}

async function loadSessions() {
    try {
        console.log("Loading sessions from Firestore...");
        const snapshot = await db.collection(COLLECTION_NAME).get();
        state.sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Efficient sorting
        state.sessions.sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
            const dateA = a.updatedAt?.seconds || (a.updatedAt instanceof Date ? a.updatedAt.getTime() / 1000 : 0);
            const dateB = b.updatedAt?.seconds || (b.updatedAt instanceof Date ? b.updatedAt.getTime() / 1000 : 0);
            return dateB - dateA;
        });

        // Background Check: Report on any sessions with legacy bloat
        const legacyCount = state.sessions.filter(s => s.posts && s.posts.length > 0).length;
        if (legacyCount > 0) console.log(`Found ${legacyCount} sessions with legacy data bloat. Optimizing on-access.`);

        console.log(`Successfully loaded ${state.sessions.length} sessions.`);
        renderSidebarContent();
        if (!state.activeSessionId && state.sessions.length > 0) autoSelectFirstSession();
    } catch (e) {
        console.error("Sessions fetch error:", e);
        showToast("데이터를 불러오는 중 오류가 발생했습니다.");
    }
}

async function switchSession(id) {
    if (state.activeSessionId === id && state.allPosts.length > 0) return;
    state.activeSessionId = id;
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;

    // 0. Instant Cache Access
    if (state.postCache.has(id)) {
        state.allPosts = state.postCache.get(id);
        updateUI();
        if (window.innerWidth <= 1024) toggleSidebar(false);
        renderSidebarContent();
        return;
    }

    showToast("초고속 병렬 분석 중...", 1000);

    try {
        console.log(`🚀 Multi-Channel Parallel Download Initiation: ${session.name}`);
        const colRef = db.collection(COLLECTION_NAME).doc(id).collection('posts');

        // Channel Definitions (Parallel Years)
        const channels = [
            { name: '2026', q: colRef.where('date', '>=', '2026-01-01').where('date', '<=', '2026-12-31') },
            { name: '2025', q: colRef.where('date', '>=', '2025-01-01').where('date', '<=', '2025-12-31') },
            { name: '2024', q: colRef.where('date', '>=', '2024-01-01').where('date', '<=', '2024-12-31') },
            { name: 'Legacy', q: colRef.where('date', '<', '2024-01-01') }
        ];

        let finalMap = new Map();

        // Merge with session document data if blooming
        (session.posts || []).forEach(p => {
            const ts = new Date(p.date + (p.time ? 'T' + p.time : '')).getTime();
            finalMap.set(p.id || `${p.date}_${p.content.substring(0, 30)}`, { ...p, _ts: ts });
        });

        // 🚀 Parallel Exec: Fetch ALL channels at once
        const fetchStartTime = Date.now();
        const snapshots = await Promise.all(channels.map(c => c.q.get()));

        snapshots.forEach((snap, idx) => {
            console.log(`Channel [${channels[idx].name}] received: ${snap.size} posts`);
            snap.docs.forEach(doc => {
                const data = doc.data();
                const ts = new Date(data.date + (data.time ? 'T' + data.time : '')).getTime();
                finalMap.set(doc.id, { ...data, _ts: ts });
            });
        });

        const combinedPosts = Array.from(finalMap.values());
        console.log(`Total Parallel Load: ${Date.now() - fetchStartTime}ms for ${combinedPosts.length} posts.`);

        state.postCache.set(id, combinedPosts);
        state.allPosts = combinedPosts;
        updateUI();

        // Diet Maintenance: Clean up doc bloat async
        if (session.posts && session.posts.length > 0) {
            console.log("Cleaning up legacy document bloat...");
            db.collection(COLLECTION_NAME).doc(id).update({ posts: firebase.firestore.FieldValue.delete() });
            session.posts = [];
        }

    } catch (e) {
        console.error("Parallel Fetch Error:", e);
        showToast("데이터 병렬 로딩 중 문제가 발생했습니다.");
        // Simple fallback
        try {
            const snap = await db.collection(COLLECTION_NAME).doc(id).collection('posts').get();
            state.allPosts = snap.docs.map(doc => ({ ...doc.data(), _ts: new Date(doc.data().date).getTime() }));
            updateUI();
        } catch (ee) { }
    }

    if (window.innerWidth <= 1024) toggleSidebar(false);
    renderSidebarContent();
}
window.switchSession = switchSession;

// --- Sidebar Management ---
function initSortable() {
    if (!els.sidebarContent || typeof Sortable === 'undefined') return;

    // Category Reordering
    new Sortable(els.sidebarContent, {
        animation: 150,
        handle: '.category-header',
        ghostClass: 'sortable-ghost',
        onEnd: async () => {
            const categoryOrder = Array.from(els.sidebarContent.querySelectorAll('.category-section')).map(el => el.dataset.id);
            const batch = db.batch();
            categoryOrder.forEach((id, index) => {
                if (id === 'uncategorized') return;
                const ref = db.collection(CATEGORY_COLLECTION).doc(id);
                batch.update(ref, { order: index });
            });
            await batch.commit();
        }
    });

    // Sessions Reordering and Moving
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
                    }
                    batch.update(ref, updateData);
                });
                await batch.commit();
                await loadSessions(); // Refresh local state
            }
        });
    });
}

window.renameCategory = async (id) => {
    const category = state.categories.find(c => c.id === id);
    if (!category) return;
    const newName = prompt('카테고리 이름 변경:', category.name);
    if (newName && newName.trim()) {
        const trimmedName = newName.trim();
        // Optimistic Update
        category.name = trimmedName;
        renderSidebarContent();

        await db.collection(CATEGORY_COLLECTION).doc(id).update({ name: trimmedName });
        showToast("변경되었습니다.");
    }
};

window.deleteCategory = async (id) => {
    const sessCount = state.sessions.filter(s => s.categoryId === id).length;
    if (sessCount > 0) return alert('카테고리가 비어있지 않습니다.');
    if (!confirm('삭제하시겠습니까?')) return;

    // Optimistic Update
    state.categories = state.categories.filter(c => c.id !== id);
    renderSidebarContent();

    await db.collection(CATEGORY_COLLECTION).doc(id).delete();
    showToast("삭제되었습니다.");
};

window.renameSession = async (id) => {
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;
    const newName = prompt('세션 이름 변경:', session.name);
    if (newName && newName.trim()) {
        const trimmedName = newName.trim();
        // Optimistic Update
        session.name = trimmedName;
        renderSidebarContent();

        await db.collection(COLLECTION_NAME).doc(id).update({ name: trimmedName });
        showToast("변경되었습니다.");
    }
};

window.deleteSession = async (id) => {
    if (!confirm('삭제하시겠습니까?')) return;

    // Optimistic Update
    state.sessions = state.sessions.filter(s => s.id !== id);
    if (state.activeSessionId === id) {
        state.allPosts = [];
        state.activeSessionId = null;
        updateUI();
    }
    renderSidebarContent();

    await db.collection(COLLECTION_NAME).doc(id).delete();
    showToast("삭제되었습니다.");
};

function renderSidebarContent() {
    if (!els.sidebarContent) return;

    const categoryHtml = state.categories.map(cat => {
        const catSessions = state.sessions.filter(s => s.categoryId === cat.id)
            .sort((a, b) => {
                if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
                // Fallback to latest first if order is missing
                const dateA = a.updatedAt?.seconds || 0;
                const dateB = b.updatedAt?.seconds || 0;
                return dateB - dateA;
            });

        return `
            <div class="category-section" data-id="${cat.id}">
                <div class="category-header">
                    <span class="category-title">${cat.name}</span>
                    <div class="category-actions" onclick="event.stopPropagation()">
                        <button class="action-btn" onclick="renameCategory('${cat.id}')">✎</button>
                        <button class="action-btn delete" onclick="deleteCategory('${cat.id}')">✕</button>
                    </div>
                </div>
                <ul class="session-list" data-category-id="${cat.id}">
                    ${catSessions.map(s => `
                        <li class="${state.activeSessionId === s.id ? 'active' : ''}" data-id="${s.id}" onclick="switchSession('${s.id}')">
                            <span class="drag-handle">☰</span>
                            <span class="session-name" title="${s.name}">${s.name}</span>
                            <div class="session-actions" onclick="event.stopPropagation()">
                                <button class="action-btn" onclick="renameSession('${s.id}')">✎</button>
                                <button class="action-btn delete" onclick="deleteSession('${s.id}')">✕</button>
                            </div>
                        </li>`).join('')}
                </ul>
            </div>`;
    }).join('');

    const uncategorizedSessions = state.sessions.filter(s => !s.categoryId || !state.categories.some(c => c.id === s.categoryId))
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    let uncategorizedHtml = '';
    if (uncategorizedSessions.length > 0) {
        uncategorizedHtml = `
            <div class="category-section" data-id="uncategorized">
                <div class="category-header"><span class="category-title">미분류</span></div>
                <ul class="session-list" data-category-id="${DEFAULT_CAT_ID}">
                    ${uncategorizedSessions.map(s => `
                        <li class="${state.activeSessionId === s.id ? 'active' : ''}" data-id="${s.id}" onclick="switchSession('${s.id}')">
                            <span class="drag-handle">☰</span>
                            <span class="session-name">${s.name}</span>
                            <div class="session-actions" onclick="event.stopPropagation()">
                                <button class="action-btn" onclick="renameSession('${s.id}')">✎</button>
                                <button class="action-btn delete" onclick="deleteSession('${s.id}')">✕</button>
                            </div>
                        </li>`).join('')}
                </ul>
            </div>`;
    }

    els.sidebarContent.innerHTML = categoryHtml + uncategorizedHtml;
    initSortable();
}

// --- UI Rendering ---
function updateUI() {
    const q = (els.searchInput?.value || '').toLowerCase();
    const start = els.startDateFilter?.value || '';
    const end = els.endDateFilter?.value || '';

    state.filteredPosts = state.allPosts.filter(p => {
        const matchesSearch = p.content.toLowerCase().includes(q) || p.date.includes(q);
        const matchesStart = start ? p.date >= start : true;
        const matchesEnd = end ? p.date <= end : true;
        return matchesSearch && matchesStart && matchesEnd;
    });

    state.filteredPosts.sort((a, b) => {
        const diff = state.sortOrder === 'desc' ? b._ts - a._ts : a._ts - b._ts;
        if (diff !== 0) return diff;
        return (a.index || 0) - (b.index || 0);
    });

    state.visiblePosts = 20;
    renderPosts();
    updateStats();
    renderDateNavigator();
}

function renderPostCard(post, idx) {
    return `
        <article class="post-card" style="animation-delay: ${idx % 20 * 0.02}s">
            <div class="post-header">
                <span class="post-date">${post.date} ${post.time || ''}</span>
                <button class="btn-icon" onclick="copyContent('${post.id}')" title="복사">📋</button>
            </div>
            <div class="post-content">${highlightText(post.content, els.searchInput.value)}</div>
            ${post.images && post.images.length > 0 ? `
                <div class="post-images">
                    ${post.images.map(img => `<img src="https://wsrv.nl/?url=${encodeURIComponent(img)}&w=800&q=80" loading="lazy" onclick="openModal(this.src)">`).join('')}
                </div>
            ` : ''}
        </article>`;
}

function renderPosts(append = false) {
    if (!els.postsFeed) return;
    const posts = state.filteredPosts.slice(0, state.visiblePosts);
    if (posts.length === 0) {
        els.postsFeed.innerHTML = `<div class="empty-state"><h2>데이터가 없습니다</h2></div>`;
        return;
    }

    const html = posts.map((p, idx) => renderPostCard(p, idx)).join('');
    if (append) {
        const div = document.createElement('div');
        div.innerHTML = html;
        while (div.firstChild) els.postsFeed.appendChild(div.firstChild);
    } else {
        els.postsFeed.innerHTML = html;
    }
}

function renderDateNavigator() {
    if (!els.dateNavigator) return;
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
                    ${months.map(m => `
                        <button class="month-btn ${els.startDateFilter.value === `${y}-${m}-01` ? 'active' : ''}" 
                                onclick="filterByMonth('${y}', '${m}')">${parseInt(m)}월</button>
                    `).join('')}
                </div>
            </div>`;
    }).join('');
}

function filterByMonth(y, m) {
    const start = `${y}-${m}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${m}-${lastDay}`;

    if (els.startDateFilter.value === start) {
        els.startDateFilter.value = '';
        els.endDateFilter.value = '';
    } else {
        els.startDateFilter.value = start;
        els.endDateFilter.value = end;
    }
    updateUI();
}
window.filterByMonth = filterByMonth;

function highlightText(text, q) {
    if (!q) return text;
    return text.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>');
}

// --- Upload Logic ---
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const md = event.target.result;
            const chunks = md.split('---');
            const newPosts = [];
            const timestamp = Date.now();

            const hashString = (s) => {
                let h = 0;
                for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
                return Math.abs(h).toString(36);
            };

            chunks.forEach((chunk, i) => {
                let dateMatch = chunk.match(/## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
                let time = '00:00', date = '';
                if (dateMatch) { date = dateMatch[1]; time = dateMatch[2]; }
                else { dateMatch = chunk.match(/## (\d{4}-\d{2}-\d{2})/); if (!dateMatch) return; date = dateMatch[1]; }

                const imageRegex = /!\[[\s\S]*?\]\((https?:\/\/[^\)]+)\)/g;
                let images = [];
                let m;
                while ((m = imageRegex.exec(chunk)) !== null) images.push(m[1].trim());

                let content = chunk.replace(/## \d{4}-\d{2}-\d{2}( \d{2}:\d{2})?/, '').replace(/!\[[\s\S]*?\]\(.*?\)/g, '').trim();
                if (content || images.length > 0) {
                    const postId = `p_${date}_${hashString(time + content)}`;
                    newPosts.push({ id: postId, date, time, index: i, content, images });
                }
            });

            if (newPosts.length === 0) {
                showToast("업로드할 유효한 포스트가 없습니다.");
                return;
            }

            const sName = file.name.replace('.md', '').replace(/_part\d+$/, '');
            let s = state.sessions.find(x => x.name === sName);
            let sId = s ? s.id : db.collection(COLLECTION_NAME).doc().id;

            if (!s) {
                // Set order to be at the top (smaller than current minimum)
                const minOrder = state.sessions.length > 0 ? Math.min(...state.sessions.map(x => x.order || 0)) : 0;
                s = {
                    id: sId,
                    name: sName,
                    categoryId: state.categories[0]?.id || DEFAULT_CAT_ID,
                    order: minOrder - 1,
                    updatedAt: new Date()
                };
                await db.collection(COLLECTION_NAME).doc(sId).set({
                    ...s,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                state.sessions.push(s);
                renderSidebarContent();
            }

            const batchSize = 500;
            const batchChunks = [];
            for (let i = 0; i < newPosts.length; i += batchSize) {
                batchChunks.push(newPosts.slice(i, i + batchSize));
            }

            let savedCount = 0;
            const CONCURRENCY = 8; // Restoration of parallel power
            for (let i = 0; i < batchChunks.length; i += CONCURRENCY) {
                const group = batchChunks.slice(i, i + CONCURRENCY);
                await Promise.all(group.map(async (chunk) => {
                    const batch = db.batch();
                    chunk.forEach(p => {
                        const ref = db.collection(COLLECTION_NAME).doc(sId).collection('posts').doc(p.id);
                        batch.set(ref, p, { merge: true });
                    });
                    await batch.commit();
                    savedCount += chunk.length;
                    showToast(`초고속 병렬 분석 중... ${Math.round((savedCount / newPosts.length) * 100)}%`, 0);
                }));
            }

            await db.collection(COLLECTION_NAME).doc(sId).update({
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast("업로드 완료!", 2000);
            await refreshData();
            await switchSession(sId);

        } catch (error) {
            console.error("Upload Error:", error);
            showToast("업로드 중 오류가 발생했습니다: " + error.message);
        }
    };
    reader.onerror = () => showToast("파일을 읽는 중 오류가 발생했습니다.");
    reader.readAsText(file);
    e.target.value = '';
}

// --- Helpers ---
function resetFilters() {
    els.searchInput.value = '';
    els.startDateFilter.value = '';
    els.endDateFilter.value = '';
    updateUI();
}

function toggleSort() {
    state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
    els.sortIcon.textContent = state.sortOrder === 'desc' ? '↓' : '↑';
    els.sortText.textContent = state.sortOrder === 'desc' ? '최신순' : '과거순';
    updateUI();
}

function updateStats() {
    els.totalPosts.textContent = state.filteredPosts.length;
    els.totalImages.textContent = state.filteredPosts.reduce((acc, p) => acc + (p.images ? p.images.length : 0), 0);
}

function showToast(m, d = 3000) {
    els.toast.textContent = m;
    els.toast.classList.add('show');
    if (d > 0) setTimeout(() => els.toast.classList.remove('show'), d);
}

function updateSyncStatus(s) {
    const icon = document.querySelector('.logo-icon');
    if (icon) icon.style.boxShadow = s ? '0 0 10px #4caf50' : '0 0 10px #f44336';
}

function handleScroll() {
    const { scrollTop, scrollHeight, clientHeight } = els.contentView;
    if (scrollTop + clientHeight >= scrollHeight - 500) {
        if (state.visiblePosts < state.filteredPosts.length) {
            state.visiblePosts += 20;
            renderPosts(true);
        }
    }
}

function toggleSidebar(o) { els.sidebar.classList.toggle('open', o); els.sidebarOverlay.classList.toggle('show', o); }

window.openModal = function (u) {
    if (els.modalImg) els.modalImg.src = u;
    els.imageModal.style.display = 'flex';
    setTimeout(() => {
        els.imageModal.classList.add('show');
    }, 10);
    document.body.style.overflow = 'hidden';
};

window.closeModal = function () {
    els.imageModal.classList.remove('show');
    setTimeout(() => {
        els.imageModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }, 300);
};

async function addNewCategory() {
    const n = prompt('새 카테고리:');
    if (n && n.trim()) {
        const name = n.trim();
        const id = db.collection(CATEGORY_COLLECTION).doc().id;
        const newCat = { id, name, order: state.categories.length };

        // Optimistic Update
        state.categories.push(newCat);
        renderSidebarContent();

        await db.collection(CATEGORY_COLLECTION).doc(id).set(newCat, { merge: true });
    }
}

async function addNewCategoryUI(n, id) {
    const cid = id || db.collection(CATEGORY_COLLECTION).doc().id;
    const newCat = { name: n, order: state.categories.length };
    await db.collection(CATEGORY_COLLECTION).doc(cid).set(newCat, { merge: true });
    state.categories.push({ id: cid, ...newCat });
    renderSidebarContent();
}

window.copyContent = (id) => {
    const p = state.allPosts.find(x => x.id === id);
    if (p) { navigator.clipboard.writeText(p.content); showToast('복사됨'); }
};

function autoSelectFirstSession() { if (state.sessions.length > 0) switchSession(state.sessions[0].id); }

init();
