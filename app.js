/* =========================================================
   かんたん家計簿  動き（記録・集計・保存）
   色・文字・画像は design/theme.css と design/images にあります。
   ========================================================= */
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const STORAGE_KEY = 'kantan-kakeibo-v1';
  const MAX_DIGITS = 7;        // 金額は最大 9,999,999円
  const COLOR_COUNT = 12;      // theme.css の --cat-1 〜 --cat-12
  const OTHER_ID = 'other';    // 削除できないカテゴリ（その他）
  const BACKUP_REMIND_DAYS = 30;

  const DEFAULT_CATEGORIES = [
    { id: 'food',      name: '食費',   icon: '🍚', color: 1 },
    { id: 'daily',     name: '日用品', icon: '🧻', color: 2 },
    { id: 'transport', name: '交通費', icon: '🚃', color: 3 },
    { id: 'eatout',    name: '外食',   icon: '🍜', color: 4 },
    { id: 'hobby',     name: '趣味',   icon: '🎮', color: 5 },
    { id: 'clothes',   name: '衣服',   icon: '👕', color: 6 },
    { id: 'medical',   name: '医療',   icon: '💊', color: 7 },
    { id: 'utility',   name: '光熱費', icon: '💡', color: 8 },
    { id: 'phone',     name: '通信費', icon: '📱', color: 9 },
    { id: OTHER_ID,    name: 'その他', icon: '📦', color: 10 },
  ];

  const ICON_CHOICES = [
    '🍚', '🍜', '🍞', '☕', '🍺', '🛒', '🧻',
    '🧴', '🚃', '🚗', '⛽', '🚌', '👕', '👟',
    '💄', '✂️', '💊', '🏥', '💡', '💧', '🔥',
    '📱', '💻', '🏠', '📚', '🎮', '🎬', '✈️',
    '🎁', '👶', '🐶', '🎓', '💼', '💰', '📦',
  ];

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  /* ---------- 小さな道具 ---------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const yen = (n) => Math.round(n).toLocaleString('ja-JP');
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const monthOf = (dateStr) => dateStr.slice(0, 7);

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function todayStr() { return toDateStr(new Date()); }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtDate(s) {
    const d = parseDate(s);
    return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
  }
  function fmtFullDate(s) {
    const d = parseDate(s);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  function fmtMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return `${y}年${m}月`;
  }
  function daysBetween(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  function toHalfDigits(s) {
    return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  }

  // 画面の部品を作る（文字は textContent で入れるので、メモに記号があっても安全）
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function s(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }
  function icon(name, extra) {
    return h('span', { class: `icon icon-${name}${extra ? ' ' + extra : ''}`, 'aria-hidden': 'true' });
  }

  /* ---------- データの読み書き（スマホの中に保存） ---------- */
  function defaultData() {
    return {
      version: 1,
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      records: [],
      settings: { budget: 0, lastBackup: null },
    };
  }

  function clampColor(n) {
    n = Math.round(Number(n));
    return n >= 1 && n <= COLOR_COUNT ? n : COLOR_COUNT - 2;
  }

  // 保存データ・バックアップファイルの中身を点検して、正しい形にそろえる
  function normalize(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.categories) || !Array.isArray(obj.records)) {
      throw new Error('家計簿のデータではありません');
    }
    const seen = new Set();
    const categories = [];
    for (const c of obj.categories) {
      if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || seen.has(c.id)) continue;
      seen.add(c.id);
      categories.push({
        id: c.id,
        name: c.name.trim().slice(0, 10) || '（名前なし）',
        icon: typeof c.icon === 'string' && c.icon ? c.icon : '📦',
        color: clampColor(c.color),
      });
    }
    if (!seen.has(OTHER_ID)) {
      categories.push({ ...DEFAULT_CATEGORIES.find((c) => c.id === OTHER_ID) });
      seen.add(OTHER_ID);
    }
    const records = [];
    for (const r of obj.records) {
      const amount = Math.round(Number(r && r.amount));
      if (!r || !(amount > 0) || typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      records.push({
        id: String(r.id || newId()),
        amount: Math.min(amount, 10 ** MAX_DIGITS - 1),
        categoryId: seen.has(r.categoryId) ? r.categoryId : OTHER_ID,
        date: r.date,
        memo: typeof r.memo === 'string' ? r.memo.slice(0, 40) : '',
        createdAt: Number(r.createdAt) || 0,
      });
    }
    const st = obj.settings || {};
    return {
      version: 1,
      categories,
      records,
      settings: {
        budget: Math.max(0, Math.min(Math.round(Number(st.budget) || 0), 10 ** MAX_DIGITS - 1)),
        lastBackup: typeof st.lastBackup === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(st.lastBackup) ? st.lastBackup : null,
      },
    };
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : defaultData();
    } catch (e) {
      // 読めないデータは消さずに別の名前で残しておく
      try { if (raw) localStorage.setItem(`${STORAGE_KEY}-broken-${Date.now()}`, raw); } catch (_) { /* 何もしない */ }
      return defaultData();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      showToast('保存できませんでした。スマホの空き容量を確認してください');
      return false;
    }
  }

  // 「このデータは消さないで」とスマホにお願いする（対応しているスマホのみ）
  let persistAsked = false;
  function requestPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (_) { /* 何もしない */ }
  }

  let data = load();

  const ui = {
    tab: 'input',
    amount: '',          // 入力中の金額（数字の文字列）
    categoryId: null,    // 入力中のカテゴリ
    date: todayStr(),    // 入力中の日付
    today: todayStr(),
    viewMonth: monthOf(todayStr()),
    filterCat: null,     // 集計画面で絞り込んでいるカテゴリ
  };

  /* ---------- カテゴリ・集計の道具 ---------- */
  function catById(id) {
    return data.categories.find((c) => c.id === id) || data.categories.find((c) => c.id === OTHER_ID);
  }
  const catColor = (c) => `var(--cat-${c.color})`;

  function catIcon(c) {
    return h('span', { class: 'cat-icon', style: `--c:${catColor(c)}`, 'aria-hidden': 'true' }, c.icon);
  }
  function catButton(c, selected, onClick) {
    return h('button', {
      type: 'button', class: 'cat-btn', style: `--c:${catColor(c)}`,
      'aria-pressed': String(selected), onclick: onClick,
    }, h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, c.icon), h('span', { class: 'cat-name' }, c.name));
  }

  function monthStats(key) {
    const recs = data.records.filter((r) => monthOf(r.date) === key);
    let total = 0;
    const byCat = new Map();
    for (const r of recs) {
      total += r.amount;
      byCat.set(r.categoryId, (byCat.get(r.categoryId) || 0) + r.amount);
    }
    return { recs, total, byCat };
  }

  function monthRange() {
    const cur = monthOf(ui.today);
    let min = cur;
    let max = cur;
    for (const r of data.records) {
      const k = monthOf(r.date);
      if (k < min) min = k;
      if (k > max) max = k;
    }
    return { min, max };
  }

  /* ---------- 入力画面 ---------- */
  function renderInput() {
    renderHeadTotal();
    renderAmount();
    renderCatGrid();
    renderDate();
    $('#first-hint').hidden = data.records.length > 0;
  }

  function renderHeadTotal() {
    const key = monthOf(ui.today);
    const { total } = monthStats(key);
    $('#head-label').textContent = `${Number(key.slice(5))}月の支出`;
    $('#head-value').textContent = `${yen(total)}円`;
    const left = $('#head-left');
    const budget = data.settings.budget;
    left.hidden = !(budget > 0);
    if (budget > 0) {
      const rest = budget - total;
      left.textContent = rest >= 0 ? `残り ${yen(rest)}円` : `${yen(-rest)}円 オーバー`;
      left.classList.toggle('is-over', rest < 0);
    }
  }

  function renderAmount() {
    const t = $('#amount-text');
    t.textContent = ui.amount ? yen(Number(ui.amount)) : '0';
    t.classList.toggle('is-empty', !ui.amount);
    $('#save-btn').classList.toggle('is-ready', !!ui.amount && !!ui.categoryId);
  }

  function renderCatGrid() {
    $('#cat-grid').replaceChildren(...data.categories.map((c) => catButton(c, c.id === ui.categoryId, () => {
      ui.categoryId = ui.categoryId === c.id ? null : c.id;
      renderCatGrid();
      renderAmount();
    })));
  }

  function renderDate() {
    const isToday = ui.date === ui.today;
    $('#date-text').textContent = isToday ? '今日' : fmtDate(ui.date);
    $('#date-chip').classList.toggle('is-other-day', !isToday);
    $('#date-input').value = ui.date;
  }

  function pressKey(k) {
    let a = ui.amount;
    if (k === 'back') a = a.slice(0, -1);
    else if (k === 'clear') a = '';
    else {
      if (!a && k[0] === '0') return;               // 先頭の0は入れない
      if ((a + k).length > MAX_DIGITS) { nudge('#amount-card'); return; }
      a += k;
    }
    ui.amount = a;
    renderAmount();
  }

  function nudge(sel) {
    const el = $(sel);
    el.classList.remove('is-nudge');
    void el.offsetWidth; // 動きをやり直すため
    el.classList.add('is-nudge');
  }

  function addRecord() {
    const amount = Number(ui.amount);
    if (!amount) { nudge('#amount-card'); showToast('金額を入力してください'); return; }
    if (!ui.categoryId) { nudge('#cat-grid'); showToast('カテゴリを選んでください'); return; }

    const memoInput = $('#memo-input');
    const rec = {
      id: newId(),
      amount,
      categoryId: ui.categoryId,
      date: ui.date,
      memo: memoInput.value.trim().slice(0, 40),
      createdAt: Date.now(),
    };
    data.records.push(rec);
    if (!save()) { data.records.pop(); return; }
    requestPersist();
    if (navigator.vibrate) navigator.vibrate(12);

    ui.amount = '';
    ui.categoryId = null;
    memoInput.value = '';
    memoInput.blur();
    renderInput();

    const c = catById(rec.categoryId);
    showToast(`${c.name} ${yen(amount)}円 を記録しました`, {
      action: '取り消す',
      onAction: () => {
        data.records = data.records.filter((r) => r.id !== rec.id);
        save();
        renderAll();
        showToast('取り消しました');
      },
    });
  }

  /* ---------- 集計画面 ---------- */
  function renderSummary() {
    const key = ui.viewMonth;
    const range = monthRange();
    $('#month-title').textContent = fmtMonth(key);
    $('#prev-month').disabled = key <= range.min;
    $('#next-month').disabled = key >= range.max;

    const { recs, total, byCat } = monthStats(key);
    $('#total-amount').textContent = yen(total);

    // 先月との比べ
    const prevTotal = monthStats(shiftMonth(key, -1)).total;
    const diff = total - prevTotal;
    $('#total-compare').textContent = prevTotal > 0
      ? (diff === 0 ? '先月と同じ' : `先月より ${yen(Math.abs(diff))}円 ${diff > 0 ? '多い' : '少ない'}`)
      : '';

    // 予算
    const budget = data.settings.budget;
    const box = $('#budget-box');
    box.hidden = !(budget > 0);
    $('#budget-set-btn').hidden = budget > 0;
    if (budget > 0) {
      const ratio = total / budget;
      const rest = budget - total;
      $('#budget-fill').style.width = `${Math.min(ratio, 1) * 100}%`;
      box.classList.toggle('is-over', ratio > 1);
      box.classList.toggle('is-warn', ratio >= 0.8 && ratio <= 1);
      $('#budget-amount').textContent = `予算 ${yen(budget)}円`;
      $('#budget-left').textContent = rest >= 0 ? `残り ${yen(rest)}円` : `${yen(-rest)}円 オーバー`;
    }

    // バックアップのお知らせ
    const last = data.settings.lastBackup;
    $('#backup-reminder').hidden = !(data.records.length >= 20 && (!last || daysBetween(last, ui.today) >= BACKUP_REMIND_DAYS));

    // カテゴリ別
    const entries = data.categories
      .filter((c) => byCat.get(c.id) > 0)
      .map((c) => [c, byCat.get(c.id)])
      .sort((a, b) => b[1] - a[1]);
    if (ui.filterCat && !byCat.get(ui.filterCat)) ui.filterCat = null;
    $('#breakdown-card').hidden = total === 0;
    if (total > 0) {
      $('#donut-wrap').replaceChildren(donut(entries, total), h('div', { class: 'donut-center' },
        h('span', { class: 'donut-center-label' }, `${Number(key.slice(5))}月の合計`),
        h('span', { class: 'donut-center-value num' }, `${yen(total)}円`)));
      $('#legend').replaceChildren(...entries.map(([c, amt]) => legendRow(c, amt, total)));
    }

    renderRecordList(recs);
  }

  function donut(entries, total) {
    const size = 184;
    const r = 72;
    const width = 26;
    const C = 2 * Math.PI * r;
    const gap = entries.length > 1 ? 2 : 0;
    const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, class: 'donut', role: 'img', 'aria-label': 'カテゴリ別の割合' });
    const g = s('g', { transform: `rotate(-90 ${size / 2} ${size / 2})` });
    g.append(s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': width, style: 'stroke: var(--color-surface-2)' }));
    let offset = 0;
    for (const [c, amt] of entries) {
      const len = (amt / total) * C;
      const dash = Math.max(len - gap, 0.6);
      g.append(s('circle', {
        cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': width,
        style: `stroke: ${catColor(c)}`,
        'stroke-dasharray': `${dash} ${C - dash}`,
        'stroke-dashoffset': String(-offset),
      }));
      offset += len;
    }
    svg.append(g);
    return svg;
  }

  function legendRow(c, amt, total) {
    const pct = (amt / total) * 100;
    const pctText = pct > 0 && pct < 1 ? '1%未満' : `${Math.round(pct)}%`;
    return h('li', null, h('button', {
      type: 'button', class: 'legend-row', style: `--c:${catColor(c)}`,
      'aria-pressed': String(ui.filterCat === c.id),
      onclick: () => { ui.filterCat = ui.filterCat === c.id ? null : c.id; renderSummary(); },
    },
    catIcon(c),
    h('span', null,
      h('span', { class: 'legend-name' }, c.name),
      h('span', { class: 'legend-bar' }, h('span', { style: `width:${pct}%` }))),
    h('span', { class: 'legend-amount num' }, `${yen(amt)}円`, h('span', { class: 'legend-pct' }, pctText))));
  }

  function renderRecordList(monthRecs) {
    const list = $('#record-list');
    const slot = $('#filter-slot');
    let recs = monthRecs;
    if (ui.filterCat) {
      const c = catById(ui.filterCat);
      recs = recs.filter((r) => r.categoryId === ui.filterCat);
      slot.replaceChildren(h('button', {
        type: 'button', class: 'filter-chip', 'aria-label': `${c.name}の絞り込みをやめる`,
        onclick: () => { ui.filterCat = null; renderSummary(); },
      }, `${c.name}だけ表示中`, icon('close')));
    } else {
      slot.replaceChildren();
    }

    if (!recs.length) {
      list.replaceChildren(h('div', { class: 'empty' },
        h('span', { class: 'img img-empty', 'aria-hidden': 'true' }),
        h('p', null, 'この月の記録はまだありません')));
      return;
    }

    const sorted = recs.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
    const groups = [];
    for (const r of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.date === r.date) last.items.push(r);
      else groups.push({ date: r.date, items: [r] });
    }
    list.replaceChildren(...groups.map((g) => h('div', { class: 'day-group' },
      h('div', { class: 'day-head' },
        h('span', null, fmtDate(g.date)),
        h('span', { class: 'num' }, `${yen(g.items.reduce((sum, r) => sum + r.amount, 0))}円`)),
      g.items.map((r) => {
        const c = catById(r.categoryId);
        return h('button', { type: 'button', class: 'rec-row', onclick: () => openRecordSheet(r) },
          catIcon(c),
          h('span', null,
            h('span', { class: 'rec-name' }, c.name),
            r.memo && h('span', { class: 'rec-memo' }, r.memo)),
          h('span', { class: 'rec-amount num' }, `${yen(r.amount)}円`));
      }))));
  }

  /* ---------- 設定画面 ---------- */
  function renderSettings() {
    const budget = data.settings.budget;
    $('#budget-value').textContent = budget > 0 ? `${yen(budget)}円` : '未設定';

    const n = data.categories.length;
    $('#cat-list').replaceChildren(...data.categories.map((c, i) => h('li', { class: 'cat-row' },
      h('button', { type: 'button', class: 'cat-row-main', onclick: () => openCategorySheet(c) },
        catIcon(c), h('span', { class: 'cat-row-name' }, c.name)),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${c.name}を上へ`, disabled: i === 0, onclick: () => moveCategory(i, -1) }, icon('up')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${c.name}を下へ`, disabled: i === n - 1, onclick: () => moveCategory(i, 1) }, icon('down')))));

    const last = data.settings.lastBackup;
    $('#last-backup').textContent = last ? `最後のバックアップ：${fmtFullDate(last)}` : 'まだバックアップしていません';
  }

  function moveCategory(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= data.categories.length) return;
    const list = data.categories;
    [list[i], list[j]] = [list[j], list[i]];
    save();
    renderAll();
  }

  /* ---------- 下から出る画面 ---------- */
  let sheetOpen = false;

  function openSheet(title, body, footer) {
    const root = $('#sheet-root');
    root.replaceChildren(
      h('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }),
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'sheet-head' },
          h('h2', { class: 'sheet-title' }, title),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '閉じる', onclick: () => closeSheet() }, icon('close'))),
        h('div', { class: 'sheet-body' }, body),
        footer && h('div', { class: 'sheet-foot' }, footer)));
    root.hidden = false;
    void root.offsetWidth;
    root.classList.add('is-open');
    document.body.classList.add('is-locked');
    // Androidの「戻る」で、アプリごと閉じずにこの画面だけ閉じるため
    if (!sheetOpen) history.pushState({ sheet: true }, '');
    sheetOpen = true;
  }

  function closeSheet(fromHistory) {
    if (!sheetOpen) return;
    sheetOpen = false;
    const root = $('#sheet-root');
    root.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    setTimeout(() => {
      if (!sheetOpen) { root.hidden = true; root.replaceChildren(); }
    }, 280);
    if (!fromHistory && history.state && history.state.sheet) history.back();
  }

  function field(label, control) {
    return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
  }

  // 金額の入力欄（数字以外は自動で取りのぞき、3けたごとに区切る）
  function amountField(initial) {
    const input = h('input', {
      class: 'field-input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
      'aria-label': '金額', placeholder: '0',
    });
    input.value = initial > 0 ? yen(initial) : '';
    input.addEventListener('input', () => {
      const digits = toHalfDigits(input.value).replace(/[^0-9]/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS);
      input.value = digits ? yen(Number(digits)) : '';
    });
    return {
      el: h('div', { class: 'field-amount' }, input),
      input,
      get: () => Number(input.value.replace(/[^0-9]/g, '')) || 0,
    };
  }

  function openRecordSheet(rec) {
    let catId = rec.categoryId;
    const amount = amountField(rec.amount);
    const grid = h('div', { class: 'cat-grid', role: 'group', 'aria-label': 'カテゴリ' });
    const drawGrid = () => grid.replaceChildren(...data.categories.map((c) => catButton(c, c.id === catId, () => { catId = c.id; drawGrid(); })));
    drawGrid();
    const dateInput = h('input', { class: 'field-input', type: 'date', 'aria-label': '日付' });
    dateInput.value = rec.date;
    const memoInput = h('input', { class: 'field-input', type: 'text', maxlength: '40', placeholder: 'なくてもOK', 'aria-label': 'メモ' });
    memoInput.value = rec.memo;

    openSheet('記録を直す', [
      field('金額', amount.el),
      field('カテゴリ', grid),
      field('日付', dateInput),
      field('メモ', memoInput),
    ], [
      h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const c = catById(rec.categoryId);
          const ok = await confirmDialog({
            title: 'この記録を削除しますか？',
            message: `${fmtDate(rec.date)}　${c.name}　${yen(rec.amount)}円`,
            okLabel: '削除する', danger: true,
          });
          if (!ok) return;
          data.records = data.records.filter((r) => r.id !== rec.id);
          save();
          closeSheet();
          renderAll();
          showToast('削除しました');
        },
      }, '削除'),
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const value = amount.get();
          if (!value) { amount.input.focus(); showToast('金額を入力してください'); return; }
          const date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : rec.date;
          Object.assign(rec, { amount: value, categoryId: catId, date, memo: memoInput.value.trim().slice(0, 40) });
          save();
          closeSheet();
          renderAll();
          showToast('記録を直しました');
        },
      }, '保存'),
    ]);
  }

  function openBudgetSheet() {
    const amount = amountField(data.settings.budget);
    const apply = (value, message) => {
      data.settings.budget = value;
      save();
      closeSheet();
      renderAll();
      showToast(message);
    };
    openSheet('1か月の予算', [
      h('p', { class: 'note' }, '1か月に使ってよい金額の目安です。入力画面と集計画面に「残り金額」が出ます。'),
      field('予算', amount.el),
    ], [
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => apply(0, '予算を使わない設定にしました') }, '予算なし'),
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const value = amount.get();
          if (!value) { amount.input.focus(); showToast('金額を入力してください'); return; }
          apply(value, '予算を保存しました');
        },
      }, '保存'),
    ]);
    setTimeout(() => amount.input.focus(), 300);
  }

  function unusedColor() {
    const used = new Set(data.categories.map((c) => c.color));
    for (let i = 1; i <= COLOR_COUNT; i++) if (!used.has(i)) return i;
    return (data.categories.length % COLOR_COUNT) + 1;
  }

  function openCategorySheet(cat) {
    const isNew = !cat;
    const draft = isNew ? { name: '', icon: ICON_CHOICES[0], color: unusedColor() } : { ...cat };

    const previewIcon = h('span', { class: 'cat-icon', 'aria-hidden': 'true' });
    const previewName = h('span', { class: 'cat-preview-name' });
    const nameInput = h('input', { class: 'field-input', type: 'text', maxlength: '10', placeholder: '例：子ども', 'aria-label': 'カテゴリの名前' });
    nameInput.value = draft.name;
    const iconGrid = h('div', { class: 'icon-grid', role: 'group', 'aria-label': 'アイコン' });
    const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': '色' });

    const draw = () => {
      previewIcon.style.cssText = `--c:var(--cat-${draft.color})`;
      previewIcon.textContent = draft.icon;
      previewName.textContent = nameInput.value.trim() || '（名前）';
      iconGrid.replaceChildren(...ICON_CHOICES.map((ic) => h('button', {
        type: 'button', class: 'icon-choice', 'aria-pressed': String(ic === draft.icon), 'aria-label': ic,
        onclick: () => { draft.icon = ic; draw(); },
      }, ic)));
      swatches.replaceChildren(...Array.from({ length: COLOR_COUNT }, (_, i) => i + 1).map((n) => h('button', {
        type: 'button', class: 'swatch', style: `--c:var(--cat-${n})`,
        'aria-pressed': String(n === draft.color), 'aria-label': `色${n}`,
        onclick: () => { draft.color = n; draw(); },
      })));
    };
    nameInput.addEventListener('input', draw);
    draw();

    const body = [
      h('div', { class: 'cat-preview' }, previewIcon, previewName),
      field('名前', nameInput),
      field('アイコン', iconGrid),
      field('色', swatches),
    ];
    if (!isNew && cat.id === OTHER_ID) {
      body.push(h('p', { class: 'note' }, 'このカテゴリは削除できません（カテゴリを削除したときの記録の移し先になります）。'));
    }

    const saveBtn = h('button', {
      type: 'button', class: 'btn btn-primary',
      onclick: () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); showToast('名前を入力してください'); return; }
        if (data.categories.some((c) => c.name === name && (isNew || c.id !== cat.id))) {
          nameInput.focus(); showToast('同じ名前のカテゴリがあります'); return;
        }
        if (isNew) data.categories.push({ id: `c${newId()}`, name, icon: draft.icon, color: draft.color });
        else Object.assign(cat, { name, icon: draft.icon, color: draft.color });
        save();
        closeSheet();
        renderAll();
        showToast(isNew ? `「${name}」を追加しました` : `「${name}」を保存しました`);
      },
    }, isNew ? '追加' : '保存');

    const footer = [saveBtn];
    if (!isNew && cat.id !== OTHER_ID) {
      footer.unshift(h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const count = data.records.filter((r) => r.categoryId === cat.id).length;
          const other = catById(OTHER_ID);
          const ok = await confirmDialog({
            title: `「${cat.name}」を削除しますか？`,
            message: count > 0 ? `このカテゴリの記録 ${count}件は「${other.name}」に移ります。` : '',
            okLabel: '削除する', danger: true,
          });
          if (!ok) return;
          data.records.forEach((r) => { if (r.categoryId === cat.id) r.categoryId = OTHER_ID; });
          data.categories = data.categories.filter((c) => c.id !== cat.id);
          if (ui.categoryId === cat.id) ui.categoryId = null;
          if (ui.filterCat === cat.id) ui.filterCat = null;
          save();
          closeSheet();
          renderAll();
          showToast(`「${cat.name}」を削除しました`);
        },
      }, '削除'));
    }

    openSheet(isNew ? 'カテゴリを追加' : 'カテゴリを編集', body, footer);
  }

  /* ---------- 確認の小窓 ---------- */
  function confirmDialog({ title, message, okLabel = 'OK', danger = false }) {
    return new Promise((resolve) => {
      const root = $('#dialog-root');
      const done = (v) => { root.hidden = true; root.replaceChildren(); resolve(v); };
      root.replaceChildren(
        h('div', { class: 'dialog-backdrop', onclick: () => done(false) }),
        h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
          h('h2', { class: 'dialog-title' }, title),
          message && h('p', { class: 'dialog-msg' }, message),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => done(false) }, 'やめる'),
            h('button', { type: 'button', class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, onclick: () => done(true) }, okLabel))));
      root.hidden = false;
    });
  }

  /* ---------- お知らせ ---------- */
  let toastTimer = 0;
  function showToast(message, opt) {
    const t = $('#toast');
    clearTimeout(toastTimer);
    t.replaceChildren(h('span', { class: 'toast-msg' }, message));
    if (opt && opt.action) {
      t.append(h('button', { type: 'button', class: 'toast-action', onclick: () => { hideToast(); opt.onAction(); } }, opt.action));
    }
    t.classList.add('is-show');
    toastTimer = setTimeout(hideToast, opt && opt.action ? 5000 : 2500);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    $('#toast').classList.remove('is-show');
  }

  /* ---------- バックアップ ---------- */
  // スマホでは「共有」画面から保存先を選んでもらい、パソコンではそのままダウンロードする
  async function shareOrDownload(filename, blob) {
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (isTouch && navigator.canShare && typeof File === 'function') {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return true;
        } catch (e) {
          if (e && e.name === 'AbortError') return false;
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }

  async function exportBackup() {
    const payload = { app: 'kantan-kakeibo', exportedAt: new Date().toISOString(), ...data };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const done = await shareOrDownload(`家計簿バックアップ_${ui.today}.json`, blob);
    if (!done) return;
    data.settings.lastBackup = ui.today;
    save();
    renderAll();
    showToast('バックアップを書き出しました');
  }

  async function importBackup(file) {
    let imported;
    try {
      imported = normalize(JSON.parse(await file.text()));
    } catch (e) {
      showToast('このファイルは読み込めませんでした。家計簿のバックアップファイルを選んでください');
      return;
    }
    const ok = await confirmDialog({
      title: 'バックアップから戻しますか？',
      message: `読み込むデータ：記録 ${imported.records.length}件\n今のデータ：記録 ${data.records.length}件\n\n今のデータは、読み込むデータに置きかわります。`,
      okLabel: '戻す', danger: true,
    });
    if (!ok) return;
    const before = data;
    data = imported;
    if (!save()) { data = before; return; }
    ui.categoryId = null;
    ui.filterCat = null;
    renderAll();
    showToast('バックアップから戻しました');
  }

  function exportCsv() {
    const cell = (v) => {
      let str = String(v);
      if (/^[=+\-@]/.test(str)) str = `'${str}`;  // Excelで式として動かないように
      return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const rows = [['日付', 'カテゴリ', '金額', 'メモ']];
    const sorted = data.records.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
    for (const r of sorted) rows.push([r.date.replace(/-/g, '/'), catById(r.categoryId).name, r.amount, r.memo]);
    // 先頭の ﻿ は、Excelで開いたときに文字化けしないための印
    const csv = '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
    shareOrDownload(`家計簿_${ui.today}.csv`, new Blob([csv], { type: 'text/csv' }));
  }

  /* ---------- 画面の切りかえ ---------- */
  function renderAll() {
    renderInput();
    renderSummary();
    renderSettings();
  }

  function showTab(name) {
    ui.tab = name;
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === name));
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    if (name === 'summary') renderSummary();
    window.scrollTo(0, 0);
  }

  // 日付が変わったら「今日」を新しい日に合わせる（アプリを開いたまま日をまたいだとき）
  function checkDayChange() {
    const now = todayStr();
    if (now === ui.today) return;
    const wasToday = ui.date === ui.today;
    const wasThisMonth = ui.viewMonth === monthOf(ui.today);
    ui.today = now;
    if (wasToday) ui.date = now;
    if (wasThisMonth) ui.viewMonth = monthOf(now);
    renderAll();
  }

  // スマホ上部の帯の色を theme.css に合わせる
  function applyStatusBarColor() {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--color-statusbar').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (color && meta) meta.setAttribute('content', color);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応なしでも動く */ });
    }
  }

  function init() {
    $('#app-version').textContent = APP_VERSION;

    // 入力画面
    $('#keypad').addEventListener('click', (e) => {
      const b = e.target.closest('[data-key]');
      if (b) pressKey(b.dataset.key);
    });
    $('#save-btn').addEventListener('click', addRecord);
    const dateInput = $('#date-input');
    dateInput.addEventListener('change', () => {
      ui.date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : ui.today;
      renderDate();
    });
    dateInput.addEventListener('click', () => {
      // パソコンではカレンダーを開く（スマホは自動で開く）
      if (window.matchMedia('(pointer: fine)').matches && dateInput.showPicker) {
        try { dateInput.showPicker(); } catch (_) { /* 何もしない */ }
      }
    });
    $('#memo-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    $('#head-total').addEventListener('click', () => {
      ui.viewMonth = monthOf(ui.today);
      ui.filterCat = null;
      showTab('summary');
    });

    // パソコンのキーボードでも入力できるように
    document.addEventListener('keydown', (e) => {
      if (ui.tab !== 'input' || sheetOpen || !$('#dialog-root').hidden) return;
      if (e.target.closest('input, textarea, button') && e.key === 'Enter') return;
      if (e.target.closest('input, textarea')) return;
      if (/^[0-9]$/.test(e.key)) { pressKey(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { pressKey('back'); e.preventDefault(); }
      else if (e.key === 'Escape') pressKey('clear');
      else if (e.key === 'Enter') { addRecord(); e.preventDefault(); }
    });

    // タブ
    $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

    // 集計画面
    $('#prev-month').addEventListener('click', () => { ui.viewMonth = shiftMonth(ui.viewMonth, -1); ui.filterCat = null; renderSummary(); });
    $('#next-month').addEventListener('click', () => { ui.viewMonth = shiftMonth(ui.viewMonth, 1); ui.filterCat = null; renderSummary(); });
    $('#budget-set-btn').addEventListener('click', () => { showTab('settings'); openBudgetSheet(); });
    $('#reminder-btn').addEventListener('click', () => showTab('settings'));

    // 設定画面
    $('#budget-row').addEventListener('click', openBudgetSheet);
    $('#add-cat-btn').addEventListener('click', () => openCategorySheet(null));
    $('#export-btn').addEventListener('click', exportBackup);
    $('#csv-btn').addEventListener('click', exportCsv);
    const fileInput = $('#import-file');
    $('#import-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) importBackup(file);
    });

    window.addEventListener('popstate', () => { if (sheetOpen) closeSheet(true); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayChange(); });

    applyStatusBarColor();
    registerServiceWorker();
    renderAll();
  }

  init();
})();
