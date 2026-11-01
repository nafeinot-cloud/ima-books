// Application State
let catalogData = [];
let claimsList = [];
let activeTab = 'boxes';
let activeFilter = 'all';
let searchQuery = '';
let isEditMode = false;
let googleScriptUrl = localStorage.getItem('google_sheet_script_url') || '';

// Multi-select Batch state
const selectedBooksMap = new Map(); // key: "boxId__bookIdOrTitle" => { boxId, bookId, bookTitle, isSet, author }

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
  initBatchModal();
  initMergeSetModal();
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
    catalogData = JSON.parse(JSON.stringify(BOOKS_DATA));
  } else {
    catalogData = [];
  }

  // Detect sets automatically if title mentions "סט" or "כרכים"
  catalogData.forEach(box => {
    (box.books || []).forEach(book => {
      if (!book.is_set) {
        const t = (book.title || '') + ' ' + (book.author || '');
        if (t.includes('סט ') || t.includes(' כרכים') || t.includes('ש"ס') || t.includes('מהדורת שבתי פרנקל')) {
          book.is_set = true;
        }
      }
    });
  });

  // Apply saved edits from localStorage
  try {
    const savedEdits = JSON.parse(localStorage.getItem('catalog_edits') || '{}');
    
    // Box category edits
    if (savedEdits.boxes) {
      Object.keys(savedEdits.boxes).forEach(boxId => {
        const box = catalogData.find(b => b.box_id == boxId);
        if (box && savedEdits.boxes[boxId].category !== undefined) {
          box.category = savedEdits.boxes[boxId].category;
        }
      });
    }

    // Book edits & deletions
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

    // Merged sets from user
    if (Array.isArray(savedEdits.mergedSets)) {
      savedEdits.mergedSets.forEach(setObj => {
        const box = catalogData.find(b => b.box_id == setObj.box_id);
        if (box) {
          // Remove the constituent books
          box.books = box.books.filter(b => !setObj.removedIds.includes(b.id));
          // Add merged set if not already present
          if (!box.books.some(b => b.id === setObj.id)) {
            box.books.unshift(setObj);
          }
        }
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
    if (!current.mergedSets) current.mergedSets = [];

    if (editsObj.box) current.boxes[editsObj.box.id] = { category: editsObj.box.category };
    if (editsObj.book) current.books[editsObj.book.id] = editsObj.book;
    if (editsObj.newBook) current.customBooks.push(editsObj.newBook);
    if (editsObj.mergedSet) current.mergedSets.push(editsObj.mergedSet);

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
      showToast(isEditMode ? 'מצב עריכה הופעל: כעת ניתן לערוך, למחוק, או לאחד ספרים לסטים' : 'מצב עריכה כבוי');
      updateBatchBar();
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
  updateBatchBar();
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

// Multi-select Batch Functions
function getBookKey(boxId, bookId, bookTitle) {
  return `${boxId}__${bookId || bookTitle}`;
}

function toggleBookSelection(boxId, bookId, bookTitle, isSet, author, elem) {
  const key = getBookKey(boxId, bookId, bookTitle);
  if (selectedBooksMap.has(key)) {
    selectedBooksMap.delete(key);
  } else {
    selectedBooksMap.set(key, { boxId, bookId, bookTitle, isSet, author });
  }

  updateBatchBar();

  document.querySelectorAll(`[data-book-key="${key}"]`).forEach(el => {
    el.classList.toggle('selected', selectedBooksMap.has(key));
    const cb = el.querySelector('.book-checkbox');
    if (cb) cb.checked = selectedBooksMap.has(key);
  });
}

function updateBatchBar() {
  const bar = document.getElementById('batch-action-bar');
  const countSpan = document.getElementById('batch-count');
  const btnMergeSet = document.getElementById('btn-batch-merge-set');
  const count = selectedBooksMap.size;

  if (countSpan) countSpan.textContent = count;
  if (btnMergeSet) {
    if (count >= 1) {
      btnMergeSet.classList.remove('hidden');
      btnMergeSet.textContent = `📦 הגדר / הוסף לסט (${count})`;
    } else {
      btnMergeSet.classList.add('hidden');
    }
  }

  if (bar) {
    if (count > 0) {
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  }
}

function clearBatchSelection() {
  selectedBooksMap.clear();
  updateBatchBar();
  document.querySelectorAll('.book-item.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.book-checkbox').forEach(cb => cb.checked = false);
}

// Batch Claim Modal
function initBatchModal() {
  const form = document.getElementById('batch-claim-form');
  if (form) form.addEventListener('submit', handleBatchClaimSubmit);
}

function openBatchClaimModal() {
  if (selectedBooksMap.size === 0) return;

  const modal = document.getElementById('batch-claim-modal');
  const listEl = document.getElementById('batch-modal-list');
  const countEl = document.getElementById('batch-modal-count');

  countEl.textContent = selectedBooksMap.size;
  listEl.innerHTML = '';

  const lastName = localStorage.getItem('last_user_name') || '';
  const lastPhone = localStorage.getItem('last_user_phone') || '';
  document.getElementById('batch-claim-name').value = lastName;
  document.getElementById('batch-claim-phone').value = lastPhone;

  let whatsappBooksList = [];
  let index = 1;

  selectedBooksMap.forEach(item => {
    const li = document.createElement('li');
    li.className = 'batch-selected-item';
    li.innerHTML = `
      <span><strong>${index}. ${escapeHtml(item.bookTitle)}</strong> ${item.isSet ? '<span class="set-badge">סט</span>' : ''}</span>
      <span style="color: var(--text-muted); font-size: 0.8rem;">ארגז ${item.boxId}</span>
    `;
    listEl.appendChild(li);

    whatsappBooksList.push(`${index}. ${item.bookTitle} (ארגז ${item.boxId})`);
    index++;
  });

  const btnWa = document.getElementById('batch-whatsapp-link');
  if (btnWa) {
    const text = `שלום נפתלי, ראיתי בקטלוג ספרי אמא ואשמח לקבל את הספרים הבאים:\n${whatsappBooksList.join('\n')}\nתודה, ${lastName || ''}`;
    btnWa.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
    btnWa.classList.remove('hidden');
  }

  modal.classList.remove('hidden');
  document.getElementById('batch-claim-name').focus();
}

function closeBatchClaimModal() {
  const modal = document.getElementById('batch-claim-modal');
  if (modal) modal.classList.add('hidden');
}

function handleBatchClaimSubmit(e) {
  e.preventDefault();

  const userName = document.getElementById('batch-claim-name').value.trim();
  const phoneOrNote = document.getElementById('batch-claim-phone').value.trim();

  if (!userName || selectedBooksMap.size === 0) return;

  localStorage.setItem('last_user_name', userName);
  if (phoneOrNote) localStorage.setItem('last_user_phone', phoneOrNote);

  const timestamp = new Date().toISOString();
  let countSaved = 0;

  selectedBooksMap.forEach(item => {
    claimsList = claimsList.filter(c => !(c.boxId == item.boxId && (c.bookId === item.bookId || c.bookTitle === item.bookTitle)));

    const newClaim = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      timestamp: timestamp,
      boxId: item.boxId,
      bookId: item.bookId,
      bookTitle: item.bookTitle,
      userName: userName,
      userPhone: phoneOrNote,
      notes: item.isSet ? 'סט שלם' : ''
    };

    claimsList.push(newClaim);
    if (googleScriptUrl) sendClaimToCloud(newClaim);
    countSaved++;
  });

  saveClaimsToStorage();
  showToast(`${countSaved} ספרים נרשמו בהצלחה על שם ${userName}!`);

  closeBatchClaimModal();
  clearBatchSelection();
  renderCurrentView();
}

// Merge / Add to Set Functions
function initMergeSetModal() {
  const form = document.getElementById('merge-set-form');
  if (form) form.addEventListener('submit', handleMergeSetSubmit);
}

function toggleMergeMode(mode) {
  const newFields = document.getElementById('merge-new-set-fields');
  const existingGroup = document.getElementById('merge-existing-select-group');
  if (mode === 'existing') {
    if (newFields) newFields.classList.add('hidden');
    if (existingGroup) existingGroup.classList.remove('hidden');
  } else {
    if (newFields) newFields.classList.remove('hidden');
    if (existingGroup) existingGroup.classList.add('hidden');
  }
}

function openMergeSetModal() {
  if (selectedBooksMap.size === 0) {
    alert('יש לסמן לפחות ספר אחד כדי להגדיר או להוסיף לסט.');
    return;
  }

  const modal = document.getElementById('merge-set-modal');
  const listEl = document.getElementById('merge-set-list');
  const countEl = document.getElementById('merge-set-count');
  const titleInput = document.getElementById('merge-set-title');
  const authorInput = document.getElementById('merge-set-author');
  const existingSelect = document.getElementById('merge-existing-set-select');
  const modeSelect = document.getElementById('merge-target-mode');

  countEl.textContent = selectedBooksMap.size;
  listEl.innerHTML = '';

  const items = Array.from(selectedBooksMap.values());
  const selectedBoxIds = new Set(items.map(it => it.boxId));

  // Find all existing sets in the relevant boxes
  let existingSets = [];
  catalogData.forEach(box => {
    if (selectedBoxIds.has(box.box_id)) {
      (box.books || []).forEach(b => {
        if (b.is_set) {
          existingSets.push({ boxId: box.box_id, book: b });
        }
      });
    }
  });

  // Populate existing sets dropdown
  if (existingSelect) {
    existingSelect.innerHTML = '';
    if (existingSets.length > 0) {
      existingSets.forEach(item => {
        const opt = document.createElement('option');
        opt.value = `${item.boxId}:::${item.book.id}`;
        opt.textContent = `ארגז ${item.boxId}: ${item.book.title}`;
        existingSelect.appendChild(opt);
      });
      if (modeSelect) modeSelect.value = 'new';
      toggleMergeMode('new');
    } else {
      if (modeSelect) modeSelect.value = 'new';
      toggleMergeMode('new');
    }
  }

  // Suggest a base title
  let commonTitle = '';
  let commonAuthor = items[0].author || '';
  const firstTitle = items[0].bookTitle;
  const match = firstTitle.match(/^([^\-\–\—:]+)/);
  if (match) commonTitle = match[1].trim();

  titleInput.value = items.length === 1 
    ? `${commonTitle} (סט שלם)` 
    : `${commonTitle} (סט שלם - ${items.length} כרכים)`;
  authorInput.value = commonAuthor;

  items.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'batch-selected-item';
    li.innerHTML = `
      <span><strong>${idx + 1}. ${escapeHtml(item.bookTitle)}</strong></span>
      <span style="color: var(--text-muted); font-size: 0.8rem;">ארגז ${item.boxId}</span>
    `;
    listEl.appendChild(li);
  });

  modal.classList.remove('hidden');
  titleInput.focus();
}

function closeMergeSetModal() {
  const modal = document.getElementById('merge-set-modal');
  if (modal) modal.classList.add('hidden');
}

function handleMergeSetSubmit(e) {
  e.preventDefault();

  const mode = document.getElementById('merge-target-mode').value;
  const items = Array.from(selectedBooksMap.values());

  if (items.length === 0) return;

  if (mode === 'existing') {
    // Add selected books to existing set
    const selectedVal = document.getElementById('merge-existing-set-select').value;
    if (!selectedVal) return;
    const [targetBoxId, targetBookId] = selectedVal.split(':::');

    const box = catalogData.find(b => b.box_id == targetBoxId);
    if (!box) return;
    const targetSet = (box.books || []).find(b => b.id === targetBookId);
    if (!targetSet) return;

    if (!Array.isArray(targetSet.volumes)) targetSet.volumes = [];

    const newTitles = items.map(it => it.bookTitle);
    const removedIds = items.map(it => it.bookId).filter(Boolean);

    targetSet.volumes.push(...newTitles);
    targetSet.volumes_count = targetSet.volumes.length;
    targetSet.notes = `כולל ${targetSet.volumes.length} כרכים: ${targetSet.volumes.join(', ')}`;

    // Remove individual books from box
    box.books = box.books.filter(b => !removedIds.includes(b.id) && !newTitles.includes(b.title));

    saveCatalogEdits({
      mergedSet: {
        id: targetSet.id,
        box_id: targetBoxId,
        title: targetSet.title,
        volumes: targetSet.volumes,
        volumes_count: targetSet.volumes_count,
        removedIds: removedIds
      }
    });

    showToast(`${items.length} ספרים נוספו בהצלחה לסט: "${targetSet.title}"!`);
  } else {
    // Create new unified set
    const title = document.getElementById('merge-set-title').value.trim();
    const author = document.getElementById('merge-set-author').value.trim();
    if (!title) return;

    const byBox = {};
    items.forEach(it => {
      if (!byBox[it.boxId]) byBox[it.boxId] = [];
      byBox[it.boxId].push(it);
    });

    Object.keys(byBox).forEach(boxId => {
      const boxItems = byBox[boxId];
      const box = catalogData.find(b => b.box_id == boxId);
      if (!box) return;

      const removedIds = boxItems.map(it => it.bookId).filter(Boolean);
      const volumeTitles = boxItems.map(it => it.bookTitle);

      box.books = box.books.filter(b => !removedIds.includes(b.id) && !volumeTitles.includes(b.title));

      const newSetObj = {
        id: `set_user_${boxId}_${Date.now()}`,
        box_id: boxId,
        title: title,
        author: author,
        is_set: true,
        volumes_count: volumeTitles.length,
        volumes: volumeTitles,
        notes: `כולל: ${volumeTitles.join(', ')}`,
        removedIds: removedIds
      };

      box.books.unshift(newSetObj);
      saveCatalogEdits({ mergedSet: newSetObj });
    });

    showToast(`הספרים הוגדרו בהצלחה כסט שלם: "${title}"!`);
  }

  closeMergeSetModal();
  clearBatchSelection();
  renderCurrentView();
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
      if (activeFilter === 'sets' && !book.is_set) return false;

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
      <div class="box-image-wrap" onclick="openLightboxById(${box.box_id})">
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
            ${box.filteredBooks.length} פריטים
          </span>
        </div>

        <ul class="books-list" id="box-books-${box.box_id}">
          ${box.filteredBooks.map(book => {
            const claim = getBookClaim(box.box_id, book.id, book.title);
            const isClaimed = !!claim;
            const isSet = !!book.is_set;
            const bookKey = getBookKey(box.box_id, book.id, book.title);
            const isSelected = selectedBooksMap.has(bookKey);
            const hasVolumes = Array.isArray(book.volumes) && book.volumes.length > 0;

            return `
              <li class="book-item ${isSet ? 'is-set' : ''} ${isClaimed ? 'claimed' : ''} ${isSelected ? 'selected' : ''}" 
                  data-book-key="${bookKey}"
                  onclick="${!isClaimed ? `toggleBookSelection(${box.box_id}, '${book.id || ''}', '${escapeForJs(book.title)}', ${isSet}, '${escapeForJs(book.author || '')}', this)` : ''}">
                
                ${!isClaimed ? `
                  <input type="checkbox" class="book-checkbox" ${isSelected ? 'checked' : ''} 
                         onclick="event.stopPropagation(); toggleBookSelection(${box.box_id}, '${book.id || ''}', '${escapeForJs(book.title)}', ${isSet}, '${escapeForJs(book.author || '')}', this)" 
                         title="סמן לבחירה מרובה / איחוד כסט">
                ` : ''}

                <div class="book-info">
                  <div class="book-name">
                    ${escapeHtml(book.title)}
                    ${isSet ? `<span class="set-badge">📦 סט שלם</span>` : ''}
                  </div>
                  ${book.author ? `<div class="book-author">${escapeHtml(book.author)}</div>` : ''}
                  
                  ${hasVolumes ? `
                    <div>
                      <button type="button" class="volumes-toggle" onclick="event.stopPropagation(); toggleVolumes('v_${book.id}')">
                        📖 פירוט ${book.volumes.length} הכרכים בסט
                      </button>
                      <ul id="v_${book.id}" class="volumes-list hidden" onclick="event.stopPropagation()">
                        ${book.volumes.map(v => `<li>${escapeHtml(v)}</li>`).join('')}
                      </ul>
                    </div>
                  ` : ''}
                </div>

                <div class="book-action" onclick="event.stopPropagation()">
                  ${isEditMode ? `
                    <button class="btn-edit-item" onclick="openEditBookModal(${box.box_id}, '${book.id}')" title="ערוך פרטי ספר">✏️</button>
                    <button class="btn-delete-item" onclick="deleteBook(${box.box_id}, '${book.id}')" title="מחק ספר">🗑️</button>
                  ` : ''}

                  ${isClaimed 
                    ? `<span class="claimed-tag">✓ נבחר ע״י ${escapeHtml(claim.userName)}</span>` 
                    : `<button class="btn-claim" onclick="openClaimModal(${box.box_id}, '${book.id || ''}', '${escapeForJs(book.title)}')">🖐️ ${isSet ? 'קח סט' : 'אני רוצה'}</button>`
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

function toggleVolumes(elemId) {
  const el = document.getElementById(elemId);
  if (el) el.classList.toggle('hidden');
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
    if (activeFilter === 'sets' && !book.is_set) return false;

    if (searchQuery) {
      const matchTitle = (book.title || '').toLowerCase().includes(searchQuery);
      const matchAuthor = (book.author || '').toLowerCase().includes(searchQuery);
      const matchBox = `ארגז ${book.boxId}`.includes(searchQuery);
      const matchClaimer = claim && claim.userName.toLowerCase().includes(searchQuery);
      return matchTitle || matchAuthor || matchBox || matchClaimer;
    }

    return true;
  });

  if (countText) countText.textContent = `מוצגים ${allBooks.length} פריטים`;

  if (allBooks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">לא נמצאו ספרים תואמים</td></tr>`;
    return;
  }

  allBooks.forEach(book => {
    const claim = getBookClaim(book.boxId, book.id, book.title);
    const isClaimed = !!claim;
    const isSet = !!book.is_set;
    const bookKey = getBookKey(book.boxId, book.id, book.title);
    const isSelected = selectedBooksMap.has(bookKey);
    const thumbUrl = `web_images/${book.imageName}`;
    const origUrl = `original_photos/${book.imageName}`;

    const tr = document.createElement('tr');
    tr.className = isSelected ? 'selected' : '';
    tr.dataset.bookKey = bookKey;

    tr.innerHTML = `
      <td><strong>${book.boxId}</strong></td>
      <td>
        <img class="table-thumb" src="${thumbUrl}" onerror="this.onerror=null; this.src='${origUrl}'" onclick="openLightboxById(${book.boxId})" title="לחץ להגדלה" alt="ארגז ${book.boxId}">
      </td>
      <td style="font-weight: 600;">
        <div style="display: flex; align-items: center; gap: 8px;">
          ${!isClaimed ? `
            <input type="checkbox" class="book-checkbox" ${isSelected ? 'checked' : ''} 
                   onclick="event.stopPropagation(); toggleBookSelection(${book.boxId}, '${book.id || ''}', '${escapeForJs(book.title)}', ${isSet}, '${escapeForJs(book.author || '')}', this)">
          ` : ''}
          <span>${escapeHtml(book.title)}</span>
          ${isSet ? `<span class="set-badge">סט שלם</span>` : ''}
        </div>
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
        ${imageName ? `<img class="table-thumb" src="${thumbUrl}" onerror="this.onerror=null; this.src='${origUrl}'" onclick="openLightboxById(${c.boxId})" title="לחץ להגדלה">` : '-'}
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

  selectedBooksMap.delete(getBookKey(boxId, bookId, bookTitle));
  updateBatchBar();

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
  const img = document.getElementById('lightbox-img');
  if (!viewport) return;

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn(0.2);
    } else {
      zoomOut(0.2);
    }
  }, { passive: false });

  // Toggle zoom on image click
  if (img) {
    img.style.pointerEvents = 'auto';
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentZoom === 1) {
        zoomIn(0.8);
      } else {
        resetZoom();
      }
    });
  }

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

  // Close when clicking empty space in viewport
  viewport.addEventListener('click', (e) => {
    if (e.target === viewport || e.target.id === 'lightbox-container') {
      closeLightbox();
    }
  });

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

function openLightboxById(boxId) {
  const box = catalogData.find(b => b.box_id == boxId);
  if (!box) return;
  const caption = `ארגז מס׳ ${box.box_id}${box.category ? ': ' + box.category : ''}`;
  openLightbox(box.image_name, caption);
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
    } else if (img.src.includes('original_photos/')) {
      img.src = imageName;
    }
  };

  img.src = webUrl;
  cap.textContent = caption || '';
  if (extLink) extLink.href = origUrl;

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function closeLightbox() {
  const modal = document.getElementById('lightbox-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
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
