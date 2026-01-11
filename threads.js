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
const CATEGORY_COLLECTION = 'threads_categories';

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
    await loadCategoriesFromFirestore();
    await loadSessionsFromFirestore();

    if (state.sessions.length > 0) {
        switchSession(state.sessions[0].id);
    }

    // Infinite Scroll Event
    els.contentView.addEventListener('scroll', handleScroll);
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
    try {
        const snapshot = await db.collection(CATEGORY_COLLECTION).orderBy('order', 'asc').get();
        state.categories = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        if (state.categories.length === 0) {
            // Create default category
            await addNewCategoryUI('미분류');
        }
    } catch (e) {
        console.error("Categories Load Error:", e);
    }
}

async function addNewCategory() {
    const name = prompt('새 카테고리 이름을 입력하세요:');
    if (name && name.trim()) {
        await addNewCategoryUI(name.trim());
        renderSidebarContent();
    }
}

async function addNewCategoryUI(name) {
    const newId = db.collection(CATEGORY_COLLECTION).doc().id;
    const category = {
        name: name,
        order: state.categories.length
    };
    await db.collection(CATEGORY_COLLECTION).doc(newId).set(category);
    state.categories.push({ id: newId, ...category });
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
    try {
        const snapshot = await db.collection(COLLECTION_NAME).orderBy('order', 'asc').get();
        state.sessions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        renderSidebarContent();
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

    els.sidebarContent.innerHTML = state.categories.map(category => {
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

    // Strip suffixes to group split files together
    const sessionRefName = filename.replace('.md', '').replace(/_part\d+$/, '').replace(/[-_]\d+$/, '').replace(/\s*\(\d+\)$/, '');

    // Match by refName OR name
    let session = state.sessions.find(s =>
        (s.refName === sessionRefName) ||
        (s.name === sessionRefName)
    );

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
            order: state.sessions.length,
            categoryId: state.categories[0] ? state.categories[0].id : 'default'
        };
        state.sessions.unshift(session);
        await saveSessionToFirestore(session);
        showToast(`'${sessionRefName}' 라이브러리에 추가되었습니다.`);
    }

    switchSession(session.id);
    renderSidebarContent();
}

// --- App Functions ---
window.switchSession = (id) => {
    state.activeSessionId = id;
    const session = state.sessions.find(s => s.id === id);
    if (session) {
        state.allPosts = session.posts;
        renderDateNavigator();
        updateUI();
        renderSidebarContent();

        // Close sidebar on mobile after selection
        if (window.innerWidth <= 1024) {
            toggleSidebar(false);
        }
    }
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
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return state.sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
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
    const imgCount = state.filteredPosts.reduce((acc, p) => acc + p.images.length, 0);
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
