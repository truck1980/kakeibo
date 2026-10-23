/* =========================================================
   かんたん家計簿  動き（記録・集計・保存）  パソコン向け
   色・文字・画像は design/theme.css と design/images にあります。
   ========================================================= */
(function () {
  'use strict';

  const APP_VERSION = '2.0.0';
  const STORAGE_KEY = 'kantan-kakeibo-v1';
  const MAX_DIGITS = 7;        // 金額は最大 9,999,999円
  const COLOR_COUNT = 12;      // theme.css の --cat-1 〜 --cat-12
  const OTHER_ID = 'other';    // 削除できないカテゴリ（その他）
  const CASH_ID = 'cash';      // 削除できない支払い方法（現金）
  const END_OF_MONTH = 31;     // 締め日・支払日の「末日」
  const BACKUP_REMIND_DAYS = 30;
  const RECENT_COUNT = 15;     // 入力画面の「最近入力した記録」に出す件数

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

  // 支払い方法の種類：cash＝現金、card＝クレジットカード（締め日・支払日あり）、other＝電子マネーなど
  const DEFAULT_PAYMENTS = [
    { id: CASH_ID, name: '現金', kind: 'cash' },
  ];
  const PAY_KIND_LABEL = { cash: '現金', card: 'カード', other: 'その他' };
  // カードを新しく登録するときの最初の値（末日締め・翌月27日払い）
  const CARD_DEFAULT = { closingDay: END_OF_MONTH, payOffset: 1, payDay: 27 };

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
  const sumAmount = (recs) => recs.reduce((sum, r) => sum + r.amount, 0);

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function todayStr() { return toDateStr(new Date()); }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
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
  function pctText(pct) {
    return pct > 0 && pct < 1 ? '1%未満' : `${Math.round(pct)}%`;
  }
  // 新しい順（同じ日なら後から入力したものが上）
  function byNewest(a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt;
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

  /* ---------- データの読み書き（ブラウザの中に保存） ---------- */
  function defaultData() {
    return {
      version: 2,
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      payments: DEFAULT_PAYMENTS.map((p) => ({ ...p })),
      records: [],
      settings: { budget: 0, lastBackup: null },
    };
  }

  function clampColor(n) {
    n = Math.round(Number(n));
    return n >= 1 && n <= COLOR_COUNT ? n : COLOR_COUNT - 2;
  }
  // 締め日・支払日は 1〜28日 か 末日（31）
  function clampDay(n, fallback) {
    n = Math.round(Number(n));
    return (n >= 1 && n <= 28) || n === END_OF_MONTH ? n : fallback;
  }

  // 保存データ・バックアップファイルの中身を点検して、正しい形にそろえる
  // （支払い方法が入っていない古いデータは、記録をすべて「現金」として読みこむ）
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
    const payIds = new Set();
    const payments = [];
    for (const p of Array.isArray(obj.payments) ? obj.payments : []) {
      if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || payIds.has(p.id)) continue;
      payIds.add(p.id);
      const kind = p.id === CASH_ID ? 'cash' : p.kind === 'card' ? 'card' : 'other';
      const pay = { id: p.id, name: p.name.trim().slice(0, 12) || '（名前なし）', kind };
      if (kind === 'card') {
        pay.closingDay = clampDay(p.closingDay, CARD_DEFAULT.closingDay);
        pay.payOffset = Number(p.payOffset) === 2 ? 2 : 1;
        pay.payDay = clampDay(p.payDay, CARD_DEFAULT.payDay);
      }
      payments.push(pay);
    }
    if (!payIds.has(CASH_ID)) {
      payments.unshift({ ...DEFAULT_PAYMENTS[0] });
      payIds.add(CASH_ID);
    }
    const records = [];
    for (const r of obj.records) {
      const amount = Math.round(Number(r && r.amount));
      if (!r || !(amount > 0) || typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      records.push({
        id: String(r.id || newId()),
        amount: Math.min(amount, 10 ** MAX_DIGITS - 1),
        categoryId: seen.has(r.categoryId) ? r.categoryId : OTHER_ID,
        paymentId: payIds.has(r.paymentId) ? r.paymentId : CASH_ID,
        date: r.date,
        memo: typeof r.memo === 'string' ? r.memo.slice(0, 40) : '',
        createdAt: Number(r.createdAt) || 0,
      });
    }
    const st = obj.settings || {};
    return {
      version: 2,
      categories,
      payments,
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
      showToast('保存できませんでした。パソコンの空き容量を確認してください');
      return false;
    }
  }

  // 「このデータは消さないで」とブラウザにお願いする（対応しているブラウザのみ）
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
    categoryId: null,    // 入力中のカテゴリ
    paymentId: CASH_ID,  // 入力中の支払い方法（記録したあとも残す）
    date: todayStr(),    // 入力中の日付
    today: todayStr(),
    viewMonth: monthOf(todayStr()),  // 集計画面で見ている月
    billMonth: monthOf(todayStr()),  // カードの引き落とし画面で見ている月
    filterCat: null,     // 集計画面で絞り込んでいるカテゴリ
    filterPay: null,     // 集計画面で絞り込んでいる支払い方法
  };

  const amountInput = $('#amount-input');

  /* ---------- カテゴリ・支払い方法・集計の道具 ---------- */
  function catById(id) {
    return data.categories.find((c) => c.id === id) || data.categories.find((c) => c.id === OTHER_ID);
  }
  function payById(id) {
    return data.payments.find((p) => p.id === id) || data.payments.find((p) => p.id === CASH_ID);
  }
  const catColor = (c) => `var(--cat-${c.color})`;
  const cards = () => data.payments.filter((p) => p.kind === 'card');

  function catIcon(c) {
    return h('span', { class: 'cat-icon', style: `--c:${catColor(c)}`, 'aria-hidden': 'true' }, c.icon);
  }
  function catButton(c, selected, onClick) {
    return h('button', {
      type: 'button', class: 'cat-btn', style: `--c:${catColor(c)}`,
      'aria-pressed': String(selected), onclick: onClick,
    }, h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, c.icon), h('span', { class: 'cat-name' }, c.name));
  }
  function payButtons(selectedId, onPick) {
    return data.payments.map((p) => h('button', {
      type: 'button', class: 'pay-btn', 'aria-pressed': String(p.id === selectedId),
      onclick: () => onPick(p.id),
    }, p.kind === 'card' && icon('card'), p.name));
  }

  function monthStats(key) {
    const recs = data.records.filter((r) => monthOf(r.date) === key);
    let total = 0;
    const byCat = new Map();
    const byPay = new Map();
    for (const r of recs) {
      total += r.amount;
      byCat.set(r.categoryId, (byCat.get(r.categoryId) || 0) + r.amount);
      byPay.set(r.paymentId, (byPay.get(r.paymentId) || 0) + r.amount);
    }
    return { recs, total, byCat, byPay };
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

  /* ---------- カードの締め日・引き落とし日の計算 ---------- */
  const dayLabel = (n) => (n === END_OF_MONTH ? '末日' : `${n}日`);
  function payRule(p) {
    return `${dayLabel(p.closingDay)}締め・${p.payOffset === 2 ? '翌々月' : '翌月'}${dayLabel(p.payDay)}払い`;
  }
  function lastDayOf(y, m) { return new Date(y, m, 0).getDate(); }  // m は 1〜12
  // その月の「n日」の日付（31＝末日。2月など短い月は月末にそろえる）
  function dayOf(key, n) {
    const [y, m] = key.split('-').map(Number);
    return `${key}-${pad2(Math.min(n, lastDayOf(y, m)))}`;
  }
  // 使った日が、どの月の締めに入るか（締め日を過ぎて使った分は翌月の締めに入る）
  function statementOf(p, dateStr) {
    const key = monthOf(dateStr);
    return dateStr <= dayOf(key, p.closingDay) ? key : shiftMonth(key, 1);
  }
  // 使った日の分が引き落とされる月
  function billMonthOf(p, dateStr) {
    return shiftMonth(statementOf(p, dateStr), p.payOffset);
  }
  // ある月の引き落とし：対象のご利用期間（start〜end）と引き落とし日
  function billInfo(p, billKey) {
    const stKey = shiftMonth(billKey, -p.payOffset);
    const end = dayOf(stKey, p.closingDay);
    const start = addDays(dayOf(shiftMonth(stKey, -1), p.closingDay), 1);
    return { start, end, payDate: dayOf(billKey, p.payDay) };
  }
  function billRecords(p, billKey) {
    return data.records.filter((r) => r.paymentId === p.id && billMonthOf(p, r.date) === billKey);
  }
  // 今日より後で、いちばん近い引き落としの月
  function nextBillMonth(p) {
    const cur = monthOf(ui.today);
    return ui.today <= dayOf(cur, p.payDay) ? cur : shiftMonth(cur, 1);
  }
  function billStatus(info, total) {
    if (ui.today > info.end && total === 0) return { label: '引き落としなし', cls: 'badge-done' };
    if (ui.today > info.payDate) return { label: '引き落とし済み', cls: 'badge-done' };
    if (ui.today === info.payDate) return { label: '今日引き落とし', cls: 'badge-card' };
    if (ui.today > info.end) return { label: '締め済み', cls: 'badge-card' };
    return { label: '締め前（まだ増えます）', cls: 'badge-warn' };
  }
  function billRange(list) {
    const cur = monthOf(ui.today);
    let min = cur;
    let max = cur;
    const consider = (k) => { if (k < min) min = k; if (k > max) max = k; };
    for (const p of list) consider(nextBillMonth(p));
    for (const r of data.records) {
      const p = payById(r.paymentId);
      if (p.kind === 'card') consider(billMonthOf(p, r.date));
    }
    return { min, max };
  }

  /* ---------- 記録の表（入力・集計・カードの画面で共通） ---------- */
  function recordTable(recs, opt = {}) {
    const rows = recs.map((r) => {
      const c = catById(r.categoryId);
      const open = () => openRecordSheet(r);
      return h('tr', {
        tabindex: '0', onclick: open,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
      },
      h('td', { class: 't-date' }, fmtDate(r.date)),
      h('td', null, h('span', { class: 'cell-cat' }, catIcon(c), c.name)),
      !opt.hidePay && h('td', { class: 't-pay' }, payById(r.paymentId).name),
      h('td', { class: 't-memo', title: r.memo || null }, r.memo),
      h('td', { class: 't-num num' }, `${yen(r.amount)}円`));
    });
    const cols = opt.hidePay ? 4 : 5;
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null,
        h('th', null, opt.dateLabel || '日付'),
        h('th', null, 'カテゴリ'),
        !opt.hidePay && h('th', null, '支払い方法'),
        h('th', null, 'メモ'),
        h('th', { class: 't-num' }, '金額'))),
      h('tbody', null, rows),
      opt.total && h('tfoot', null, h('tr', null,
        h('td', { colspan: String(cols - 1) }, `${recs.length}件`),
        h('td', { class: 't-num num' }, `${yen(sumAmount(recs))}円`)))));
  }

  function emptyBox(...lines) {
    return h('div', { class: 'empty' },
      h('span', { class: 'img img-empty', 'aria-hidden': 'true' }),
      lines.map((l) => (typeof l === 'string' ? h('p', null, l) : l)));
  }

  /* ---------- 入力画面 ---------- */
  function renderInput() {
    renderHeadTotal();
    renderSaveReady();
    renderCatGrid();
    renderPayGrid();
    renderDate();
    renderRecent();
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
      left.textContent = rest >= 0 ? `予算の残り ${yen(rest)}円` : `予算を ${yen(-rest)}円 オーバー`;
      left.classList.toggle('is-over', rest < 0);
    }
  }

  function renderSaveReady() {
    $('#save-btn').classList.toggle('is-ready', getAmount() > 0 && !!ui.categoryId);
  }

  function renderCatGrid() {
    $('#cat-grid').replaceChildren(...data.categories.map((c) => catButton(c, c.id === ui.categoryId, () => {
      ui.categoryId = ui.categoryId === c.id ? null : c.id;
      renderCatGrid();
      renderSaveReady();
    })));
  }

  function renderPayGrid() {
    if (!data.payments.some((p) => p.id === ui.paymentId)) ui.paymentId = CASH_ID;
    const grid = $('#pay-grid');
    grid.replaceChildren(...payButtons(ui.paymentId, (id) => { ui.paymentId = id; renderPayGrid(); }));
    if (!cards().length) {
      grid.append(h('button', { type: 'button', class: 'pay-btn pay-add', onclick: () => openPaymentSheet(null) }, icon('plus'), 'カードを登録'));
    }
  }

  function renderDate() {
    const diff = daysBetween(ui.date, ui.today);
    $('#date-text').textContent = diff === 0 ? '今日' : diff === 1 ? '昨日' : diff === 2 ? 'おととい' : `(${WEEKDAYS[parseDate(ui.date).getDay()]})`;
    $('#date-chip').classList.toggle('is-other-day', diff !== 0);
    $('#date-input').value = ui.date;
  }

  function renderRecent() {
    const recs = data.records.slice().sort((a, b) => (b.createdAt - a.createdAt) || byNewest(a, b)).slice(0, RECENT_COUNT);
    $('#recent-list').replaceChildren(recs.length ? recordTable(recs) : emptyBox('まだ記録がありません'));
  }

  function nudge(sel) {
    const el = $(sel);
    el.classList.remove('is-nudge');
    void el.offsetWidth; // 動きをやり直すため
    el.classList.add('is-nudge');
  }

  function addRecord() {
    const amount = getAmount();
    if (!amount) { nudge('#amount-card'); amountInput.focus(); showToast('金額を入力してください'); return; }
    if (!ui.categoryId) { nudge('#cat-grid'); showToast('カテゴリを選んでください'); return; }

    const memoInput = $('#memo-input');
    const rec = {
      id: newId(),
      amount,
      categoryId: ui.categoryId,
      paymentId: ui.paymentId,
      date: ui.date,
      memo: memoInput.value.trim().slice(0, 40),
      createdAt: Date.now(),
    };
    data.records.push(rec);
    if (!save()) { data.records.pop(); return; }
    requestPersist();

    amountInput.value = '';
    ui.categoryId = null;
    memoInput.value = '';
    renderAll();
    amountInput.focus();

    const c = catById(rec.categoryId);
    showToast(`${c.name} ${yen(amount)}円（${payById(rec.paymentId).name}）を記録しました`, {
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
    $('#this-month').hidden = key === monthOf(ui.today);

    const { recs, total, byCat, byPay } = monthStats(key);
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

    // 支払い方法別（使った日の月で集計）
    if (ui.filterPay && !byPay.get(ui.filterPay)) ui.filterPay = null;
    $('#pay-card').hidden = total === 0;
    $('#pay-hint').hidden = cards().length > 0;
    if (total > 0) {
      const list = $('#pay-list');
      list.replaceChildren(...data.payments.filter((p) => byPay.get(p.id) > 0).map((p) => payRow(p, byPay.get(p.id), total)));
      if (cards().length) {
        const cardTotal = cards().reduce((sum, p) => sum + (byPay.get(p.id) || 0), 0);
        list.append(h('li', { class: 'pay-sum' }, h('span', null, 'うちクレジットカードの合計'), h('b', { class: 'num' }, `${yen(cardTotal)}円`)));
      }
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
    return h('li', null, h('button', {
      type: 'button', class: 'legend-row', style: `--c:${catColor(c)}`,
      'aria-pressed': String(ui.filterCat === c.id),
      onclick: () => { ui.filterCat = ui.filterCat === c.id ? null : c.id; renderSummary(); },
    },
    catIcon(c),
    h('span', null,
      h('span', { class: 'legend-name' }, c.name),
      h('span', { class: 'legend-bar' }, h('span', { style: `width:${pct}%` }))),
    h('span', { class: 'legend-amount num' }, `${yen(amt)}円`, h('span', { class: 'legend-pct' }, pctText(pct)))));
  }

  function payRow(p, amt, total) {
    const pct = (amt / total) * 100;
    return h('li', null, h('button', {
      type: 'button', class: `pay-row${p.kind === 'cash' ? ' is-cash' : ''}`,
      'aria-pressed': String(ui.filterPay === p.id),
      onclick: () => { ui.filterPay = ui.filterPay === p.id ? null : p.id; renderSummary(); },
    },
    h('span', null,
      h('span', { class: 'pay-row-name' }, h('span', null, p.name), p.kind === 'card' && h('span', { class: 'badge badge-card' }, 'カード')),
      h('span', { class: 'legend-bar' }, h('span', { style: `width:${pct}%` }))),
    h('span', { class: 'legend-amount num' }, `${yen(amt)}円`, h('span', { class: 'legend-pct' }, pctText(pct)))));
  }

  function filterChip(label, onClear) {
    return h('button', { type: 'button', class: 'filter-chip', 'aria-label': `${label}の絞り込みをやめる`, onclick: onClear }, `${label}だけ表示中`, icon('close'));
  }

  function renderRecordList(monthRecs) {
    let recs = monthRecs;
    const chips = [];
    if (ui.filterCat) {
      recs = recs.filter((r) => r.categoryId === ui.filterCat);
      chips.push(filterChip(catById(ui.filterCat).name, () => { ui.filterCat = null; renderSummary(); }));
    }
    if (ui.filterPay) {
      recs = recs.filter((r) => r.paymentId === ui.filterPay);
      chips.push(filterChip(payById(ui.filterPay).name, () => { ui.filterPay = null; renderSummary(); }));
    }
    $('#filter-slot').replaceChildren(...chips);
    $('#record-list').replaceChildren(recs.length
      ? recordTable(recs.slice().sort(byNewest), { total: true })
      : emptyBox('この月の記録はまだありません'));
  }

  /* ---------- カードの引き落とし画面 ---------- */
  function renderCards() {
    const body = $('#cards-body');
    const list = cards();
    if (!list.length) {
      body.replaceChildren(h('section', { class: 'card' }, emptyBox(
        'クレジットカードがまだ登録されていません。',
        'カードの名前・締め日・支払日を登録すると、引き落とされる月ごとの金額がここに出ます。',
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openPaymentSheet(null) }, icon('plus', 'icon-s'), 'カードを登録する'))));
      return;
    }

    // 次の引き落とし（カードごとに、これから来るいちばん近い1回）
    const nextRows = list.map((p) => {
      const key = nextBillMonth(p);
      const info = billInfo(p, key);
      const total = sumAmount(billRecords(p, key));
      const st = billStatus(info, total);
      const jump = () => { ui.billMonth = key; renderCards(); $('#bill-section').scrollIntoView({ behavior: 'smooth' }); };
      return h('tr', {
        tabindex: '0', onclick: jump,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } },
      },
      h('td', null, h('span', { class: 'cell-cat' }, icon('card', 'icon-s'), p.name)),
      h('td', { class: 't-date' }, fmtDate(info.payDate)),
      h('td', { class: 't-date' }, `${fmtDate(info.start)}〜${fmtDate(info.end)}`),
      h('td', null, h('span', { class: `badge ${st.cls}` }, st.label)),
      h('td', { class: 't-num num' }, `${yen(total)}円`));
    });
    const nextCard = h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, h('span', null, '次の引き落とし予定'), h('span', { class: 'card-sub' }, `今日（${fmtDate(ui.today)}）の時点`)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null,
          h('th', null, 'カード'), h('th', null, '引き落とし日'), h('th', null, '対象のご利用期間'), h('th', null, '状態'), h('th', { class: 't-num' }, '金額'))),
        h('tbody', null, nextRows))));

    // 月ごとの引き落とし
    const key = ui.billMonth;
    const range = billRange(list);
    const go = (k) => { ui.billMonth = k; renderCards(); };
    const blocks = list.map((p) => billBlock(p, key));
    const monthTotal = list.reduce((sum, p) => sum + sumAmount(billRecords(p, key)), 0);
    const head = h('div', { class: 'page-head', id: 'bill-section' },
      h('h2', { class: 'page-title' }, '月ごとの引き落とし'),
      h('div', { class: 'month-nav' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '前の月', disabled: key <= range.min, onclick: () => go(shiftMonth(key, -1)) }, icon('chevron-left')),
        h('span', { class: 'month-nav-title' }, fmtMonth(key)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '次の月', disabled: key >= range.max, onclick: () => go(shiftMonth(key, 1)) }, icon('chevron-right')),
        key !== monthOf(ui.today) && h('button', { type: 'button', class: 'chip-btn', onclick: () => go(monthOf(ui.today)) }, '今月')));
    const totalCard = h('section', { class: 'card' },
      h('div', { class: 'total-label' }, `${fmtMonth(key)}に引き落とされる金額（カード${list.length}枚の合計）`),
      h('div', { class: 'total-value num' }, yen(monthTotal), h('span', { class: 'unit' }, '円')));
    const note = h('p', { class: 'note' }, '※ 使った日と、登録した締め日・支払日から計算した目安です。お店からの請求が遅れて次の月に回った分や、支払日が土日・祝日にあたるときの日付のずれは反映していません。');

    body.replaceChildren(nextCard, head, totalCard, ...blocks, note);
  }

  function billBlock(p, key) {
    const info = billInfo(p, key);
    const recs = billRecords(p, key).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
    const total = sumAmount(recs);
    const st = billStatus(info, total);
    return h('section', { class: 'card bill-card' },
      h('div', { class: 'bill-head' },
        h('div', null,
          h('div', { class: 'bill-name' }, icon('card'), p.name, h('span', { class: `badge ${st.cls}` }, st.label)),
          h('div', { class: 'bill-meta' }, '引き落とし日 ', h('b', null, fmtDate(info.payDate)), `　対象：${fmtDate(info.start)}〜${fmtDate(info.end)}のご利用分`),
          h('div', { class: 'bill-rule' }, payRule(p))),
        h('div', { class: 'bill-amount' }, h('span', { class: 'num' }, `${yen(total)}円`), h('span', { class: 'card-sub' }, `${recs.length}件`))),
      recs.length
        ? recordTable(recs, { hidePay: true, dateLabel: '使った日' })
        : h('p', { class: 'bill-none' }, 'この期間のご利用はありません'));
  }

  /* ---------- 設定画面 ---------- */
  function renderSettings() {
    const budget = data.settings.budget;
    $('#budget-value').textContent = budget > 0 ? `${yen(budget)}円` : '未設定';

    $('#cat-list').replaceChildren(...data.categories.map((c, i, list) => h('li', { class: 'cat-row' },
      h('button', { type: 'button', class: 'cat-row-main', onclick: () => openCategorySheet(c) },
        catIcon(c), h('span', { class: 'cat-row-name' }, c.name)),
      moveButtons(list, i, c.name))));

    $('#pay-setting-list').replaceChildren(...data.payments.map((p, i, list) => h('li', { class: 'cat-row' },
      h('button', { type: 'button', class: 'cat-row-main', onclick: () => openPaymentSheet(p) },
        h('span', { class: 'cat-row-name' }, p.name,
          h('span', { class: 'cat-row-sub' }, p.kind === 'card' ? payRule(p) : p.kind === 'cash' ? '手元のお金' : '電子マネー・口座振替など（締め日なし）')),
        h('span', { class: `badge${p.kind === 'card' ? ' badge-card' : ''}` }, PAY_KIND_LABEL[p.kind])),
      moveButtons(list, i, p.name))));

    const last = data.settings.lastBackup;
    $('#last-backup').textContent = last ? `最後のバックアップ：${fmtFullDate(last)}` : 'まだバックアップしていません';
  }

  // 並べかえの「上へ」「下へ」ボタン
  function moveButtons(list, i, name) {
    const move = (delta) => {
      const j = i + delta;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      save();
      renderAll();
    };
    return [
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${name}を上へ`, disabled: i === 0, onclick: () => move(-1) }, icon('up')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${name}を下へ`, disabled: i === list.length - 1, onclick: () => move(1) }, icon('down')),
    ];
  }

  /* ---------- 編集の小窓 ---------- */
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
    // 入力欄で Enter を押したら「保存」（日本語の変換を確定する Enter は除く）
    root.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || !e.target.matches('input')) return;
      const primary = root.querySelector('.sheet-foot .btn-primary');
      if (primary) { e.preventDefault(); primary.click(); }
    };
    root.hidden = false;
    void root.offsetWidth;
    root.classList.add('is-open');
    document.body.classList.add('is-locked');
    // ブラウザの「戻る」で、ページごと戻らずにこの小窓だけ閉じるため
    if (!sheetOpen) history.pushState({ sheet: true }, '');
    sheetOpen = true;
    setTimeout(() => {
      const first = root.querySelector('.sheet-body input, .sheet-body select');
      if (first) { first.focus(); if (first.select) first.select(); }
    }, 30);
  }

  function closeSheet(fromHistory) {
    if (!sheetOpen) return;
    sheetOpen = false;
    const root = $('#sheet-root');
    root.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    setTimeout(() => {
      if (!sheetOpen) { root.hidden = true; root.replaceChildren(); }
    }, 200);
    if (!fromHistory && history.state && history.state.sheet) history.back();
  }

  function field(label, control) {
    return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
  }

  // 金額の入力欄（数字以外は自動で取りのぞき、3けたごとに区切る）。金額を読み取る関数を返す
  function attachAmountFormat(input) {
    const format = () => {
      const digits = toHalfDigits(input.value).replace(/[^0-9]/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS);
      input.value = digits ? yen(Number(digits)) : '';
    };
    input.addEventListener('input', (e) => { if (!e.isComposing) format(); });
    input.addEventListener('compositionend', format);
    return () => Number(input.value.replace(/[^0-9]/g, '')) || 0;
  }
  const getAmount = attachAmountFormat(amountInput);

  function amountField(initial) {
    const input = h('input', {
      class: 'field-input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
      'aria-label': '金額', placeholder: '0',
    });
    input.value = initial > 0 ? yen(initial) : '';
    return { el: h('div', { class: 'field-amount' }, input), input, get: attachAmountFormat(input) };
  }

  function openRecordSheet(rec) {
    let catId = rec.categoryId;
    let payId = rec.paymentId;
    const amount = amountField(rec.amount);
    const grid = h('div', { class: 'cat-grid', role: 'group', 'aria-label': 'カテゴリ' });
    const drawGrid = () => grid.replaceChildren(...data.categories.map((c) => catButton(c, c.id === catId, () => { catId = c.id; drawGrid(); })));
    drawGrid();
    const payBox = h('div', { class: 'pay-grid', role: 'group', 'aria-label': '支払い方法' });
    const drawPay = () => payBox.replaceChildren(...payButtons(payId, (id) => { payId = id; drawPay(); }));
    drawPay();
    const dateInput = h('input', { class: 'field-input', type: 'date', 'aria-label': '日付' });
    dateInput.value = rec.date;
    const memoInput = h('input', { class: 'field-input', type: 'text', maxlength: '40', placeholder: 'なくてもOK', 'aria-label': 'メモ' });
    memoInput.value = rec.memo;

    openSheet('記録を直す', [
      field('金額', amount.el),
      field('カテゴリ', grid),
      field('支払い方法', payBox),
      h('div', { class: 'field-row' }, field('日付', dateInput), field('メモ', memoInput)),
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
          Object.assign(rec, { amount: value, categoryId: catId, paymentId: payId, date, memo: memoInput.value.trim().slice(0, 40) });
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
      h('p', { class: 'note' }, '1か月に使ってよい金額の目安です。左のメニューと集計画面に「残り金額」が出ます。'),
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

  // 締め日・支払日を選ぶ欄（1〜28日と末日）
  function daySelect(value, label) {
    const sel = h('select', { class: 'field-input', 'aria-label': label },
      Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1) }, `${i + 1}日`)),
      h('option', { value: String(END_OF_MONTH) }, '末日'));
    sel.value = String(value);
    return sel;
  }

  function openPaymentSheet(pay) {
    const isNew = !pay;
    const isCash = !isNew && pay.id === CASH_ID;
    const draft = isNew ? { name: '', kind: 'card', ...CARD_DEFAULT } : { ...CARD_DEFAULT, ...pay };

    const nameInput = h('input', { class: 'field-input', type: 'text', maxlength: '12', placeholder: '例：楽天カード', 'aria-label': '名前' });
    nameInput.value = draft.name;
    const kindBox = h('div', { class: 'seg', role: 'group', 'aria-label': '種類' });
    const closingSel = daySelect(draft.closingDay, '締め日');
    const offsetSel = h('select', { class: 'field-input', 'aria-label': '引き落としの月' },
      h('option', { value: '1' }, '翌月'), h('option', { value: '2' }, '翌々月'));
    offsetSel.value = String(draft.payOffset);
    const payDaySel = daySelect(draft.payDay, '引き落とし日');
    const example = h('p', { class: 'note' });
    const cardFields = h('div', null,
      field('締め日', h('div', { class: 'inline-fields' }, '毎月', closingSel, 'に締め')),
      field('支払日（口座から引き落とされる日）', h('div', { class: 'inline-fields' }, offsetSel, 'の', payDaySel, 'に引き落とし')),
      example);

    const draw = () => {
      draft.closingDay = Number(closingSel.value);
      draft.payOffset = Number(offsetSel.value);
      draft.payDay = Number(payDaySel.value);
      kindBox.replaceChildren(...[['card', 'クレジットカード'], ['other', 'その他（電子マネー・口座振替など）']].map(([k, label]) => h('button', {
        type: 'button', class: 'pay-btn', 'aria-pressed': String(draft.kind === k),
        onclick: () => { draft.kind = k; draw(); },
      }, label)));
      cardFields.hidden = draft.kind !== 'card';
      const info = billInfo(draft, billMonthOf(draft, ui.today));
      example.textContent = `例：今日（${fmtDate(ui.today)}）使った分は、${fmtDate(info.start)}〜${fmtDate(info.end)}のご利用分として、${fmtFullDate(info.payDate)}に引き落とされます。`;
    };
    [closingSel, offsetSel, payDaySel].forEach((el) => el.addEventListener('change', draw));
    draw();

    const body = [field('名前', nameInput)];
    if (isCash) body.push(h('p', { class: 'note' }, '「現金」は削除できません（ほかの支払い方法を削除したときの記録の移し先になります）。'));
    else body.push(field('種類', kindBox), cardFields);

    const saveBtn = h('button', {
      type: 'button', class: 'btn btn-primary',
      onclick: () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); showToast('名前を入力してください'); return; }
        if (data.payments.some((p) => p.name === name && (isNew || p.id !== pay.id))) {
          nameInput.focus(); showToast('同じ名前の支払い方法があります'); return;
        }
        const values = { name };
        if (!isCash) {
          values.kind = draft.kind;
          if (draft.kind === 'card') Object.assign(values, { closingDay: draft.closingDay, payOffset: draft.payOffset, payDay: draft.payDay });
        }
        if (isNew) {
          data.payments.push({ id: `p${newId()}`, ...values });
        } else {
          Object.assign(pay, values);
          if (pay.kind !== 'card') { delete pay.closingDay; delete pay.payOffset; delete pay.payDay; }
        }
        save();
        closeSheet();
        renderAll();
        showToast(isNew ? `「${name}」を追加しました` : `「${name}」を保存しました`);
      },
    }, isNew ? '追加' : '保存');

    const footer = [saveBtn];
    if (!isNew && !isCash) {
      footer.unshift(h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const count = data.records.filter((r) => r.paymentId === pay.id).length;
          const cash = payById(CASH_ID);
          const ok = await confirmDialog({
            title: `「${pay.name}」を削除しますか？`,
            message: count > 0 ? `この支払い方法の記録 ${count}件は「${cash.name}」に移ります。` : '',
            okLabel: '削除する', danger: true,
          });
          if (!ok) return;
          data.records.forEach((r) => { if (r.paymentId === pay.id) r.paymentId = CASH_ID; });
          data.payments = data.payments.filter((p) => p.id !== pay.id);
          if (ui.paymentId === pay.id) ui.paymentId = CASH_ID;
          if (ui.filterPay === pay.id) ui.filterPay = null;
          save();
          closeSheet();
          renderAll();
          showToast(`「${pay.name}」を削除しました`);
        },
      }, '削除'));
    }

    openSheet(isNew ? 'カード・支払い方法を追加' : '支払い方法を編集', body, footer);
  }

  /* ---------- 確認の小窓 ---------- */
  function confirmDialog({ title, message, okLabel = 'OK', danger = false }) {
    return new Promise((resolve) => {
      const root = $('#dialog-root');
      const done = (v) => { root.hidden = true; root.replaceChildren(); root.onkeydown = null; resolve(v); };
      const cancelBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => done(false) }, 'やめる');
      const okBtn = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, onclick: () => done(true) }, okLabel);
      root.replaceChildren(
        h('div', { class: 'dialog-backdrop', onclick: () => done(false) }),
        h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
          h('h2', { class: 'dialog-title' }, title),
          message && h('p', { class: 'dialog-msg' }, message),
          h('div', { class: 'dialog-actions' }, cancelBtn, okBtn)));
      root.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      root.hidden = false;
      // 削除などのときは、うっかり Enter で実行しないよう「やめる」を選んだ状態にする
      (danger ? cancelBtn : okBtn).focus();
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
  // パソコンではそのままダウンロードする（スマホで開いたときは「共有」画面から保存先を選んでもらう）
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
    showToast('バックアップを書き出しました（「ダウンロード」フォルダ）');
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
    ui.filterPay = null;
    renderAll();
    showToast('バックアップから戻しました');
  }

  function exportCsv() {
    const cell = (v) => {
      let str = String(v);
      if (/^[=+\-@]/.test(str)) str = `'${str}`;  // Excelで式として動かないように
      return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const slash = (d) => d.replace(/-/g, '/');
    const rows = [['日付', 'カテゴリ', '支払い方法', '金額', 'メモ', '引き落とし予定日']];
    const sorted = data.records.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
    for (const r of sorted) {
      const p = payById(r.paymentId);
      const bill = p.kind === 'card' ? slash(billInfo(p, billMonthOf(p, r.date)).payDate) : '';
      rows.push([slash(r.date), catById(r.categoryId).name, p.name, r.amount, r.memo, bill]);
    }
    // 先頭の ﻿（BOM）は、Excelで開いたときに文字化けしないための印
    const csv = '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
    shareOrDownload(`家計簿_${ui.today}.csv`, new Blob([csv], { type: 'text/csv' }));
  }

  /* ---------- 画面の切りかえ ---------- */
  function renderAll() {
    renderInput();
    renderSummary();
    renderCards();
    renderSettings();
  }

  function showTab(name) {
    ui.tab = name;
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === name));
    $$('.nav-item').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    if (name === 'summary') renderSummary();
    if (name === 'cards') renderCards();
    window.scrollTo(0, 0);
    if (name === 'input') amountInput.focus();
  }

  // 日付が変わったら「今日」を新しい日に合わせる（開いたまま日をまたいだとき）
  function checkDayChange() {
    const now = todayStr();
    if (now === ui.today) return;
    const wasToday = ui.date === ui.today;
    const cur = monthOf(ui.today);
    const wasThisMonth = ui.viewMonth === cur;
    const wasThisBill = ui.billMonth === cur;
    ui.today = now;
    if (wasToday) ui.date = now;
    if (wasThisMonth) ui.viewMonth = monthOf(now);
    if (wasThisBill) ui.billMonth = monthOf(now);
    renderAll();
  }

  // アプリとして入れたときの上の帯の色を theme.css に合わせる
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

    // 入力画面（金額やメモの欄で Enter を押しても記録できる）
    $('#entry-form').addEventListener('submit', (e) => { e.preventDefault(); addRecord(); });
    amountInput.addEventListener('input', renderSaveReady);
    const dateInput = $('#date-input');
    dateInput.addEventListener('change', () => {
      ui.date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : ui.today;
      renderDate();
    });
    $$('.quick-dates [data-day]').forEach((b) => b.addEventListener('click', () => {
      ui.date = addDays(ui.today, Number(b.dataset.day));
      renderDate();
    }));
    $('#head-total').addEventListener('click', () => {
      ui.viewMonth = monthOf(ui.today);
      ui.filterCat = null;
      ui.filterPay = null;
      showTab('summary');
    });

    // キーボード：Esc で小窓を閉じる。入力画面では、どこにいても数字を打てば金額の欄に入る
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheetOpen && $('#dialog-root').hidden) { closeSheet(); return; }
      if (ui.tab !== 'input' || sheetOpen || !$('#dialog-root').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key) && !e.target.closest('input, textarea, select')) amountInput.focus();
    });

    // 左のメニュー
    $$('.nav-item').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

    // 集計画面
    const goMonth = (k) => { ui.viewMonth = k; ui.filterCat = null; ui.filterPay = null; renderSummary(); };
    $('#prev-month').addEventListener('click', () => goMonth(shiftMonth(ui.viewMonth, -1)));
    $('#next-month').addEventListener('click', () => goMonth(shiftMonth(ui.viewMonth, 1)));
    $('#this-month').addEventListener('click', () => goMonth(monthOf(ui.today)));
    $('#budget-set-btn').addEventListener('click', () => { showTab('settings'); openBudgetSheet(); });
    $('#reminder-btn').addEventListener('click', () => showTab('settings'));
    $('#pay-hint').addEventListener('click', () => { showTab('settings'); openPaymentSheet(null); });

    // 設定画面
    $('#budget-row').addEventListener('click', openBudgetSheet);
    $('#add-cat-btn').addEventListener('click', () => openCategorySheet(null));
    $('#add-pay-btn').addEventListener('click', () => openPaymentSheet(null));
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
    setInterval(checkDayChange, 60000);  // パソコンは開きっぱなしのことが多いので1分ごとにも確かめる

    applyStatusBarColor();
    registerServiceWorker();
    renderAll();
    amountInput.focus();
  }

  init();
})();
