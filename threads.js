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

        // Enable real-time sync with specific tuning
        console.log("Threads Analyzer: Premium Cloud Sync Active");

        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
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
        console.error("Init Error:", e);
        showToast("초기화 실패");
    }
}

function setupEventListeners() {
    if (els.uploadBtn) els.uploadBtn.addEventListener('click', () => els.fileInput.click());
    if (els.fileInput) els.fileInput.addEventListener('change', handleFileUpload);
    if (els.searchInput) els.searchInput.addEventListener('input', debounce(updateUI, 300));
    if (els.startDateFilter) els.startDateFilter.addEventListener('change', updateUI);
    if (els.endDateFilter) els.endDateFilter.addEventListener('change', updateUI);
    if (els.resetFilters) els.resetFilters.addEventListener('click', resetFilters);
    if (els.sortToggle) els.sortToggle.addEventListener('click', toggleSort);
    if (els.mobileMenuToggle) els.mobileMenuToggle.addEventListener('click', () => toggleSidebar(true));
    if (els.sidebarOverlay) els.sidebarOverlay.addEventListener('click', () => toggleSidebar(false));
    if (els.addCategoryBtn) els.addCategoryBtn.addEventListener('click', addNewCategory);
    if (els.closeModal) els.closeModal.onclick = closeModal;
    if (els.imageModal) els.imageModal.onclick = (e) => { if (e.target === els.imageModal) closeModal(); };
    if (els.contentView) els.contentView.addEventListener('scroll', handleScroll);
}

// --- App Core Functions ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function handleScroll() {
    const { scrollTop, scrollHeight, clientHeight } = els.contentView;
    if (scrollTop + clientHeight >= scrollHeight - 500) {
        if (state.visiblePosts < state.filteredPosts.length) {
            state.visiblePosts += 30;
            renderPosts(true);
        }
    }
}

function toggleSidebar(open) {
    els.sidebar.classList.toggle('open', open);
    els.sidebarOverlay.classList.toggle('show', open);
}

// --- Data Loading ---
async function loadCategoriesFromFirestore() {
    return new Promise((resolve) => {
        db.collection(CATEGORY_COLLECTION).orderBy('order', 'asc').onSnapshot((snapshot) => {
            state.categories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (state.categories.length === 0 && !snapshot.metadata.fromCache) {
                addNewCategoryUI('미분류', DEFAULT_CAT_ID);
            }
            renderSidebarContent();
            resolve();
        });
    });
}

