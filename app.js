// Application State
let catalogData = [];
let claimsList = [];
let activeTab = 'boxes';
let activeFilter = 'all';
let searchQuery = '';
let isEditMode = false;
let googleScriptUrl = localStorage.getItem('google_sheet_script_url') || '';

// Lightbox state
let currentZoom = 1;
let currentRotation = 0;
let isPanning = false;
let startX = 0, startY = 0;
let translateX = 0, translateY = 0;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initStorage();
  initNavigation();
  initSearchAndFilter();
  initModal();
  initEditModal();
  initLightbox();
  initSettings();
  initHeaderActions();
  loadData();
});

function initStorage() {
  try {
    const saved = localStorage.getItem('family_book_claims');
    if (saved) claimsList = JSON.parse(saved);
  } catch (e) {
    claimsList = [];
  }
}

function saveClaimsToStorage() {
  localStorage.setItem('family_book_claims', JSON.stringify(claimsList));
}

// Load catalog & apply user edits
function loadData() {
  if (typeof BOOKS_DATA !== 'undefined' && Array.isArray(BOOKS_DATA)) {
    // Deep clone to allow in-memory edits
    catalogData = JSON.parse(JSON.stringify(BOOKS_DATA));
  } else {
    catalogData = [];
  }

  // Detect sets automatically if title mentions "סט" or "כרכים"
  catalogData.forEach(box => {
    (box.books || []).forEach(book => {
      if (!book.is_set) {
        const t = (book.title || '') + ' ' + (book.author || '');
        if (t.includes('סט ') || t.includes(' כרכים') || t.includes('חלקים') || t.includes('ש"ס') || t.includes('כרך א-') || t.includes('מהדורת שבתי פרנקל')) {
          book.is_set = true;
        }
      }
    });
  });

  // Apply saved edits from localStorage
  try {
    const savedEdits = JSON.parse(localStorage.getItem('catalog_edits') || '{}');
    if (savedEdits.boxes) {
      Object.keys(savedEdits.boxes).forEach(boxId => {
        const box = catalogData.find(b => b.box_id == boxId);
        if (box && savedEdits.boxes[boxId].category !== undefined) {
          box.category = savedEdits.boxes[boxId].category;
        }
      });
    }

    if (savedEdits.books) {
      Object.keys(savedEdits.books).forEach(bookId => {
        const edit = savedEdits.books[bookId];
        catalogData.forEach(box => {
          const book = (box.books || []).find(b => b.id === bookId);
          if (book) {
            if (edit.deleted) {
              box.books = box.books.filter(b => b.id !== bookId);
            } else {
              if (edit.title !== undefined) book.title = edit.title;
              if (edit.author !== undefined) book.author = edit.author;
              if (edit.is_set !== undefined) book.is_set = edit.is_set;
            }
          }
        });
      });
    }

    // Custom added books
    if (Array.isArray(savedEdits.customBooks)) {
      savedEdits.customBooks.forEach(cb => {
        const box = catalogData.find(b => b.box_id === cb.box_id);
        if (box && !box.books.some(b => b.id === cb.id)) {
          box.books.push(cb);
        }
      });
    }
  } catch (e) {
    console.warn('Error loading saved edits', e);
  }

  updateStats();
  renderCurrentView();

  if (googleScriptUrl) {
    syncWithCloud(false);
  }
}

function saveCatalogEdits(editsObj) {
  try {
    let current = JSON.parse(localStorage.getItem('catalog_edits') || '{}');
    if (!current.boxes) current.boxes = {};
    if (!current.books) current.books = {};
    if (!current.customBooks) current.customBooks = [];

    if (editsObj.box) {
      current.boxes[editsObj.box.id] = { category: editsObj.box.category };
    }
    if (editsObj.book) {
      current.books[editsObj.book.id] = editsObj.book;
    }
    if (editsObj.newBook) {
      current.customBooks.push(editsObj.newBook);
    }

    localStorage.setItem('catalog_edits', JSON.stringify(current));
  } catch (e) {
    console.error('Failed to save edits', e);
  }
}

// Navigation Tabs
function initNavigation() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabName) {
  activeTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-view').forEach(view => {
    view.classList.add('hidden');
  });

  const activeView = document.getElementById(`view-${tabName}`);
  if (activeView) activeView.classList.remove('hidden');

  const controls = document.getElementById('main-controls');
  if (controls) {
    controls.style.display = (tabName === 'boxes' || tabName === 'all-books') ? 'flex' : 'none';
  }

  renderCurrentView();
}

