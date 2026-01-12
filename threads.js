const state = {
    allPosts: [],
    filteredPosts: [],
    sessions: [],
    categories: [],
    activeSessionId: null,
    sortOrder: 'desc',
    visiblePosts: 20,
    postCache: new Map(),
    lastSyncMap: new Map(), // Track last successful sync time per session
    isSyncing: false,
};
window.state = state; // Global DEBUG Access

// [CRITICAL] Cache Invalidation Logic
// We must clear old corrupted caches (mixed data) to ensure users get fresh data.
const CURRENT_CACHE_VERSION = '2026-01-12-v6-user-req-clean';
if (localStorage.getItem('threads_cache_version') !== CURRENT_CACHE_VERSION) {
    console.log("🧹 Detected old cache version. purging threads cache...");
    localStorage.removeItem('threads_hot_cache');
    localStorage.removeItem('threads_sessions');
    localStorage.setItem('threads_cache_version', CURRENT_CACHE_VERSION);
    location.reload(); // Force reload to apply clean state
}

console.log(`Threads Analyzer Loaded - Version: ${CURRENT_CACHE_VERSION}`);
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
        progressContainer: document.getElementById('progress-container'),
        progressBar: document.getElementById('progress-bar'),
        progressPercent: document.getElementById('progress-percent'),
        progressLabel: document.getElementById('progress-label'),
        profilePanel: document.getElementById('profile-info-panel'),
        displayUsername: document.getElementById('display-username'),
        displayUrlLink: document.getElementById('display-url-link'),
    };
}

// --- Initialization ---
// --- Initialization ---
async function init() {
    initElements();
    setupEventListeners();

    // 0. Instant Hot-Start (Restore last view immediately)
    restoreStateFromCache();

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        firebase.firestore().enablePersistence({ synchronizeTabs: true })
            .catch(err => console.log("Persistence:", err.code));

        db = firebase.firestore();

        // Load Sidebar Cache
        const cachedSessions = localStorage.getItem('threads_sessions');
        const cachedCategories = localStorage.getItem('threads_categories');

        if (cachedSessions) {
            try {
                state.sessions = JSON.parse(cachedSessions);
                console.log(`Restored ${state.sessions.length} sessions from local cache.`);
            } catch (e) { console.error("Cache parse error", e); }
        }
        if (cachedCategories) {
            try {
                state.categories = JSON.parse(cachedCategories);
            } catch (e) { }
        }
        renderSidebarContent();

        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                console.log("User signed in:", user.uid);
                updateSyncStatus(true);
                // Background Sync: Only refresh if we don't have data, or strictly in background
                if (state.sessions.length === 0) {
                    updateProgressBar(20, "클라우드 데이터 동기화 중...");
                    await refreshData();
                    updateProgressBar(100, "동기화 완료");
                    setTimeout(hideProgressBar, 1000);
                }
                else refreshData(); // Fire and forget, don't await to block UI
            } else {
                updateProgressBar(10, "클라우드 접속 중...");
                try {
                    await firebase.auth().signInAnonymously();
                } catch (e) {
                    console.error("Auth Error:", e);
                    showToast(`로그인 실패: ${e.message}`);
                }
            }
        });
    } catch (e) {
        console.error("Init Error:", e);
    }
}


function saveStateToCache() {
    if (!state.activeSessionId) return;
    try {
        // Cache only the first 400 posts to stay within LocalStorage limits (~5MB)
        const hotCache = {
            sessionId: state.activeSessionId,
            posts: state.allPosts.slice(0, 400),
            timestamp: Date.now()
        };
        localStorage.setItem('threads_hot_cache', JSON.stringify(hotCache));
    } catch (e) {
        console.warn("Cache quota exceeded", e);
    }
}

function restoreStateFromCache() {
    try {
        const raw = localStorage.getItem('threads_hot_cache');
        if (!raw) return;
        const cache = JSON.parse(raw);
        if (!cache.sessionId || !cache.posts) return;

        console.log("⚡ Instant Hot-Start: Restoring " + cache.posts.length + " posts");
        state.activeSessionId = cache.sessionId;
        state.allPosts = cache.posts;
        // [CRITICAL FIX] Safe Cache Population
        // Register this restored data immediately to the safe memory cache
        state.postCache.set(cache.sessionId, cache.posts);

        updateUI(); // Immediate Render
        if (els.postsFeed) els.postsFeed.style.opacity = '1';
    } catch (e) {
        console.error("Hot-start failed:", e);
    }
}