async function loadSessionsFromFirestore() {
    return new Promise((resolve) => {
        db.collection(COLLECTION_NAME).onSnapshot((snapshot) => {
            state.sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            state.sessions.sort((a, b) => (a.order || 0) - (b.order || 0));
            renderSidebarContent();
            if (!state.activeSessionId && state.sessions.length > 0) autoSelectFirstSession();
            resolve();
        });
    });
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
                <div class="category-header"><span class="category-title">미분류 항목</span></div>
                <ul class="session-list" data-category-id="default">
                    ${uncategorizedSessions.map(s => `
                        <li class="${state.activeSessionId === s.id ? 'active' : ''}" data-id="${s.id}" onclick="switchSession('${s.id}')">
                            <span class="drag-handle">☰</span><span class="session-name">${s.name}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    els.sidebarContent.innerHTML = categoryHtml + uncategorizedHtml;
}

// --- Session Logic ---
window.switchSession = async (id) => {
    if (postsUnsubscribe) postsUnsubscribe();
    state.activeSessionId = id;
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;

    showToast("데이터 연동 중...", 1000);

    postsUnsubscribe = db.collection(COLLECTION_NAME).doc(id).collection('posts').onSnapshot((snapshot) => {
        const subPosts = snapshot.docs.map(doc => {
            const data = doc.data();
            // Pre-calculate sort key for performance
            data.sortKey = `${data.date}${data.time || '00:00'}`;
            return data;
        });

        const legacyPosts = (session.posts || []).map(p => {
            p.sortKey = `${p.date}${p.time || '00:00'}`;
            return p;
        });

        const allMap = new Map();
        legacyPosts.forEach(p => allMap.set(p.id || `${p.date}_${p.content.substring(0, 20)}`, p));
        subPosts.forEach(p => allMap.set(p.id, p));

        state.allPosts = Array.from(allMap.values());
        updateUI();
    });

    if (window.innerWidth <= 1024) toggleSidebar(false);
    renderSidebarContent();
};

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        const chunks = event.target.result.split('---');
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

            let content = chunk.replace(/## \d{4}-\d{2}-\d{2}( \d{2}:\d{2})?/, '').replace(/!\[[\s\S]*?\]\(.*?\)/g, '').trim();
            if (content || images.length > 0) {
                newPosts.push({ id: `p_${date}_${i}_${content.length}`, date, time, index: i, content, images });
            }
        });

        const sessionName = file.name.replace('.md', '').replace(/_part\d+$/, '');
        let session = state.sessions.find(s => s.name === sessionName);
        let sessionId = session ? session.id : db.collection(COLLECTION_NAME).doc().id;

        if (!session) {
            session = { id: sessionId, name: sessionName, categoryId: state.categories[0]?.id || DEFAULT_CAT_ID, order: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
            await db.collection(COLLECTION_NAME).doc(sessionId).set(session, { merge: true });
        }

        const batchSize = 100; // Smaller batch size for smoother UI
        let saved = 0;
        for (let i = 0; i < newPosts.length; i += batchSize) {
            const batch = db.batch();
            newPosts.slice(i, i + batchSize).forEach(p => {
                const ref = db.collection(COLLECTION_NAME).doc(sessionId).collection('posts').doc(p.id.replace(/\//g, '_'));
                batch.set(ref, p, { merge: true });
            });
            await batch.commit();
            saved += Math.min(batchSize, newPosts.length - i);
            showToast(`분석 중... ${Math.round((saved / newPosts.length) * 100)}%`, 0, Math.round((saved / newPosts.length) * 100));
        }
        await db.collection(COLLECTION_NAME).doc(sessionId).update({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        showToast("업로드 완료", 2000, 100);
        await switchSession(sessionId);
    };
    reader.readAsText(file);
    e.target.value = '';
}

// --- UI Rendering ---
function updateUI() {
    const q = (els.searchInput?.value || '').toLowerCase();
    const start = els.startDateFilter?.value || '';

    state.filteredPosts = state.allPosts.filter(p => p.content.toLowerCase().includes(q) && (!start || p.date >= start));

    // Optimized Sort
    state.filteredPosts.sort((a, b) => {
        if (a.sortKey !== b.sortKey) {
            return state.sortOrder === 'desc' ? b.sortKey.localeCompare(a.sortKey) : a.sortKey.localeCompare(b.sortKey);
        }
        return (a.index || 0) - (b.index || 0);
    });

    state.visiblePosts = 25;
    renderPosts();
    updateStats();
    renderDateNavigator();
}

function renderPosts(append = false) {
    if (!els.postsFeed) return;
    const posts = state.filteredPosts.slice(0, state.visiblePosts);
    if (posts.length === 0) {
        els.postsFeed.innerHTML = `<div class="empty-state"><h2>데이터가 없습니다</h2></div>`;
        return;
    }

    const html = posts.map((p, idx) => `
        <article class="post-card">
            <div class="post-header">
                <span class="post-date">${p.date} ${p.time || ''}</span>
                <button class="btn-icon" onclick="copyContent('${p.id}')">📋</button>
            </div>
            <div class="post-content">${p.content}</div>
            ${p.images && p.images.length > 0 ? `<div class="post-images">${p.images.map(img => `<img src="https://wsrv.nl/?url=${encodeURIComponent(img)}&w=800&q=80" loading="lazy" onclick="openModal(this.src)">`).join('')}</div>` : ''}
        </article>`).join('');

    if (append) {
        const div = document.createElement('div');
        div.innerHTML = html;
        const currentCount = els.postsFeed.querySelectorAll('.post-card').length;
        const newOnes = div.querySelectorAll('.post-card');
        for (let i = currentCount; i < newOnes.length; i++) {
            if (newOnes[i]) els.postsFeed.appendChild(newOnes[i]);
        }
    } else {
        els.postsFeed.innerHTML = html;
    }
}

function renderDateNavigator() {
    if (!els.dateNavigator) return;
    const years = [...new Set(state.allPosts.map(p => p.date.split('-')[0]))].sort().reverse();
    els.dateNavigator.innerHTML = years.map(y => `<div class="year-group"><span class="year-label">${y}</span></div>`).join('');
}

function updateStats() {
    if (els.totalPosts) els.totalPosts.textContent = state.filteredPosts.length.toLocaleString();
    if (els.totalImages) {
        const count = state.filteredPosts.reduce((acc, p) => acc + (p.images ? p.images.length : 0), 0);
        els.totalImages.textContent = count.toLocaleString();
    }
}

function updateSyncStatus(s) {
    const icon = document.querySelector('.logo-icon');
    if (icon) icon.style.boxShadow = s ? '0 0 10px #4caf50' : '0 0 10px #f44336';
}

function showToast(m, d = 3000, p = null) {
    if (!els.toast) return;
    els.toast.innerHTML = `<span>${m}</span>${p !== null ? `<div class="toast-progress-bar"><div class="toast-progress-fill" style="width: ${p}%"></div></div>` : ''}`;
    els.toast.classList.add('show');
    if (d > 0) setTimeout(() => els.toast.classList.remove('show'), d);
}

// Utility
window.copyContent = (id) => {
    const p = state.allPosts.find(x => x.id === id);
    if (p) { navigator.clipboard.writeText(p.content); showToast('복사됨'); }
};
function openModal(u) { if (els.modalImg) els.modalImg.src = u; els.imageModal.style.display = 'flex'; }
function closeModal() { els.imageModal.style.display = 'none'; }
async function addNewCategoryUI(n, id) {
    const cid = id || db.collection(CATEGORY_COLLECTION).doc().id;
    await db.collection(CATEGORY_COLLECTION).doc(cid).set({ name: n, order: state.categories.length }, { merge: true });
}
function autoSelectFirstSession() {
    if (state.activeSessionId || state.sessions.length === 0) return;
    switchSession(state.sessions[0].id);
}

init();
