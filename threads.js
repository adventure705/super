// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDdk_axp2Q9OANqleknWeYWK9DrxKWKeY4",
    authDomain: "template-3530f.firebaseapp.com",
    projectId: "template-3530f",
    storageBucket: "template-3530f.firebasestorage.app",
    messagingSenderId: "891098188622",
    appId: "1:891098188622:web:392c0121a17f1cd4402c1f"
};

// Initialize Firebase (Synchronous to prevent undefined 'db')
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// Enable Persistence
try {
    db.enablePersistence({ synchronizeTabs: true })
        .catch((err) => {
            if (err.code == 'failed-precondition') {
                console.warn("Persistence failed: Multiple tabs open");
            } else if (err.code == 'unimplemented') {
                console.warn("Persistence failed: Browser not supported");
            }
        });
} catch (err) {
    console.warn("Persistence configuration error:", err);
}

const COLLECTION_NAME = 'threads_sessions';
const CATEGORY_COLLECTION = 'threads_categories';
const DEFAULT_CAT_ID = 'uncategorized_default';

const state = {
    allPosts: [],
    filteredPosts: [],
    sessions: [],
    categories: [],
    activeSessionId: null,
    sortOrder: 'desc',
    visiblePosts: 20, // Number of posts to show initially
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

// --- Initialization ---
async function init() {
    // Auth for persistent access
    try {
        const userCredential = await firebase.auth().signInAnonymously();
        console.log("Firebase Authenticated - UserID:", userCredential.user.uid);

        // Show subtle debug info if needed
        console.info(`Connected to Project: ${firebaseConfig.projectId}`);

        showToast("데이터 동기화 활성화됨", 2000);
        updateSyncStatus(true);
    } catch (e) {
        console.error("Firebase Auth Error:", e);
        showToast("인증 실패: 데이터 연동이 제한될 수 있습니다.");
        updateSyncStatus(false);
    }

    // Monitor online/offline status
    db.doc('.info/connected').onSnapshot((snapshot) => {
        const isConnected = snapshot.data() ? snapshot.data().connected : true; // Fallback for Firestore info path
        // Note: Firestore doesn't have .info/connected like RTDB, 
        // using a manual check for snapshot sources instead.
    });

    // Better way to monitor Firestore connectivity:
    db.collection(COLLECTION_NAME).limit(1).onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
        const isFromCache = snapshot.metadata.fromCache;
        updateSyncStatus(!isFromCache);
    });

    els.uploadBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', handleFileUpload);
    els.searchInput.addEventListener('input', updateUI);
    els.startDateFilter.addEventListener('change', updateUI);
    els.endDateFilter.addEventListener('change', updateUI);
    els.resetFilters.addEventListener('click', resetFilters);
    els.sortToggle.addEventListener('click', toggleSort);

    // Mobile Menu
    els.mobileMenuToggle.addEventListener('click', () => toggleSidebar(true));
    els.sidebarOverlay.addEventListener('click', () => toggleSidebar(false));
    els.addCategoryBtn.addEventListener('click', addNewCategory);

    // Modal Events
    els.closeModal.onclick = closeModal;
    els.imageModal.onclick = (e) => {
        if (e.target === els.imageModal) closeModal();
    };
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && els.imageModal.style.display === 'flex') {
            closeModal();
        }
    });

    // Initial Load from Firestore
    await Promise.all([
        loadCategoriesFromFirestore(),
        loadSessionsFromFirestore()
    ]);

    // Initial session selection is handled within loadSessionsFromFirestore to accommodate real-time sync

    // Infinite Scroll Event
    els.contentView.addEventListener('scroll', handleScroll);
}

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
            renderPosts(true); // true means append mode
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
    // Sort Categories
    new Sortable(els.sidebarContent, {
        animation: 150,
        handle: '.category-header',
        ghostClass: 'sortable-ghost',
        onEnd: async () => {
            const categoryOrder = Array.from(els.sidebarContent.querySelectorAll('.category-section'))
                .map(el => el.dataset.id);

            const batch = db.batch();
            categoryOrder.forEach((id, index) => {
                const ref = db.collection(CATEGORY_COLLECTION).doc(id);
                batch.update(ref, { order: index });
                // Update local state
                const cat = state.categories.find(c => c.id === id);
                if (cat) cat.order = index;
            });
            await batch.commit();
            state.categories.sort((a, b) => a.order - b.order);
        }
    });

    // Sort Sessions within and across categories
    document.querySelectorAll('.session-list').forEach(listEl => {
        new Sortable(listEl, {
            group: 'sessions',
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            onEnd: async (evt) => {
                const sessionId = evt.item.dataset.id;
                const newCategoryId = evt.to.dataset.categoryId;

                // Get all sessions in the new category to update order
                const sessionEls = Array.from(evt.to.querySelectorAll('li'));
                const batch = db.batch();

                sessionEls.forEach((el, index) => {
                    const sid = el.dataset.id;
                    const ref = db.collection(COLLECTION_NAME).doc(sid);
                    const updateData = { order: index };
                    if (sid === sessionId) {
                        updateData.categoryId = newCategoryId;
                        // Update local state
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

            const hasDefault = state.categories.some(c => c.id === DEFAULT_CAT_ID);

            // Only create default category if we are 100% sure the server is empty
            if (state.categories.length === 0 && !snapshot.metadata.fromCache) {
                addNewCategoryUI('미분류', DEFAULT_CAT_ID);
            }

            renderSidebarContent();
            resolve();
        }, (e) => {
            console.error("Categories Sync Error:", e);
            if (e.code === 'permission-denied') {
                showToast("권한 오류: Firebase Rules에서 읽기 권한을 확인해주세요.");
            }
            resolve();
        });
    });
}

function updateSyncStatus(isSynced) {
    const logoIcon = document.querySelector('.logo-icon');
    if (logoIcon) {
        logoIcon.style.boxShadow = isSynced ? '0 0 10px #4caf50' : '0 0 10px #f44336';
        logoIcon.style.transition = 'box-shadow 0.3s ease';
        logoIcon.title = isSynced ? '동기화 완료 (서버 연결됨)' : '동기화 대기 중 (오프라인/로컬 캐시)';
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
    const category = {
        name: name,
        order: state.categories.length
    };
    await db.collection(CATEGORY_COLLECTION).doc(id).set(category, { merge: true });

    // Check if already in state to avoid dupes
    if (!state.categories.find(c => c.id === id)) {
        state.categories.push({ id, ...category });
    }
}

window.renameCategory = async (id) => {
    const category = state.categories.find(c => c.id === id);
    if (!category) return;
    const newName = prompt('새 이름을 입력하세요:', category.name);
    if (newName && newName.trim()) {
        category.name = newName.trim();
        await db.collection(CATEGORY_COLLECTION).doc(id).update({ name: category.name });
        renderSidebarContent();
        showToast('카테고리 이름이 변경되었습니다.');
    }
};

window.deleteCategory = async (id) => {
    const sessCount = state.sessions.filter(s => s.categoryId === id).length;
    if (sessCount > 0) {
        alert('이 카테고리에 포함된 세션이 있습니다. 세션을 이동시킨 후 삭제해주세요.');
        return;
    }
    if (!confirm('이 카테고리를 삭제하시겠습니까?')) return;
    await db.collection(CATEGORY_COLLECTION).doc(id).delete();
    state.categories = state.categories.filter(c => c.id !== id);
    renderSidebarContent();
    showToast('삭제되었습니다.');
};

// --- Firestore Data Handling ---
async function loadSessionsFromFirestore() {
    return new Promise((resolve) => {
        db.collection(COLLECTION_NAME).onSnapshot((snapshot) => {
            state.sessions = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            state.sessions.sort((a, b) => (a.order || 0) - (b.order || 0));

            renderSidebarContent();

            // Auto-select first session if none active (useful for cross-device loading)
            if (!state.activeSessionId && state.sessions.length > 0) {
                autoSelectFirstSession();
            }

            resolve();
        }, (e) => {
            console.error("Sessions Sync Error:", e);
            if (e.code === 'permission-denied') {
                showToast("권한 오류: 타 기기의 데이터를 불러올 권한이 없습니다.");
            } else {
                showToast("데이터 동기화 오류.");
            }
            resolve();
        });
    });
}

async function saveSessionToFirestore(session) {
    try {
        const { id, ...data } = session;
        await db.collection(COLLECTION_NAME).doc(id).set({
            ...data,
            refName: data.refName || data.name, // Ensure refName exists
            categoryId: data.categoryId || (state.categories[0] ? state.categories[0].id : 'default'),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.error("Firestore Save Error:", e);
        showToast("데이터 저장에 실패했습니다.");
    }
}

function renderSidebarContent() {
    if (state.categories.length === 0) {
        els.sidebarContent.innerHTML = `<div class="empty-lib">라이브러리가 비어있습니다</div>`;
        return;
    }

    const categoryHtml = state.categories.map(category => {
        const catSessions = state.sessions.filter(s => s.categoryId === category.id)
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        return `
            <div class="category-section" data-id="${category.id}">
                <div class="category-header">
                    <span class="category-title">${category.name}</span>
                    <div class="category-actions" onclick="event.stopPropagation()">
                        <button class="action-btn" onclick="renameCategory('${category.id}')" title="이름 변경">✎</button>
                        <button class="action-btn delete" onclick="deleteCategory('${category.id}')" title="삭제">✕</button>
                    </div>
                </div>
                <ul class="session-list" data-category-id="${category.id}">
                    ${catSessions.map(session => `
                        <li class="${state.activeSessionId === session.id ? 'active' : ''}" 
                            data-id="${session.id}"
                            onclick="switchSession('${session.id}')">
                            <span class="drag-handle">☰</span>
                            <span class="session-name" title="${session.name}">${session.name}</span>
                            <div class="session-actions" onclick="event.stopPropagation()">
                                <button class="action-btn" onclick="renameSession('${session.id}')" title="이름 변경">✎</button>
                                <button class="action-btn delete" onclick="deleteSession('${session.id}')" title="삭제">✕</button>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }).join('');

    // Handle sessions without a valid category (Safety Net)
    const categoryIds = state.categories.map(c => c.id);
    const uncategorizedSessions = state.sessions.filter(s => !s.categoryId || !categoryIds.includes(s.categoryId))
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    let uncategorizedHtml = '';
    if (uncategorizedSessions.length > 0) {
        uncategorizedHtml = `
            <div class="category-section" data-id="uncategorized">
                <div class="category-header">
                    <span class="category-title">미분류 세션</span>
                </div>
                <ul class="session-list" data-category-id="default">
                    ${uncategorizedSessions.map(session => `
                        <li class="${state.activeSessionId === session.id ? 'active' : ''}" 
                            data-id="${session.id}"
                            onclick="switchSession('${session.id}')">
                            <span class="drag-handle">☰</span>
                            <span class="session-name" title="${session.name}">${session.name}</span>
                            <div class="session-actions" onclick="event.stopPropagation()">
                                <button class="action-btn" onclick="renameSession('${session.id}')" title="이름 변경">✎</button>
                                <button class="action-btn delete" onclick="deleteSession('${session.id}')" title="삭제">✕</button>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    els.sidebarContent.innerHTML = categoryHtml + uncategorizedHtml;
    initSortable();
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
    e.target.value = ''; // Reset to allow re-uploading the same file
}

async function parseAndSyncMarkdown(md, filename) {
    try {
        // Efficient Parsing
        showToast("파일 분석 중...", 0, 0);
        const chunks = md.split('---');
        const newPosts = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            try {
                let dateMatch = chunk.match(/## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
                let time = '00:00';
                let date = '';

                if (dateMatch) {
                    date = dateMatch[1];
                    time = dateMatch[2];
                } else {
                    dateMatch = chunk.match(/## (\d{4}-\d{2}-\d{2})/);
                    if (!dateMatch) continue;
                    date = dateMatch[1];
                }

                const imageRegex = /!\[[\s\S]*?\]\((https?:\/\/[^\)]+)\)/g;
                let images = [];
                let m;
                if (chunk.length < 100000) {
                    while ((m = imageRegex.exec(chunk)) !== null) {
                        images.push(m[1].trim());
                    }
                }

                let content = chunk
                    .replace(/## \d{4}-\d{2}-\d{2}( \d{2}:\d{2})?/, '')
                    .replace(/!\[[\s\S]*?\]\(.*?\)/g, '')
                    .replace(/^\//gm, '')
                    .trim();

                if (content || images.length > 0) {
                    const contentKey = content.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '');
                    const uniqueKey = `${date}_${images.length}_${content.length}_${contentKey}`;

                    newPosts.push({
                        id: uniqueKey,
                        date,
                        time,
                        index: i,
                        content,
                        images
                    });
                }
            } catch (chunkErr) {
                console.warn("Skipping chunk:", chunkErr);
            }
        }

        const statsMsg = `분석 완료: 총 ${newPosts.length}개의 포스트를 발견했습니다.`;
        console.log(statsMsg);
        showToast(statsMsg, 3000);

        showToast("업로드 준비 중...", 0, 0);

        // Regex to safely identify session name from parts
        // e.g. "MyThread_part1", "MyThread (2)", "MyThread 1" -> "MyThread"
        const sessionRefName = filename
            .replace('.md', '')
            .replace(/_part\d+$/, '')
            .replace(/\s*\(\d+\)$/, '')
            .replace(/\s+\d+$/, ''); // specific handle for "Name 1" pattern if needed

        let session = state.sessions.find(s => (s.refName === sessionRefName) || (s.name === sessionRefName));
        let sessionId;
        let isNewSession = false;

        if (session) {
            sessionId = session.id;
            showToast(`'${session.name}'에 병합 중...`, 0, 0);
        } else {
            sessionId = db.collection(COLLECTION_NAME).doc().id;
            session = {
                id: sessionId,
                name: sessionRefName,
                refName: sessionRefName,
                order: state.sessions.length > 0 ? Math.min(...state.sessions.map(s => s.order || 0)) - 1 : 0, // Truly put at the top
                categoryId: state.categories.length > 0 ? state.categories[0].id : DEFAULT_CAT_ID,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // 1. Optimistic UI Update (Instant Feedback)
            state.sessions.unshift({ ...session, posts: [] });
            isNewSession = true;
            renderSidebarContent();

            // 2. IMMEDIATE STRATEGY (User Request: "Upload First")
            // Replaced Blocking Save with "Include in Batch 1" strategy.
            // This eliminates the initial wait time.  
        }

        // --- 4. UPLOAD STRATEGY (Turbo Parallel) ---
        const batchSize = 500;
        const chunks_posts = [];
        for (let i = 0; i < newPosts.length; i += batchSize) {
            chunks_posts.push(newPosts.slice(i, i + batchSize));
        }

        let savedCount = 0;
        const totalToSave = newPosts.length;

        if (totalToSave === 0) {
            alert("저장할 포스트가 없습니다.");
            return;
        }

        // --- SESSION INITIALIZATION ---
        resetFilters();
        if (isNewSession) {
            state.activeSessionId = sessionId;
            state.allPosts = [];
            // NEW session? Create it FIRST and wait for success.
            try {
                const sessionToSave = {
                    ...session,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await db.collection(COLLECTION_NAME).doc(sessionId).set(sessionToSave);
                console.log("Session document created successfully.");

                // Ensure local state.sessions includes this new session (not just the optimistic push)
                if (!state.sessions.find(s => s.id === sessionId)) {
                    state.sessions.unshift({ ...session, posts: [] });
                }
            } catch (e) {
                console.error("Session creation failed:", e);
                showToast("세션 생성 실패!", 3000);
                throw e; // Stop if session can't be created
            }
        } else {
            // Merging? Load existing posts first
            if (state.activeSessionId !== sessionId) {
                await switchSession(sessionId);
            }
        }

        renderSidebarContent();
        renderDateNavigator();
        updateUI();

        showToast(`업로드 시작... (총 ${totalToSave}개)`, 0, 0);

        // --- PARALLEL UPLOAD ENHANCEMENT ---
        // We use a concurrency limit of 5 to avoid Firestore rate limits while maintaining high speed.
        const CONCURRENCY = 8;
        const uploadBatches = async () => {
            const groups = [];
            for (let i = 0; i < chunks_posts.length; i += CONCURRENCY) {
                groups.push(chunks_posts.slice(i, i + CONCURRENCY));
            }

            for (const group of groups) {
                await Promise.all(group.map(async (chunk, groupIdx) => {
                    const batch = db.batch();
                    chunk.forEach(post => {
                        const safeId = post.id.replace(/\//g, '_').replace(/\./g, '_');
                        const ref = db.collection(COLLECTION_NAME).doc(sessionId).collection('posts').doc(safeId);
                        batch.set(ref, post, { merge: true });
                    });

                    let success = false;
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            await batch.commit();
                            success = true;
                            break;
                        } catch (e) {
                            console.warn(`[Batch] Attempt ${attempt} failed:`, e);
                            await new Promise(r => setTimeout(r, 1000 * attempt));
                        }
                    }

                    if (success) {
                        savedCount += chunk.length;
                        state.allPosts.push(...chunk);
                        showToast(`업로드 중... ${Math.round((savedCount / totalToSave) * 100)}% (${savedCount}/${totalToSave})`, 0, Math.round((savedCount / totalToSave) * 100));
                    } else {
                        throw new Error("일부 데이터 전송에 실패했습니다.");
                    }
                }));

                // UI PERFORMANCE: Periodic refresh to show progress in sidebar/feed
                renderDateNavigator();
            }
        };

        try {
            await uploadBatches();
        } catch (err) {
            alert(`업로드 중 오류 발생: ${err.message}`);
        }

        // Finalize Session
        await db.collection(COLLECTION_NAME).doc(sessionId).update({
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // No need to manually re-fetch, onSnapshot handles it!

        showToast(`업로드 완료! 총 ${savedCount}개의 포스트가 저장되었습니다.`, 5000, 100);
        await switchSession(sessionId);
        renderSidebarContent();

    } catch (e) {
        console.error("Process Error:", e);
        showToast("작업 실패!", 0);
        alert(`처리 중 오류가 발생했습니다: ${e.message}`);
    }
}

// --- App Functions ---
window.switchSession = async (id) => {
    state.activeSessionId = id;
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;

    showToast("데이터를 불러오는 중...", 0, 50);

    // Load from subcollection
    try {
        const postsSnapshot = await db.collection(COLLECTION_NAME).doc(id).collection('posts').get();
        let subcollectionPosts = postsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Restore backward compatibility for old sessions stored in array
        let legacyPosts = session.posts || [];

        // Merge legacy and new posts (new posts take precedence if ID matches)
        const allPostsMap = new Map();

        // Add legacy posts first
        legacyPosts.forEach(p => {
            const key = p.id || `${p.date}_${p.content.substring(0, 30)}`;
            allPostsMap.set(key, p);
        });

        // Overwrite/Add subcollection posts
        subcollectionPosts.forEach(p => {
            allPostsMap.set(p.id, p);
        });

        state.allPosts = Array.from(allPostsMap.values());

        // Initial Sort (Default Descending for Latest First)
        state.sortOrder = 'desc';
        updateSortUI();

        // Mobile UI handle
        if (window.innerWidth <= 1024) toggleSidebar(false);

    } catch (e) {
        console.error("Load Posts Error:", e);
        showToast("포스트 로딩 실패");
        state.allPosts = session.posts || []; // Fallback
    }

    renderDateNavigator();
    updateUI();
    renderSidebarContent();
    showToast("로딩 완료!", 1000);
};

window.renameSession = async (id) => {
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;
    const newName = prompt('새 이름을 입력하세요:', session.name);
    if (newName && newName.trim()) {
        session.name = newName.trim();
        await saveSessionToFirestore(session);
        renderSidebarContent();
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
        renderSidebarContent();
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
        // Priority 1: Date & Time (Overall Chronology)
        const dateA = new Date(a.date + (a.time ? 'T' + a.time : ''));
        const dateB = new Date(b.date + (b.time ? 'T' + b.time : ''));

        if (dateA - dateB !== 0) {
            return state.sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        }

        // Priority 2: Original MD Order (Tie-breaker for same date/time)
        // User requested: "Within same date, follow MD order"
        return (a.index || 0) - (b.index || 0);
    });

    state.visiblePosts = 20; // Reset pagination
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

function renderPosts(append = false) {
    if (state.allPosts.length === 0 && state.sessions.length > 0) {
        els.postsFeed.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><h2>라이브러리에서 파일을 선택해주세요</h2></div>`;
        return;
    }
    if (state.filteredPosts.length === 0) {
        els.postsFeed.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><h2>검색 결과가 없습니다</h2></div>`;
        return;
    }

    const postsToShow = state.filteredPosts.slice(0, state.visiblePosts);

    // To minimize DOM updates, only append if we're loading more
    if (append) {
        const currentCount = els.postsFeed.querySelectorAll('.post-card').length;
        const newPosts = state.filteredPosts.slice(currentCount, state.visiblePosts);

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newPosts.map((post, idx) => renderPostCard(post, currentCount + idx)).join('');

        while (tempDiv.firstChild) {
            els.postsFeed.appendChild(tempDiv.firstChild);
        }
    } else {
        els.postsFeed.innerHTML = postsToShow.map((post, idx) => renderPostCard(post, idx)).join('');
    }
}

function renderPostCard(post, idx) {
    return `
        <article class="post-card" style="animation-delay: ${idx % 20 * 0.01}s">
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
        const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(img)}&w=800&q=80`;
        return `<img src="${proxyUrl}" alt="Post image" loading="lazy" 
                                            onerror="this.onerror=null; this.src='https://via.placeholder.com/400x300?text=이미지+로드+실패';"
                                            onclick="openModal('${proxyUrl}')">`;
    }).join('')}
                </div>
            ` : ''}
        </article>
    `;
}

function updateStats() {
    els.totalPosts.textContent = state.filteredPosts.length.toLocaleString();
    const imgCount = state.filteredPosts.reduce((acc, p) => acc + (p.images ? p.images.length : 0), 0);
    els.totalImages.textContent = imgCount.toLocaleString();
}

function highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark style="background: rgba(59, 130, 246, 0.4); color: white; border-radius: 2px;">$1</mark>');
}

// --- Modal Functions ---
function openModal(proxyUrl) {
    // Already proxied URL passed for instant view if already loaded in feed
    els.modalImg.src = proxyUrl;

    // Safety check for image loading
    els.modalImg.onerror = () => {
        els.modalImg.src = `https://via.placeholder.com/800x600?text=이미지를+불러올+수+없습니다`;
    };

    els.imageModal.style.display = 'flex';
    setTimeout(() => {
        els.imageModal.classList.add('show');
    }, 10);
    document.body.style.overflow = 'hidden'; // Prevent scroll
}

function closeModal() {
    els.imageModal.classList.remove('show');
    setTimeout(() => {
        els.imageModal.style.display = 'none';
    }, 300);
    document.body.style.overflow = 'auto'; // Restore scroll
}

let toastTimeout;
function showToast(msg, duration = 3000, progress = null) {
    if (toastTimeout) clearTimeout(toastTimeout);

    // Ensure structure exists
    let textInfo = els.toast.querySelector('.toast-text');
    let progressBar = els.toast.querySelector('.toast-progress-bar');
    let progressFill = els.toast.querySelector('.toast-progress-fill');

    if (!textInfo) {
        els.toast.innerHTML = '<span class="toast-text"></span><div class="toast-progress-bar"><div class="toast-progress-fill"></div></div>';
        textInfo = els.toast.querySelector('.toast-text');
        progressBar = els.toast.querySelector('.toast-progress-bar');
        progressFill = els.toast.querySelector('.toast-progress-fill');
    }

    textInfo.textContent = msg;

    if (progress !== null) {
        progressBar.style.display = 'block';
        setTimeout(() => {
            progressFill.style.width = `${progress}%`;
        }, 10);
    } else {
        progressBar.style.display = 'none';
        progressFill.style.width = '0%';
    }

    els.toast.classList.add('show');

    if (duration > 0) {
        toastTimeout = setTimeout(() => els.toast.classList.remove('show'), duration);
    }
}

window.copyContent = (id) => {
    const post = state.allPosts.find(p => p.id === id);
    if (post) {
        navigator.clipboard.writeText(post.content);
        showToast('내용이 복사되었습니다!');
    }
};

init();