// Search & Filter
function initSearchAndFilter() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderCurrentView();
    });
  }

  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderCurrentView();
    });
  });

  const summaryUserFilter = document.getElementById('summary-filter-user');
  if (summaryUserFilter) {
    summaryUserFilter.addEventListener('input', renderSummaryView);
  }

  const btnExportCsv = document.getElementById('btn-export-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', exportToCSV);
  }
}

// Header Actions (Edit Mode & Download Data)
function initHeaderActions() {
  const btnEdit = document.getElementById('btn-toggle-edit-mode');
  if (btnEdit) {
    btnEdit.addEventListener('click', () => {
      isEditMode = !isEditMode;
      btnEdit.classList.toggle('active', isEditMode);
      btnEdit.textContent = isEditMode ? '✓ מצב עריכה (פעיל)' : '✏️ מצב עריכה (כבוי)';
      showToast(isEditMode ? 'מצב עריכה הופעל: כעת ניתן לערוך ספרים, שמות וארגזים' : 'מצב עריכה כבוי');
      renderCurrentView();
    });
  }

  const btnDownload = document.getElementById('btn-download-updated-data');
  if (btnDownload) {
    btnDownload.addEventListener('click', downloadUpdatedData);
  }
}

// Stats Calculation
function updateStats() {
  const totalBoxes = catalogData.length;
  let totalBooks = 0;
  
  catalogData.forEach(box => {
    totalBooks += (box.books || []).length;
  });

  const claimedCount = claimsList.length;
  const availableCount = Math.max(0, totalBooks - claimedCount);

  document.getElementById('stat-boxes').textContent = totalBoxes;
  document.getElementById('stat-books').textContent = totalBooks;
  document.getElementById('stat-claimed').textContent = claimedCount;
  document.getElementById('stat-available').textContent = availableCount;

  document.getElementById('badge-boxes-count').textContent = totalBoxes;
  document.getElementById('badge-all-count').textContent = totalBooks;
  document.getElementById('badge-summary-count').textContent = claimedCount;
}

function renderCurrentView() {
  updateStats();
  if (activeTab === 'boxes') {
    renderBoxesView();
  } else if (activeTab === 'all-books') {
    renderAllBooksView();
  } else if (activeTab === 'summary') {
    renderSummaryView();
  }
}

function getBookClaim(boxId, bookId, bookTitle) {
  return claimsList.find(c => {
    if (c.boxId == boxId) {
      if (bookId && c.bookId === bookId) return true;
      if (bookTitle && c.bookTitle === bookTitle) return true;
    }
    return false;
  });
}

