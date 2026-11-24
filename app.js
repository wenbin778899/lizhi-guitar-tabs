import { createReader } from './reader.js';

const byId = (id) => document.getElementById(id);
const ui = {
  search: byId('search'), filters: byId('filters'), publicOnly: byId('public-only'),
  list: byId('songs'), results: byId('results-label'), more: byId('more'),
  empty: byId('empty'), emptyTitle: byId('empty-title'), emptyText: byId('empty-text'),
  reset: byId('reset'), detail: byId('detail'), title: byId('track-title'),
  summary: byId('track-summary'), versions: byId('versions'), favorite: byId('favorite'),
  favoriteNav: byId('favorite-nav'), back: byId('back-to-list'), local: byId('open-local'),
};
const pageSize = 12;
const narrowScreen = matchMedia('(max-width: 680px)');
const favoritesKey = 'lizhi-tabs:favorites:v1';
const typeOrder = ['弹唱', '指弹', '双吉他'];
const state = {
  tracks: [], favorites: readFavorites(), selected: '',
  kind: 'all', publicOnly: false, favoritesOnly: false, limit: pageSize, failed: false,
};
const reader = createReader(() => updateLocalButton(state.selected));

function readFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem(favoritesKey) || '[]');
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function normalize(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[\s·《》、]/g, '');
}

function versionsFor(track, query) {
  const matchesTitle = !query || [track.title, ...(track.aliases || [])]
    .some((title) => normalize(title).includes(query));
  return track.versions.filter((version) => (
    (state.kind === 'all' || state.kind === version.kind)
    && (!state.publicOnly || version.access === '公开')
    && (matchesTitle || [version.source, version.arranger, version.version, version.key, version.kind]
      .some((value) => normalize(value).includes(query)))
  ));
}

function filteredTracks() {
  const query = normalize(ui.search.value);
  return state.tracks
    .filter((track) => !state.favoritesOnly || state.favorites.has(track.id))
    .map((track) => ({ ...track, versions: versionsFor(track, query) }))
    .filter((track) => track.versions.length);
}

function trackButton(track) {
  const button = node('button', 'song-button');
  button.type = 'button';
  button.dataset.track = track.id;
  button.setAttribute('aria-current', String(state.selected === track.id));
  button.setAttribute('aria-controls', 'detail');
  const mark = node('span', 'score-mark');
  mark.setAttribute('aria-hidden', 'true');
  const labels = node('span', 'song-text');
  const kinds = typeOrder.filter((kind) => track.versions.some((version) => version.kind === kind));
  labels.append(node('span', 'song-title', track.title), node('span', 'song-kinds', kinds.join(' · ') || '六线谱'));
  const count = node('span', 'song-count');
  if (state.favorites.has(track.id)) {
    const star = node('span', 'star', '★');
    star.setAttribute('aria-label', '已收藏');
    count.append(star);
  }
  count.append(document.createTextNode(track.versions.length + ' 个入口'));
  button.append(mark, labels, count);
  const item = node('li');
  item.append(button);
  return item;
}

function versionRow(version) {
  const item = node('li');
  const link = node('a', 'version-link');
  link.href = version.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const label = [version.source, version.arranger, version.version].filter(Boolean).join(' · ');
  const keyLabel = version.key && (version.key.endsWith('调') ? version.key + '指法' : version.key + ' 调指法');
  const capoLabel = Number.isInteger(version.capo) && (version.capo === 0 ? '不夹变调夹' : '变调夹 ' + version.capo + ' 品');
  const details = [version.kind || '六线谱', keyLabel, capoLabel].filter(Boolean);
  const action = node('span', 'version-action');
  const access = node('span', 'version-access', version.access === '未知' ? '访问条件见原站' : version.access);
  access.dataset.access = version.access;
  action.append(access, node('small', '', '打开来源'));
  link.append(node('span', 'version-name', label), node('span', 'version-meta', details.join(' · ')), action);
  item.append(link);
  return item;
}

async function updateLocalButton(id) {
  const available = id && await reader.has(id);
  if (id === state.selected) ui.local.textContent = available ? '继续阅读本地谱' : '打开本地谱';
}

function renderDetail(track) {
  ui.detail.hidden = !track;
  if (!track) return;
  ui.title.textContent = track.title;
  const sources = new Set(track.versions.map((version) => version.source)).size;
  ui.summary.textContent = track.versions.length + ' 个谱页入口 · ' + sources + ' 个来源';
  const saved = state.favorites.has(track.id);
  ui.favorite.textContent = saved ? '★' : '☆';
  ui.favorite.setAttribute('aria-pressed', String(saved));
  ui.favorite.setAttribute('aria-label', saved ? '取消收藏' : '收藏此曲');
  ui.versions.replaceChildren(...track.versions.map(versionRow));
  ui.versions.scrollTop = 0;
  ui.local.textContent = '打开本地谱';
  void updateLocalButton(track.id);
}

function render({ keepFocus = false } = {}) {
  const focusedTrack = keepFocus ? document.activeElement?.dataset.track : '';
  const available = filteredTracks();
  let chosen = available.find((track) => track.id === state.selected);
  if (!chosen) {
    chosen = available[0];
    state.selected = chosen?.id || '';
    ui.detail.classList.remove('is-open');
  }
  const visible = available.slice(0, state.limit);
  ui.list.replaceChildren(...visible.map(trackButton));
  ui.results.textContent = state.failed ? '曲库载入失败' : available.length + ' 首曲目';
  ui.empty.hidden = available.length > 0;
  const hasFilters = Boolean(ui.search.value.trim()) || state.kind !== 'all' || state.publicOnly;
  ui.emptyTitle.textContent = state.failed ? '暂时无法读取曲库' : state.favoritesOnly && !hasFilters ? '还没有收藏' : '没找到符合条件的曲目';
  ui.emptyText.textContent = state.failed ? '请刷新网页后重试。' : state.favoritesOnly && !hasFilters
    ? '打开曲目后，点星标即可收藏。' : '试试其他关键词，或调整筛选条件。';
  ui.reset.textContent = state.failed ? '重新载入' : '查看所有曲目';
  ui.favoriteNav.setAttribute('aria-pressed', String(state.favoritesOnly));
  ui.more.hidden = visible.length >= available.length;
  renderDetail(chosen);
  if (focusedTrack) getTrackButton(focusedTrack)?.focus({ preventScroll: true });
}

