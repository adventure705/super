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

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDdk_axp2Q9OANqleknWeYWK9DrxKWKeY4",
    authDomain: "template-3530f.firebaseapp.com",
    projectId: "template-3530f",
    storageBucket: "template-3530f.firebasestorage.app",
    messagingSenderId: "891098188622",
    appId: "1:891098188622:web:392c0121a17f1cd4402c1f"
};

// UI Elements (Initialized in init for DOM safety)
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

        // persistence disabled for real-time sync across devices
        console.log("Threads Analyzer: Real-time Sync Mode Active");

        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                console.log("Firebase Authenticated:", user.uid);
                showToast("서버 실시간 연동 중...", 1000);
                updateSyncStatus(true);

                await Promise.all([
                    loadCategoriesFromFirestore(),
                    loadSessionsFromFirestore()
                ]);
            } else {
                await firebase.auth().signInAnonymously();
            }
        });

        // Connection monitor
        db.collection(COLLECTION_NAME).limit(1).onSnapshot({ includeMetadataChanges: true }, (snap) => {
            updateSyncStatus(!snap.metadata.fromCache);
        }, (err) => {
            updateSyncStatus(false);
        });

    } catch (e) {
        console.error("Firebase Init Error:", e);
        showToast("초기화 실패: " + e.message);
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
        if (e.key === 'Escape' && els.imageModal && els.imageModal.style.display === 'flex') closeModal();
    });

    if (els.contentView) els.contentView.addEventListener('scroll', handleScroll);
}

// --- App Controls ---
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
            const categoryOrder = Array.from(els.sidebarContent.querySelectorAll('.category-section')).map(el => el.dataset.id);
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

            if (state.categories.length === 0 && !snapshot.metadata.fromCache) {
                addNewCategoryUI('미분류', DEFAULT_CAT_ID);
            }

            renderSidebarContent();
            resolve();
        }, (e) => {
            console.error("Categories Sync Error:", e);
            resolve();
        });
    });
}

