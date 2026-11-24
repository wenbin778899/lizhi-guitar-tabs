const byId = (id) => document.getElementById(id);
const databaseName = 'lizhi-tabs:scores:v1';
const storeName = 'scores';
const imageName = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;
const fileOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const memory = new Map();
let databasePromise;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('本地谱库被其他页面占用'));
    });
  }
  return databasePromise;
}

async function storedPages(id) {
  if (memory.has(id)) return memory.get(id);
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(storeName).objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

async function savePages(id, pages) {
  memory.set(id, pages);
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(pages, id);
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export function createReader(onChange) {
  const dialog = byId('reader');
  const chooser = byId('local-files');
  const choose = byId('choose-files');
  const pageControls = byId('page-controls');
  const zoom = byId('zoom');
  const notice = byId('reader-notice');
  const body = byId('reader-body');
  const openPdf = byId('open-pdf');
  const previous = byId('prev-page');
  const next = byId('next-page');
  const zoomOut = byId('zoom-out');
  const zoomIn = byId('zoom-in');
  const zoomReset = byId('zoom-reset');
  const state = { id: '', pages: [], page: 0, scale: 1, url: '', cycle: 0 };

  function clearPage() {
    body.replaceChildren();
    openPdf.removeAttribute('href');
    if (state.url) {
      URL.revokeObjectURL(state.url);
      state.url = '';
    }
  }

  function renderPage() {
    clearPage();
    const current = state.pages[state.page];
    const pdf = current?.pdf;
    const picture = current && !pdf;
    choose.textContent = current ? '更换文件' : '选择图片或 PDF';
    pageControls.hidden = state.pages.length < 2;
    zoom.hidden = !picture;
    openPdf.hidden = !pdf;
    previous.disabled = state.page <= 0;
    next.disabled = state.page >= state.pages.length - 1;
    byId('page-count').textContent = (state.page + 1) + ' / ' + state.pages.length;

    if (!current) {
      const empty = document.createElement('p');
      empty.className = 'reader-empty';
      empty.textContent = '可以一次选择多张谱图，页面会按文件名顺序排列。';
      body.append(empty);
      return;
    }

    state.url = URL.createObjectURL(current.file);
    if (pdf) {
      const viewer = document.createElement('iframe');
      viewer.src = state.url;
      viewer.title = '本地曲谱 PDF';
      openPdf.href = state.url;
      body.append(viewer);
    } else {
      const image = document.createElement('img');
      image.alt = '六线谱第 ' + (state.page + 1) + ' 页';
      image.src = state.url;
      image.addEventListener('error', () => {
        notice.textContent = '此图片无法打开，请检查文件格式。';
      }, { once: true });
      body.append(image);
      renderScale();
    }
    body.scrollTo(0, 0);
  }

  function renderScale() {
    const image = body.querySelector('img');
    if (!image) return;
    image.style.width = state.scale * 100 + '%';
    zoomReset.textContent = state.scale === 1 ? '适合宽度' : Math.round(state.scale * 100) + '%';
    zoomOut.disabled = state.scale <= 1;
    zoomIn.disabled = state.scale >= 3;
  }

  function changePage(step) {
    const target = state.page + step;
    if (target < 0 || target >= state.pages.length) return;
    state.page = target;
    notice.textContent = '';
    renderPage();
  }

  function setScale(scale) {
    state.scale = Math.min(3, Math.max(1, scale));
    renderScale();
  }

  choose.addEventListener('click', () => chooser.click());
  chooser.addEventListener('change', async () => {
    const files = [...chooser.files];
    chooser.value = '';
    if (!files.length) return;
    const pdfs = files.filter((file) => /\.pdf$/i.test(file.name));
    const pictures = files.filter((file) => imageName.test(file.name));
    const valid = pdfs.length === 1 && files.length === 1 || pictures.length === files.length;
    if (!valid) {
      notice.textContent = '请选择一份 PDF，或一组 PNG、JPG、WebP 等图片。';
      return;
    }

    const pages = files.sort((a, b) => fileOrder.compare(a.name, b.name))
      .map((file) => ({ file, pdf: pdfs.length > 0 }));
    const id = state.id;
    const cycle = state.cycle;
    state.pages = pages;
    state.page = 0;
    state.scale = 1;
    notice.textContent = '';
    renderPage();
    try {
      await savePages(id, pages);
    } catch {
      if (cycle === state.cycle) notice.textContent = '浏览器存储受限，曲谱在本次打开网页时仍可阅读。';
    }
    onChange();
  });

  previous.addEventListener('click', () => changePage(-1));
  next.addEventListener('click', () => changePage(1));
  zoomOut.addEventListener('click', () => setScale(state.scale - .25));
  zoomIn.addEventListener('click', () => setScale(state.scale + .25));
  zoomReset.addEventListener('click', () => setScale(1));
  dialog.addEventListener('keydown', (event) => {
    if (state.pages.length < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    changePage(event.key === 'ArrowLeft' ? -1 : 1);
  });
  dialog.addEventListener('close', () => {
    state.cycle++;
    clearPage();
    state.pages = [];
  });

  return {
    async open(track) {
      const cycle = ++state.cycle;
      state.id = track.id;
      state.pages = await storedPages(track.id);
      if (cycle !== state.cycle) return;
      state.page = 0;
      state.scale = 1;
      notice.textContent = '';
      byId('reader-title').textContent = track.title;
      renderPage();
      if (!dialog.open) dialog.showModal();
    },
    async has(id) {
      return (await storedPages(id)).length > 0;
    },
    isOpen() {
      return dialog.open;
    },
  };
}