function getTrackButton(id) {
  return [...ui.list.querySelectorAll('button[data-track]')].find((button) => button.dataset.track === id);
}

function setKind(kind) {
  state.kind = kind;
  for (const button of ui.filters.querySelectorAll('[data-kind]')) {
    button.setAttribute('aria-pressed', String(button.dataset.kind === kind));
  }
}

function resetFilters() {
  setKind('all');
  ui.search.value = '';
  ui.publicOnly.checked = false;
  state.publicOnly = false;
  state.favoritesOnly = false;
  state.limit = pageSize;
}

function scrollToCatalog() {
  byId('曲目').scrollIntoView({ block: 'start' });
  byId('catalog-title').focus({ preventScroll: true });
}

function selectTrack(id, reveal = false) {
  state.selected = id;
  history.replaceState(null, '', '#谱=' + encodeURIComponent(id));
  render({ keepFocus: true });
  if (reveal && narrowScreen.matches) {
    ui.detail.classList.add('is-open');
    ui.detail.scrollIntoView({ block: 'start' });
    ui.title.focus({ preventScroll: true });
  }
}

function catalogHash() {
  try {
    return location.hash.startsWith('#谱=') || location.hash.startsWith('#%E8%B0%B1=')
      ? decodeURIComponent(location.hash.slice(location.hash.indexOf('=') + 1))
      : '';
  } catch {
    return '';
  }
}

ui.search.addEventListener('input', () => {
  state.limit = pageSize;
  render();
});

ui.filters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-kind]');
  if (!button) return;
  setKind(button.dataset.kind);
  state.limit = pageSize;
  render();
});

ui.publicOnly.addEventListener('change', () => {
  state.publicOnly = ui.publicOnly.checked;
  state.limit = pageSize;
  render();
});

ui.list.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-track]');
  if (button) selectTrack(button.dataset.track, true);
});

ui.more.addEventListener('click', () => {
  const firstAdded = filteredTracks()[state.limit];
  state.limit += pageSize;
  render();
  if (firstAdded) getTrackButton(firstAdded.id)?.focus();
});

ui.favorite.addEventListener('click', () => {
  const id = state.selected;
  if (!id) return;
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  try {
    localStorage.setItem(favoritesKey, JSON.stringify([...state.favorites]));
  } catch {
    // 存储受限时，收藏在当前页面仍可使用。
  }
  render();
  if (ui.detail.hidden || narrowScreen.matches && !ui.detail.classList.contains('is-open')) scrollToCatalog();
});

ui.favoriteNav.addEventListener('click', () => {
  const next = !state.favoritesOnly;
  resetFilters();
  state.favoritesOnly = next;
  ui.detail.classList.remove('is-open');
  render();
  scrollToCatalog();
});

byId('catalog-link').addEventListener('click', (event) => {
  event.preventDefault();
  resetFilters();
  ui.detail.classList.remove('is-open');
  render();
  history.replaceState(null, '', '#曲目');
  scrollToCatalog();
});

ui.reset.addEventListener('click', () => {
  if (state.failed) {
    location.reload();
    return;
  }
  resetFilters();
  render();
  scrollToCatalog();
});

ui.back.addEventListener('click', () => {
  ui.detail.classList.remove('is-open');
  const row = getTrackButton(state.selected);
  if (row) row.focus();
  else scrollToCatalog();
});

ui.local.addEventListener('click', () => {
  const track = state.tracks.find(({ id }) => id === state.selected);
  if (track) void reader.open(track);
});

document.addEventListener('keydown', (event) => {
  const isEditing = event.target instanceof HTMLElement && event.target.matches('input, textarea, [contenteditable]');
  if (event.key === '/' && !isEditing && !event.altKey && !event.ctrlKey && !event.metaKey && !reader.isOpen()) {
    event.preventDefault();
    ui.search.focus();
  }
});

async function init() {
  try {
    const response = await fetch('./catalog.json');
    if (!response.ok) throw new Error('目录请求失败');
    state.tracks = await response.json();
    if (!Array.isArray(state.tracks) || !state.tracks.length) throw new Error('曲库为空');

    const versionCount = state.tracks.reduce((total, track) => total + track.versions.length, 0);
    byId('song-count').textContent = state.tracks.length + ' 首歌曲';
    byId('version-count').textContent = versionCount + ' 个谱页入口';
    byId('hero-meta').hidden = false;

    const linked = catalogHash();
    const linkedIndex = state.tracks.findIndex((track) => track.id === linked);
    if (linkedIndex >= 0) {
      state.selected = linked;
      state.limit = Math.max(pageSize, linkedIndex + 1);
      ui.detail.classList.add('is-open');
    }
    render();
    if (linkedIndex >= 0 && narrowScreen.matches) ui.detail.scrollIntoView({ block: 'start' });
  } catch (error) {
    console.error(error);
    state.tracks = [];
    state.failed = true;
    render();
  }
}

void init();