function updateSyncStatus(isSynced) {
    const logoIcon = document.querySelector('.logo-icon');
    if (logoIcon) {
        logoIcon.style.boxShadow = isSynced ? '0 0 10px #4caf50' : '0 0 10px #f44336';
        logoIcon.style.transition = 'box-shadow 0.3s ease';
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
    const newName = prompt('새 이름을 입력하세요:', category.name);
    if (newName && newName.trim()) {
        category.name = newName.trim();
        await db.collection(CATEGORY_COLLECTION).doc(id).update({ name: category.name });
        renderSidebarContent();
    }
};

window.deleteCategory = async (id) => {
    const sessCount = state.sessions.filter(s => s.categoryId === id).length;
    if (sessCount > 0) return alert('카테고리가 비어있지 않습니다.');
    if (!confirm('삭제하시겠습니까?')) return;
    await db.collection(CATEGORY_COLLECTION).doc(id).delete();
    state.categories = state.categories.filter(c => c.id !== id);
    renderSidebarContent();
};

// --- Firestore Data Handling ---
async function loadSessionsFromFirestore() {
    return new Promise((resolve) => {
        db.collection(COLLECTION_NAME).onSnapshot((snapshot) => {
            state.sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            state.sessions.sort((a, b) => (a.order || 0) - (b.order || 0));
            renderSidebarContent();
            if (!state.activeSessionId && state.sessions.length > 0) autoSelectFirstSession();
            resolve();
        }, (e) => {
            console.error("Sessions Sync Error:", e);
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
    if (state.categories.length === 0) {
        els.sidebarContent.innerHTML = `<div class="empty-lib">데이터가 없습니다</div>`;
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
                        <button class="action-btn" onclick="renameCategory('${category.id}')">✎</button>
                        <button class="action-btn delete" onclick="deleteCategory('${category.id}')">✕</button>
                    </div>
                </div>
                <ul class="session-list" data-category-id="${category.id}">
                    ${catSessions.map(session => `
                        <li class="${state.activeSessionId === session.id ? 'active' : ''}" data-id="${session.id}" onclick="switchSession('${session.id}')">
                            <span class="drag-handle">☰</span>
                            <span class="session-name">${session.name}</span>
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

    const uncategorizedSessions = state.sessions.filter(s => !s.categoryId || !state.categories.some(c => c.id === s.categoryId));
    let uncategorizedHtml = '';
    if (uncategorizedSessions.length > 0) {
        uncategorizedHtml = `
            <div class="category-section" data-id="uncategorized">
                <div class="category-header"><span class="category-title">미분류</span></div>
                <ul class="session-list" data-category-id="default">
                    ${uncategorizedSessions.map(session => `
                        <li class="${state.activeSessionId === session.id ? 'active' : ''}" data-id="${session.id}" onclick="switchSession('${session.id}')">
                            <span class="drag-handle">☰</span><span class="session-name">${session.name}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    els.sidebarContent.innerHTML = categoryHtml + uncategorizedHtml;
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
            let images = [];
            const m_images = chunk.match(/!\[[\s\S]*?\]\((https?:\/\/[^\)]+)\)/g);
            if (m_images) m_images.forEach(imgLink => images.push(imgLink.match(/\((.*?)\)/)[1]));
            let content = chunk.replace(/## \d{4}-\d{2}-\d{2}( \d{2}:\d{2})?/, '').replace(/!\[[\s\S]*?\]\(.*?\)/g, '').trim();
            if (content || images.length > 0) newPosts.push({ id: `${date}_${i}`, date, time, index: i, content, images });
        });

        const sessionRefName = filename.replace('.md', '').replace(/_part\d+$/, '');
        let session = state.sessions.find(s => s.name === sessionRefName);
        let sessionId = session ? session.id : db.collection(COLLECTION_NAME).doc().id;

        if (!session) {
            session = { id: sessionId, name: sessionRefName, categoryId: state.categories[0]?.id || DEFAULT_CAT_ID, order: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
            await db.collection(COLLECTION_NAME).doc(sessionId).set(session);
        }

        const batchSize = 500;
        let savedCount = 0;
        for (let i = 0; i < newPosts.length; i += batchSize) {
            const batch = db.batch();
            newPosts.slice(i, i + batchSize).forEach(p => {
                const ref = db.collection(COLLECTION_NAME).doc(sessionId).collection('posts').doc(p.id.replace(/\//g, '_'));
                batch.set(ref, p, { merge: true });
            });
            await batch.commit();
            savedCount += Math.min(batchSize, newPosts.length - i);
            showToast(`업로드 중... ${Math.round((savedCount / newPosts.length) * 100)}%`);
        }
        showToast("업로드 완료");
        await switchSession(sessionId);
    } catch (e) { console.error(e); showToast("오류 발생"); }
}

window.refreshSidebar = async () => {
    showToast("새로고침 중...", 1000);
    await Promise.all([loadCategoriesFromFirestore(), loadSessionsFromFirestore()]);
};

window.switchSession = async (id) => {
    if (postsUnsubscribe) postsUnsubscribe();
    state.activeSessionId = id;
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;
    postsUnsubscribe = db.collection(COLLECTION_NAME).doc(id).collection('posts').onSnapshot(snap => {
        state.allPosts = snap.docs.map(doc => doc.data());
        renderDateNavigator();
        updateUI();
    });
    if (window.innerWidth <= 1024) toggleSidebar(false);
    renderSidebarContent();
};

window.renameSession = async (id) => {
    const s = state.sessions.find(x => x.id === id);
    const n = prompt('이름:', s.name);
    if (n) { s.name = n; await db.collection(COLLECTION_NAME).doc(id).update({ name: n }); renderSidebarContent(); }
};

window.deleteSession = async (id) => {
    if (confirm('삭제?')) { await db.collection(COLLECTION_NAME).doc(id).delete(); state.sessions = state.sessions.filter(s => s.id !== id); renderSidebarContent(); }
};

function resetFilters() { els.searchInput.value = ''; els.startDateFilter.value = ''; els.endDateFilter.value = ''; updateUI(); }
function toggleSort() { state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc'; updateUI(); }

function updateUI() {
    state.filteredPosts = state.allPosts.filter(p => p.content.includes(els.searchInput.value) && (!els.startDateFilter.value || p.date >= els.startDateFilter.value));
    state.filteredPosts.sort((a, b) => state.sortOrder === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
    renderPosts();
    updateStats();
}

function renderDateNavigator() {
    if (!els.dateNavigator) return;
    const years = [...new Set(state.allPosts.map(p => p.date.split('-')[0]))].sort().reverse();
    els.dateNavigator.innerHTML = years.map(y => `<div>${y}</div>`).join('');
}

function renderPosts() {
    if (!els.postsFeed) return;
    els.postsFeed.innerHTML = state.filteredPosts.map(p => `<div class="post-card"><div>${p.date}</div><div>${p.content}</div></div>`).join('');
}

function updateStats() {
    if (els.totalPosts) els.totalPosts.textContent = state.filteredPosts.length;
}

function showToast(m, d = 3000) {
    if (!els.toast) return;
    els.toast.textContent = m;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), d);
}

function openModal(url) { els.modalImg.src = url; els.imageModal.style.display = 'flex'; }
function closeModal() { els.imageModal.style.display = 'none'; }

// Start
document.addEventListener('DOMContentLoaded', init);
if (document.readyState === 'interactive' || document.readyState === 'complete') init();