async function refreshData() {
    // Silent Refresh
    await Promise.all([
        loadCategories(),
        loadSessions()
    ]);
}

window.refreshSidebar = refreshData;

async function forceReloadSession() {
    const id = state.activeSessionId;
    if (!id) return;

    if (state.isSyncing) {
        showToast("이미 동기화 중입니다.");
        return;
    }

    console.log(`🔄 Force Reloading Session: ${id}`);
    state.postCache.delete(id);
    state.lastSyncMap.delete(id);

    // Clear current view momentarily
    state.allPosts = [];
    updateUI();

    await switchSession(id);
}
window.forceReloadSession = forceReloadSession;

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
            localStorage.setItem('threads_categories', JSON.stringify(state.categories));
            console.log(`Successfully loaded ${state.categories.length} categories.`);
        } else {
            console.warn("No categories found in cloud. Creating default fallback...");
            await addNewCategoryUI('미분류', DEFAULT_CAT_ID);
            const retry = await db.collection(CATEGORY_COLLECTION).get();
            state.categories = retry.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
            localStorage.setItem('threads_categories', JSON.stringify(state.categories));
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

        localStorage.setItem('threads_sessions', JSON.stringify(state.sessions));
        console.log(`Successfully loaded ${state.sessions.length} sessions.`);
        renderSidebarContent();
        if (!state.activeSessionId && state.sessions.length > 0) autoSelectFirstSession();
    } catch (e) {
        console.error("Sessions fetch error:", e);
        showToast(`목록 로딩 실패: ${e.code || e.message}`);
    }
}

