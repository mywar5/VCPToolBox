(function () {
  const API_BASE = '/AdminPanel/dailynote_api';

  // ------- 本地设置 -------

  const DEFAULT_SETTINGS = {
    blockedNotebooks: [],
    autoBlockClusters: false,
    themeMode: 'auto',          // auto | light | dark
    cardsColumns: 5,
    cardMaxLines: 5,
    pageSize: 100,
    sortMode: 'mtime-desc',     // mtime-desc | mtime-asc | name-asc | name-desc
    globalFontSize: 16          // 全局基础字体大小（px）
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem('DailyNotePanelSettings');
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
      console.warn('[DailyNotePanel] Failed to load settings:', e);
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem('DailyNotePanelSettings', JSON.stringify(settings));
    } catch (e) {
      console.warn('[DailyNotePanel] Failed to save settings:', e);
    }
  }

  let settings = loadSettings();

  // ------- DOM 引用 -------

  const sidebar = document.getElementById('sidebar');
  const notebookList = document.getElementById('notebook-list');
  const notebookMiniList = document.getElementById('notebook-mini-list');
  const toggleSidebarBtn = document.getElementById('toggle-sidebar');
  const openSettingsBtn = document.getElementById('open-settings');

  const topBarDefault = document.getElementById('top-bar-default');
  const topBarEditor = document.getElementById('top-bar-editor');
  const topBarSettings = document.getElementById('top-bar-settings');

  const searchInput = document.getElementById('search-input');
  const bulkToggleButton = document.getElementById('bulk-toggle-button');

  const cardsView = document.getElementById('cards-view');
  const editorView = document.getElementById('editor-view');
  const settingsView = document.getElementById('settings-view');

  const cardsContainer = document.getElementById('cards-container');
  const cardsStatus = document.getElementById('cards-status');
  const prevPageBtn = document.getElementById('prev-page');
  const nextPageBtn = document.getElementById('next-page');
  const pageInfoSpan = document.getElementById('page-info');

  const deleteModalBackdrop = document.getElementById('delete-modal-backdrop');
  const deleteCountSpan = document.getElementById('delete-count');
  const deleteListContainer = document.getElementById('delete-list');
  const deleteCancelBtn = document.getElementById('delete-cancel');
  const deleteConfirmBtn = document.getElementById('delete-confirm');

  const backToCardsBtn = document.getElementById('back-to-cards');
  const editorFilenameSpan = document.getElementById('editor-filename');
  const editorModeToggle = document.getElementById('editor-mode-toggle');
  const saveNoteButton = document.getElementById('save-note-button');
  const editorTextarea = document.getElementById('editor-textarea');
  const editorPreview = document.getElementById('editor-preview');

  const backFromSettingsBtn = document.getElementById('back-from-settings');
  const blockedNotebooksContainer = document.getElementById('blocked-notebooks-container');
  const autoBlockClustersCheckbox = document.getElementById('auto-block-clusters');
  const themeModeSelect = document.getElementById('theme-mode-select');
  const cardsColumnsInput = document.getElementById('cards-columns');
  const cardMaxLinesInput = document.getElementById('card-max-lines');
  const pageSizeInput = document.getElementById('page-size');
  const sortModeSelect = document.getElementById('sort-mode');
  const globalFontSizeInput = document.getElementById('global-font-size');
  const settingsResetBtn = document.getElementById('settings-reset');
  const forceUpdateBtn = document.getElementById('force-update-btn');
  const settingsStatus = document.getElementById('settings-status');

  // ------- 运行时状态 -------

  let notebooks = [];            // [{ name }]
  let currentNotebook = null;    // string
  let notes = [];                // 当前「源列表」（可能来自 /notes 或 /search）
  let filteredNotes = [];        // 排序 + 过滤后的列表
  let bulkMode = false;          // 批量选择模式
  let selectedSet = new Set();   // `folder/name` 形式
  let currentPage = 1;           // 简单分页
  let editorState = {
    folder: null,
    file: null,
    mode: 'edit'                 // edit | preview
  };

  let lastNotesFingerprint = null; // 用于自动刷新（简单版本）
  // 高亮定时器：key = `${folderName}/${note.name}`, value = { toYellow, clearAll }
  let highlightTimers = new Map();

  // 删除确认弹窗当前要删除的列表缓存
  let pendingDeleteFiles = [];

  // ------- 工具函数 -------

  async function apiGet(path) {
    const res = await fetch(API_BASE + path, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    return res.json();
  }

  // 极简 Markdown 渲染（不引入外部依赖，够用版）
  function renderMarkdown(text) {
    if (!text) return '';
    let html = text;

    // 转义基础 HTML
    html = html
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');

    // 代码块 ```...```
    html = html.replace(/```([\s\S]*?)```/g, function (_, code) {
      return '<pre><code>' + code.trim().replace(/\n/g, '<br/>') + '</code></pre>';
    });

    // 行内代码 `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 标题行 # / ## / ###
    html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

    // 无序列表行 - / * 开头
    html = html.replace(/^(?:\s*[-*]\s+.+\n?)+/gm, function (block) {
      const items = block
        .trim()
        .split(/\n/)
        .map(line => line.replace(/^\s*[-*]\s+/, '').trim())
        .filter(Boolean)
        .map(item => '<li>' + item + '</li>')
        .join('');
      return '<ul>' + items + '</ul>';
    });

    // 段落：简单按双换行切分
    html = html
      .split(/\n{2,}/)
      .map(chunk => {
        if (/^<h[1-6]>/.test(chunk) || /^<ul>/.test(chunk) || /^<pre>/.test(chunk)) return chunk;
        return '<p>' + chunk.replace(/\n/g, '<br/>') + '</p>';
      })
      .join('');

    return html;
  }

  function applyTheme() {
    const root = document.documentElement;
    const mode = settings.themeMode;
    if (mode === 'light') {
      root.setAttribute('data-theme', 'light');
    } else if (mode === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      const prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }

  function updateCardsGridColumns() {
    const cols = settings.cardsColumns;
    // 使用固定列数，而不是 auto-fill，让设置更直观
    cardsContainer.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  }

  // 这里不再尝试用 CSS 的 -webkit-line-clamp 做“视觉行数”控制，
  // 而是仅用它做一个“最多 N 行”的软约束。真正的“多 / 少”感受，交给文本本身长度。
  function clampTextLines(element, maxLines) {
    if (!element) return;
    const raw = element.textContent || '';
    if (!raw) return;

    const max = Number(maxLines) || 5;
    const approxCharsPerLine = 40;
    const hardLimit = max * approxCharsPerLine;

    let truncated = raw;
    if (raw.length > hardLimit) {
      truncated = raw.slice(0, hardLimit) + ' …';
    }

    // 彻底不用任何 layout 相关的 CSS 限制，让浏览器老实按内容自然排版
    element.textContent = truncated;
    element.style.display = '';
    element.style.webkitBoxOrient = '';
    element.style.webkitLineClamp = '';
    element.style.overflow = '';
  }

  function sortedNotes(source) {
    const arr = [...source];
    const mode = settings.sortMode;
    arr.sort((a, b) => {
      if (mode === 'mtime-desc') {
        return b.mtime - a.mtime;
      } else if (mode === 'mtime-asc') {
        return a.mtime - b.mtime;
      } else if (mode === 'name-asc') {
        return a.name.localeCompare(b.name, 'zh-CN');
      } else if (mode === 'name-desc') {
        return b.name.localeCompare(a.name, 'zh-CN');
      }
      return 0;
    });
    return arr;
  }

  function applyGlobalFontSize() {
    // 优先使用显式配置；如果没有，则写入默认值并持久化，保证后续变更能生效
    if (
      typeof settings.globalFontSize !== 'number' ||
      Number.isNaN(settings.globalFontSize)
    ) {
      settings.globalFontSize = DEFAULT_SETTINGS.globalFontSize;
      saveSettings(settings);
    }
    const size = settings.globalFontSize;
    document.documentElement.style.fontSize = size + 'px';
  }

  function notebookVisible(name) {
    if (settings.blockedNotebooks.includes(name)) return false;
    if (settings.autoBlockClusters && name.endsWith('簇')) return false;
    return true;
  }

  // ------- 侧边栏渲染 -------

  function renderNotebookLists() {
    notebookList.innerHTML = '';
    notebookMiniList.innerHTML = '';

    const visibleNotebooks = notebooks.filter(n => notebookVisible(n.name));
    const activeName = currentNotebook;

    visibleNotebooks.forEach(nb => {
      const li = document.createElement('div');
      li.className = 'notebook-item';
      if (nb.name === activeName) li.classList.add('active');

      const dot = document.createElement('div');
      dot.className = 'notebook-dot';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'notebook-name';
      nameSpan.textContent = nb.name;

      li.appendChild(dot);
      li.appendChild(nameSpan);

      li.addEventListener('click', () => {
        if (currentNotebook === nb.name) return;
        currentNotebook = nb.name;
        localStorage.setItem('DailyNotePanel_LastNotebook', currentNotebook);
        selectedSet.clear();
        bulkMode = false;
        updateBulkModeUI();
        loadNotesForNotebook(nb.name).catch(console.error);
      });

      notebookList.appendChild(li);
    });

    visibleNotebooks.forEach(nb => {
      const mini = document.createElement('div');
      mini.className = 'notebook-mini-item';
      if (nb.name === activeName) mini.classList.add('active');

      const firstChar = (nb.name || '').trim().charAt(0) || '?';
      mini.textContent = firstChar;

      mini.addEventListener('click', () => {
        if (currentNotebook === nb.name) return;
        currentNotebook = nb.name;
        localStorage.setItem('DailyNotePanel_LastNotebook', currentNotebook);
        selectedSet.clear();
        bulkMode = false;
        updateBulkModeUI();
        loadNotesForNotebook(nb.name).catch(console.error);
      });

      notebookMiniList.appendChild(mini);
    });
  }

  // ------- 搜索 & 排序 -------

  async function refreshNotesUsingSearchIfNeeded() {
    const q = (searchInput.value || '').trim();
    if (!q) {
      // 无搜索词时，notes 已由 loadNotesForNotebook 填充
      filteredNotes = sortedNotes(notes);
      return;
    }

    const params = new URLSearchParams();
    // 官方 API 使用 term 而不是 q
    params.set('term', q);
    if (currentNotebook) {
      params.set('folder', currentNotebook);
    }

    try {
      const data = await apiGet('/search?' + params.toString());
      // 官方 search 返回的 notes 带有 folderName/name/lastModified/preview
      notes = (data.notes || []).map(n => {
        const mtime =
          n.mtime != null
            ? n.mtime
            : n.lastModified
            ? new Date(n.lastModified).getTime()
            : 0;
        return {
          folderName: n.folderName || currentNotebook || '',
          name: n.name,
          mtime,
          size: n.size != null ? n.size : 0,
          preview: n.preview
        };
      });
      filteredNotes = sortedNotes(notes);
    } catch (e) {
      console.error('[DailyNotePanel] search error:', e);
      // 搜索失败时不改变原 notes，只前端退回空过滤
      filteredNotes = sortedNotes(notes);
    }
  }

  function computeFingerprint(list) {
    if (!list || list.length === 0) return '0:0';
    const total = list.length;
    const latest = list.reduce((max, n) => (n.mtime > max ? n.mtime : max), 0);
    return `${total}:${latest}`;
  }

  // ------- 卡片渲染 -------

  async function recomputeAndRenderCards() {
    // 如果有搜索词，使用 /search；否则使用当前 notes
    await refreshNotesUsingSearchIfNeeded();
    currentPage = 1;
    renderCards();
  }

  function renderCards() {
    // 渲染前先清理所有旧的高亮定时器，避免内存泄漏和重复切换
    highlightTimers.forEach(timerObj => {
      if (timerObj.toYellow) clearTimeout(timerObj.toYellow);
      if (timerObj.clearAll) clearTimeout(timerObj.clearAll);
    });
    highlightTimers.clear();

    cardsContainer.innerHTML = '';
    const total = filteredNotes.length;
    const pageSize = settings.pageSize;
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > maxPage) currentPage = maxPage;

    const start = (currentPage - 1) * pageSize;
    const end = Math.min(total, start + pageSize);
    const slice = filteredNotes.slice(start, end);

    const currentFingerprint = computeFingerprint(filteredNotes);
    lastNotesFingerprint = currentFingerprint;

    const now = Date.now();

    slice.forEach(note => {
      const card = document.createElement('div');
      card.className = 'note-card';

      const folderName = note.folderName || currentNotebook || '';
      const noteId = `${folderName}/${note.name}`;

      // 基于修改时间添加发光高亮，且注册后续状态切换定时器：
      // - 10 分钟内：绿色
      // - 10–30 分钟内：黄色
      // - 超过 30 分钟：无高亮
      if (note.mtime && typeof note.mtime === 'number') {
        const diffMs = now - note.mtime;
        const diffMinutes = diffMs / 60000;

        let toYellowTimer = null;
        let clearAllTimer = null;

        if (diffMinutes <= 10) {
          card.classList.add('glow-green');

          // 距离 10 分钟还有多久，届时从绿变黄
          const msToYellow = Math.max(0, 10 * 60000 - diffMs);
          toYellowTimer = setTimeout(() => {
            card.classList.remove('glow-green');
            card.classList.add('glow-yellow');
          }, msToYellow);

          // 距离 30 分钟还有多久，届时移除所有高亮
          const msToClear = Math.max(0, 30 * 60000 - diffMs);
          clearAllTimer = setTimeout(() => {
            card.classList.remove('glow-green');
            card.classList.remove('glow-yellow');
          }, msToClear);
        } else if (diffMinutes > 10 && diffMinutes <= 30) {
          card.classList.add('glow-yellow');

          // 距离 30 分钟还有多久，届时移除黄色高亮
          const msToClear = Math.max(0, 30 * 60000 - diffMs);
          clearAllTimer = setTimeout(() => {
            card.classList.remove('glow-yellow');
          }, msToClear);
        }

        if (toYellowTimer || clearAllTimer) {
          highlightTimers.set(noteId, {
            toYellow: toYellowTimer,
            clearAll: clearAllTimer
          });
        }
      }

      if (selectedSet.has(noteId)) card.classList.add('selected');

      const header = document.createElement('div');
      header.className = 'note-card-header';

      let checkbox = null;
      if (bulkMode) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'note-checkbox';
        checkbox.checked = selectedSet.has(noteId);
        checkbox.addEventListener('click', e => {
          e.stopPropagation();
          if (checkbox.checked) {
            selectedSet.add(noteId);
          } else {
            selectedSet.delete(noteId);
          }
          renderCardsStatus();
        });
        header.appendChild(checkbox);
      }

      const title = document.createElement('h3');
      title.className = 'note-filename';
      title.textContent = note.name;
      header.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'note-meta';
      const d = new Date(note.mtime);
      meta.textContent = `修改于：${d.toLocaleString()}`;

      const preview = document.createElement('div');
      preview.className = 'note-preview';
      // 卡片预览使用纯文本，避免轻量 Markdown 渲染带来的兼容性和样式不稳定问题
      preview.textContent = note.preview || '';
      clampTextLines(preview, settings.cardMaxLines);

      card.appendChild(header);
      card.appendChild(meta);
      card.appendChild(preview);

      card.addEventListener('click', () => {
        if (bulkMode) {
          const exist = selectedSet.has(noteId);
          if (exist) {
            selectedSet.delete(noteId);
          } else {
            selectedSet.add(noteId);
          }
          renderCards();
          renderCardsStatus();
          return;
        }
        openEditor(folderName, note.name);
      });

      cardsContainer.appendChild(card);
    });

    renderCardsStatus();
  }

  function renderCardsStatus() {
    const total = filteredNotes.length;
    const pageSize = settings.pageSize;
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const selectionCount = selectedSet.size;

    cardsStatus.textContent =
      `共 ${total} 条日记` +
      (bulkMode ? ` | 已选中 ${selectionCount} 条` : '');

    if (pageInfoSpan) {
      pageInfoSpan.textContent = `第 ${currentPage}/${maxPage} 页`;
    }
    if (prevPageBtn) {
      prevPageBtn.disabled = currentPage <= 1;
    }
    if (nextPageBtn) {
      nextPageBtn.disabled = currentPage >= maxPage;
    }
  }

  // ------- 模式切换 -------

  function showCardsView() {
    cardsView.classList.remove('hidden');
    editorView.classList.add('hidden');
    settingsView.classList.add('hidden');

    topBarDefault.classList.remove('hidden');
    topBarEditor.classList.add('hidden');
    topBarSettings.classList.add('hidden');
  }

  function showEditorView() {
    cardsView.classList.add('hidden');
    editorView.classList.remove('hidden');
    settingsView.classList.add('hidden');

    topBarDefault.classList.add('hidden');
    topBarEditor.classList.remove('hidden');
    topBarSettings.classList.add('hidden');
  }

  function showSettingsView() {
    cardsView.classList.add('hidden');
    editorView.classList.add('hidden');
    settingsView.classList.remove('hidden');

    topBarDefault.classList.add('hidden');
    topBarEditor.classList.add('hidden');
    topBarSettings.classList.remove('hidden');
  }

  // ------- 事件绑定 -------

  function updateBulkModeUI() {
    if (bulkMode) {
      bulkToggleButton.classList.add('danger-active');
    } else {
      bulkToggleButton.classList.remove('danger-active');
      selectedSet.clear();
    }
    renderCards();
  }

  function bindEvents() {
    if (toggleSidebarBtn) {
      toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
      });
    }

    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        const total = filteredNotes.length;
        const pageSize = settings.pageSize;
        const maxPage = Math.max(1, Math.ceil(total / pageSize));
        if (currentPage > 1) {
          currentPage -= 1;
          renderCards();
        }
      });
    }

    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        const total = filteredNotes.length;
        const pageSize = settings.pageSize;
        const maxPage = Math.max(1, Math.ceil(total / pageSize));
        if (currentPage < maxPage) {
          currentPage += 1;
          renderCards();
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        recomputeAndRenderCards().catch(console.error);
      });
    }

    if (bulkToggleButton) {
      bulkToggleButton.addEventListener('click', () => {
        if (bulkMode && selectedSet.size > 0) {
          // 进入二次确认弹窗，而不是直接 confirm()
          const files = Array.from(selectedSet).map(id => {
            const [folder, file] = id.split('/');
            return { folder, file };
          });
          openDeleteModal(files);
        } else {
          bulkMode = !bulkMode;
          updateBulkModeUI();
        }
      });
    }

    if (backToCardsBtn) {
      backToCardsBtn.addEventListener('click', () => {
        showCardsView();
      });
    }

    if (editorModeToggle) {
      editorModeToggle.addEventListener('click', () => {
        if (editorState.mode === 'edit') {
          editorState.mode = 'preview';
          editorTextarea.classList.add('hidden');
          editorPreview.classList.remove('hidden');
          editorPreview.innerHTML = renderMarkdown(editorTextarea.value);
        } else {
          editorState.mode = 'edit';
          editorTextarea.classList.remove('hidden');
          editorPreview.classList.add('hidden');
        }
      });
    }

    if (saveNoteButton) {
      saveNoteButton.addEventListener('click', async () => {
        if (!editorState.folder || !editorState.file) return;
        try {
          // 同样移除 encodeURIComponent
          await apiPost(
            `/note/${editorState.folder}/${editorState.file}`,
            { content: editorTextarea.value }
          );
          if (currentNotebook === editorState.folder) {
            await loadNotesForNotebook(editorState.folder);
            await recomputeAndRenderCards();
          }
          showCardsView();
        } catch (e) {
          console.error('[DailyNotePanel] save error:', e);
        }
      });
    }

    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => {
        syncSettingsUI();
        showSettingsView();
      });
    }
    if (backFromSettingsBtn) {
      backFromSettingsBtn.addEventListener('click', () => {
        showCardsView();
      });
    }

    if (autoBlockClustersCheckbox) {
      autoBlockClustersCheckbox.addEventListener('change', () => {
        settings.autoBlockClusters = !!autoBlockClustersCheckbox.checked;
        saveSettings(settings);
        renderNotebookLists();
        recomputeAndRenderCards().catch(console.error);
      });
    }

    if (themeModeSelect) {
      themeModeSelect.addEventListener('change', () => {
        settings.themeMode = themeModeSelect.value;
        saveSettings(settings);
        applyTheme();
      });
    }

    if (cardsColumnsInput) {
      cardsColumnsInput.addEventListener('change', () => {
        const v = parseInt(cardsColumnsInput.value, 10);
        if (!isNaN(v) && v >= 1 && v <= 8) {
          settings.cardsColumns = v;
          saveSettings(settings);
          updateCardsGridColumns();
        }
      });
    }
    if (cardMaxLinesInput) {
      cardMaxLinesInput.addEventListener('change', () => {
        const v = parseInt(cardMaxLinesInput.value, 10);
        if (!isNaN(v) && v >= 1 && v <= 20) {
          settings.cardMaxLines = v;
          saveSettings(settings);
          renderCards();
        }
      });
    }
    if (pageSizeInput) {
      pageSizeInput.addEventListener('change', () => {
        const v = parseInt(pageSizeInput.value, 10);
        if (!isNaN(v) && v >= 10 && v <= 500) {
          settings.pageSize = v;
          saveSettings(settings);
          currentPage = 1;
          renderCards();
        }
      });
    }
    if (sortModeSelect) {
      sortModeSelect.addEventListener('change', () => {
        settings.sortMode = sortModeSelect.value;
        saveSettings(settings);
        filteredNotes = sortedNotes(filteredNotes);
        currentPage = 1;
        renderCards();
      });
    }
    if (globalFontSizeInput) {
      globalFontSizeInput.addEventListener('change', () => {
        const v = parseInt(globalFontSizeInput.value, 10);
        if (!isNaN(v) && v >= 10 && v <= 24) {
          settings.globalFontSize = v;
          saveSettings(settings);
          applyGlobalFontSize();
        } else {
          // 非法输入时，回退到当前有效值，避免出现“看起来改了但实际没效果”的错觉
          globalFontSizeInput.value =
            typeof settings.globalFontSize === 'number'
              ? settings.globalFontSize
              : DEFAULT_SETTINGS.globalFontSize;
        }
      });
    }

    if (settingsResetBtn) {
      settingsResetBtn.addEventListener('click', () => {
        settings = { ...DEFAULT_SETTINGS };
        saveSettings(settings);
        syncSettingsUI();
        applyTheme();
        updateCardsGridColumns();
        renderNotebookLists();
        applyGlobalFontSize();
        recomputeAndRenderCards().catch(console.error);
        settingsStatus.textContent = '已重置为默认设置';
        setTimeout(() => (settingsStatus.textContent = ''), 2000);
      });
    }

    if (forceUpdateBtn) {
      forceUpdateBtn.addEventListener('click', async () => {
        if (!confirm('确定要清除所有缓存并强制刷新吗？\n这将注销 Service Worker 并重新加载最新版本。')) return;

        try {
          if (settingsStatus) {
            settingsStatus.textContent = '正在清理缓存与 Service Worker...';
          }

          // 注销当前域名下所有 Service Worker
          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
              await registration.unregister();
            }
          }

          // 清除 Cache Storage
          if ('caches' in window) {
            const keys = await caches.keys();
            for (const key of keys) {
              await caches.delete(key);
            }
          }

          // 最后强制刷新页面
          window.location.reload();
        } catch (e) {
          console.error('[DailyNotePanel] force update failed:', e);
          if (settingsStatus) {
            settingsStatus.textContent = '强制刷新失败，请尝试手动清理浏览器缓存';
            setTimeout(() => (settingsStatus.textContent = ''), 3000);
          }
        }
      });
    }

    // 删除确认弹窗事件
    if (deleteCancelBtn) {
      deleteCancelBtn.addEventListener('click', () => {
        closeDeleteModal();
      });
    }
    if (deleteConfirmBtn) {
      deleteConfirmBtn.addEventListener('click', async () => {
        if (!pendingDeleteFiles || pendingDeleteFiles.length === 0) {
          closeDeleteModal();
          return;
        }
        try {
          // 官方 API：POST /delete-batch，body: { notesToDelete: [{ folder, file }] }
          await apiPost('/delete-batch', { notesToDelete: pendingDeleteFiles });
        } catch (e) {
          console.error('[DailyNotePanel] delete error:', e);
        }
        selectedSet.clear();
        pendingDeleteFiles = [];
        closeDeleteModal();
        if (currentNotebook) {
          await loadNotesForNotebook(currentNotebook);
          await recomputeAndRenderCards();
        }
      });
    }
  }

  // ------- 设置 UI 同步 -------

  function syncSettingsUI() {
    autoBlockClustersCheckbox.checked = !!settings.autoBlockClusters;
    themeModeSelect.value = settings.themeMode;
    cardsColumnsInput.value = settings.cardsColumns;
    cardMaxLinesInput.value = settings.cardMaxLines;
    pageSizeInput.value = settings.pageSize;
    sortModeSelect.value = settings.sortMode;
    if (globalFontSizeInput) {
      globalFontSizeInput.value =
        typeof settings.globalFontSize === 'number'
          ? settings.globalFontSize
          : DEFAULT_SETTINGS.globalFontSize;
    }
 
    blockedNotebooksContainer.innerHTML = '';
    notebooks.forEach(nb => {
      const row = document.createElement('label');
      row.className = 'settings-row';

      const span = document.createElement('span');
      span.textContent = nb.name;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = settings.blockedNotebooks.includes(nb.name);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!settings.blockedNotebooks.includes(nb.name)) {
            settings.blockedNotebooks.push(nb.name);
          }
        } else {
          settings.blockedNotebooks = settings.blockedNotebooks.filter(x => x !== nb.name);
        }
        saveSettings(settings);
        renderNotebookLists();
        recomputeAndRenderCards().catch(console.error);
      });

      row.appendChild(span);
      row.appendChild(checkbox);
      blockedNotebooksContainer.appendChild(row);
    });
  }

  // ------- 删除确认弹窗 -------
  
  function openDeleteModal(files) {
    pendingDeleteFiles = files || [];
    if (!deleteModalBackdrop) return;
    // 数量
    if (deleteCountSpan) {
      deleteCountSpan.textContent = String(pendingDeleteFiles.length);
    }
    // 列表
    if (deleteListContainer) {
      deleteListContainer.innerHTML = '';
      pendingDeleteFiles.forEach(item => {
        const div = document.createElement('div');
        div.className = 'modal-list-item';
        div.textContent = `${item.folder}/${item.file}`;
        deleteListContainer.appendChild(div);
      });
    }
    deleteModalBackdrop.classList.remove('hidden');
  }

  function closeDeleteModal() {
    if (!deleteModalBackdrop) return;
    deleteModalBackdrop.classList.add('hidden');
  }

  // ------- 数据加载 -------

  async function loadNotebooks() {
    try {
      const data = await apiGet('/folders');
      notebooks = (data.folders || []).map(name => ({ name }));

      // 尝试从 localStorage 恢复上次打开的日记本
      if (!currentNotebook) {
        currentNotebook = localStorage.getItem('DailyNotePanel_LastNotebook');
      }

      // 验证当前选中的日记本是否有效（存在且可见）
      const hasValidCurrent =
        currentNotebook &&
        notebooks.some(n => n.name === currentNotebook && notebookVisible(n.name));

      if (!hasValidCurrent) {
        const firstVisible = notebooks.find(n => notebookVisible(n.name));
        currentNotebook = firstVisible ? firstVisible.name : null;
      }

      // 确认为有效值后，更新 localStorage（防止存的是无效值）
      if (currentNotebook) {
        localStorage.setItem('DailyNotePanel_LastNotebook', currentNotebook);
      }

      renderNotebookLists();
      if (currentNotebook) {
        await loadNotesForNotebook(currentNotebook);
      } else {
        notes = [];
        filteredNotes = [];
        renderCards();
      }
      syncSettingsUI();
      applyGlobalFontSize();
      await recomputeAndRenderCards();
    } catch (e) {
      console.error('[DailyNotePanel] loadNotebooks error:', e);
    }
  }

  async function loadNotesForNotebook(notebookName) {
    try {
      // 官方 API 使用 /folder/:folderName 获取某个日记本下的文件列表
      // 注意：官方 API 路由中，folderName 是直接作为路径参数，而不是查询参数
      // 且官方 API 内部使用 path.join(root, folderName)，所以这里不需要 encodeURIComponent
      // 否则 "文献鸟" 会变成 "%E6%96%87%E7%8C%AE%E9%B8%9F"，导致 fs.readdir 找不到目录
      const data = await apiGet('/folder/' + notebookName);
      notes = (data.notes || []).map(n => {
        const mtime =
          n.mtime != null
            ? n.mtime
            : n.lastModified
            ? new Date(n.lastModified).getTime()
            : 0;
        return {
          folderName: notebookName,
          name: n.name,
          mtime,
          size: n.size != null ? n.size : 0,
          preview: n.preview
        };
      });
      filteredNotes = sortedNotes(notes);
      currentPage = 1;
      renderCards();
      renderNotebookLists();
    } catch (e) {
      console.error('[DailyNotePanel] loadNotes error:', e);
    }
  }

  // ------- 编辑 -------

  async function openEditor(folder, file) {
    try {
      // 同样移除 encodeURIComponent
      const data = await apiGet(
        '/note/' + folder + '/' + file
      );
      editorState.folder = folder;
      editorState.file = file;
      editorState.mode = 'edit';
      editorFilenameSpan.textContent = `${folder}/${file}`;
      editorTextarea.value = data.content || '';
      editorTextarea.classList.remove('hidden');
      editorPreview.classList.add('hidden');
      showEditorView();
    } catch (e) {
      console.error('[DailyNotePanel] openEditor error:', e);
    }
  }

  // ------- 自动刷新（简单轮询版） -------

  async function autoRefreshLoop() {
    const INTERVAL = 10000; // 10 秒
    while (true) {
      try {
        await new Promise(r => setTimeout(r, INTERVAL));
        if (!currentNotebook || cardsView.classList.contains('hidden')) {
          continue;
        }
        // 无搜索词情况下才考虑轮询刷新（避免 search 结果被覆盖）
        if ((searchInput.value || '').trim()) continue;

        // 官方 API：/folder/:folderName
        // 同样移除 encodeURIComponent，直接传递原始字符串
        const data = await apiGet('/folder/' + currentNotebook);
        const nextNotes = (data.notes || []).map(n => {
          const mtime =
            n.mtime != null
              ? n.mtime
              : n.lastModified
              ? new Date(n.lastModified).getTime()
              : 0;
          return {
            folderName: currentNotebook,
            name: n.name,
            mtime,
            size: n.size != null ? n.size : 0,
            preview: n.preview
          };
        });
        const fp = computeFingerprint(nextNotes);
        if (fp !== lastNotesFingerprint) {
          notes = nextNotes;
          filteredNotes = sortedNotes(notes);
          currentPage = 1;
          renderCards();
        }
      } catch (e) {
        console.warn('[DailyNotePanel] autoRefreshLoop error:', e);
      }
    }
  }

  // ------- 初始化 -------

  function init() {
    applyTheme();
    updateCardsGridColumns();
    bindEvents();
    // 默认折叠侧边栏（刷新后自动收起）
    if (sidebar) {
      sidebar.classList.add('collapsed');
    }
    loadNotebooks().catch(console.error);
    showCardsView();
    applyGlobalFontSize();
    autoRefreshLoop(); // fire and forget

    // 注册 Service Worker（PWA）
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/AdminPanel/DailyNotePanel/sw.js').catch(e => {
        console.warn('[DailyNotePanel] serviceWorker register failed:', e);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();