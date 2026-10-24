/* =========================================================
   かんたん家計簿  動き（記録・集計・保存）  パソコン向け
   色・文字・画像は design/theme.css と design/images にあります。
   ========================================================= */
(function () {
  'use strict';

  const APP_VERSION = '3.0.0';
  const STORAGE_KEY = 'kantan-kakeibo-v1';
  const MAX_DIGITS = 7;        // 金額は最大 9,999,999円
  const COLOR_COUNT = 12;      // theme.css の --cat-1 〜 --cat-12
  const OTHER_ID = 'other';    // 削除できないカテゴリ（その他）
  const CASH_ID = 'cash';      // 削除できない支払い方法（現金）
  const CASH_COLOR = 10;       // 現金の色（灰色）
  const END_OF_MONTH = 31;     // 締め日・支払日の「末日」
  const BACKUP_REMIND_DAYS = 30;
  const TREND_MONTHS = 12;     // 月間集計の「月ごとの表」に出す月の数
  const THEMES = ['auto', 'light', 'dark'];  // 画面の明るさ（自動＝Windowsの設定に合わせる）

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
    { id: CASH_ID, name: '現金', kind: 'cash', color: CASH_COLOR },
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
  const dayNum = (dateStr) => Number(dateStr.slice(8));
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
  const monthName = (key) => `${Number(key.slice(5))}月`;
  function daysBetween(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  function lastDayOf(y, m) { return new Date(y, m, 0).getDate(); }  // m は 1〜12
  function daysInMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return lastDayOf(y, m);
  }
  function toHalfDigits(s) {
    return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  }
  function pctText(pct) {
    return pct > 0 && pct < 1 ? '1%未満' : `${Math.round(pct)}%`;
  }
  // グラフの上に出す短い金額（12,300 → 1.2万）
  function yenShort(n) {
    if (n < 10000) return yen(n);
    const man = n / 10000;
    return `${man >= 100 ? Math.round(man) : Math.round(man * 10) / 10}万`;
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
      incomes: [],
      settings: { budget: 0, lastBackup: null, theme: 'auto' },
    };
  }

  function clampColor(n, fallback = COLOR_COUNT - 2) {
    n = Math.round(Number(n));
    return n >= 1 && n <= COLOR_COUNT ? n : fallback;
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
      // 色が入っていない（2.0.0 までの）支払い方法には、並び順で色を割りあてる
      const pay = { id: p.id, name: p.name.trim().slice(0, 12) || '（名前なし）', kind, color: clampColor(p.color, kind === 'cash' ? CASH_COLOR : (payments.length % 9) + 1) };
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
        ...(r.fixed ? { fixed: true } : {}),   // 月初で入れた「毎月の固定費」の印
      });
    }
    // 収入（月ごと）。バックアップに入っていない古いデータは空で読みこむ
    const incomes = [];
    for (const i of Array.isArray(obj.incomes) ? obj.incomes : []) {
      const amount = Math.round(Number(i && i.amount));
      if (!i || !(amount > 0) || typeof i.month !== 'string' || !/^\d{4}-\d{2}$/.test(i.month)) continue;
      incomes.push({
        id: String(i.id || newId()),
        month: i.month,
        name: typeof i.name === 'string' && i.name.trim() ? i.name.trim().slice(0, 20) : '収入',
        amount: Math.min(amount, 10 ** MAX_DIGITS - 1),
      });
    }
    const st = obj.settings || {};
    return {
      version: 2,
      categories,
      payments,
      records,
      incomes,
      settings: {
        budget: Math.max(0, Math.min(Math.round(Number(st.budget) || 0), 10 ** MAX_DIGITS - 1)),
        lastBackup: typeof st.lastBackup === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(st.lastBackup) ? st.lastBackup : null,
        theme: THEMES.includes(st.theme) ? st.theme : 'auto',
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
    tab: 'spend',
    categoryId: null,    // 入力中のカテゴリ
    paymentId: CASH_ID,  // 入力中の支払い方法（記録したあとも残す）
    date: todayStr(),    // 入力中の日付
    today: todayStr(),
    viewMonth: monthOf(todayStr()),  // 月初・支出・月間集計で見ている月
    billMonth: monthOf(todayStr()),  // カードの引き落とし画面で見ている月
    filterCat: null,     // 支出の表で絞り込んでいるカテゴリ
    filterPay: null,     // 支出の表で絞り込んでいる支払い方法
  };

  const amountInput = $('#amount-input');

  /* ---------- カテゴリ・支払い方法・集計の道具 ---------- */
  function catById(id) {
    return data.categories.find((c) => c.id === id) || data.categories.find((c) => c.id === OTHER_ID);
  }
  function payById(id) {
    return data.payments.find((p) => p.id === id) || data.payments.find((p) => p.id === CASH_ID);
  }
  const colorVar = (n) => `var(--cat-${n})`;
  const catColor = (c) => colorVar(c.color);
  const cards = () => data.payments.filter((p) => p.kind === 'card');
  const dot = (color) => h('span', { class: 'dot', style: `--c:${colorVar(color)}`, 'aria-hidden': 'true' });

  function catIcon(c) {
    return h('span', { class: 'cat-icon', style: `--c:${catColor(c)}`, 'aria-hidden': 'true' }, c.icon);
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

  // 月を切りかえられる範囲：いちばん古い記録の月 〜 来月（来月分の月初を先に入れられるように）
  function monthRange() {
    const cur = monthOf(ui.today);
    let min = cur;
    let max = shiftMonth(cur, 1);
    for (const r of data.records) {
      const k = monthOf(r.date);
      if (k < min) min = k;
      if (k > max) max = k;
    }
    for (const i of data.incomes) {
      if (i.month < min) min = i.month;
      if (i.month > max) max = i.month;
    }
    return { min, max };
  }

  /* ---------- カードの締め日・引き落とし日の計算 ---------- */
  const dayLabel = (n) => (n === END_OF_MONTH ? '末日' : `${n}日`);
  function payRule(p) {
    return `${dayLabel(p.closingDay)}締め・${p.payOffset === 2 ? '翌々月' : '翌月'}${dayLabel(p.payDay)}払い`;
  }
  // その月の「n日」の日付（31＝末日。2月など短い月は月末にそろえる）
  function dayOf(key, n) {
    return `${key}-${pad2(Math.min(n, daysInMonth(key)))}`;
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
  // カードごとの「次の1回」の引き落とし（日付の早い順）
  function upcomingBills() {
    return cards().map((p) => {
      const key = nextBillMonth(p);
      const info = billInfo(p, key);
      const total = sumAmount(billRecords(p, key));
      return { p, key, info, total, st: billStatus(info, total) };
    }).sort((a, b) => (a.info.payDate < b.info.payDate ? -1 : a.info.payDate > b.info.payDate ? 1 : 0));
  }

  /* ---------- 共通の部品：枠・表 ---------- */
  const money = (n) => `${yen(n)}円`;
  const signedMoney = (n) => `${n < 0 ? '−' : ''}${yen(Math.abs(n))}円`;
  const signClass = (n) => (n < 0 ? 'neg' : n > 0 ? 'pos' : '');
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt);
  const incomesOf = (key) => data.incomes.filter((i) => i.month === key);
  const fixedOf = (key) => data.records.filter((r) => r.fixed && monthOf(r.date) === key).sort(byDate);

  // 見出しつきの枠（見出しの右に操作ボタンを置ける）
  function panel(title, actions, ...body) {
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, title),
        actions && h('div', { class: 'panel-actions' }, actions)),
      h('div', { class: 'panel-body' }, body));
  }

  // 表。head＝[{t, num}]、rows＝[{cells:[{v, num, cls, title}], onClick, cls}]、foot＝[{v, num, span}]
  function table(head, rows, foot) {
    const td = (c) => h('td', {
      class: [c.num && 't-num', c.cls].filter(Boolean).join(' ') || null,
      title: c.title || null, colspan: c.span ? String(c.span) : null,
    }, c.v);
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, head.map((c) => h('th', { class: c.num ? 't-num' : null }, c.t)))),
      h('tbody', null, rows.map((r) => h('tr', r.onClick
        ? { tabindex: '0', class: r.cls, onclick: r.onClick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.onClick(); } } }
        : { class: r.cls }, r.cells.map(td)))),
      foot && h('tfoot', null, h('tr', null, foot.map(td)))));
  }

  // 「項目｜金額」だけの小さな表
  function kvTable(rows) {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table table-kv' }, h('tbody', null,
      rows.map(([k, v, cls]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', { class: `t-num${cls ? ' ' + cls : ''}` }, v))))));
  }

  function emptyNote(...lines) {
    return h('div', { class: 'empty' }, lines.map((l) => (typeof l === 'string' ? h('p', null, l) : l)));
  }
  const linkBtn = (label, onClick) => h('button', { type: 'button', class: 'link-btn', onclick: onClick }, label);

  function meterEl(ratio) {
    return h('span', { class: `meter${ratio > 1 ? ' is-over' : ratio >= 0.8 ? ' is-warn' : ''}` },
      h('span', { class: 'meter-fill', style: `width:${Math.min(ratio, 1) * 100}%` }));
  }

  // 割合を横棒で見せる欄
  function barCell(pct, color) {
    return h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width:${pct}%;--c:${color}` }));
  }

  function selectEl(items, value, label) {
    const sel = h('select', { class: 'field-input', 'aria-label': label },
      items.map(([v, t]) => h('option', { value: v }, t)));
    sel.value = value;
    return sel;
  }

  // 支出の記録の表（支出・カードの画面で共通）。行を押すと直せる
  function recordTable(recs, opt = {}) {
    const rows = recs.map((r) => {
      const c = catById(r.categoryId);
      const p = payById(r.paymentId);
      return {
        onClick: () => openRecordSheet(r, false),
        cells: [
          { v: fmtDate(r.date), cls: 't-date' },
          { v: h('span', { class: 'cell-cat' }, h('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, c.icon), c.name) },
          !opt.hidePay && { v: h('span', { class: 'cell-pay' }, dot(p.color), p.name), cls: 't-pay' },
          { v: [r.fixed && h('span', { class: 'badge badge-card' }, '固定費'), r.memo], cls: 't-memo', title: r.memo || null },
          { num: true, v: money(r.amount) },
        ].filter(Boolean),
      };
    });
    const head = [
      { t: opt.dateLabel || '日付' }, { t: 'カテゴリ' },
      !opt.hidePay && { t: '支払い方法' }, { t: 'メモ' }, { t: '金額', num: true },
    ].filter(Boolean);
    const foot = opt.total && [{ v: `${recs.length}件`, span: head.length - 1 }, { num: true, v: money(sumAmount(recs)) }];
    return table(head, rows, foot);
  }

  /* ---------- 月初 ---------- */
  function renderStart() {
    const key = ui.viewMonth;
    $('#copy-prev-btn').textContent = `${monthName(shiftMonth(key, -1))}の収入・固定費をコピー`;

    const incomes = incomesOf(key);
    const fixed = fixedOf(key);
    const { total } = monthStats(key);
    const incomeTotal = sumAmount(incomes);
    const fixedTotal = sumAmount(fixed);
    const budget = data.settings.budget;

    const incomePanel = panel('収入（給料など）',
      linkBtn('＋ 収入を追加', () => openIncomeSheet(null)),
      incomes.length
        ? table([{ t: '項目' }, { t: '金額', num: true }],
          incomes.map((i) => ({ onClick: () => openIncomeSheet(i), cells: [{ v: i.name }, { num: true, v: money(i.amount) }] })),
          [{ v: '合計' }, { num: true, v: money(incomeTotal) }])
        : emptyNote('この月の収入はまだ入っていません。', '「＋ 収入を追加」で入れます（前の月から「コピー」もできます）。'));

    const fixedPanel = panel('毎月の固定費（引落し）',
      linkBtn('＋ 固定費を追加', () => openRecordSheet(newFixedRecord(key), true)),
      fixed.length
        ? table([{ t: '日' }, { t: '項目' }, { t: 'カテゴリ' }, { t: '支払い方法' }, { t: '金額', num: true }],
          fixed.map((r) => {
            const c = catById(r.categoryId);
            const p = payById(r.paymentId);
            return {
              onClick: () => openRecordSheet(r, false),
              cells: [
                { v: `${dayNum(r.date)}日`, cls: 't-date' },
                { v: r.memo },
                { v: h('span', { class: 'cell-cat' }, h('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, c.icon), c.name) },
                { v: h('span', { class: 'cell-pay' }, dot(p.color), p.name) },
                { num: true, v: money(r.amount) },
              ],
            };
          }),
          [{ v: `${fixed.length}件`, span: 4 }, { num: true, v: money(fixedTotal) }])
        : emptyNote('この月の固定費はまだ入っていません。', '家賃・保険料・通信費など、毎月決まって出ていくお金を入れます。固定費は支出の記録にも入ります。'));

    const budgetRows = [['1か月の予算', budget > 0 ? money(budget) : '未設定']];
    if (budget > 0) {
      budgetRows.push(['使った金額（固定費を含む）', money(total)]);
      budgetRows.push([budget - total >= 0 ? '予算の残り' : '予算オーバー', money(Math.abs(budget - total)), budget - total >= 0 ? 'pos' : 'neg']);
    }
    const budgetPanel = panel('月の予算', linkBtn('予算を変える', openBudgetSheet),
      kvTable(budgetRows), budget > 0 && h('div', { class: 'panel-pad' }, meterEl(total / budget)));

    const balance = incomeTotal - total;
    const summaryPanel = panel(`${monthName(key)}のまとめ`, null, kvTable([
      ['収入の合計', money(incomeTotal)],
      ['支出の合計', money(total)],
      ['　うち固定費', money(fixedTotal)],
      ['収支（収入 − 支出）', signedMoney(balance), signClass(balance)],
    ]));

    const list = cards();
    const cardPanel = panel('カードの支払い金額', h('span', { class: 'panel-note' }, `${monthName(key)}に引き落とされる分`),
      list.length
        ? table([{ t: 'カード' }, { t: '引き落とし日' }, { t: '対象の期間' }, { t: '金額', num: true }, { t: '状態' }],
          list.map((p) => {
            const info = billInfo(p, key);
            const amt = sumAmount(billRecords(p, key));
            const st = billStatus(info, amt);
            return {
              onClick: () => { ui.billMonth = key; showTab('cards'); },
              cells: [
                { v: h('span', { class: 'cell-pay' }, dot(p.color), p.name) },
                { v: fmtDate(info.payDate), cls: 't-date' },
                { v: `${fmtDate(info.start)}〜${fmtDate(info.end)}`, cls: 't-date' },
                { num: true, v: money(amt) },
                { v: h('span', { class: `badge ${st.cls}` }, st.label) },
              ],
            };
          }),
          [{ v: '合計', span: 3 }, { num: true, v: money(list.reduce((sum, p) => sum + sumAmount(billRecords(p, key)), 0)) }, { v: '' }])
        : emptyNote('クレジットカードを登録すると、この月に引き落とされる金額がここに出ます。', linkBtn('カードを登録する ›', () => openPaymentSheet(null))));

    $('#start-body').replaceChildren(h('div', { class: 'grid-2' },
      h('div', { class: 'col' }, incomePanel, fixedPanel),
      h('div', { class: 'col' }, budgetPanel, summaryPanel, cardPanel)));
  }

  function newFixedRecord(key) {
    return { id: newId(), amount: 0, categoryId: OTHER_ID, paymentId: CASH_ID, date: `${key}-01`, memo: '', createdAt: Date.now(), fixed: true };
  }

  // 前の月の収入・固定費を、いま見ている月にコピーする（すでに同じ内容があるものは足さない）
  async function copyFromPrev() {
    const key = ui.viewMonth;
    const prev = shiftMonth(key, -1);
    const nowInc = incomesOf(key);
    const nowFix = fixedOf(key);
    const incs = incomesOf(prev).filter((i) => !nowInc.some((x) => x.name === i.name && x.amount === i.amount));
    const fixes = fixedOf(prev).filter((r) => !nowFix.some((x) => x.memo === r.memo && x.amount === r.amount && x.categoryId === r.categoryId && x.paymentId === r.paymentId));
    if (!incs.length && !fixes.length) {
      showToast(`${fmtMonth(prev)}にコピーできる収入・固定費はありません（入っていないか、すでにコピー済みです）`);
      return;
    }
    const ok = await confirmDialog({
      title: `${fmtMonth(prev)}の内容を${fmtMonth(key)}にコピーしますか？`,
      message: `収入 ${incs.length}件、固定費 ${fixes.length}件を追加します。\n（すでに同じ内容があるものは追加しません）`,
      okLabel: 'コピーする',
    });
    if (!ok) return;
    const now = Date.now();
    const newIncs = incs.map((i) => ({ id: newId(), month: key, name: i.name, amount: i.amount }));
    const newRecs = fixes.map((r, n) => ({ ...r, id: newId(), date: dayOf(key, dayNum(r.date)), createdAt: now + n }));
    data.incomes.push(...newIncs);
    data.records.push(...newRecs);
    if (!save()) {
      data.incomes = data.incomes.filter((i) => !newIncs.includes(i));
      data.records = data.records.filter((r) => !newRecs.includes(r));
      return;
    }
    renderAll();
    showToast(`収入 ${newIncs.length}件、固定費 ${newRecs.length}件をコピーしました`, {
      action: '取り消す',
      onAction: () => {
        data.incomes = data.incomes.filter((i) => !newIncs.includes(i));
        data.records = data.records.filter((r) => !newRecs.includes(r));
        save();
        renderAll();
        showToast('取り消しました');
      },
    });
  }

  /* ---------- 支出 ---------- */
  function renderSpend() {
    const key = ui.viewMonth;
    fillEntrySelects();
    renderDate();
    $('#first-hint').hidden = data.records.length > 0;

    if (ui.filterCat && !data.categories.some((c) => c.id === ui.filterCat)) ui.filterCat = null;
    if (ui.filterPay && !data.payments.some((p) => p.id === ui.filterPay)) ui.filterPay = null;

    let recs = monthStats(key).recs;
    if (ui.filterCat) recs = recs.filter((r) => r.categoryId === ui.filterCat);
    if (ui.filterPay) recs = recs.filter((r) => r.paymentId === ui.filterPay);

    $('#spend-title').textContent = `${fmtMonth(key)}の支出`;
    const catFilter = selectEl([['', 'カテゴリ：すべて'], ...data.categories.map((c) => [c.id, `${c.icon} ${c.name}`])], ui.filterCat || '', 'カテゴリで絞り込む');
    catFilter.addEventListener('change', () => { ui.filterCat = catFilter.value || null; renderSpend(); });
    const payFilter = selectEl([['', '支払い方法：すべて'], ...data.payments.map((p) => [p.id, p.name])], ui.filterPay || '', '支払い方法で絞り込む');
    payFilter.addEventListener('change', () => { ui.filterPay = payFilter.value || null; renderSpend(); });
    $('#spend-filters').replaceChildren(catFilter, payFilter);

    $('#spend-list').replaceChildren(recs.length
      ? recordTable(recs.slice().sort(byNewest), { total: true })
      : emptyNote(ui.filterCat || ui.filterPay ? '条件に合う記録はありません' : 'この月の記録はまだありません'));
  }

  // 入力欄のカテゴリ・支払い方法の選択肢
  function fillEntrySelects() {
    if (!data.payments.some((p) => p.id === ui.paymentId)) ui.paymentId = CASH_ID;
    if (ui.categoryId && !data.categories.some((c) => c.id === ui.categoryId)) ui.categoryId = null;
    const cat = $('#cat-select');
    cat.replaceChildren(h('option', { value: '' }, 'カテゴリを選んでください'),
      ...data.categories.map((c) => h('option', { value: c.id }, `${c.icon} ${c.name}`)));
    cat.value = ui.categoryId || '';
    const pay = $('#pay-select');
    pay.replaceChildren(...data.payments.map((p) => h('option', { value: p.id }, p.name)));
    pay.value = ui.paymentId;
  }

  function renderDate() {
    $('#date-input').value = ui.date;
    $('#date-chip').classList.toggle('is-other-day', ui.date !== ui.today);
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
    if (!ui.categoryId) { nudge('#cat-select'); $('#cat-select').focus(); showToast('カテゴリを選んでください'); return; }

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
    ui.viewMonth = monthOf(rec.date);   // 入れた記録が表に見えるように
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

  /* ---------- 月間集計 ---------- */
  function renderSummary() {
    const key = ui.viewMonth;
    const cur = monthOf(ui.today);
    const { recs, total, byCat, byPay } = monthStats(key);
    const incomeTotal = sumAmount(incomesOf(key));
    const fixedTotal = sumAmount(fixedOf(key));
    const prevTotal = monthStats(shiftMonth(key, -1)).total;
    const budget = data.settings.budget;
    const balance = incomeTotal - total;
    const days = key === cur ? dayNum(ui.today) : daysInMonth(key);

    // まとめ
    const rows = [
      ['収入の合計', money(incomeTotal)],
      ['支出の合計', money(total)],
      ['　うち固定費', money(fixedTotal)],
      ['収支（収入 − 支出）', signedMoney(balance), signClass(balance)],
    ];
    if (budget > 0) {
      rows.push(['予算', money(budget)]);
      rows.push([budget - total >= 0 ? '予算の残り' : '予算オーバー', money(Math.abs(budget - total)), budget - total >= 0 ? 'pos' : 'neg']);
    }
    rows.push([key === cur ? '1日あたりの支出（今日まで）' : '1日あたりの支出', money(Math.round(total / days))]);
    rows.push(['先月の支出', prevTotal > 0 ? `${money(prevTotal)}（${total - prevTotal >= 0 ? '+' : '−'}${yen(Math.abs(total - prevTotal))}円）` : '記録なし']);
    rows.push(['記録の件数', `${recs.length}件`]);
    const summaryPanel = panel(`${fmtMonth(key)}のまとめ`, null, kvTable(rows));

    // カテゴリ別・支払い方法別（行を押すと、支出の表をその条件だけに絞る）
    const counts = (field) => {
      const m = new Map();
      for (const r of recs) m.set(r[field], (m.get(r[field]) || 0) + 1);
      return m;
    };
    const catCount = counts('categoryId');
    const payCount = counts('paymentId');
    const goSpend = () => showTab('spend');
    const catEntries = data.categories.filter((c) => byCat.get(c.id) > 0).map((c) => [c, byCat.get(c.id)]).sort((a, b) => b[1] - a[1]);
    const catPanel = panel('カテゴリ別', h('span', { class: 'panel-note' }, '行を押すと、支出の表をそのカテゴリに絞ります'),
      catEntries.length
        ? table([{ t: 'カテゴリ' }, { t: '金額', num: true }, { t: '割合', num: true }, { t: '' }, { t: '件数', num: true }],
          catEntries.map(([c, amt]) => ({
            onClick: () => { ui.filterCat = c.id; ui.filterPay = null; goSpend(); },
            cells: [
              { v: h('span', { class: 'cell-cat' }, h('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, c.icon), c.name) },
              { num: true, v: money(amt) },
              { num: true, v: pctText((amt / total) * 100) },
              { v: barCell((amt / total) * 100, catColor(c)), cls: 't-bar' },
              { num: true, v: `${catCount.get(c.id)}件` },
            ],
          })),
          [{ v: '合計' }, { num: true, v: money(total) }, { num: true, v: '100%' }, { v: '' }, { num: true, v: `${recs.length}件` }])
        : emptyNote('この月の記録はまだありません'));

    const payEntries = data.payments.filter((p) => byPay.get(p.id) > 0).map((p) => [p, byPay.get(p.id)]).sort((a, b) => b[1] - a[1]);
    const payPanel = panel('支払い方法別', h('span', { class: 'panel-note' }, '使った日の月で集計'),
      payEntries.length
        ? table([{ t: '支払い方法' }, { t: '金額', num: true }, { t: '割合', num: true }, { t: '' }, { t: '件数', num: true }],
          payEntries.map(([p, amt]) => ({
            onClick: () => { ui.filterPay = p.id; ui.filterCat = null; goSpend(); },
            cells: [
              { v: h('span', { class: 'cell-pay' }, dot(p.color), p.name, p.kind === 'card' && h('span', { class: 'badge badge-card' }, 'カード')) },
              { num: true, v: money(amt) },
              { num: true, v: pctText((amt / total) * 100) },
              { v: barCell((amt / total) * 100, colorVar(p.color)), cls: 't-bar' },
              { num: true, v: `${payCount.get(p.id)}件` },
            ],
          })),
          [{ v: '合計' }, { num: true, v: money(total) }, { num: true, v: '100%' }, { v: '' }, { num: true, v: `${recs.length}件` }])
        : emptyNote('この月の記録はまだありません'));

    // 月ごとの表（ふだんは今月までの12か月。古い月を見ているときはその月のまわり）
    let end = key > cur ? key : cur;
    if (key <= shiftMonth(end, -TREND_MONTHS)) end = shiftMonth(key, 6);
    const months = Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(end, i - (TREND_MONTHS - 1)));
    const lines = months.map((k) => ({ k, inc: sumAmount(incomesOf(k)), out: monthStats(k).total }));
    const sumInc = lines.reduce((sum, l) => sum + l.inc, 0);
    const sumOut = lines.reduce((sum, l) => sum + l.out, 0);
    const monthsPanel = panel('月ごとの収支', h('span', { class: 'panel-note' }, '行を押すとその月へ'),
      table([{ t: '月' }, { t: '収入', num: true }, { t: '支出', num: true }, { t: '収支', num: true }],
        lines.map((l) => ({
          cls: l.k === key ? 'is-current' : null,
          onClick: () => setViewMonth(l.k),
          cells: [
            { v: fmtMonth(l.k) },
            { num: true, v: l.inc > 0 ? money(l.inc) : '－' },
            { num: true, v: l.out > 0 ? money(l.out) : '－' },
            { num: true, v: l.inc > 0 || l.out > 0 ? signedMoney(l.inc - l.out) : '－', cls: signClass(l.inc - l.out) },
          ],
        })),
        [{ v: '12か月の合計' }, { num: true, v: money(sumInc) }, { num: true, v: money(sumOut) }, { num: true, v: signedMoney(sumInc - sumOut), cls: signClass(sumInc - sumOut) }]));

    $('#summary-body').replaceChildren(h('div', { class: 'grid-2' },
      h('div', { class: 'col' }, summaryPanel, monthsPanel),
      h('div', { class: 'col' }, catPanel, payPanel)));

    // バックアップのお知らせ
    const last = data.settings.lastBackup;
    $('#backup-reminder').hidden = !(data.records.length >= 20 && (!last || daysBetween(last, ui.today) >= BACKUP_REMIND_DAYS));
  }

  /* ---------- カード ---------- */
  function renderCards() {
    const body = $('#cards-body');
    const list = cards();
    if (!list.length) {
      body.replaceChildren(panel('カード', null, emptyNote(
        'クレジットカードがまだ登録されていません。',
        'カードの名前・締め日・支払日を登録すると、引き落とされる月ごとの金額がここに出ます。',
        h('button', { type: 'button', class: 'btn btn-primary btn-inline', onclick: () => openPaymentSheet(null) }, icon('plus', 'icon-s'), 'カードを登録する'))));
      return;
    }

    const range = billRange(list);
    const key = ui.billMonth;
    const go = (k) => { ui.billMonth = k; renderCards(); };

    // 次の引き落とし（カードごとに、これから来るいちばん近い1回）
    const bills = upcomingBills();
    const upcoming = panel('これからの引き落とし', h('span', { class: 'panel-note' }, 'カードごとの、次の1回'),
      table([{ t: 'カード' }, { t: '引き落とし日' }, { t: '対象の期間' }, { t: '金額', num: true }, { t: '状態' }],
        bills.map((b) => ({
          onClick: () => go(b.key),
          cells: [
            { v: h('span', { class: 'cell-pay' }, dot(b.p.color), b.p.name) },
            { v: fmtDate(b.info.payDate), cls: 't-date' },
            { v: `${fmtDate(b.info.start)}〜${fmtDate(b.info.end)}`, cls: 't-date' },
            { num: true, v: money(b.total) },
            { v: h('span', { class: `badge ${b.st.cls}` }, b.st.label) },
          ],
        })),
        [{ v: '合計', span: 3 }, { num: true, v: money(bills.reduce((sum, b) => sum + b.total, 0)) }, { v: '' }]));

    // 月ごとの引き落とし
    const monthTotal = list.reduce((sum, p) => sum + sumAmount(billRecords(p, key)), 0);
    const nav = h('div', { class: 'month-nav' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '前の月', disabled: key <= range.min, onclick: () => go(shiftMonth(key, -1)) }, icon('chevron-left')),
      h('span', { class: 'month-nav-title' }, `${fmtMonth(key)}の引き落とし`),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '次の月', disabled: key >= range.max, onclick: () => go(shiftMonth(key, 1)) }, icon('chevron-right')),
      key !== monthOf(ui.today) && h('button', { type: 'button', class: 'chip-btn', onclick: () => go(monthOf(ui.today)) }, '今月'));
    const head = h('div', { class: 'toolbar' },
      h('p', { class: 'toolbar-text' }, `${fmtMonth(key)}の引き落とし合計：`, h('b', { class: 'num' }, money(monthTotal)), `（カード${list.length}枚）`),
      nav);
    const blocks = h('div', { class: 'grid-2' }, list.map((p) => billBlock(p, key)));
    const note = h('p', { class: 'note' }, '※ 使った日と、登録した締め日・支払日から計算した目安です。お店からの請求が遅れて次の月に回った分や、支払日が土日・祝日にあたるときの日付のずれは反映していません。');

    body.replaceChildren(upcoming, head, blocks, note);
  }

  function billBlock(p, key) {
    const info = billInfo(p, key);
    const recs = billRecords(p, key).sort(byDate);
    const total = sumAmount(recs);
    const st = billStatus(info, total);
    return panel([dot(p.color), p.name, h('span', { class: `badge ${st.cls}` }, st.label)],
      h('b', { class: 'num' }, money(total)),
      h('p', { class: 'bill-meta' }, '引き落とし日 ', h('b', null, fmtDate(info.payDate)), `　対象：${fmtDate(info.start)}〜${fmtDate(info.end)}のご利用分　（${payRule(p)}）`),
      recs.length
        ? recordTable(recs, { hidePay: true, dateLabel: '使った日' })
        : emptyNote('この期間のご利用はありません'));
  }

  /* ---------- 表示する月の切りかえ ---------- */
  const MONTH_TABS = ['start', 'spend', 'summary'];

  function renderMonthNav() {
    const key = ui.viewMonth;
    const range = monthRange();
    $('#month-nav').hidden = !MONTH_TABS.includes(ui.tab);
    $('#month-title').textContent = fmtMonth(key);
    $('#prev-month').disabled = key <= range.min;
    $('#next-month').disabled = key >= range.max;
    $('#this-month').hidden = key === monthOf(ui.today);
  }

  function setViewMonth(key) {
    ui.viewMonth = key;
    renderAll();
  }

  /* ---------- 設定画面 ---------- */
  function renderSettings() {
    $$('#theme-seg [data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === data.settings.theme)));

    $('#cat-list').replaceChildren(...data.categories.map((c, i, list) => h('li', { class: 'cat-row' },
      h('button', { type: 'button', class: 'cat-row-main', onclick: () => openCategorySheet(c) },
        catIcon(c), h('span', { class: 'cat-row-name' }, c.name)),
      moveButtons(list, i, c.name))));

    $('#pay-setting-list').replaceChildren(...data.payments.map((p, i, list) => h('li', { class: 'cat-row' },
      h('button', { type: 'button', class: 'cat-row-main', onclick: () => openPaymentSheet(p) },
        dot(p.color),
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

  /* ---------- 画面の明るさ ---------- */
  function applyTheme() {
    const t = data.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    applyStatusBarColor();
  }

  // アプリとして入れたときの上の帯の色を theme.css に合わせる
  function applyStatusBarColor() {
    const probe = h('span', { style: 'display:none;color:var(--color-statusbar)' });
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (color && meta) meta.setAttribute('content', color);
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

  // 色を選ぶ欄（12色）
  function swatchPicker(getColor, setColor) {
    const box = h('div', { class: 'swatches', role: 'group', 'aria-label': '色' });
    const draw = () => box.replaceChildren(...Array.from({ length: COLOR_COUNT }, (_, i) => i + 1).map((n) => h('button', {
      type: 'button', class: 'swatch', style: `--c:${colorVar(n)}`,
      'aria-pressed': String(n === getColor()), 'aria-label': `色${n}`,
      onclick: () => { setColor(n); draw(); },
    })));
    draw();
    return box;
  }

  // 支出・固定費の記録を直す（isNew なら新しく追加する）
  function openRecordSheet(rec, isNew) {
    const fixedMode = !!rec.fixed;
    const amount = amountField(rec.amount);
    const catSel = selectEl(data.categories.map((c) => [c.id, `${c.icon} ${c.name}`]), rec.categoryId, 'カテゴリ');
    const paySel = selectEl(data.payments.map((p) => [p.id, p.name]), rec.paymentId, '支払い方法');
    const dateInput = h('input', { class: 'field-input', type: 'date', 'aria-label': '日付' });
    dateInput.value = rec.date;
    const memoInput = h('input', { class: 'field-input', type: 'text', maxlength: '40', placeholder: fixedMode ? '例：家賃' : 'なくてもOK', 'aria-label': fixedMode ? '項目名' : 'メモ' });
    memoInput.value = rec.memo;

    const footer = [
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const value = amount.get();
          if (!value) { amount.input.focus(); showToast('金額を入力してください'); return; }
          const memo = memoInput.value.trim().slice(0, 40);
          if (fixedMode && !memo) { memoInput.focus(); showToast('項目名を入力してください'); return; }
          const date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : rec.date;
          Object.assign(rec, { amount: value, categoryId: catSel.value, paymentId: paySel.value, date, memo });
          if (isNew) data.records.push(rec);
          save();
          closeSheet();
          renderAll();
          showToast(isNew ? '追加しました' : '記録を直しました');
        },
      }, isNew ? '追加' : '保存'),
    ];
    if (!isNew) {
      footer.unshift(h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const c = catById(rec.categoryId);
          const ok = await confirmDialog({
            title: 'この記録を削除しますか？',
            message: `${fmtDate(rec.date)}　${c.name}　${yen(rec.amount)}円${rec.memo ? '　' + rec.memo : ''}`,
            okLabel: '削除する', danger: true,
          });
          if (!ok) return;
          data.records = data.records.filter((r) => r.id !== rec.id);
          save();
          closeSheet();
          renderAll();
          showToast('削除しました');
        },
      }, '削除'));
    }

    openSheet(isNew ? '固定費を追加' : fixedMode ? '固定費を直す' : '記録を直す', [
      field('金額', amount.el),
      h('div', { class: 'field-row' }, field('カテゴリ', catSel), field('支払い方法', paySel)),
      h('div', { class: 'field-row' }, field('日付', dateInput), field(fixedMode ? '項目名' : 'メモ', memoInput)),
      fixedMode && h('p', { class: 'note' }, '固定費は、この日付の支出としても数えます。'),
    ], footer);
  }

  // 収入（給料など）を追加・直す
  function openIncomeSheet(inc) {
    const isNew = !inc;
    const key = ui.viewMonth;
    const nameInput = h('input', { class: 'field-input', type: 'text', maxlength: '20', placeholder: '例：給料', 'aria-label': '項目' });
    nameInput.value = isNew ? '' : inc.name;
    const amount = amountField(isNew ? 0 : inc.amount);

    const footer = [
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const name = nameInput.value.trim();
          const value = amount.get();
          if (!name) { nameInput.focus(); showToast('項目を入力してください'); return; }
          if (!value) { amount.input.focus(); showToast('金額を入力してください'); return; }
          if (isNew) data.incomes.push({ id: newId(), month: key, name, amount: value });
          else Object.assign(inc, { name, amount: value });
          save();
          closeSheet();
          renderAll();
          showToast(isNew ? '収入を追加しました' : '収入を直しました');
        },
      }, isNew ? '追加' : '保存'),
    ];
    if (!isNew) {
      footer.unshift(h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'この収入を削除しますか？', message: `${inc.name}　${yen(inc.amount)}円`, okLabel: '削除する', danger: true });
          if (!ok) return;
          data.incomes = data.incomes.filter((i) => i.id !== inc.id);
          save();
          closeSheet();
          renderAll();
          showToast('削除しました');
        },
      }, '削除'));
    }
    openSheet(isNew ? `${fmtMonth(key)}の収入を追加` : '収入を直す', [field('項目', nameInput), field('金額', amount.el)], footer);
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
      h('p', { class: 'note' }, '1か月に使ってよい金額の目安です。月初・月間集計に「残り金額」が出ます。毎月同じ金額を使います。'),
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

  function unusedColor(list) {
    const used = new Set(list.map((x) => x.color));
    for (let i = 1; i <= COLOR_COUNT; i++) if (!used.has(i)) return i;
    return (list.length % COLOR_COUNT) + 1;
  }

  function openCategorySheet(cat) {
    const isNew = !cat;
    const draft = isNew ? { name: '', icon: ICON_CHOICES[0], color: unusedColor(data.categories) } : { ...cat };

    const previewIcon = h('span', { class: 'cat-icon', 'aria-hidden': 'true' });
    const previewName = h('span', { class: 'cat-preview-name' });
    const nameInput = h('input', { class: 'field-input', type: 'text', maxlength: '10', placeholder: '例：子ども', 'aria-label': 'カテゴリの名前' });
    nameInput.value = draft.name;
    const iconGrid = h('div', { class: 'icon-grid', role: 'group', 'aria-label': 'アイコン' });

    const draw = () => {
      previewIcon.style.cssText = `--c:${colorVar(draft.color)}`;
      previewIcon.textContent = draft.icon;
      previewName.textContent = nameInput.value.trim() || '（名前）';
      iconGrid.replaceChildren(...ICON_CHOICES.map((ic) => h('button', {
        type: 'button', class: 'icon-choice', 'aria-pressed': String(ic === draft.icon), 'aria-label': ic,
        onclick: () => { draft.icon = ic; draw(); },
      }, ic)));
    };
    nameInput.addEventListener('input', draw);
    draw();

    const body = [
      h('div', { class: 'cat-preview' }, previewIcon, previewName),
      field('名前', nameInput),
      field('アイコン', iconGrid),
      field('色', swatchPicker(() => draft.color, (n) => { draft.color = n; draw(); })),
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
    const draft = isNew ? { name: '', kind: 'card', color: unusedColor(data.payments), ...CARD_DEFAULT } : { ...CARD_DEFAULT, ...pay };

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
    if (!isCash) body.push(field('種類', kindBox), cardFields);
    body.push(field('色（グラフや一覧で使います）', swatchPicker(() => draft.color, (n) => { draft.color = n; })));
    if (isCash) body.push(h('p', { class: 'note' }, '「現金」は削除できません（ほかの支払い方法を削除したときの記録の移し先になります）。'));

    const saveBtn = h('button', {
      type: 'button', class: 'btn btn-primary',
      onclick: () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); showToast('名前を入力してください'); return; }
        if (data.payments.some((p) => p.name === name && (isNew || p.id !== pay.id))) {
          nameInput.focus(); showToast('同じ名前の支払い方法があります'); return;
        }
        const values = { name, color: draft.color };
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
    // 画面の明るさは、このパソコンでの設定のまま
    imported.settings.theme = data.settings.theme;
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
    const rows = [['日付', 'カテゴリ', '支払い方法', '金額', 'メモ', '引き落とし予定日', '区分']];
    const sorted = data.records.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
    for (const r of sorted) {
      const p = payById(r.paymentId);
      const bill = p.kind === 'card' ? slash(billInfo(p, billMonthOf(p, r.date)).payDate) : '';
      rows.push([slash(r.date), catById(r.categoryId).name, p.name, r.amount, r.memo, bill, r.fixed ? '固定費' : '']);
    }
    // 先頭の ﻿（BOM）は、Excelで開いたときに文字化けしないための印
    const csv = '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
    shareOrDownload(`家計簿_${ui.today}.csv`, new Blob([csv], { type: 'text/csv' }));
  }

  /* ---------- 画面の切りかえ ---------- */
  function renderAll() {
    renderStart();
    renderSpend();
    renderSummary();
    renderCards();
    renderSettings();
    renderMonthNav();
  }

  function showTab(name) {
    ui.tab = name;
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === name));
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    renderAll();
    window.scrollTo(0, 0);
    if (name === 'spend') amountInput.focus();
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

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応なしでも動く */ });
    }
  }

  function init() {
    $('#app-version').textContent = APP_VERSION;

    // 支出の入力欄（金額やメモの欄で Enter を押しても記録できる）
    $('#entry-form').addEventListener('submit', (e) => { e.preventDefault(); addRecord(); });
    $('#cat-select').addEventListener('change', (e) => { ui.categoryId = e.target.value || null; });
    $('#pay-select').addEventListener('change', (e) => { ui.paymentId = e.target.value; });
    const dateInput = $('#date-input');
    dateInput.addEventListener('change', () => {
      ui.date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : ui.today;
      renderDate();
    });
    $('#today-btn').addEventListener('click', () => { ui.date = ui.today; renderDate(); });

    // キーボード：Esc で小窓を閉じる。支出の画面では、どこにいても数字を打てば金額の欄に入る
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheetOpen && $('#dialog-root').hidden) { closeSheet(); return; }
      if (ui.tab !== 'spend' || sheetOpen || !$('#dialog-root').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key) && !e.target.closest('input, textarea, select')) amountInput.focus();
    });

    // 上のタブと、表示する月
    $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
    $('#prev-month').addEventListener('click', () => setViewMonth(shiftMonth(ui.viewMonth, -1)));
    $('#next-month').addEventListener('click', () => setViewMonth(shiftMonth(ui.viewMonth, 1)));
    $('#this-month').addEventListener('click', () => setViewMonth(monthOf(ui.today)));
    $('#reminder-btn').addEventListener('click', () => showTab('settings'));

    // 月初
    $('#copy-prev-btn').addEventListener('click', copyFromPrev);

    // 設定画面
    $$('#theme-seg [data-theme-choice]').forEach((b) => b.addEventListener('click', () => {
      data.settings.theme = b.dataset.themeChoice;
      save();
      applyTheme();
      renderSettings();
    }));
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
    // Windows のライト／ダークを切りかえたとき、上の帯の色も合わせる
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyStatusBarColor);

    applyTheme();
    registerServiceWorker();
    renderAll();
    amountInput.focus();
  }

  init();
})();