async function switchSession(id) {
    // Prevent reload if clicking the same session
    if (state.activeSessionId === id) return;

    state.activeSessionId = id;
    const session = state.sessions.find(s => s.id === id);
    if (!session) {
        console.error("Session not found:", id);
        return;
    }

    updateHeaderProfile(session);

    // 0. Cache Check
    let isCached = false;

    // [CRITICAL FIX] Removed dangerous "Hot-Start Promotion" block.
    // It was causing the previous session's 'allPosts' to be copied into the new session's cache slot
    // because state.activeSessionId had just been updated to the new ID.

    // [CRITICAL FIX] Enable Read-Cache for performance
    if (state.postCache.has(id)) {
        state.allPosts = state.postCache.get(id);
        updateUI();
        if (window.innerWidth <= 1024) toggleSidebar(false);
        renderSidebarContent();
        isCached = true;
        console.log("Skipping sync - Loaded from cache (Manual Reload available).");
        return; // [USER REQUIREMENT] No auto-reload on tab return. Stops here.
    } else {
        updateProgressBar(10, "데이터 로딩 시작...");
        state.allPosts = [];

        // [CRITICAL FIX] Legacy Block DISABLED to prevent Mixed Data
        /*
        if (session.posts && Array.isArray(session.posts) && session.posts.length > 0) {
            console.log("⚡ Found legacy posts in session doc, using as initial state.");
            state.allPosts = session.posts.map(p => {
                 const ts = new Date((p.date || '') + (p.time ? 'T' + p.time : '')).getTime() || 0;
                 return { ...p, _ts: ts };
            }).sort((a, b) => (b._ts || 0) - (a._ts || 0));
        }
        */

        updateUI();
    }

    try {
        state.isSyncing = true;
        updateStats(); // Show syncing state immediately
        console.log(`🚀 Loading Session: ${session.name} (ID: ${id})`);
        const colRef = db.collection(COLLECTION_NAME).doc(id).collection('posts');

        // Step 1: Rapid 300-post fetch (Only if not cached)
        if (!isCached) {
            updateProgressBar(30, "최신 글 불러오는 중...");
            try {
                // Try getting latest posts first
                const firstSnap = await colRef.orderBy('date', 'desc').limit(300).get();

                // [CRITICAL FIX] Abort if session changed during fast-fetch
                if (state.activeSessionId !== id) return;

                const initialPosts = firstSnap.docs.map(doc => {
                    const data = doc.data();
                    const ts = new Date((data.date || '') + (data.time ? 'T' + data.time : '')).getTime() || 0;
                    return { ...data, id: doc.id, _ts: ts };
                });

                if (initialPosts.length === 0) {
                    // Do not show error yet, wait for full sync
                    console.log("Initial fetch empty, relying on full sync.");
                } else {
                    state.allPosts = initialPosts.sort((a, b) => (b._ts || 0) - (a._ts || 0));
                    updateUI();
                }
            } catch (e) {
                console.warn("Fast fetch failed, falling back to full sync", e);
            }
        }

        // [CRITICAL FIX] Capture state synchronously!
        // This snapshot ensures that the background loader uses the data that belonged to THIS session
        const safeInitialPosts = [...state.allPosts];

        // Step 2: Robust Recursive Batch Sync
        const loadAllBatches = async () => {
            try {
                // progressive merging
                const unifiedMap = new Map();

                // [CRITICAL FIX] Isolation Strategy
                // Seed from the CAPTURED safe snapshot.
                safeInitialPosts.forEach(p => unifiedMap.set(p.id, p));

                let lastSnap = null;
                let hasMore = true;
                const BATCH_SIZE = 1000; // Maximize throughput
                let batchCount = 0;
                let totalFetched = 0;
                let retryCount = 0;

                while (hasMore) {
                    // [BACKGROUND SYNC] Continued even if switched...
                    /*
                    if (state.activeSessionId !== id) {
                        console.log(`🛑 Loading aborted for ${id} (Switched to ${state.activeSessionId})`);
                        return;
                    }
                    */

                    let query = colRef.orderBy(firebase.firestore.FieldPath.documentId()).limit(BATCH_SIZE);
                    if (lastSnap) {
                        query = query.startAfter(lastSnap);
                    }

                    try {
                        const snapshot = await query.get();

                        // [BACKGROUND SYNC] Continued even if switched...
                        // if (state.activeSessionId !== id) return; // Removed to allow background cache fill

                        // Reset retry count on success
                        retryCount = 0;

                        if (snapshot.empty) {
                            hasMore = false;
                            break;
                        }

                        // Process this batch
                        snapshot.docs.forEach(doc => {
                            const data = doc.data();
                            const ts = new Date((data.date || '') + (data.time ? 'T' + data.time : '')).getTime() || 0;
                            unifiedMap.set(doc.id, { ...data, id: doc.id, _ts: ts });
                        });

                        lastSnap = snapshot.docs[snapshot.docs.length - 1];
                        batchCount++;
                        totalFetched += snapshot.size;

                        // Incremental Update - ONLY if still active
                        if (state.activeSessionId === id) {
                            const partialList = Array.from(unifiedMap.values());
                            partialList.sort((a, b) => (b._ts || 0) - (a._ts || 0));
                            state.allPosts = partialList;
                            // Throttle UI updates to save CPU
                            // Only update every 1000 posts or if it's the last batch
                            if (totalFetched % 1000 < BATCH_SIZE || snapshot.size < BATCH_SIZE) {
                                updateUI();
                            }
                            updateProgressBar(50 + (batchCount * 2), `동기화 중... (${state.allPosts.length}개)`);
                        }

                        if (snapshot.size < BATCH_SIZE) hasMore = false;



                    } catch (batchErr) {
                        console.error(`Batch ${batchCount + 1} failed. Retrying... (${retryCount + 1}/3)`, batchErr);
                        retryCount++;
                        if (retryCount >= 3) {
                            showToast("네트워크 불안정으로 일부 데이터를 건너뜁니다.");
                            break;
                        }
                        await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
                        continue; // Retry same loop iteration
                    }
                }

                console.log(`✅ Recursive Sync Complete: ${totalFetched} new docs merged.`);

                // Final State Update - Always Update Cache because we finished!
                const final = Array.from(unifiedMap.values());
                final.sort((a, b) => (b._ts || 0) - (a._ts || 0));

                state.postCache.set(id, final);
                state.lastSyncMap.set(id, Date.now());

                if (state.activeSessionId === id) {
                    state.allPosts = final;
                    updateUI();

                    if (session.posts && session.posts.length > 0) {
                        db.collection(COLLECTION_NAME).doc(id).update({ posts: firebase.firestore.FieldValue.delete() });
                        session.posts = [];
                    }
                    saveStateToCache();
                    showToast(`모든 데이터 로드 완료! (${final.length}개)`);
                } else {
                    console.log(`🔒 Data for ${id} cached in background. UI not updated (User on ${state.activeSessionId})`);
                }

                state.isSyncing = false;
                updateProgressBar(100, "동기화 완료");
                setTimeout(hideProgressBar, 1000);
                updateUI();

            } catch (err) {
                console.error("Batch sync failed:", err);
                showToast("데이터 로드 일부 실패 (현재까지 로드됨): " + err.message);

                // Even if failed, keep what we have
                state.isSyncing = false;
                updateUI();
            }
        };

        // Execute Step 2
        loadAllBatches();

    } catch (e) {
        console.error("Critical Load Error:", e);
        showToast("데이터 연동 실패");
        updateProgressBar(0, "오류 발생");
        hideProgressBar();
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
        const content = (p.content || '').toLowerCase();
        const date = (p.date || '');
        const matchesSearch = content.includes(q) || date.includes(q);
        const matchesStart = start ? date >= start : true;
        const matchesEnd = end ? date <= end : true;
        return matchesSearch && matchesStart && matchesEnd;
    });

    state.filteredPosts.sort((a, b) => {
        const diff = state.sortOrder === 'desc' ? (b._ts || 0) - (a._ts || 0) : (a._ts || 0) - (b._ts || 0);
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

let lastDateMapHash = "";
function renderDateNavigator() {
    if (!els.dateNavigator) return;

    // Performance Cache: Only re-render if post count or session changed
    const currentHash = `${state.activeSessionId}_${state.allPosts.length}_${els.startDateFilter.value}`;
    if (lastDateMapHash === currentHash) return;
    lastDateMapHash = currentHash;

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
                        <button class="month-btn ${els.startDateFilter.value.startsWith(`${y}-${m}`) ? 'active' : ''}" 
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
    updateProgressBar(0, "파일 분석 시작...");

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            updateProgressBar(10, "데이터 파싱 중...");
            const md = event.target.result;

            // Extract Thread ID from the first line if available
            // Format: "# Threads Posts: @username"
            const firstLineNode = md.split('\n')[0];
            let extractedId = null;
            if (firstLineNode.startsWith('# Threads Posts: @')) {
                extractedId = firstLineNode.replace('# Threads Posts: @', '').trim();
                console.log("Extracted Thread ID:", extractedId);
            }

            const chunks = md.split('---');
            const newPosts = [];

            const hashString = (s) => {
                let h = 0;
                for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
                return Math.abs(h).toString(36);
            };

            chunks.forEach((chunk, i) => {
                // Skip the header chunk if it doesn't contain a date
                let dateMatch = chunk.match(/## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
                let time = '00:00', date = '';
                if (dateMatch) { date = dateMatch[1]; time = dateMatch[2]; }
                else {
                    dateMatch = chunk.match(/## (\d{4}-\d{2}-\d{2})/);
                    if (!dateMatch) return; // Skip chunks without dates (like the header)
                    date = dateMatch[1];
                }

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

            // [CRITICAL FIX] Strict Isolation: If names match but Thread IDs differ, FORCE NEW SESSION.
            if (s && s.threadId && extractedId && s.threadId !== extractedId) {
                console.log(`⚠️ Isolation Enforcement: Name matches '${s.name}' but Thread IDs differ (${s.threadId} vs ${extractedId}). Creating new session.`);
                s = null;
            }

            // [FIX] Fallback: If renamed, try to match by Thread ID
            if (!s && extractedId) {
                // 1. Check Active Session First (For Incremental Updates)
                if (state.activeSessionId) {
                    const active = state.sessions.find(x => x.id === state.activeSessionId);
                    if (active && active.threadId === extractedId) {
                        console.log("⚡ Match: Uploaded file ID matches Active Session ID. Merging...");
                        s = active;
                    }
                }

                // 2. If not active, check other sessions
                if (!s) {
                    const candidates = state.sessions.filter(x => x.threadId === extractedId);
                    if (candidates.length > 0) {
                        s = candidates[0];
                    }
                }
            }

            // [FIX] Fallback: If still no match, but user is looking at a session, Ask?
            // [CHANGED] Disabled to prevent accidental data mixing. Always create new session for new files.
            /*
            if (!s && state.activeSessionId) {
                const active = state.sessions.find(x => x.id === state.activeSessionId);
                if (active && confirm(`기존 세션 '${active.name}'에 데이터를 합치시겠습니까?\n(취소 시 새 세션 생성)`)) {
                    s = active;
                }
            }
            */

            let sId = s ? s.id : db.collection(COLLECTION_NAME).doc().id;

            if (!s) {
                // Set order to be at the top (smaller than current minimum)
                const minOrder = state.sessions.length > 0 ? Math.min(...state.sessions.map(x => x.order || 0)) : 0;
                s = {
                    id: sId,
                    name: sName,
                    categoryId: state.categories[0]?.id || DEFAULT_CAT_ID,
                    order: minOrder - 1,
                    updatedAt: new Date(),
                    threadId: extractedId // Save the extracted ID
                };
                await db.collection(COLLECTION_NAME).doc(sId).set({
                    ...s,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                state.sessions.push(s);
                renderSidebarContent();
            } else if (extractedId) {
                // Update existing session with threadId if missing
                s.threadId = extractedId;
                await db.collection(COLLECTION_NAME).doc(sId).update({ threadId: extractedId });
            }

            // --- DUPLICATE CHECK ---
            let uniquePosts = newPosts;
            if (s) { // If session exists, check for duplicates
                updateProgressBar(20, "중복 검사 중...");
                const existingIds = new Set();

                // Optimized: Check local cache first if available
                if (state.postCache.has(sId)) {
                    state.postCache.get(sId).forEach(p => existingIds.add(p.id));
                    console.log(`Checked ${existingIds.size} posts from cache.`);
                } else {
                    // Fallback: Fetch IDs from server (still faster than writing duplicates)
                    const snapshot = await db.collection(COLLECTION_NAME).doc(sId).collection('posts').get();
                    snapshot.docs.forEach(doc => existingIds.add(doc.id));
                    console.log(`Checked ${existingIds.size} posts from server.`);
                }

                uniquePosts = newPosts.filter(p => !existingIds.has(p.id));
                console.log(`Found ${uniquePosts.length} new posts out of ${newPosts.length}.`);
            }

            if (uniquePosts.length === 0) {
                updateProgressBar(100, "변경사항 없음");
                showToast("모든 포스트가 이미 존재합니다.");
                setTimeout(hideProgressBar, 2000);
                return;
            }
            // -----------------------

            const batchSize = 500;
            const batchChunks = [];
            for (let i = 0; i < uniquePosts.length; i += batchSize) { // Use uniquePosts
                batchChunks.push(uniquePosts.slice(i, i + batchSize));
            }

            let savedCount = 0;
            const CONCURRENCY = 8; // Restoration of parallel power
            for (let i = 0; i < batchChunks.length; i += CONCURRENCY) {
                const group = batchChunks.slice(i, i + CONCURRENCY);
                await Promise.all(group.map(async (chunk) => {
                    try {
                        const batch = db.batch();
                        chunk.forEach(p => {
                            const ref = db.collection(COLLECTION_NAME).doc(sId).collection('posts').doc(p.id);
                            batch.set(ref, p, { merge: true });
                        });
                        await batch.commit();
                        savedCount += chunk.length;
                        const percent = Math.round((savedCount / uniquePosts.length) * 100); // Use uniquePosts length
                        updateProgressBar(percent, "클라우드 저장 중...");
                    } catch (err) {
                        console.error("Batch upload error:", err);
                        // Continue processing other batches, but log this one
                    }
                }));
            }

            await db.collection(COLLECTION_NAME).doc(sId).update({
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            updateProgressBar(100, "완료!");
            showToast("업로드 완료!", 2000);
            hideProgressBar();

            // [OPTIMIZATION] Incremental Update
            // Instead of reloading, directly merge new posts into current view/cache.
            uniquePosts.forEach(p => {
                p._ts = new Date((p.date || '') + (p.time ? 'T' + p.time : '')).getTime() || 0;
            });

            if (state.activeSessionId === sId) {
                console.log("⚡ Incremental Update: Adding posts directly to current view.");
                const currentMap = new Map();
                (state.allPosts || []).forEach(p => currentMap.set(p.id, p));
                uniquePosts.forEach(p => currentMap.set(p.id, p));

                const merged = Array.from(currentMap.values()).sort((a, b) => (b._ts || 0) - (a._ts || 0));

                state.allPosts = merged;
                state.postCache.set(sId, merged);
                state.lastSyncMap.set(sId, Date.now());
                updateUI();
            } else {
                // If switching to a different session, invalidate cache to force fetch of new data
                state.postCache.delete(sId);
                await switchSession(sId);
            }

        } catch (error) {
            console.error("Upload Error:", error);
            console.error("Upload Error:", error);
            showToast("업로드 실패: " + error.message);
            updateProgressBar(0, "오류 발생");
            setTimeout(hideProgressBar, 3000);
        }
    };
    reader.onerror = () => {
        showToast("파일 읽기 오류");
        hideProgressBar();
    };
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
    els.totalPosts.innerHTML = `${state.filteredPosts.length}${state.isSyncing ? ' <span class="sync-spinner">↻</span>' : ''}`;
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

window.editCurrentThreadId = async () => {
    if (!state.activeSessionId) return;

    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (!session) return;

    let currentId = els.displayUsername.textContent.replace('@', '');
    const newId = prompt("수정할 ID를 입력하세요:", currentId);

    if (newId && newId.trim() !== "") {
        const finalId = newId.trim().replace('@', '');

        // Optimistic Update
        session.threadId = finalId;
        localStorage.setItem('threads_sessions', JSON.stringify(state.sessions)); // Immediate Cache Update
        updateHeaderProfile(session);

        try {
            await db.collection(COLLECTION_NAME).doc(state.activeSessionId).update({
                threadId: finalId,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast("ID가 수정되었습니다.");
        } catch (e) {
            console.error("ID update error:", e);
            showToast("ID 수정 실패: 네트워크 오류");
        }
    }
};

window.editCurrentUrl = async () => {
    if (!state.activeSessionId) return;

    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (!session) return;

    let currentUrl = els.displayUrlLink.dataset.fullUrl;
    const newUrl = prompt("수정할 주소를 입력하세요:", currentUrl);

    if (newUrl && newUrl.trim() !== "") {
        const finalUrl = newUrl.trim();

        // Optimistic Update
        session.customUrl = finalUrl;
        localStorage.setItem('threads_sessions', JSON.stringify(state.sessions)); // Immediate Cache Update
        updateHeaderProfile(session);

        try {
            await db.collection(COLLECTION_NAME).doc(state.activeSessionId).update({
                customUrl: finalUrl,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast("주소가 수정되었습니다.");
        } catch (e) {
            console.error("URL update error:", e);
            showToast("주소 수정 실패: 네트워크 오류");
        }
    }
};

window.copyContent = (id) => {
    const p = state.allPosts.find(x => x.id === id);
    if (p) { navigator.clipboard.writeText(p.content); showToast('복사됨'); }
};

function autoSelectFirstSession() { if (state.sessions.length > 0) switchSession(state.sessions[0].id); }

function updateHeaderProfile(session) { // Changed to accept session object
    if (!session || !els.profilePanel) return;

    let displayId = session.threadId; // Prefer explicitly saved ID

    if (!displayId) {
        // Fallback: Heuristic from name
        displayId = session.name.replace(/_threads$/i, '').replace(/_part\d+$/i, '').replace(/\.md$/i, '').trim();
    }

    if (displayId || session.customUrl) {
        els.profilePanel.style.display = 'flex';
        els.displayUsername.textContent = displayId ? '@' + displayId : 'Unknown';

        let url = session.customUrl || `https://www.threads.net/@${displayId}`;
        els.displayUrlLink.textContent = url.replace(/https?:\/\//, '');
        els.displayUrlLink.href = url;
        els.displayUrlLink.dataset.fullUrl = url;
    } else {
        els.profilePanel.style.display = 'none';
    }
}

window.exportData = () => {
    try {
        const backup = {
            timestamp: new Date().toISOString(),
            version: "1.0",
            activeSessionId: state.activeSessionId,
            categories: state.categories,
            sessions: state.sessions,
            // Include currently active posts
            activeSessionPosts: state.allPosts,
            // Dump memory cache
            cachedSessions: {}
        };

        // Serialize Map to Object for JSON
        state.postCache.forEach((posts, id) => {
            backup.cachedSessions[id] = posts;
        });

        const dataStr = JSON.stringify(backup, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        a.download = `threads_backup_${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast("데이터 백업 파일이 다운로드되었습니다.");
    } catch (e) {
        console.error("Backup failed:", e);
        showToast("백업 생성 중 오류가 발생했습니다.");
    }
};

window.importData = async (input) => {
    const file = input.files[0];
    if (!file) return;

    if (!confirm("⚠️ 경고: 현재 데이터가 백업 파일의 내용으로 '모두' 덮어쓰여집니다.\n계속하시겠습니까?")) {
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.version || !data.sessions) throw new Error("유효하지 않은 백업 파일입니다.");

            updateProgressBar(10, "데이터 복원 시작...");

            // 1. Clear current state locally
            state.categories = [];
            state.sessions = [];
            state.allPosts = [];
            state.postCache.clear();

            // 2. Restore Collections (Blind Overwrite - Careful!)
            // Ideally we should delete current collections, but for now we merge/overwrite

            updateProgressBar(30, "카테고리 복원 중...");
            const catBatch = db.batch();
            data.categories.forEach(c => {
                catBatch.set(db.collection(CATEGORY_COLLECTION).doc(c.id), c);
            });
            await catBatch.commit();
            state.categories = data.categories;

            updateProgressBar(50, "세션 복원 중...");
            // Sessions & Posts restoration is complex due to subcollections.
            // For this 'Light' version, we restore Metadata and rely on Lazy Loading or Cache if possible.
            // We cannot easily delete ALL existing posts in Firestore without recursive delete.
            // So we focus on ensuring 'sessions' list is correct.

            const sessBatch = db.batch();
            data.sessions.forEach(s => {
                const sRef = db.collection(COLLECTION_NAME).doc(s.id);
                // We keep existing posts in subcollection, just update metadata
                sessBatch.set(sRef, s, { merge: true });
            });
            await sessBatch.commit();
            state.sessions = data.sessions;

            // 3. Restore Memory Cache (Critical for Hot Start)
            if (data.cachedSessions) {
                Object.keys(data.cachedSessions).forEach(sid => {
                    const posts = data.cachedSessions[sid];
                    // Re-instantiate Dates
                    const rev = posts.map(p => ({
                        ...p,
                        // Ensure timestamp exists
                        _ts: p._ts || new Date((p.date || '') + (p.time ? 'T' + p.time : '')).getTime() || 0
                    }));
                    state.postCache.set(sid, rev);
                });
            }

            // 4. Update LocalStorage
            localStorage.setItem('threads_categories', JSON.stringify(state.categories));
            localStorage.setItem('threads_sessions', JSON.stringify(state.sessions));
            updateProgressBar(90, "마무리 중...");

            // 5. Restore View
            if (data.activeSessionId && state.sessions.find(s => s.id === data.activeSessionId)) {
                await switchSession(data.activeSessionId);
            } else {
                renderSidebarContent();
                autoSelectFirstSession();
            }

            updateProgressBar(100, "복원 완료!");
            showToast("데이터가 성공적으로 복원되었습니다.");
            setTimeout(hideProgressBar, 2000);

        } catch (err) {
            console.error("Import Error:", err);
            showToast("복원 실패: " + err.message);
            updateProgressBar(0, "오류 발생");
            hideProgressBar();
        }
    };
    reader.onerror = () => showToast("파일 읽기 실패");
    reader.readAsText(file);
    input.value = '';
};

window.copyHeaderId = () => {
    const txt = els.displayUsername.textContent.replace('@', '');
    if (txt) { navigator.clipboard.writeText(txt); showToast('아이디 복사됨'); }
};

window.copyHeaderUrl = () => {
    const url = els.displayUrlLink.dataset.fullUrl;
    if (url) { navigator.clipboard.writeText(url); showToast('주소 복사됨'); }
};

function updateProgressBar(percent, text) {
    if (!els.progressContainer) return;
    els.progressContainer.style.display = 'block';

    requestAnimationFrame(() => {
        els.progressBar.style.width = `${percent}%`;
        els.progressPercent.textContent = `${percent}%`;
        if (text) els.progressLabel.textContent = text;
    });
}

function hideProgressBar() {
    if (!els.progressContainer) return;
    setTimeout(() => {
        els.progressContainer.style.display = 'none';
        els.progressBar.style.width = '0%';
        els.progressPercent.textContent = '0%';
    }, 2000);
}

init();
