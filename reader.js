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
  const zoom = byId('zoom');
  const zoomOut = byId('zoom-out');
  const zoomIn = byId('zoom-in');
  const zoomReset = byId('zoom-reset');
  const notice = byId('reader-notice');
  const body = byId('reader-body');
  const openPdf = byId('open-pdf');
  const localUrls = [];
  const state = { id: '', scale: 1, cycle: 0, online: false };
  let stack;

  function clearSheets() {
    body.replaceChildren();
    openPdf.removeAttribute('href');
    stack = undefined;
    for (const url of localUrls) URL.revokeObjectURL(url);
    localUrls.length = 0;
  }

  function pageSource(page) {
    if (!page.file) return page.src;
    const url = URL.createObjectURL(page.file);
    localUrls.push(url);
    return url;
  }

  function sheetImage(page, index) {
    const source = pageSource(page);
    const sheet = document.createElement('div');
    sheet.className = 'reader-sheet';

    const image = document.createElement('img');
    image.alt = '六线谱第 ' + (index + 1) + ' 张';
    image.loading = index === 0 ? 'eager' : 'lazy';
    image.decoding = 'async';

    const failure = document.createElement('div');
    failure.className = 'reader-sheet-error';
    failure.hidden = true;
    const message = document.createElement('p');
    message.textContent = state.online ? '这张谱图暂时无法加载。' : '这张图片无法打开，请检查文件格式。';
    failure.append(message);

    if (state.online) {
      const retry = document.createElement('button');
      retry.className = 'secondary';
      retry.type = 'button';
      retry.textContent = '重新加载这张';
      retry.addEventListener('click', () => {
        failure.hidden = true;
        image.hidden = false;
        image.loading = 'eager';
        image.removeAttribute('src');
        image.src = source;
        body.focus({ preventScroll: true });
      });
      failure.append(retry);
    }

    image.addEventListener('error', () => {
      image.hidden = true;
      failure.hidden = false;
    });
    sheet.append(image, failure);
    image.src = source;
    return sheet;
  }

  function renderSheets(pages) {
    clearSheets();
    state.scale = 1;
    const first = pages[0];
    const pdf = first?.pdf;
    choose.hidden = state.online;
    choose.textContent = first ? '更换文件' : '选择图片或 PDF';
    zoom.hidden = !first || Boolean(pdf);
    openPdf.hidden = !pdf;

    if (!first) {
      const empty = document.createElement('p');
      empty.className = 'reader-empty';
      empty.textContent = '可以一次选择多张谱图，按文件名顺序连续显示。';
      body.append(empty);
    } else if (pdf) {
      const viewer = document.createElement('iframe');
      const source = pageSource(first);
      viewer.src = source;
      viewer.title = '本地曲谱 PDF';
      openPdf.href = source;
      body.append(viewer);
    } else {
      stack = document.createElement('div');
      stack.className = 'reader-stack';
      stack.append(...pages.map(sheetImage));
      body.append(stack);
      renderScale();
    }

    body.scrollTo(0, 0);
  }

  function renderScale() {
    stack.style.width = state.scale * 100 + '%';
    zoomReset.textContent = state.scale === 1 ? '适合宽度' : Math.round(state.scale * 100) + '%';
    zoomOut.disabled = state.scale <= 1;
    zoomIn.disabled = state.scale >= 3;
  }

  function setScale(scale) {
    if (!stack) return;
    const next = Math.min(3, Math.max(1, scale));
    if (next === state.scale) return;
    const ratio = next / state.scale;
    const center = body.clientWidth / 2;
    const left = (body.scrollLeft + center) * ratio - center;
    const top = body.scrollTop * ratio;
    state.scale = next;
    renderScale();
    body.scrollTo(left, top);
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
    notice.textContent = '';
    renderSheets(pages);
    try {
      await savePages(id, pages);
    } catch {
      if (cycle === state.cycle) notice.textContent = '浏览器存储受限，曲谱在本次打开网页时仍可阅读。';
    }
    onChange();
  });

  zoomOut.addEventListener('click', () => setScale(state.scale - .25));
  zoomIn.addEventListener('click', () => setScale(state.scale + .25));
  zoomReset.addEventListener('click', () => setScale(1));
  dialog.addEventListener('close', () => {
    state.cycle++;
    clearSheets();
  });

  return {
    async open(track, version) {
      const cycle = ++state.cycle;
      const pages = version ? version.pages.map((src) => ({ src })) : await storedPages(track.id);
      if (cycle !== state.cycle) return;
      state.id = track.id;
      state.online = Boolean(version);
      dialog.dataset.mode = version ? 'online' : 'local';
      notice.textContent = '';
      byId('reader-title').textContent = track.title;
      byId('reader-mode').textContent = version ? '在线读谱' : '本地读谱';
      if (!dialog.open) dialog.showModal();
      renderSheets(pages);
    },
    async has(id) {
      return (await storedPages(id)).length > 0;
    },
    isOpen() {
      return dialog.open;
    },
  };
}