// 1. Render Boxes View
function renderBoxesView() {
  const container = document.getElementById('boxes-container');
  if (!container) return;

  container.innerHTML = '';

  let filteredBoxes = catalogData.map(box => {
    const books = (box.books || []).filter(book => {
      const claim = getBookClaim(box.box_id, book.id, book.title);
      
      if (activeFilter === 'available' && claim) return false;
      if (activeFilter === 'claimed' && !claim) return false;

      if (searchQuery) {
        const matchTitle = (book.title || '').toLowerCase().includes(searchQuery);
        const matchAuthor = (book.author || '').toLowerCase().includes(searchQuery);
        const matchCategory = (box.category || '').toLowerCase().includes(searchQuery);
        const matchBox = `ארגז ${box.box_id}`.includes(searchQuery);
        const matchClaimer = claim && claim.userName.toLowerCase().includes(searchQuery);
        return matchTitle || matchAuthor || matchCategory || matchBox || matchClaimer;
      }

      return true;
    });

    return { ...box, filteredBooks: books };
  });

  if (searchQuery || activeFilter !== 'all') {
    filteredBoxes = filteredBoxes.filter(box => box.filteredBooks.length > 0);
  }

  if (filteredBoxes.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted); background: #fff; border-radius: 12px; border: 1px dashed var(--border);">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
        <h3>לא נמצאו ספרים התואמים את החיפוש</h3>
        <p>נסה לשנות את מילת החיפוש או לבחור בסינון "הכל".</p>
      </div>
    `;
    return;
  }

  filteredBoxes.forEach(box => {
    const card = document.createElement('div');
    card.className = 'box-card';

    const imageWeb = `web_images/${box.image_name}`;
    const imageOriginal = `original_photos/${box.image_name}`;

    card.innerHTML = `
      <div class="box-image-wrap" onclick="openLightbox('${box.image_name}', 'ארגז מס׳ ${box.box_id}: ${box.category || ''}')">
        <img class="box-img" src="${imageWeb}" onerror="this.onerror=null; this.src='${imageOriginal}'" alt="ארגז ${box.box_id}" loading="lazy">
        <div class="zoom-overlay">🔍 לחץ להגדלה וזום מלא</div>
      </div>
      <div class="box-content">
        <div class="box-header">
          <div class="box-title">
            <span>📦 ארגז מס׳ ${box.box_id}</span>
            <span class="box-badge" onclick="${isEditMode ? `openEditBoxModal(${box.box_id})` : ''}" title="${isEditMode ? 'לחץ לעריכת נושא הארגז' : ''}">
              ${box.category || 'כללי'} ${isEditMode ? '✏️' : ''}
            </span>
          </div>
          <span style="font-size: 0.85rem; color: var(--text-muted);">
            ${box.filteredBooks.length} ספרים
          </span>
        </div>

        <ul class="books-list" id="box-books-${box.box_id}">
          ${box.filteredBooks.map(book => {
            const claim = getBookClaim(box.box_id, book.id, book.title);
            const isClaimed = !!claim;
            const isSet = !!book.is_set;

            return `
              <li class="book-item ${isSet ? 'is-set' : ''} ${isClaimed ? 'claimed' : ''}">
                <div class="book-info">
                  <div class="book-name">
                    ${escapeHtml(book.title)}
                    ${isSet ? `<span class="set-badge">📦 סט שלם</span>` : ''}
                  </div>
                  ${book.author ? `<div class="book-author">${escapeHtml(book.author)}</div>` : ''}
                </div>
                <div class="book-action">
                  ${isEditMode ? `
                    <button class="btn-edit-item" onclick="openEditBookModal(${box.box_id}, '${book.id}')" title="ערוך פרטי ספר">✏️</button>
                    <button class="btn-delete-item" onclick="deleteBook(${box.box_id}, '${book.id}')" title="מחק ספר">🗑️</button>
                  ` : ''}

                  ${isClaimed 
                    ? `<span class="claimed-tag">✓ נבחר ע״י ${escapeHtml(claim.userName)}</span>` 
                    : `<button class="btn-claim" onclick="openClaimModal(${box.box_id}, '${book.id || ''}', '${escapeForJs(book.title)}')">🖐️ ${isSet ? 'אני רוצה את כל הסט' : 'אני מעוניין/ת'}</button>`
                  }
                </div>
              </li>
            `;
          }).join('')}
        </ul>

        <div class="add-custom-book">
          <input type="text" id="custom-book-input-${box.box_id}" class="add-input" placeholder="רואה בתמונה ספר נוסף שלא ברשימה? הקלד כאן...">
          <button class="btn-add" onclick="addCustomBook(${box.box_id})">+ הוסף ספר</button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// 2. Render All Books View
function renderAllBooksView() {
  const tbody = document.getElementById('all-books-tbody');
  const countText = document.getElementById('all-books-count-text');
  if (!tbody) return;

  tbody.innerHTML = '';
  let allBooks = [];

  catalogData.forEach(box => {
    (box.books || []).forEach(book => {
      allBooks.push({
        boxId: box.box_id,
        imageName: box.image_name,
        category: box.category,
        ...book
      });
    });
  });

  allBooks = allBooks.filter(book => {
    const claim = getBookClaim(book.boxId, book.id, book.title);

    if (activeFilter === 'available' && claim) return false;
    if (activeFilter === 'claimed' && !claim) return false;

    if (searchQuery) {
      const matchTitle = (book.title || '').toLowerCase().includes(searchQuery);
      const matchAuthor = (book.author || '').toLowerCase().includes(searchQuery);
      const matchBox = `ארגז ${book.boxId}`.includes(searchQuery);
      const matchClaimer = claim && claim.userName.toLowerCase().includes(searchQuery);
      return matchTitle || matchAuthor || matchBox || matchClaimer;
    }

    return true;
  });

  if (countText) countText.textContent = `מוצגים ${allBooks.length} ספרים`;

  if (allBooks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">לא נמצאו ספרים תואמים</td></tr>`;
    return;
  }

  allBooks.forEach(book => {
    const claim = getBookClaim(book.boxId, book.id, book.title);
    const isClaimed = !!claim;
    const isSet = !!book.is_set;
    const thumbUrl = `web_images/${book.imageName}`;
    const origUrl = `original_photos/${book.imageName}`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${book.boxId}</strong></td>
      <td>
        <img class="table-thumb" src="${thumbUrl}" onerror="this.onerror=null; this.src='${origUrl}'" onclick="openLightbox('${book.imageName}', 'ארגז מס׳ ${book.boxId}')" title="לחץ להגדלה" alt="ארגז ${book.boxId}">
      </td>
      <td style="font-weight: 600;">
        ${escapeHtml(book.title)}
        ${isSet ? `<span class="set-badge" style="margin-right: 6px;">סט שלם</span>` : ''}
      </td>
      <td style="color: var(--text-muted);">${escapeHtml(book.author || '-')}</td>
      <td>
        ${isClaimed 
          ? `<span class="claimed-tag">נבחר ע״י ${escapeHtml(claim.userName)}</span>` 
          : `<span style="color: var(--success); font-weight: 600; font-size: 0.85rem;">● פנוי</span>`
        }
      </td>
      <td>
        <div style="display: flex; gap: 4px; align-items: center;">
          ${isEditMode ? `
            <button class="btn-edit-item" onclick="openEditBookModal(${book.boxId}, '${book.id}')">✏️</button>
            <button class="btn-delete-item" onclick="deleteBook(${book.boxId}, '${book.id}')">🗑️</button>
          ` : ''}

          ${isClaimed 
            ? `<button class="btn-action" style="font-size: 0.8rem; padding: 3px 8px;" onclick="openClaimModal(${book.boxId}, '${book.id || ''}', '${escapeForJs(book.title)}')">פרטים / שינוי</button>` 
            : `<button class="btn-claim" onclick="openClaimModal(${book.boxId}, '${book.id || ''}', '${escapeForJs(book.title)}')">🖐️ ${isSet ? 'קח סט' : 'אני רוצה'}</button>`
          }
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 3. Render Summary View
function renderSummaryView() {
  const tbody = document.getElementById('summary-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  const filterInput = document.getElementById('summary-filter-user');
  const userQuery = filterInput ? filterInput.value.trim().toLowerCase() : '';

  let list = [...claimsList];
  if (userQuery) {
    list = list.filter(c => (c.userName || '').toLowerCase().includes(userQuery));
  }

  list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">עדיין לא נבחרו ספרים</td></tr>`;
    return;
  }

  list.forEach(c => {
    const box = catalogData.find(b => b.box_id == c.boxId);
    const imageName = box ? box.image_name : '';
    const thumbUrl = imageName ? `web_images/${imageName}` : '';
    const origUrl = imageName ? `original_photos/${imageName}` : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-size: 0.82rem; color: var(--text-muted);">${formatDate(c.timestamp)}</td>
      <td><strong>ארגז ${c.boxId}</strong></td>
      <td>
        ${imageName ? `<img class="table-thumb" src="${thumbUrl}" onerror="this.onerror=null; this.src='${origUrl}'" onclick="openLightbox('${imageName}', 'ארגז מס׳ ${c.boxId}')" title="לחץ להגדלה">` : '-'}
      </td>
      <td style="font-weight: 600;">${escapeHtml(c.bookTitle)}</td>
      <td style="color: var(--primary); font-weight: 700;">${escapeHtml(c.userName)}</td>
      <td style="font-size: 0.88rem; color: var(--text-muted);">${escapeHtml(c.userPhone || c.notes || '-')}</td>
      <td>
        <button class="btn-delete-row" onclick="removeClaim('${c.id}')" title="ביטול בחירה">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Modal handling
function initModal() {
  const modal = document.getElementById('claim-modal');
  const closeBtn = document.getElementById('btn-close-modal');
  const form = document.getElementById('claim-form');

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }
  if (form) form.addEventListener('submit', handleClaimSubmit);
}

function openClaimModal(boxId, bookId, bookTitle) {
  const modal = document.getElementById('claim-modal');
  document.getElementById('modal-box-id').value = boxId;
  document.getElementById('modal-book-id').value = bookId;
  document.getElementById('modal-book-exact-title').value = bookTitle;

  document.getElementById('modal-book-title').textContent = bookTitle;
  document.getElementById('modal-box-info').textContent = `ארגז מס׳ ${boxId}`;

  const lastName = localStorage.getItem('last_user_name') || '';
  const lastPhone = localStorage.getItem('last_user_phone') || '';
  document.getElementById('claim-name').value = lastName;
  document.getElementById('claim-phone').value = lastPhone;

  const existing = getBookClaim(boxId, bookId, bookTitle);
  if (existing) {
    document.getElementById('claim-name').value = existing.userName || '';
    document.getElementById('claim-phone').value = existing.userPhone || existing.notes || '';
  }

  updateWhatsAppLink(boxId, bookTitle, lastName);

  modal.classList.remove('hidden');
  document.getElementById('claim-name').focus();
}

function closeModal() {
  const modal = document.getElementById('claim-modal');
  if (modal) modal.classList.add('hidden');
}

function handleClaimSubmit(e) {
  e.preventDefault();

  const boxId = document.getElementById('modal-box-id').value;
  const bookId = document.getElementById('modal-book-id').value;
  const bookTitle = document.getElementById('modal-book-exact-title').value;
  const userName = document.getElementById('claim-name').value.trim();
  const phoneOrNote = document.getElementById('claim-phone').value.trim();

  if (!userName) return;

  localStorage.setItem('last_user_name', userName);
  if (phoneOrNote) localStorage.setItem('last_user_phone', phoneOrNote);

  claimsList = claimsList.filter(c => !(c.boxId == boxId && (c.bookId === bookId || c.bookTitle === bookTitle)));

  const newClaim = {
    id: 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    timestamp: new Date().toISOString(),
    boxId: boxId,
    bookId: bookId,
    bookTitle: bookTitle,
    userName: userName,
    userPhone: phoneOrNote,
    notes: ''
  };

  claimsList.push(newClaim);
  saveClaimsToStorage();

  showToast(`הספר "${bookTitle}" נרשם על שם ${userName}`);

  if (googleScriptUrl) {
    sendClaimToCloud(newClaim);
  }

  closeModal();
  renderCurrentView();
}

function removeClaim(claimId) {
  const item = claimsList.find(c => c.id === claimId);
  const name = item ? `"${item.bookTitle}" (${item.userName})` : 'פריט זה';
  if (!confirm(`האם לבטל את בחירת הספר ${name}?`)) return;

  claimsList = claimsList.filter(c => c.id !== claimId);
  saveClaimsToStorage();
  showToast('הבחירה בוטלה');
  renderCurrentView();
}

// Edit Modal Functions
function initEditModal() {
  const form = document.getElementById('edit-form');
  if (form) form.addEventListener('submit', handleEditSubmit);
}

function openEditBookModal(boxId, bookId) {
  const box = catalogData.find(b => b.box_id == boxId);
  if (!box) return;
  const book = (box.books || []).find(b => b.id === bookId);
  if (!book) return;

  document.getElementById('edit-type').value = 'book';
  document.getElementById('edit-box-id').value = boxId;
  document.getElementById('edit-book-id').value = bookId;
  document.getElementById('edit-modal-title').textContent = `עריכת ספר (ארגז ${boxId})`;

  document.getElementById('edit-book-fields').classList.remove('hidden');
  document.getElementById('edit-box-fields').classList.add('hidden');

  document.getElementById('edit-book-title').value = book.title || '';
  document.getElementById('edit-book-author').value = book.author || '';
  document.getElementById('edit-book-is-set').checked = !!book.is_set;

  document.getElementById('edit-modal').classList.remove('hidden');
  document.getElementById('edit-book-title').focus();
}

function openEditBoxModal(boxId) {
  const box = catalogData.find(b => b.box_id == boxId);
  if (!box) return;

  document.getElementById('edit-type').value = 'box';
  document.getElementById('edit-box-id').value = boxId;
  document.getElementById('edit-modal-title').textContent = `עריכת תיאור ארגז מס׳ ${boxId}`;

  document.getElementById('edit-book-fields').classList.add('hidden');
  document.getElementById('edit-box-fields').classList.remove('hidden');

  document.getElementById('edit-box-category').value = box.category || '';

  document.getElementById('edit-modal').classList.remove('hidden');
  document.getElementById('edit-box-category').focus();
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
}

function handleEditSubmit(e) {
  e.preventDefault();
  const type = document.getElementById('edit-type').value;
  const boxId = document.getElementById('edit-box-id').value;

  if (type === 'book') {
    const bookId = document.getElementById('edit-book-id').value;
    const newTitle = document.getElementById('edit-book-title').value.trim();
    const newAuthor = document.getElementById('edit-book-author').value.trim();
    const isSet = document.getElementById('edit-book-is-set').checked;

    const box = catalogData.find(b => b.box_id == boxId);
    if (box) {
      const book = (box.books || []).find(b => b.id === bookId);
      if (book) {
        book.title = newTitle;
        book.author = newAuthor;
        book.is_set = isSet;
        saveCatalogEdits({ book: { id: bookId, title: newTitle, author: newAuthor, is_set: isSet } });
      }
    }
    showToast('פרטי הספר עודכנו');
  } else if (type === 'box') {
    const newCategory = document.getElementById('edit-box-category').value.trim();
    const box = catalogData.find(b => b.box_id == boxId);
    if (box) {
      box.category = newCategory;
      saveCatalogEdits({ box: { id: boxId, category: newCategory } });
    }
    showToast('תיאור הארגז עודכן');
  }

  closeEditModal();
  renderCurrentView();
}

function deleteBook(boxId, bookId) {
  const box = catalogData.find(b => b.box_id == boxId);
  if (!box) return;
  const book = (box.books || []).find(b => b.id === bookId);
  const title = book ? book.title : 'ספר זה';

  if (!confirm(`האם למחוק את "${title}" מרשימת הארגז?`)) return;

  box.books = box.books.filter(b => b.id !== bookId);
  saveCatalogEdits({ book: { id: bookId, deleted: true } });
  showToast('הספר נמחק מהארגז');
  renderCurrentView();
}

// Add custom book to box
function addCustomBook(boxId) {
  const input = document.getElementById(`custom-book-input-${boxId}`);
  if (!input) return;
  const title = input.value.trim();
  if (!title) return;

  const newBook = {
    id: `custom_${boxId}_${Date.now()}`,
    box_id: boxId,
    title: title,
    author: 'הוסף ידנית'
  };

  const box = catalogData.find(b => b.box_id === boxId);
  if (box) {
    if (!box.books) box.books = [];
    box.books.push(newBook);
    saveCatalogEdits({ newBook: newBook });
  }

  input.value = '';
  renderCurrentView();
  openClaimModal(boxId, newBook.id, newBook.title);
}

// Download Updated books_data.js
function downloadUpdatedData() {
  const cleanData = JSON.stringify(catalogData, null, 2);
  const jsContent = `const BOOKS_DATA = ${cleanData};\n`;
  const blob = new Blob([jsContent], { type: 'application/javascript;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'books_data.js';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('קובץ books_data.js המעודכן הורד בהצלחה!');
}

// Lightbox with Zoom, Rotate, Pan & Wheel
function initLightbox() {
  const viewport = document.getElementById('lightbox-viewport');
  if (!viewport) return;

  // Wheel zoom
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn(0.2);
    } else {
      zoomOut(0.2);
    }
  }, { passive: false });

  // Pan (drag)
  viewport.addEventListener('mousedown', (e) => {
    if (currentZoom > 1) {
      isPanning = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
      viewport.classList.add('panning');
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    applyImageTransform();
  });

  window.addEventListener('mouseup', () => {
    isPanning = false;
    viewport.classList.remove('panning');
  });

  // Keyboard controls
  window.addEventListener('keydown', (e) => {
    const modal = document.getElementById('lightbox-modal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') closeLightbox();
    if (e.key === '+' || e.key === '=') zoomIn();
    if (e.key === '-' || e.key === '_') zoomOut();
    if (e.key === 'r' || e.key === 'R') rotateImage();
    if (e.key === '0') resetZoom();
  });
}

function openLightbox(imageName, caption) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  const extLink = document.getElementById('lightbox-external-link');

  resetZoom();

  const webUrl = `web_images/${imageName}`;
  const origUrl = `original_photos/${imageName}`;

  img.onerror = () => {
    if (img.src.includes('web_images/')) {
      img.src = origUrl;
    }
  };

  img.src = webUrl;
  cap.textContent = caption || '';
  if (extLink) extLink.href = origUrl;

  modal.classList.remove('hidden');
}

function closeLightbox() {
  const modal = document.getElementById('lightbox-modal');
  if (modal) modal.classList.add('hidden');
  resetZoom();
}

function applyImageTransform() {
  const container = document.getElementById('lightbox-container');
  if (container) {
    container.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentZoom}) rotate(${currentRotation}deg)`;
  }
}

function zoomIn(step = 0.3) {
  currentZoom = Math.min(currentZoom + step, 4.0);
  applyImageTransform();
}

function zoomOut(step = 0.3) {
  currentZoom = Math.max(currentZoom - step, 0.5);
  if (currentZoom <= 1) {
    translateX = 0;
    translateY = 0;
  }
  applyImageTransform();
}

function rotateImage() {
  currentRotation = (currentRotation + 90) % 360;
  applyImageTransform();
}

function resetZoom() {
  currentZoom = 1;
  currentRotation = 0;
  translateX = 0;
  translateY = 0;
  applyImageTransform();
}

// WhatsApp Link
function updateWhatsAppLink(boxId, bookTitle, userName) {
  const btn = document.getElementById('modal-whatsapp-link');
  if (!btn) return;

  const text = `שלום נפתלי, ראיתי בקטלוג ספרי אמא ואשמח לקבל את הספר:\n*${bookTitle}* (מארגז ${boxId})\nתודה, ${userName || ''}`;
  btn.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  btn.classList.remove('hidden');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Settings & Cloud Sync
function initSettings() {
  const urlInput = document.getElementById('settings-sheet-url');
  if (urlInput && googleScriptUrl) urlInput.value = googleScriptUrl;

  const btnSave = document.getElementById('btn-save-settings');
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      googleScriptUrl = document.getElementById('settings-sheet-url').value.trim();
      localStorage.setItem('google_sheet_script_url', googleScriptUrl);
      showToast('ההגדרות נשמרו בהצלחה!');
      if (googleScriptUrl) syncWithCloud(true);
    });
  }

  const btnSync = document.getElementById('btn-sync-now');
  if (btnSync) {
    btnSync.addEventListener('click', () => syncWithCloud(true));
  }
}

function sendClaimToCloud(claim) {
  if (!googleScriptUrl) return;

  fetch(googleScriptUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(claim)
  }).catch(err => console.warn('Cloud sync error', err));
}

function syncWithCloud(notify) {
  if (!googleScriptUrl) return;

  fetch(googleScriptUrl)
    .then(res => res.json())
    .then(data => {
      if (data && data.status === 'success' && Array.isArray(data.data)) {
        data.data.forEach(cloudItem => {
          const exists = claimsList.some(c => 
            c.boxId == cloudItem.boxId && 
            c.bookTitle === cloudItem.bookTitle && 
            c.userName === cloudItem.userName
          );
          if (!exists) {
            claimsList.push({
              id: 'cloud_' + Math.random().toString(36).substr(2, 6),
              timestamp: cloudItem.timestamp || new Date().toISOString(),
              boxId: cloudItem.boxId,
              bookTitle: cloudItem.bookTitle,
              userName: cloudItem.userName,
              userPhone: cloudItem.userPhone,
              notes: cloudItem.notes
            });
          }
        });
        saveClaimsToStorage();
        renderCurrentView();
        if (notify) showToast('הסנכרון עם Google Sheets הושלם בהצלחה!');
      }
    })
    .catch(err => {
      if (notify) showToast('שגיאה בסנכרון עם Google Sheets');
    });
}

// Export to CSV
function exportToCSV() {
  if (claimsList.length === 0) {
    alert('אין בקשות לייצוא עדיין.');
    return;
  }

  let csvContent = '\uFEFF';
  csvContent += 'תאריך ושעה,מספר ארגז,שם הספר,נבחר על ידי,טלפון / הערות\n';

  claimsList.forEach(c => {
    const date = formatDate(c.timestamp).replace(',', '');
    const box = `ארגז ${c.boxId}`;
    const book = `"${(c.bookTitle || '').replace(/"/g, '""')}"`;
    const user = `"${(c.userName || '').replace(/"/g, '""')}"`;
    const phone = `"${(c.userPhone || c.notes || '').replace(/"/g, '""')}"`;

    csvContent += `${date},${box},${book},${user},${phone}\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ריכוז_ספרי_אמא_זל_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return isoStr;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeForJs(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
