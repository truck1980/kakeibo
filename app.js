/* =========================================================
   かんたん家計簿  動き（記録・集計・保存）  パソコン向け
   色・文字・画像は design/theme.css と design/images にあります。
   ========================================================= */
(function () {
  'use strict';

  const APP_VERSION = '6.3.0';
  const STORAGE_KEY = 'kantan-kakeibo-v1';
  const MAX_DIGITS = 7;        // 金額は最大 9,999,999円
  const COLOR_COUNT = 12;      // theme.css の --cat-1 〜 --cat-12
  const OTHER_ID = 'other';    // 削除できないカテゴリ（その他）
  const CASH_ID = 'cash';      // 削除できない支払い方法（現金）
  const CASH_COLOR = 10;       // 現金の色（灰色）
  const END_OF_MONTH = 31;     // 締め日・支払日の「末日」
  const DEFAULT_CLOSING_DAY = 24;  // 家計簿の月の締め日（25日〜翌24日が1か月分）
  const BACKUP_REMIND_DAYS = 30;
  const TREND_MONTHS = 12;     // 月間集計の「月ごとの表」に出す月の数
  const THEMES = ['auto', 'light', 'dark'];  // 画面の明るさ（自動＝Windowsの設定に合わせる）

  // 手書きの家計簿（週の支出・予算の表）の項目。「その他」は削除できない項目
  // 4つ目は「よみ」（支出の表で「しょ」と打つと食費になる、など項目を打って選ぶときに使う）
  const DEFAULT_CATEGORIES = [
    ['food', '食費', '🍚', 'しょくひ'], ['sake', '酒', '🍺', 'さけ'], ['eatout', '外食', '🍜', 'がいしょく'], ['daily', '日用品', '🧻', 'にちようひん'],
    ['bu', 'ブー', '🐶', 'ぶー'], ['beauty', '美容', '💄', 'びよう'], ['clothes', '衣服', '👕', 'いふく'], ['goods', '雑貨', '🧴', 'ざっか'],
    ['gas', 'ガソリン', '⛽', 'がそりん'], ['car', '車', '🚗', 'くるま'], ['medical', '医療', '💊', 'いりょう'], ['hobby', '趣味', '🎮', 'しゅみ'],
    ['fun', '娯楽', '🎬', 'ごらく'], ['social', '交際', '🎁', 'こうさい'], ['stationery', '文房具', '📚', 'ぶんぼうぐ'], ['furniture', '家具', '🏠', 'かぐ'],
    ['appliance', '家電', '💻', 'かでん'], ['kerosene', '灯油', '🔥', 'とうゆ'], [OTHER_ID, 'その他', '📦', 'そのた'],
  ].map(([id, name, icon, yomi], i) => ({ id, name, icon, yomi, tax: id === 'food' ? 8 : 10, color: (i % COLOR_COUNT) + 1 }));

  // 文字をそろえる（全角・半角の違い、カタカナ→ひらがな）。項目のよみの照合と、購入先の名前のそろえに使う
  function toHiragana(s) {
    return String(s || '').normalize('NFKC').replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }
  function cleanStore(s) {
    return String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 20);
  }
  const storeKey = (s) => (s ? s.toLowerCase() : STORE_NONE);
  const STORE_NONE = '__none';

  // 前の版（2.x・3.0.0）の初期の項目のままのデータは、手書きの項目に入れかえる（記録は近い項目に移す）
  const OLD_DEFAULT_NAMES = { food: '食費', daily: '日用品', transport: '交通費', eatout: '外食', hobby: '趣味', clothes: '衣服', medical: '医療', utility: '光熱費', phone: '通信費', other: 'その他' };
  const OLD_CATEGORY_MAP = { food: 'food', daily: 'daily', transport: 'car', eatout: 'eatout', hobby: 'hobby', clothes: 'clothes', medical: 'medical', utility: OTHER_ID, phone: OTHER_ID, other: OTHER_ID };

  // 支払い方法の種類：cash＝現金、card＝クレジットカード（締め日・支払日あり）、other＝電子マネーなど
  const DEFAULT_PAYMENTS = [
    { id: CASH_ID, name: '現金', kind: 'cash', color: CASH_COLOR },
  ];
  // bank＝銀行口座で払う（口座を登録すると自動で作られる）。other のうち prepaid＝チャージして使う電子マネー（残高を管理する）
  const PAY_KIND_LABEL = { cash: '現金', card: 'カード', bank: '口座', other: 'その他' };
  const MOVE_LABEL = { deposit: '入金', withdraw: '出金', charge: 'チャージ', cashin: '現金の入金', cashout: '現金の出金' };
  const BALANCE_DIGITS = 9;    // 残高の入力は9けたまで
  // カードを新しく登録するときの最初の値（末日締め・翌月27日払い）
  const DEFAULT_VARI_ITEMS = ['電気代', '水道代', '灯油', '電話代'];
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
  // 暦どおりの月（カードの締め・引き落としの計算に使う）
  const calMonthOf = (dateStr) => dateStr.slice(0, 7);
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
  // 家計簿の月：締め日までがその月（締め日24日なら、9月25日〜10月24日は「10月」）。末日締めなら暦どおり
  function monthOf(dateStr) {
    const closing = data.settings.closingDay;
    const key = calMonthOf(dateStr);
    return closing === END_OF_MONTH || dayNum(dateStr) <= closing ? key : shiftMonth(key, 1);
  }
  // 家計簿の月の、はじめの日と終わりの日
  function periodOf(key) {
    const closing = data.settings.closingDay;
    if (closing === END_OF_MONTH) return { start: `${key}-01`, end: `${key}-${pad2(daysInMonth(key))}` };
    const prev = shiftMonth(key, -1);
    return { start: addDays(`${prev}-${pad2(closing)}`, 1), end: `${key}-${pad2(closing)}` };
  }
  const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`;
  function periodText(key) {
    const { start, end } = periodOf(key);
    return `${md(start)}〜${md(end)}`;
  }
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
      version: 3,
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      payments: DEFAULT_PAYMENTS.map((p) => ({ ...p })),
      accounts: [],     // 銀行口座 { id, name, openingBalance（基準日の始まりの残高）, openingDate }
      cash: null,       // 手元の現金 { openingBalance（基準日の始まりの残高）, openingDate }（null＝管理していない）
      moves: [],        // 口座の入金・出金、電子マネーのチャージ { id, date, type, accountId, payId, fromType, fromId, amount, memo, createdAt }
      records: [],      // 支出の記録
      incomes: [],      // 月初の収入 { id, month, name, amount, accountId（入金される口座・空＝なし）, day（0＝指定なし） }
      fixeds: [],       // 月初の固定費 { id, month, name, amount, accountId（空＝現金支出）, day（0＝指定なし） }
      budgets: {},      // 項目ごとの月の予算 { 'YYYY-MM': { 項目id: 金額 } }
      varis: [],        // 月初の「毎月の金額がかわるもの」 { id, month, name, day, budget, actual }
      variItems: DEFAULT_VARI_ITEMS.slice(),  // 「かわるもの」に登録した項目名（光熱費タブで月ごとに比べる）
      specials: [],     // 月初の特別支出 { id, month, name, day, source, amount }
      savings: [],      // 月初の貯蓄まとめ { id, month, name, amount }
      memos: {},        // 月ごとのメモ { 'YYYY-MM': 文字 }
      settings: { lastBackup: null, theme: 'auto', closingDay: DEFAULT_CLOSING_DAY },
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

  // 口座を登録すると「口座」という支払い方法が自動でできる（デビットカード・口座払いの支出用）。口座の名前と同じにそろえる
  function ensureBankPayments(accounts, payments) {
    for (const a of accounts) {
      const name = `${a.name}（口座）`;
      const pay = payments.find((p) => p.kind === 'bank' && p.accountId === a.id);
      if (pay) pay.name = name;
      else payments.push({ id: `b${a.id}`, name, kind: 'bank', color: unusedColor(payments), accountId: a.id });
    }
  }

  // 保存データ・バックアップファイルの中身を点検して、正しい形にそろえる
  // （支払い方法が入っていない古いデータは、記録をすべて「現金」として読みこむ）
  function normalize(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.categories) || !Array.isArray(obj.records)) {
      throw new Error('家計簿のデータではありません');
    }
    const maxAmount = 10 ** MAX_DIGITS - 1;
    const maxBalance = 10 ** BALANCE_DIGITS - 1;
    const money0 = (n) => Math.min(Math.max(Math.round(Number(n)) || 0, 0), maxAmount);
    const balance0 = (n) => Math.min(Math.max(Math.round(Number(n)) || 0, 0), maxBalance);
    const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const isMonth = (v) => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);
    const isOldDefault = (Number(obj.version) || 0) < 3
      && obj.categories.length === Object.keys(OLD_DEFAULT_NAMES).length
      && obj.categories.every((c) => c && OLD_DEFAULT_NAMES[c.id] === c.name);
    const catsIn = isOldDefault ? DEFAULT_CATEGORIES : obj.categories;
    const mapCat = (id) => (isOldDefault ? OLD_CATEGORY_MAP[id] || OTHER_ID : id);

    const seen = new Set();
    const categories = [];
    for (const c of catsIn) {
      if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || seen.has(c.id)) continue;
      seen.add(c.id);
      const catName = c.name.trim().slice(0, 10) || '（名前なし）';
      // よみが入っていない（6.0.0 までの）項目は、初期の項目と同じ名前のときだけ初期のよみを入れる
      const def = DEFAULT_CATEGORIES.find((d) => d.id === c.id && d.name === catName);
      categories.push({
        id: c.id,
        name: catName,
        icon: typeof c.icon === 'string' && c.icon ? c.icon : '📦',
        yomi: typeof c.yomi === 'string' ? toHiragana(c.yomi).trim().slice(0, 20) : (def ? def.yomi : ''),
        tax: c.tax === 8 || c.tax === 10 ? c.tax : (c.id === 'food' ? 8 : 10),   // 「＋」で税込にするときの税率
        color: clampColor(c.color),
      });
    }
    if (!seen.has(OTHER_ID)) {
      categories.push({ ...DEFAULT_CATEGORIES.find((c) => c.id === OTHER_ID) });
      seen.add(OTHER_ID);
    }
    const accIds = new Set();
    const accounts = [];
    for (const a of Array.isArray(obj.accounts) ? obj.accounts : []) {
      if (!a || typeof a.id !== 'string' || typeof a.name !== 'string' || accIds.has(a.id)) continue;
      accIds.add(a.id);
      accounts.push({
        id: a.id, name: a.name.trim().slice(0, 12) || '（名前なし）',
        openingBalance: balance0(a.openingBalance), openingDate: isDate(a.openingDate) ? a.openingDate : todayStr(),
      });
    }
    const payIds = new Set();
    const payments = [];
    for (const p of Array.isArray(obj.payments) ? obj.payments : []) {
      if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || payIds.has(p.id)) continue;
      const kind = p.id === CASH_ID ? 'cash' : p.kind === 'card' ? 'card' : p.kind === 'bank' ? 'bank' : 'other';
      if (kind === 'bank' && !accIds.has(p.accountId)) continue;   // 口座がなくなっていたら、この支払い方法も外す
      payIds.add(p.id);
      // 色が入っていない（2.0.0 までの）支払い方法には、並び順で色を割りあてる
      const pay = { id: p.id, name: p.name.trim().slice(0, 12) || '（名前なし）', kind, color: clampColor(p.color, kind === 'cash' ? CASH_COLOR : (payments.length % 9) + 1) };
      if (kind === 'card') {
        pay.closingDay = clampDay(p.closingDay, CARD_DEFAULT.closingDay);
        pay.payOffset = Number(p.payOffset) === 2 ? 2 : 1;
        pay.payDay = clampDay(p.payDay, CARD_DEFAULT.payDay);
        if (accIds.has(p.accountId)) pay.accountId = p.accountId;   // 引き落とされる口座
      }
      if (kind === 'bank') pay.accountId = p.accountId;
      if (kind === 'other' && p.prepaid) {
        pay.prepaid = true;
        pay.openingBalance = balance0(p.openingBalance);
        pay.openingDate = isDate(p.openingDate) ? p.openingDate : todayStr();
      }
      payments.push(pay);
    }
    if (!payIds.has(CASH_ID)) {
      payments.unshift({ ...DEFAULT_PAYMENTS[0] });
      payIds.add(CASH_ID);
    }
    ensureBankPayments(accounts, payments);
    for (const p of payments) payIds.add(p.id);

    const fixeds = [];
    const records = [];
    for (const r of obj.records) {
      const amount = Math.round(Number(r && r.amount));
      if (!r || !(amount > 0) || !isDate(r.date)) continue;
      if (r.fixed) {
        // 3.0.0 で「固定費の印つきの記録」として入れたものは、月初の固定費に移す
        fixeds.push({ id: String(r.id || newId()), month: calMonthOf(r.date), name: (typeof r.memo === 'string' && r.memo.trim()) || '固定費', amount: Math.min(amount, maxAmount), accountId: '', day: dayNum(r.date) });
        continue;
      }
      const catId = mapCat(r.categoryId);
      records.push({
        id: String(r.id || newId()),
        amount: Math.min(amount, maxAmount),
        categoryId: seen.has(catId) ? catId : OTHER_ID,
        paymentId: payIds.has(r.paymentId) ? r.paymentId : CASH_ID,
        date: r.date,
        store: cleanStore(r.store),
        memo: typeof r.memo === 'string' ? r.memo.slice(0, 40) : '',
        createdAt: Number(r.createdAt) || 0,
      });
    }
    for (const f of Array.isArray(obj.fixeds) ? obj.fixeds : []) {
      const amount = Math.round(Number(f && f.amount));
      if (!f || !(amount > 0) || !isMonth(f.month)) continue;
      fixeds.push({
        id: String(f.id || newId()), month: f.month,
        name: typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 20) : '固定費',
        amount: Math.min(amount, maxAmount),
        accountId: accIds.has(f.accountId) ? f.accountId : '',
        day: clampDay(f.day, 0),
      });
    }
    const incomes = [];
    for (const i of Array.isArray(obj.incomes) ? obj.incomes : []) {
      const amount = Math.round(Number(i && i.amount));
      if (!i || !(amount > 0) || !isMonth(i.month)) continue;
      incomes.push({
        id: String(i.id || newId()), month: i.month,
        name: typeof i.name === 'string' && i.name.trim() ? i.name.trim().slice(0, 20) : '収入',
        amount: Math.min(amount, maxAmount),
        accountId: accIds.has(i.accountId) ? i.accountId : '',
        day: clampDay(i.day, 0),
      });
    }
    const budgets = {};
    const bIn = obj.budgets && typeof obj.budgets === 'object' ? obj.budgets : {};
    for (const month of Object.keys(bIn)) {
      if (!isMonth(month) || !bIn[month] || typeof bIn[month] !== 'object') continue;
      for (const id of Object.keys(bIn[month])) {
        const v = Math.round(Number(bIn[month][id]));
        if (!seen.has(id) || !(v > 0)) continue;
        if (!budgets[month]) budgets[month] = {};
        budgets[month][id] = Math.min(v, maxAmount);
      }
    }
    const lineName = (v, fallback) => (typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 20) : fallback);
    const varis = [];
    for (const v of Array.isArray(obj.varis) ? obj.varis : []) {
      if (!v || !isMonth(v.month)) continue;
      varis.push({ id: String(v.id || newId()), month: v.month, name: lineName(v, '項目'), day: clampDay(v.day, 0), budget: money0(v.budget), actual: money0(v.actual) });
    }
    const specials = [];
    for (const v of Array.isArray(obj.specials) ? obj.specials : []) {
      if (!v || !isMonth(v.month) || !(money0(v.amount) > 0)) continue;
      specials.push({ id: String(v.id || newId()), month: v.month, name: lineName(v, '特別支出'), day: clampDay(v.day, 0), source: typeof v.source === 'string' ? v.source.trim().slice(0, 20) : '', amount: money0(v.amount) });
    }
    const savings = [];
    for (const v of Array.isArray(obj.savings) ? obj.savings : []) {
      if (!v || !isMonth(v.month) || !(money0(v.amount) > 0)) continue;
      savings.push({ id: String(v.id || newId()), month: v.month, name: lineName(v, '貯蓄'), amount: money0(v.amount) });
    }
    const memos = {};
    const mIn = obj.memos && typeof obj.memos === 'object' ? obj.memos : {};
    for (const month of Object.keys(mIn)) {
      if (isMonth(month) && typeof mIn[month] === 'string' && mIn[month].trim()) memos[month] = mIn[month].slice(0, 2000);
    }
    // 口座の入金・出金・チャージ
    const moves = [];
    const fromTypes = ['account', 'card', 'cash', 'none'];
    for (const m of Array.isArray(obj.moves) ? obj.moves : []) {
      const amount = Math.round(Number(m && m.amount));
      if (!m || !(amount > 0) || !isDate(m.date) || !MOVE_LABEL[m.type]) continue;
      const mv = { id: String(m.id || newId()), date: m.date, type: m.type, amount: Math.min(amount, maxAmount), memo: typeof m.memo === 'string' ? m.memo.slice(0, 40) : '', createdAt: Number(m.createdAt) || 0 };
      if (m.type === 'charge') {
        const pay = payments.find((x) => x.id === m.payId && x.kind === 'other' && x.prepaid);
        if (!pay) continue;
        mv.payId = pay.id;
        mv.fromType = fromTypes.includes(m.fromType) ? m.fromType : 'none';
        mv.fromId = typeof m.fromId === 'string' ? m.fromId : '';
        if (mv.fromType === 'account' && !accIds.has(mv.fromId)) mv.fromType = 'none';
        if (mv.fromType === 'card' && !payments.some((x) => x.id === mv.fromId && x.kind === 'card')) mv.fromType = 'none';
        if (mv.fromType === 'cash' || mv.fromType === 'none') mv.fromId = '';
      } else if (m.type === 'cashin' || m.type === 'cashout') {
        // 手元の現金だけの出入り（口座は使わない）
      } else {
        if (!accIds.has(m.accountId)) continue;
        mv.accountId = m.accountId;
        if (m.type === 'withdraw' && m.toCash === false) mv.toCash = false;   // 出金した分を手元の現金に入れない
        if (m.type === 'deposit' && m.fromCash === true) mv.fromCash = true;   // 手元の現金から預け入れた
      }
      moves.push(mv);
    }
    // 基準日より前の日付でチャージしていたら、数えられるように基準日をその日まで前に戻す
    for (const mv of moves) {
      if (mv.type !== 'charge') continue;
      const pay = payments.find((x) => x.id === mv.payId);
      if (pay && pay.openingDate && mv.date < pay.openingDate) pay.openingDate = mv.date;
    }
    // 登録した項目名。古いデータ（登録がない）は、標準の項目と、これまで入れた名前を引き継ぐ
    const variItems = [];
    const addVariItem = (n) => {
      n = typeof n === 'string' ? n.trim().slice(0, 20) : '';
      if (n && !variItems.includes(n) && variItems.length < 30) variItems.push(n);
    };
    if (Array.isArray(obj.variItems)) obj.variItems.forEach(addVariItem);
    else { DEFAULT_VARI_ITEMS.forEach(addVariItem); varis.forEach((v) => addVariItem(v.name)); }
    const cashIn = obj.cash && typeof obj.cash === 'object' ? obj.cash : null;
    const cash = cashIn ? { openingBalance: balance0(cashIn.openingBalance), openingDate: isDate(cashIn.openingDate) ? cashIn.openingDate : todayStr() } : null;
    const st = obj.settings || {};
    return {
      version: 3,
      categories,
      payments,
      accounts,
      cash,
      moves,
      records,
      incomes,
      fixeds,
      budgets,
      varis,
      variItems,
      specials,
      savings,
      memos,
      settings: {
        lastBackup: isDate(st.lastBackup) ? st.lastBackup : null,
        theme: THEMES.includes(st.theme) ? st.theme : 'auto',
        closingDay: clampDay(st.closingDay, DEFAULT_CLOSING_DAY),
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
    viewMonth: monthOf(todayStr()),  // 月初・支出・月間集計・クレジットで共通の、見ている月
    sum: { range: 'month', cat: '', pay: '', store: '', by: 'cat' },  // 集計の画面の条件
    acc: { filter: '' },   // 口座の画面の履歴で絞っている口座・電子マネー（'acc:ID' / 'pay:ID'・空＝すべて）
  };

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

  // 月を切りかえられる範囲：5年前（過去の分を入れられるように。それより古い記録があればその月）〜 来月（来月分の月初を先に入れられるように）
  const PAST_MONTHS = 60;
  function monthRange() {
    const cur = monthOf(ui.today);
    let min = shiftMonth(cur, -PAST_MONTHS);
    let max = shiftMonth(cur, 1);
    for (const r of data.records) {
      const k = monthOf(r.date);
      if (k < min) min = k;
      if (k > max) max = k;
    }
    for (const x of [...data.incomes, ...data.fixeds, ...data.varis, ...data.specials, ...data.savings]) {
      if (x.month < min) min = x.month;
      if (x.month > max) max = x.month;
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
    const key = calMonthOf(dateStr);
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
  // カードからのチャージ（電子マネーへ）は、支出ではないが引き落とし額には入る。表では記録と同じ形の「仮の記録」にする
  function cardChargeRecords(p) {
    return data.moves.filter((m) => m.type === 'charge' && m.fromType === 'card' && m.fromId === p.id).map((m) => ({
      id: `mv${m.id}`, virtual: true, move: m, amount: m.amount, date: m.date, paymentId: p.id,
      categoryId: OTHER_ID, memo: m.memo || `${payById(m.payId).name}へチャージ`, createdAt: m.createdAt,
    }));
  }
  function billRecords(p, billKey) {
    return [...data.records, ...cardChargeRecords(p)].filter((r) => r.paymentId === p.id && billMonthOf(p, r.date) === billKey);
  }
  // 今日より後で、いちばん近い引き落としの月
  function nextBillMonth(p) {
    const cur = calMonthOf(ui.today);
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
    const cur = calMonthOf(ui.today);
    let min = shiftMonth(cur, -PAST_MONTHS);
    let max = cur;
    const consider = (k) => { if (k < min) min = k; if (k > max) max = k; };
    for (const p of list) consider(nextBillMonth(p));
    for (const r of data.records) {
      const p = payById(r.paymentId);
      if (p.kind === 'card') consider(billMonthOf(p, r.date));
    }
    for (const p of list) for (const r of cardChargeRecords(p)) consider(billMonthOf(p, r.date));
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


  /* ---------- 口座・電子マネーの残高 ---------- */
  const accountOf = (id) => data.accounts.find((a) => a.id === id);
  const prepaids = () => data.payments.filter((p) => p.kind === 'other' && p.prepaid);
  const walletKey = (type, id) => `${type}:${id}`;

  // 月初の固定費を引き落とす日（日付の指定がなければ、その月の最後の日）
  function fixedDate(f) {
    const { start, end } = periodOf(f.month);
    if (!f.day) return end;
    let d = dayOf(calMonthOf(end), f.day);
    if (d < start || d > end) d = dayOf(calMonthOf(start), f.day);
    return d >= start && d <= end ? d : end;
  }

  // 口座・電子マネーの出入りの一覧（基準日以降）。delta＝増えた(+)・減った(−)、auto＝自動で入る分、move＝手で入れた入出金
  function walletEvents(type, id) {
    const evs = [];
    const add = (date, delta, label, extra) => evs.push({ date, delta, label, ...extra });
    if (type === 'cash') {
      if (!data.cash) return [];
      for (const m of data.moves) {
        const accName = (accountOf(m.accountId) || {}).name || '口座';
        if (m.type === 'cashin') add(m.date, m.amount, m.memo || '現金の入金', { move: m, createdAt: m.createdAt });
        else if (m.type === 'cashout') add(m.date, -m.amount, m.memo || '現金の出金', { move: m, createdAt: m.createdAt });
        else if (m.type === 'withdraw' && m.toCash !== false) add(m.date, m.amount, m.memo || `${accName}から引き出し`, { move: m, createdAt: m.createdAt });
        else if (m.type === 'deposit' && m.fromCash) add(m.date, -m.amount, m.memo || `${accName}へ預け入れ`, { move: m, createdAt: m.createdAt });
        else if (m.type === 'charge' && m.fromType === 'cash') add(m.date, -m.amount, `${payById(m.payId).name}へチャージ`, { move: m, createdAt: m.createdAt });
      }
      for (const r of data.records) {
        if (r.paymentId === CASH_ID) add(r.date, -r.amount, `${catById(r.categoryId).name}${r.memo ? '：' + r.memo : ''}（支出）`, { auto: true, rec: r, createdAt: r.createdAt });
      }
      return evs.filter((e) => e.date >= data.cash.openingDate);
    }
    if (type === 'acc') {
      const a = accountOf(id);
      if (!a) return [];
      for (const m of data.moves) {
        if (m.type === 'deposit' && m.accountId === id) add(m.date, m.amount, m.memo || '入金', { move: m, createdAt: m.createdAt });
        else if (m.type === 'withdraw' && m.accountId === id) add(m.date, -m.amount, m.memo || '出金', { move: m, createdAt: m.createdAt });
        else if (m.type === 'charge' && m.fromType === 'account' && m.fromId === id) add(m.date, -m.amount, `${payById(m.payId).name}へチャージ`, { move: m, createdAt: m.createdAt });
      }
      for (const i of data.incomes) {
        if (i.accountId === id) add(fixedDate(i), i.amount, `${i.name}（収入）`, { auto: true });
      }
      for (const f of data.fixeds) {
        if (f.accountId === id) add(fixedDate(f), -f.amount, `${f.name}（口座引落）`, { auto: true });
      }
      const bankPay = data.payments.find((p) => p.kind === 'bank' && p.accountId === id);
      if (bankPay) {
        for (const r of data.records) {
          if (r.paymentId === bankPay.id) add(r.date, -r.amount, `${catById(r.categoryId).name}${r.memo ? '：' + r.memo : ''}（支出）`, { auto: true, rec: r, createdAt: r.createdAt });
        }
      }
      for (const p of cards()) {
        if (p.accountId !== id) continue;
        const keys = new Set([...data.records, ...cardChargeRecords(p)].filter((r) => r.paymentId === p.id).map((r) => billMonthOf(p, r.date)));
        for (const k of keys) {
          const total = sumAmount(billRecords(p, k));
          if (total > 0) add(billInfo(p, k).payDate, -total, `${p.name}の引き落とし`, { auto: true });
        }
      }
      return evs.filter((e) => e.date >= a.openingDate);
    }
    const p = payById(id);
    if (!p || !p.prepaid) return [];
    for (const m of data.moves) {
      if (m.type === 'charge' && m.payId === id) add(m.date, m.amount, m.memo || `チャージ（${fromLabel(m)}）`, { move: m, createdAt: m.createdAt });
    }
    for (const r of data.records) {
      if (r.paymentId === id) add(r.date, -r.amount, `${catById(r.categoryId).name}${r.memo ? '：' + r.memo : ''}（支出）`, { auto: true, rec: r, createdAt: r.createdAt });
    }
    return evs.filter((e) => e.date >= p.openingDate);
  }
  const walletOpening = (type, id) => (type === 'cash' ? data.cash.openingBalance : type === 'acc' ? accountOf(id).openingBalance : payById(id).openingBalance);
  const walletName = (type, id) => (type === 'cash' ? '現金' : type === 'acc' ? accountOf(id).name : payById(id).name);

  // 日付の順（同じ日は 入った順・手入力のものが先）
  const byEventDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0));
  // 今日までの出入りを反映した残高
  function walletBalance(type, id) {
    return walletOpening(type, id) + walletEvents(type, id).filter((e) => e.date <= ui.today).reduce((sum, e) => sum + e.delta, 0);
  }
  // チャージ元の表示
  function fromLabel(m) {
    if (m.fromType === 'account') { const a = accountOf(m.fromId); return a ? `口座：${a.name}` : '口座'; }
    if (m.fromType === 'card') return `カード：${payById(m.fromId).name}`;
    return m.fromType === 'cash' ? '現金' : 'チャージ元なし';
  }

  /* ---------- 共通の部品：枠・表 ---------- */
  const money = (n) => `${yen(n)}円`;
  const signedMoney = (n) => `${n < 0 ? '−' : ''}${yen(Math.abs(n))}円`;
  const signClass = (n) => (n < 0 ? 'neg' : n > 0 ? 'pos' : '');
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt);

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

  // クレジットの画面で行を押したとき：その日・その購入先の記録を一覧で見せる（押すと直せる）
  function openGroupRecords(g) {
    const list = [...g.recs].sort(byDate);
    openSheet(`${fmtDate(g.date)}　${g.store}`, [
      table([{ t: '項目' }, { t: '品目' }, { t: '金額', num: true }],
        list.map((r) => {
          const c = catById(r.categoryId);
          return {
            onClick: () => openRecordSheet(r, false),
            cells: [
              { v: h('span', { class: 'cell-cat' }, h('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, c.icon), c.name) },
              { v: r.memo, cls: 't-memo', title: r.memo || null },
              { num: true, v: money(r.amount) },
            ],
          };
        }),
        [{ v: `${list.length}件`, span: 2 }, { num: true, v: money(sumAmount(list)) }]),
      h('p', { class: 'note' }, '行を押すと、項目・金額・購入先などを直せます。'),
    ], []);
  }

  // クレジットの画面：日付・購入先ごとに、その日の使用合計金額だけを出す
  function cardUseTable(recs) {
    const groups = new Map();
    for (const r of recs) {
      const k = `${r.date}|${storeKey(r.store)}`;
      const g = groups.get(k) || { date: r.date, store: r.store || '（購入先なし）', sum: 0, recs: [] };
      g.sum += r.amount;
      g.recs.push(r);
      groups.set(k, g);
    }
    const list = [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return table([{ t: '日付' }, { t: '購入先' }, { t: '使用合計金額', num: true }],
      list.map((g) => ({ onClick: () => openGroupRecords(g), cells: [{ v: fmtDate(g.date), cls: 't-date' }, { v: g.store, cls: 't-memo', title: g.store }, { num: true, v: money(g.sum) }] })),
      [{ v: `${list.length}件`, span: 2 }, { num: true, v: money(sumAmount(recs)) }]);
  }

  // 支出の記録の表（支出・カードの画面で共通）。行を押すと直せる
  function recordTable(recs, opt = {}) {
    const rows = recs.map((r) => {
      const c = r.virtual ? { icon: '🔌', name: 'チャージ' } : catById(r.categoryId);
      const p = payById(r.paymentId);
      return {
        onClick: () => (r.virtual ? openMoveSheet(r.move) : openRecordSheet(r, false)),
        cells: [
          { v: fmtDate(r.date), cls: 't-date' },
          { v: h('span', { class: 'cell-cat' }, h('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, c.icon), c.name) },
          !opt.hidePay && { v: h('span', { class: 'cell-pay' }, dot(p.color), p.name), cls: 't-pay' },
          { v: r.store || '', cls: 't-memo', title: r.store || null },
          { v: r.memo, cls: 't-memo', title: r.memo || null },
          { num: true, v: money(r.amount) },
        ].filter(Boolean),
      };
    });
    const head = [
      { t: opt.dateLabel || '日付' }, { t: '項目' },
      !opt.hidePay && { t: '支払い方法' }, { t: '購入先' }, { t: opt.memoLabel || 'メモ' }, { t: '金額', num: true },
    ].filter(Boolean);
    const foot = opt.total && [{ v: `${recs.length}件`, span: head.length - 1 }, { num: true, v: money(sumAmount(recs)) }];
    return table(head, rows, foot);
  }

  /* ---------- 月初（収入・固定費） ---------- */
  const incomesOf = (key) => data.incomes.filter((i) => i.month === key);
  const fixedsOf = (key) => data.fixeds.filter((f) => f.month === key).sort((a, b) => (a.day || 99) - (b.day || 99));
  const budgetsOf = (key) => data.budgets[key] || {};
  const budgetOf = (key, catId) => budgetsOf(key)[catId] || 0;
  const accountById = (id) => data.accounts.find((a) => a.id === id);
  const fixedDayText = (f) => (f.day ? dayLabel(f.day) : '－');

  // その月の支出（記録）の合計
  const monthSpent = (key) => monthStats(key).total;

  const byDay = (a, b) => (a.day || 99) - (b.day || 99);
  const variOf = (key) => data.varis.filter((v) => v.month === key).sort(byDay);
  const specialOf = (key) => data.specials.filter((v) => v.month === key).sort(byDay);
  const savingOf = (key) => data.savings.filter((v) => v.month === key);

  // 手書きの表の空き行（押すと追加できる）
  const blankRow = (cols, onClick) => ({ onClick, cls: 'row-blank', cells: Array.from({ length: cols }, () => ({ v: ' ' })) });
  const padRows = (rows, min, cols, onClick) => { while (rows.length < min) rows.push(blankRow(cols, onClick)); return rows; };
  const mark = (label, sign) => h('span', null, label, ' ', h('span', { class: 'mark' }, sign));

  // 月初：手書きの家計簿の「月のはじめのページ」と同じ並び
  function renderStart() {
    const key = ui.viewMonth;
    $('#copy-prev-btn').textContent = `${monthName(shiftMonth(key, -1))}の内容をコピー`;

    const incomes = incomesOf(key);
    const fixeds = fixedsOf(key);
    const varis = variOf(key);
    const specials = specialOf(key);
    const savings = savingOf(key);
    const cardList = cards();
    const cardBill = cardList.reduce((sum, p) => sum + sumAmount(billRecords(p, key)), 0);

    // ⓐ〜ⓕ（手書きのページの記号と同じ）
    const A = sumAmount(incomes);
    const B = sumAmount(fixeds) + cardBill;
    const C = varis.reduce((sum, v) => sum + v.budget, 0);
    const D = varis.reduce((sum, v) => sum + v.actual, 0);
    const spentBy = new Map();   // やりくり費の実績＝カード以外（現金・電子マネーなど）で使った分。カード分は翌月の「カード支払い」に入る
    for (const r of data.records) {
      if (monthOf(r.date) !== key || payById(r.paymentId).kind === 'card') continue;
      spentBy.set(r.categoryId, (spentBy.get(r.categoryId) || 0) + r.amount);
    }
    const budgets = budgetsOf(key);
    const E = [...spentBy.values()].reduce((a, b) => a + b, 0);
    const F = B + D + E;
    const yarikuri = A - (B + C);

    // ---- 今月の収入
    const addIncome = () => openIncomeSheet(null);
    const incomePanel = panel('今月の収入', linkBtn('＋ 追加', addIncome),
      table([{ t: '内容' }, { t: '金額', num: true }],
        padRows(incomes.map((i) => ({ onClick: () => openIncomeSheet(i), cells: [{ v: h('span', null, i.name, i.accountId && accountById(i.accountId) ? h('span', { class: 'tag' }, `入金：${accountById(i.accountId).name}`) : null) }, { num: true, v: yen(i.amount) }] })), 4, 2, addIncome),
        [{ v: mark('合計', 'ⓐ') }, { num: true, v: yen(A) }]));

    // ---- クレジットカードの引き落とし（この月に引き落とされる分。前の月に使った分が、ここに出る）
    const billRows = cardList.map((p) => {
      const bk = key;   // 「12月」の欄には、12月に引き落とされる分（引き落とし日が12月）を出す
      const info = billInfo(p, bk);
      return {
        onClick: () => showTab('cards'),
        cells: [
          { v: h('span', { class: 'cell-pay' }, dot(p.color), p.name) },
          { v: fmtDate(info.payDate), cls: 't-date' },
          { v: `${md(info.start)}〜${md(info.end)}`, cls: 't-date' },
          { num: true, v: yen(sumAmount(billRecords(p, bk))) },
        ],
      };
    });
    const cardPanel = panel('クレジットカードの引き落とし', h('span', { class: 'panel-note' }, 'この月に引き落とされる金額（前に使った分）'),
      cardList.length
        ? table([{ t: 'カード' }, { t: '引き落とし日' }, { t: '使った期間' }, { t: '金額', num: true }], billRows,
          [{ v: '合計', span: 3 }, { num: true, v: yen(cardBill) }])
        : emptyNote('クレジットカードを登録すると、引き落とされる金額がここに出ます。', linkBtn('カードを登録する ›', () => openPaymentSheet(null))));

    // ---- 特別支出
    const addSpecial = () => openLineSheet('special', null);
    const specialPanel = panel('特別支出', linkBtn('＋ 追加', addSpecial),
      table([{ t: '日付' }, { t: '内容' }, { t: '出所' }, { t: '金額', num: true }],
        padRows(specials.map((s) => ({
          onClick: () => openLineSheet('special', s),
          cells: [{ v: fixedDayText(s), cls: 't-date' }, { v: s.name }, { v: s.source }, { num: true, v: yen(s.amount) }],
        })), 3, 4, addSpecial),
        [{ v: '合計', span: 3 }, { num: true, v: yen(sumAmount(specials)) }]));

    // ---- 出ていくことが決まっているお金（金額が決まっているもの／毎月の金額がかわるもの）
    const addFixed = () => openFixedSheet(null, '');
    const fixedRows = fixeds.map((f) => ({
      onClick: () => openFixedSheet(f, f.accountId),
      cells: [
        { v: fixedDayText(f), cls: 't-date' },
        { v: h('span', null, f.name, f.accountId && accountById(f.accountId) ? h('span', { class: 'tag' }, accountById(f.accountId).name) : null) },
        { num: true, v: yen(f.amount) },
      ],
    }));
    padRows(fixedRows, 6, 3, addFixed);
    fixedRows.push({
      onClick: () => showTab('cards'), cls: 'row-auto',
      cells: [{ v: '' }, { v: 'カード支払い（自動）' }, { num: true, v: yen(cardBill) }],
    });
    const fixedPanelEl = panel('金額が決まっているもの', linkBtn('＋ 追加', addFixed),
      table([{ t: '日付' }, { t: '内容' }, { t: '金額', num: true }], fixedRows,
        [{ v: mark('合計', 'ⓑ'), span: 2 }, { num: true, v: yen(B) }]));

    const addVari = () => openLineSheet('vari', null);
    const variPanel = panel('毎月の金額がかわるもの', linkBtn('＋ 追加', addVari),
      table([{ t: '日付' }, { t: '内容' }, { t: '予算', num: true }, { t: '実績', num: true }],
        padRows([
          ...varis.map((v) => ({
            onClick: () => openLineSheet('vari', v),
            cells: [{ v: fixedDayText(v), cls: 't-date' }, { v: v.name }, { num: true, v: v.budget ? yen(v.budget) : '' }, { num: true, v: v.actual ? yen(v.actual) : '' }],
          })),
          // 登録した項目は、まだ入れていない月にも並べる（押すと、その名前で入力できる）
          ...data.variItems.filter((n) => !varis.some((v) => v.name === n)).map((n) => ({
            onClick: () => openLineSheet('vari', null, n),
            cells: [{ v: '' }, { v: h('span', { style: 'opacity:.55' }, n) }, { num: true, v: '' }, { num: true, v: '' }],
          })),
        ], 6, 4, addVari),
        [{ v: '合計', span: 2 }, { num: true, v: mark(yen(C), 'ⓒ') }, { num: true, v: mark(yen(D), 'ⓓ') }]));

    // ---- 今月のやりくり費
    const yarikuriPanel = panel('今月のやりくり費', null,
      h('div', { class: 'formula' },
        h('p', { class: 'formula-text' }, 'ⓐ − (ⓑ + ⓒ)'),
        h('p', { class: `formula-num ${signClass(yarikuri)}` }, signedMoney(yarikuri)),
        h('p', { class: 'note note-tight' }, `${yen(A)} − (${yen(B)} + ${yen(C)})`)));

    // ---- やりくり費の内訳（予算はここで入れる）
    const judgeText = (bud, spent) => (bud > 0 ? (spent <= bud ? '○' : '×') : '－');
    const lines = [];
    const budTotalTd = h('td', { class: 't-num' });
    const restTotalTd = h('td', { class: 't-num' });
    const judgeTotalTd = h('td', { class: 't-judge' });
    const catRows = data.categories.map((c) => {
      const spent = spentBy.get(c.id) || 0;
      const input = h('input', { class: 'field-input budget-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${c.name}の予算`, placeholder: '0' });
      const b0 = budgets[c.id] || 0;
      input.value = b0 > 0 ? yen(b0) : '';
      const get = attachAmountFormat(input);
      const restTd = h('td', { class: 't-num' });
      const judgeTd = h('td', { class: 't-judge' });
      lines.push({ c, spent, restTd, judgeTd });
      input.addEventListener('change', () => { setBudget(key, c.id, get()); refreshBudget(); });
      return h('tr', null, itemTh(c, key), h('td', { class: 't-input' }, input),
        h('td', { class: 't-num' }, spent > 0 ? yen(spent) : ''), restTd, judgeTd);
    });
    function refreshBudget() {
      let totalBud = 0;
      for (const l of lines) {
        const bud = budgetOf(key, l.c.id);
        totalBud += bud;
        l.restTd.textContent = bud > 0 ? signedYen(bud - l.spent) : '－';
        l.restTd.classList.toggle('neg', bud > 0 && bud - l.spent < 0);
        l.judgeTd.textContent = judgeText(bud, l.spent);
        l.judgeTd.classList.toggle('neg', bud > 0 && l.spent > bud);
      }
      budTotalTd.textContent = totalBud > 0 ? yen(totalBud) : '－';
      restTotalTd.textContent = totalBud > 0 ? signedYen(totalBud - E) : '－';
      restTotalTd.classList.toggle('neg', totalBud > 0 && totalBud - E < 0);
      judgeTotalTd.textContent = judgeText(totalBud, E);
      judgeTotalTd.classList.toggle('neg', totalBud > 0 && E > totalBud);
    }
    const breakdownPanel = panel('やりくり費の内訳', h('span', { class: 'panel-note' }, '予算の欄に金額を入れると、残り・判定が自動で出ます'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table table-grid' },
        h('thead', null, h('tr', null, h('th', null, '内容'), h('th', { class: 't-num' }, '予算'), h('th', { class: 't-num' }, '実績'), h('th', { class: 't-num' }, '残り'), h('th', { class: 't-judge' }, '判定'))),
        h('tbody', null, catRows),
        h('tfoot', null, h('tr', null, h('td', null, '合計'), budTotalTd, h('td', { class: 't-num' }, mark(yen(E), 'ⓔ')), restTotalTd, judgeTotalTd)))),
      h('p', { class: 'note note-pad' }, '実績は、現金・電子マネーなどで使った分です（「支出」タブの記録から自動）。カードで使った分は、引き落とされる月の「カード支払い」に入ります。残り＝予算 − 実績、判定＝予算の範囲内なら ○、超えたら ×。項目名を押すと、その月の記録を見られます。'));
    refreshBudget();

    // ---- 今月のまとめ
    const summaryPanel = panel('今月のまとめ', h('span', { class: 'panel-note' }, '自動で計算します'), kvTable([
      [mark('収入の合計', 'ⓐ'), yen(A) + '円'],
      [mark('支出の合計（ⓑ＋ⓓ＋ⓔ）', 'ⓕ'), yen(F) + '円'],
      ['今月余ったお金（ⓐ − ⓕ）', signedMoney(A - F), signClass(A - F)],
    ]));

    // ---- 今月の貯蓄まとめ
    const addSaving = () => openLineSheet('saving', null);
    const savingPanel = panel('今月の貯蓄まとめ', linkBtn('＋ 追加', addSaving),
      table([{ t: '内容' }, { t: '金額', num: true }],
        padRows(savings.map((s) => ({ onClick: () => openLineSheet('saving', s), cells: [{ v: s.name }, { num: true, v: yen(s.amount) }] })), 3, 2, addSaving),
        [{ v: '合計' }, { num: true, v: yen(sumAmount(savings)) }]));

    // ---- メモ
    const memoArea = h('textarea', { class: 'field-input memo-area', rows: '6', maxlength: '2000', 'aria-label': 'メモ', placeholder: 'この月のメモ' });
    memoArea.value = data.memos[key] || '';
    memoArea.addEventListener('change', () => {
      const t = memoArea.value.trim();
      if (t) data.memos[key] = t; else delete data.memos[key];
      save();
    });
    const memoPanel = panel('メモ', null, h('div', { class: 'panel-pad' }, memoArea));

    $('#start-body').replaceChildren(h('div', { class: 'grid-3' },
      h('div', { class: 'col' }, incomePanel, cardPanel, specialPanel),
      h('div', { class: 'col' }, fixedPanelEl, yarikuriPanel, breakdownPanel),
      h('div', { class: 'col' }, variPanel, summaryPanel, savingPanel, memoPanel)));
  }

  // 日の選択欄（指定なし／1〜28日／末日）
  function dayOrNoneSelect(value) {
    const sel = h('select', { class: 'field-input', 'aria-label': '日' },
      h('option', { value: '0' }, '指定なし'),
      Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1) }, `${i + 1}日`)),
      h('option', { value: String(END_OF_MONTH) }, '末日'));
    sel.value = String(value);
    return sel;
  }

  // 月初の「かわるもの」「特別支出」「貯蓄」を追加・直す
  const LINE_KINDS = {
    vari: { list: 'varis', noun: '毎月の金額がかわるもの', day: true, namePh: '例：電気代', hint: '予算と実績は、わかっているほうだけでも入れられます。' },
    special: { list: 'specials', noun: '特別支出', day: true, source: true, namePh: '例：お祝い', needAmount: true },
    saving: { list: 'savings', noun: '貯蓄', namePh: '例：定期預金', needAmount: true },
  };
  function openLineSheet(kind, item, presetName) {
    const K = LINE_KINDS[kind];
    const isNew = !item;
    const key = ui.viewMonth;
    const nameInput = h('input', { class: 'field-input', type: 'text', maxlength: '20', placeholder: K.namePh, 'aria-label': '内容' });
    nameInput.value = isNew ? (presetName || '') : item.name;
    const daySel = K.day ? dayOrNoneSelect(isNew ? 0 : item.day) : null;
    const sourceInput = K.source ? h('input', { class: 'field-input', type: 'text', maxlength: '20', placeholder: '例：ボーナス・貯金から', 'aria-label': '出所' }) : null;
    if (sourceInput) sourceInput.value = isNew ? '' : item.source;
    const budget = kind === 'vari' ? amountField(isNew ? 0 : item.budget) : null;
    const actual = kind === 'vari' ? amountField(isNew ? 0 : item.actual) : null;
    const amount = kind !== 'vari' ? amountField(isNew ? 0 : item.amount) : null;

    const footer = [
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) { nameInput.focus(); showToast('内容を入力してください'); return; }
          const values = { name };
          if (daySel) values.day = Number(daySel.value);
          if (sourceInput) values.source = sourceInput.value.trim();
          if (kind === 'vari') {
            values.budget = budget.get();
            values.actual = actual.get();
          } else {
            values.amount = amount.get();
            if (!values.amount) { amount.input.focus(); showToast('金額を入力してください'); return; }
          }
          if (isNew) data[K.list].push({ id: newId(), month: key, ...values });
          else Object.assign(item, values);
          save();
          closeSheet();
          renderAll();
          showToast(isNew ? `${K.noun}を追加しました` : `${K.noun}を直しました`);
        },
      }, isNew ? '追加' : '保存'),
    ];
    if (!isNew) {
      footer.unshift(h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const ok = await confirmDialog({ title: `この${K.noun}を削除しますか？`, message: item.name, okLabel: '削除する', danger: true });
          if (!ok) return;
          data[K.list] = data[K.list].filter((x) => x.id !== item.id);
          save();
          closeSheet();
          renderAll();
          showToast('削除しました');
        },
      }, '削除'));
    }
    openSheet(isNew ? `${fmtMonth(key)}の${K.noun}を追加` : `${K.noun}を直す`, [
      kind === 'vari' && data.variItems.length > 0 && h('div', { class: 'field' },
        h('p', { class: 'note' }, '登録した項目から選べます（光熱費タブで月ごとに比べられます）'),
        data.variItems.map((n) => h('button', { type: 'button', class: 'chip-btn', onclick: () => { nameInput.value = n; actual.input.focus(); } }, n))),
      field('内容', nameInput),
      daySel && field('日付', daySel),
      sourceInput && field('出所', sourceInput),
      kind === 'vari'
        ? h('div', { class: 'field-row' }, field('予算', budget.el), field('実績', actual.el))
        : field('金額', amount.el),
      K.hint && h('p', { class: 'note' }, K.hint),
    ], footer);
  }

  // 前の月の収入・固定費・かわるもの・予算を、いま見ている月にコピーする（すでに同じ内容があるものは足さない）
  async function copyFromPrev() {
    const key = ui.viewMonth;
    const prev = shiftMonth(key, -1);
    const nowInc = incomesOf(key);
    const nowFix = fixedsOf(key);
    const nowVari = variOf(key);
    const incs = incomesOf(prev).filter((i) => !nowInc.some((x) => x.name === i.name && x.amount === i.amount && x.accountId === i.accountId));
    const fixes = fixedsOf(prev).filter((f) => !nowFix.some((x) => x.name === f.name && x.amount === f.amount && x.accountId === f.accountId));
    const varis = variOf(prev).filter((v) => !nowVari.some((x) => x.name === v.name));
    const prevB = budgetsOf(prev);
    const nowB = budgetsOf(key);
    const budgetIds = Object.keys(prevB).filter((id) => !(nowB[id] > 0));
    if (!incs.length && !fixes.length && !varis.length && !budgetIds.length) {
      showToast(`${fmtMonth(prev)}にコピーできる内容はありません（入っていないか、すでにコピー済みです）`);
      return;
    }
    const ok = await confirmDialog({
      title: `${fmtMonth(prev)}の内容を${fmtMonth(key)}にコピーしますか？`,
      message: `収入 ${incs.length}件、金額が決まっているもの ${fixes.length}件、金額がかわるもの ${varis.length}件（予算だけ）、やりくり費の予算 ${budgetIds.length}項目を追加します。\n（すでに同じ内容があるものは追加しません）`,
      okLabel: 'コピーする',
    });
    if (!ok) return;
    const newIncs = incs.map((i) => ({ id: newId(), month: key, name: i.name, amount: i.amount, accountId: i.accountId || '', day: i.day || 0 }));
    const newFix = fixes.map((f) => ({ id: newId(), month: key, name: f.name, amount: f.amount, accountId: f.accountId, day: f.day }));
    const newVari = varis.map((v) => ({ id: newId(), month: key, name: v.name, day: v.day, budget: v.budget, actual: 0 }));
    data.incomes.push(...newIncs);
    data.fixeds.push(...newFix);
    data.varis.push(...newVari);
    if (budgetIds.length && !data.budgets[key]) data.budgets[key] = {};
    budgetIds.forEach((id) => { data.budgets[key][id] = prevB[id]; });
    const undo = () => {
      data.incomes = data.incomes.filter((i) => !newIncs.includes(i));
      data.fixeds = data.fixeds.filter((f) => !newFix.includes(f));
      data.varis = data.varis.filter((v) => !newVari.includes(v));
      budgetIds.forEach((id) => { if (data.budgets[key]) delete data.budgets[key][id]; });
      if (data.budgets[key] && !Object.keys(data.budgets[key]).length) delete data.budgets[key];
    };
    if (!save()) { undo(); return; }
    renderAll();
    showToast(`収入 ${newIncs.length}件、決まっているもの ${newFix.length}件、かわるもの ${newVari.length}件、予算 ${budgetIds.length}項目をコピーしました`, {
      action: '取り消す',
      onAction: () => { undo(); save(); renderAll(); showToast('取り消しました'); },
    });
  }

  /* ---------- 支出（Excel の表のように、次々と入力する） ---------- */
  const SPEND_BLANK_ROWS = 8;
  const signedYen = (n) => `${n < 0 ? '−' : ''}${yen(Math.abs(n))}`;
  const isDateStr = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const slashDate = (iso) => { const [y, m, d] = iso.split('-'); return `${y}/${Number(m)}/${Number(d)}(${'日月火水木金土'[new Date(Number(y), Number(m) - 1, Number(d)).getDay()]})`; };

  // 手で打った日付（10.30　11/1　2026.11.1　12日 など）を「YYYY-MM-DD」にする。読み取れなければ空
  function parseDateText(text, viewKey) {
    const s = String(text || '').normalize('NFKC').replace(/\([^)]*\)/g, '').trim().replace(/[年月.\-]/g, '/').replace(/日/g, '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    if (!s) return '';
    let parts = s.split('/');
    if (!parts.every((p) => /^\d+$/.test(p))) return '';
    if (parts.length === 1) {
      if (parts[0].length === 4) parts = [parts[0].slice(0, 2), parts[0].slice(2)];          // 1030 → 10月30日
      else parts = [viewKey.slice(0, 4), viewKey.slice(5, 7), parts[0]];                       // 15 → 表の月の15日
    }
    let [y, m, d] = parts.length === 2 ? [null, ...parts] : parts;
    m = Number(m); d = Number(d);
    const todayD = new Date(`${ui.today}T00:00:00`);
    if (y === null) {
      y = todayD.getFullYear();
      // 12月に「1.5」と打ったら来年…ではなく、先すぎる日付（半年より先）は去年のこととして扱う
      if (new Date(y, m - 1, d) - todayD > 180 * 86400000) y -= 1;
    } else {
      y = Number(y);
      if (String(parts[0]).length <= 2) y += 2000;
    }
    const dt = new Date(y, m - 1, d);
    if (y < 1990 || y > 2100 || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // 手で打った項目（しょ → 食費）。ひとつに決まれば {id}、決まらなければ当てはまる項目の一覧
  function resolveCategory(text) {
    const q = toHiragana(text).replace(/^[^\p{L}\p{N}ー]+/u, '').trim();
    if (!q) return { list: [] };
    const exact = data.categories.filter((c) => toHiragana(c.name) === q || c.yomi === q);
    if (exact.length === 1) return { id: exact[0].id };
    const hit = data.categories.filter((c) => toHiragana(c.name).startsWith(q) || (c.yomi && c.yomi.startsWith(q)));
    if (hit.length === 1) return { id: hit[0].id };
    return { list: hit };
  }
  const catLabel = (c) => `${c.icon} ${c.name}`;

  function renderSpend() {
    const key = ui.viewMonth;
    if (!data.payments.some((p) => p.id === ui.paymentId)) ui.paymentId = CASH_ID;
    const recs = data.records.filter((r) => monthOf(r.date) === key).sort(byDate);
    let lastDate = recs.length ? recs[recs.length - 1].date : (monthOf(ui.today) === key ? ui.today : periodOf(key).start);
    let lastPay = recs.length ? recs[recs.length - 1].paymentId : ui.paymentId;
    if (!data.payments.some((p) => p.id === lastPay)) lastPay = CASH_ID;

    const tbody = h('tbody');
    const totalTd = h('td', { class: 't-num' });
    const countTd = h('td', { colspan: '4' });
    const updateTotal = () => {
      const list = data.records.filter((r) => monthOf(r.date) === key);
      countTd.textContent = `${list.length}件　合計`;
      totalTd.textContent = yen(sumAmount(list));
    };

    function addRow(rec) {
      let cur = rec;   // 保存済みの記録（空き行は null）
      const dateIn = h('input', { class: 'cell-input', type: 'text', autocomplete: 'off', 'aria-label': '日付' });
      const toHalf = () => { const v = dateIn.value.normalize('NFKC'); if (v !== dateIn.value) dateIn.value = v; };
      dateIn.addEventListener('input', (e) => { if (!e.isComposing) toHalf(); });
      dateIn.addEventListener('compositionend', toHalf);   // 全角で打っても半角にそろえる
      const catIn = h('input', { class: 'cell-input', type: 'text', list: 'cat-choice-list', autocomplete: 'off', lang: 'ja', placeholder: '例 しょ', 'aria-label': '項目' });
      const storeIn = h('input', { class: 'cell-input', type: 'text', maxlength: '20', list: 'store-list', autocomplete: 'off', lang: 'ja', 'aria-label': '購入先' });
      const memoIn = h('input', { class: 'cell-input', type: 'text', maxlength: '40', list: 'memo-list', autocomplete: 'off', lang: 'ja', 'aria-label': '品目' });
      const amountIn = h('input', { class: 'cell-input num', type: 'text', autocomplete: 'off', 'aria-label': '金額' });
      const paySel = h('select', { class: 'cell-input', 'aria-label': '支払い方法' },
        data.payments.map((p) => h('option', { value: p.id }, p.name)));
      const getAmt = attachAmountFormat(amountIn, MAX_DIGITS, true);
      const fields = [dateIn, catIn, storeIn, memoIn, amountIn, paySel];

      dateIn.value = cur ? slashDate(cur.date) : '';
      catIn.value = cur ? catLabel(catById(cur.categoryId)) : '';
      storeIn.value = cur ? cur.store || '' : '';
      memoIn.value = cur ? cur.memo : '';
      amountIn.value = cur ? yen(cur.amount) : '';
      paySel.value = cur ? cur.paymentId : lastPay;

      const delBtn = h('button', { type: 'button', class: 'icon-btn row-del', 'aria-label': 'この行を削除', title: 'この行を削除', hidden: !cur }, icon('close'));
      const td = (el, cls) => h('td', { class: cls || null }, el);
      const tr = h('tr', { class: cur ? '' : 'is-new' },
        td(dateIn), td(catIn), td(storeIn), td(memoIn), td(amountIn, 't-num'), td(paySel), td(delBtn, 't-del'));

      const commit = () => {
        let amount = getAmt();
        const taxPending = amountIn.value.includes('+');   // 「1000+」＝税抜の金額（税込にする）
        // 日付：打った文字を読み取って「2026/10/30」の形に直す（読み取れないときは赤い行のまま）
        const date = parseDateText(dateIn.value, key);
        if (date && dateIn.value !== slashDate(date)) dateIn.value = slashDate(date);
        // 項目：よみ・名前の先頭が合う項目がひとつなら、その項目に決める
        let categoryId = '';
        const catText = catIn.value.trim();
        if (catText) {
          const res = resolveCategory(catText);
          if (res.id) {
            categoryId = res.id;
            const label = catLabel(catById(res.id));
            if (catIn.value !== label) catIn.value = label;
          } else if (document.activeElement !== catIn) {
            showToast(res.list.length ? `「${catText}」に当てはまる項目が複数あります：${res.list.map((c) => c.name).join('・')}` : `「${catText}」に当てはまる項目がありません`);
          }
        }
        // 税抜（＋つき）の金額は、項目の税率をかけて、1円未満は切り上げて税込にする
        let taxWait = false;
        if (taxPending && amount > 0) {
          if (categoryId) {
            amount = Math.min(Math.floor((amount * (100 + catById(categoryId).tax) + 99) / 100), 10 ** MAX_DIGITS - 1);
            amountIn.value = yen(amount);
          } else taxWait = true;   // 項目が決まったら、そのときに換算する
        }
        const store = cleanStore(storeIn.value);
        if (storeIn.value !== store) storeIn.value = store;
        const memo = memoIn.value.trim().slice(0, 40);
        const paymentId = paySel.value;
        const filled = amount > 0 && categoryId && isDateStr(date) && !taxWait;
        tr.classList.toggle('is-invalid', !filled && !!(amount || catText || memo || store));
        if (!filled) return;
        if (cur) {
          Object.assign(cur, { amount, categoryId, paymentId, date, store, memo });
          save();
        } else {
          const r = { id: newId(), amount, categoryId, paymentId, date, store, memo, createdAt: Date.now() };
          data.records.push(r);
          if (!save()) { data.records.pop(); return; }
          requestPersist();
          cur = r;
          tr.classList.remove('is-new');
          delBtn.hidden = false;
          lastDate = date;
          lastPay = paymentId;
          ui.paymentId = paymentId;
          if (tr === tbody.lastElementChild) addRow(null);
        }
        updateTotal();
        if (monthOf(date) !== key) showToast(`${fmtMonth(monthOf(date))}の分として記録しました（この表は${fmtMonth(key)}です）`);
      };

      tr.addEventListener('change', commit);
      // Enter で次の欄へ。支払い方法で Enter を押すと、次の行の日付へ
      tr.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || !fields.includes(e.target)) return;
        e.preventDefault();
        commit();
        const i = fields.indexOf(e.target);
        if (i < fields.length - 1) fields[i + 1].focus();
        else {
          const next = tr.nextElementSibling;
          if (next) next.querySelectorAll('.cell-input')[0].focus();
        }
      });
      delBtn.addEventListener('click', () => {
        if (!cur) return;
        const rec0 = cur;
        data.records = data.records.filter((r) => r.id !== rec0.id);
        save();
        tr.remove();
        if (!tbody.children.length) addRow(null);
        updateTotal();
        showToast(`${catById(rec0.categoryId).name} ${yen(rec0.amount)}円を削除しました`, {
          action: '取り消す',
          onAction: () => { data.records.push(rec0); save(); renderAll(); showToast('取り消しました'); },
        });
      });
      tbody.append(tr);
    }

    recs.forEach(addRow);
    for (let i = 0; i < SPEND_BLANK_ROWS; i++) addRow(null);
    updateTotal();

    const memos = [...new Set(data.records.map((r) => r.memo).filter(Boolean))].slice(-300);
    const stores = [...new Set(data.records.map((r) => r.store).filter(Boolean))].slice(-300);
    $('#spend-body').replaceChildren(
      panel(`${fmtMonth(key)}の支出`,
        h('button', { type: 'button', class: 'link-btn', onclick: () => { for (let i = 0; i < 5; i++) addRow(null); } }, '＋ 行を増やす'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table spend-grid' },
          h('thead', null, h('tr', null,
            h('th', { class: 'c-date' }, '日付'), h('th', { class: 'c-cat' }, '項目'), h('th', { class: 'c-store' }, '購入先'), h('th', { class: 'c-memo' }, '品目'),
            h('th', { class: 't-num c-amount' }, '金額'), h('th', { class: 'c-pay' }, '支払い方法'), h('th', { class: 'c-del' }, ''))),
          tbody,
          h('tfoot', null, h('tr', null, countTd, totalTd, h('td', { colspan: '2' }, ''))))),
        h('p', { class: 'note note-pad' }, '日付・項目・購入先・品目・金額・支払い方法を入れると、その行が自動で記録されます（日付・項目・金額が必要です）。日付は「10.30」「11/1」のように打てば今年の日付になります。金額を「1000＋」のように打つと、税抜として項目の税率（初期は食費8%・ほか10%）をかけ、1円未満は切り上げた税込の金額になります。項目は「しょ」（食費）や「しゅ」（趣味）のようによみの最初の字を打てば選ばれます（当てはまる項目が複数あるときは、もう少し打つか一覧から選びます）。購入先は同じ名前でそろえて入れると、集計で購入先ごとの合計が見られます。Enterキーで次の欄、支払い方法のEnterで次の行へ進みます。入れた行は、あとから直接書きかえたり、右端の×で消したりできます。赤い行は、項目か金額が足りなくて、まだ記録されていません。')),
      h('datalist', { id: 'memo-list' }, memos.map((m) => h('option', { value: m }))),
      h('datalist', { id: 'store-list' }, stores.map((m) => h('option', { value: m }))),
      h('datalist', { id: 'cat-choice-list' }, data.categories.map((c) => h('option', { value: catLabel(c), label: c.yomi || '' }))));
  }

  // 項目名（食費・酒など）：押すと、その月のその項目の記録（金額・メモ）の一覧を出す
  function itemTh(c, key) {
    const open = () => openCategoryRecords(c.id, key);
    return h('th', {
      scope: 'row', class: 't-item t-link', tabindex: '0', title: `${monthName(key)}の${c.name}の記録を見る`,
      onclick: open,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
    }, h('span', { class: 'cell-cat' }, h('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, c.icon), c.name));
  }

  function openCategoryRecords(catId, key) {
    const c = catById(catId);
    const list = data.records.filter((r) => r.categoryId === catId && monthOf(r.date) === key).sort(byDate);
    const body = [list.length
      ? table([{ t: '日付' }, { t: '支払い方法' }, { t: '購入先' }, { t: 'メモ' }, { t: '金額', num: true }],
        list.map((r) => ({
          onClick: () => openRecordSheet(r, false),
          cells: [
            { v: fmtDate(r.date), cls: 't-date' },
            { v: h('span', { class: 'cell-pay' }, dot(payById(r.paymentId).color), payById(r.paymentId).name) },
            { v: r.store || '', cls: 't-memo', title: r.store || null },
            { v: r.memo, cls: 't-memo', title: r.memo || null },
            { num: true, v: money(r.amount) },
          ],
        })),
        [{ v: `${list.length}件`, span: 4 }, { num: true, v: money(sumAmount(list)) }])
      : emptyNote(`${fmtMonth(key)}の${c.name}の記録はまだありません`)];
    openSheet(`${fmtMonth(key)}　${c.icon} ${c.name}`, body, [
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const today = monthOf(ui.today) === key ? ui.today : periodOf(key).start;
          openRecordSheet({ id: newId(), amount: 0, categoryId: catId, paymentId: ui.paymentId, date: today, store: '', memo: '', createdAt: Date.now() }, true);
        },
      }, '＋ 追加'),
    ]);
  }

  /* ---------- 予算（月初の表の中で入れる） ---------- */
  function setBudget(key, catId, value) {
    if (value > 0) {
      if (!data.budgets[key]) data.budgets[key] = {};
      data.budgets[key][catId] = value;
    } else if (data.budgets[key]) {
      delete data.budgets[key][catId];
      if (!Object.keys(data.budgets[key]).length) delete data.budgets[key];
    }
    save();
  }

  /* ---------- 集計（支出の記録を、項目・支払い方法・日付・月ごとに見る） ---------- */
  function segEl(items, value, label, pick) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': label },
      items.map(([v, t]) => h('button', { type: 'button', class: 'pay-btn', 'aria-pressed': String(v === value), onclick: () => pick(v) }, t)));
  }

  function renderSummary() {
    const s = ui.sum;
    const key = ui.viewMonth;
    if (s.cat && !data.categories.some((c) => c.id === s.cat)) s.cat = '';
    if (s.pay && !data.payments.some((p) => p.id === s.pay)) s.pay = '';
    const set = (patch) => { Object.assign(s, patch); renderAll(); };

    // 購入先は、書き方の違い（全角・半角、英字の大小）をそろえて同じ店として数える
    const storeNames = new Map();   // そろえた名前 → 表に出す名前
    for (const r of data.records) if (r.store && !storeNames.has(storeKey(r.store))) storeNames.set(storeKey(r.store), r.store);
    if (s.store && s.store !== STORE_NONE && !storeNames.has(s.store)) s.store = '';

    const filtered = data.records.filter((r) =>
      (s.range === 'all' || monthOf(r.date) === key)
      && (!s.cat || r.categoryId === s.cat)
      && (!s.pay || r.paymentId === s.pay)
      && (!s.store || storeKey(r.store) === s.store));
    const total = sumAmount(filtered);

    const catSel = selectEl([['', 'すべての項目'], ...data.categories.map((c) => [c.id, `${c.icon} ${c.name}`])], s.cat, '項目で絞る');
    catSel.addEventListener('change', () => set({ cat: catSel.value }));
    const paySel = selectEl([['', 'すべての支払い方法'], ...data.payments.map((p) => [p.id, p.name])], s.pay, '支払い方法で絞る');
    paySel.addEventListener('change', () => set({ pay: paySel.value }));

    const storeSel = selectEl([['', 'すべての購入先'], ...[...storeNames].sort((a, b) => a[1].localeCompare(b[1], 'ja')), [STORE_NONE, '（購入先なし）']], s.store, '購入先で絞る');
    storeSel.addEventListener('change', () => set({ store: storeSel.value }));

    const controls = h('section', { class: 'panel' },
      h('div', { class: 'filter-bar' },
        field('期間', segEl([['month', fmtMonth(key)], ['all', '全期間']], s.range, '期間', (v) => set({ range: v }))),
        field('項目', catSel),
        field('購入先', storeSel),
        field('支払い方法', paySel),
        field('集計のしかた', segEl([['cat', '項目別'], ['store', '購入先別'], ['pay', '支払い方法別'], ['date', '日付別'], ['month', '月別']], s.by, '集計のしかた', (v) => set({ by: v }))),
        (s.cat || s.pay || s.store) && h('button', { type: 'button', class: 'btn btn-ghost btn-inline', onclick: () => set({ cat: '', pay: '', store: '' }) }, '絞りこみを外す')));

    // グループごとの件数・金額
    const groups = new Map();
    for (const r of filtered) {
      const k = s.by === 'cat' ? r.categoryId : s.by === 'store' ? storeKey(r.store) : s.by === 'pay' ? r.paymentId : s.by === 'date' ? r.date : monthOf(r.date);
      const g = groups.get(k) || { n: 0, sum: 0 };
      g.n += 1;
      g.sum += r.amount;
      groups.set(k, g);
    }
    const keys = [...groups.keys()];
    if (s.by === 'cat' || s.by === 'pay' || s.by === 'store') keys.sort((a, b) => groups.get(b).sum - groups.get(a).sum);
    else keys.sort();
    const label = (k) => {
      if (s.by === 'store') return k === STORE_NONE ? '（購入先なし）' : storeNames.get(k);
      if (s.by === 'cat') { const c = catById(k); return h('span', { class: 'cell-cat' }, h('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, c.icon), c.name); }
      if (s.by === 'pay') { const p = payById(k); return h('span', { class: 'cell-pay' }, dot(p.color), p.name); }
      if (s.by === 'date') return fmtDate(k);
      return fmtMonth(k);
    };
    const barColor = (k) => (s.by === 'cat' ? catColor(catById(k)) : s.by === 'pay' ? colorVar(payById(k).color) : 'var(--color-primary)');
    const headName = { cat: '項目', store: '購入先', pay: '支払い方法', date: '日付', month: '月' }[s.by];
    const rows = keys.map((k) => {
      const g = groups.get(k);
      const pct = total > 0 ? (g.sum / total) * 100 : 0;
      const onClick = s.by === 'cat' ? () => set({ cat: s.cat === k ? '' : k })
        : s.by === 'store' ? () => set({ store: s.store === k ? '' : k })
        : s.by === 'pay' ? () => set({ pay: s.pay === k ? '' : k })
          : s.by === 'month' ? () => { ui.viewMonth = k; set({ range: 'month' }); } : null;
      return {
        onClick,
        cells: [{ v: label(k), cls: s.by === 'date' ? 't-date' : null }, { num: true, v: `${g.n}件` }, { num: true, v: money(g.sum) }, { v: barCell(pct, barColor(k)), cls: 't-bar' }, { num: true, v: pctText(pct) }],
      };
    });
    const groupPanel = panel(`${headName}ごとの合計`,
      h('span', { class: 'panel-note' }, s.by === 'cat' || s.by === 'pay' || s.by === 'store' ? '行を押すと、その条件で絞りこめます' : s.by === 'month' ? '行を押すと、その月を見られます' : ''),
      rows.length
        ? table([{ t: headName }, { t: '件数', num: true }, { t: '金額', num: true }, { t: '割合' }, { t: '', num: true }], rows,
          [{ v: '合計' }, { num: true, v: `${filtered.length}件` }, { num: true, v: money(total) }, { v: '', span: 2 }])
        : emptyNote('この条件の記録はありません'));

    const sorted = [...filtered].sort(byNewest);
    const listPanel = panel(`記録の一覧（${filtered.length}件）`, h('span', { class: 'panel-note' }, '行を押すと直せます'),
      filtered.length ? recordTable(sorted, { total: true, memoLabel: '品目' }) : emptyNote('この条件の記録はありません'));

    $('#summary-body').replaceChildren(controls, h('div', { class: 'grid-2' }, h('div', { class: 'col' }, groupPanel), h('div', { class: 'col' }, listPanel)));
  }

  function renderReminder() {
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

    const range = monthRange();
    const key = ui.viewMonth;
    const go = (k) => { ui.viewMonth = k; renderAll(); };

    // 次の引き落とし（カードごとに、これから来るいちばん近い1回）
    const bills = upcomingBills();
    const upcoming = panel('これからの引き落とし', h('span', { class: 'panel-note' }, 'カードごとの、次の1回'),
      table([{ t: 'カード' }, { t: '引き落とし日' }, { t: '対象の期間' }, { t: '金額', num: true }, { t: '状態' }],
        bills.map((b) => ({
          onClick: () => go(monthOf(b.info.end)),
          cells: [
            { v: h('span', { class: 'cell-pay' }, dot(b.p.color), b.p.name) },
            { v: fmtDate(b.info.payDate), cls: 't-date' },
            { v: `${fmtDate(b.info.start)}〜${fmtDate(b.info.end)}`, cls: 't-date' },
            { num: true, v: money(b.total) },
            { v: h('span', { class: `badge ${b.st.cls}` }, b.st.label) },
          ],
        })),
        [{ v: '合計', span: 3 }, { num: true, v: money(bills.reduce((sum, b) => sum + b.total, 0)) }, { v: '' }]));

    // 月ごとの使用額（使った月で集計。引き落とし日は、カードごとの欄に出す）
    const monthTotal = list.reduce((sum, p) => sum + sumAmount(usedRecords(p, key)), 0);
    const nav = h('div', { class: 'month-nav' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '前の月', disabled: key <= range.min, onclick: () => go(shiftMonth(key, -1)) }, icon('chevron-left')),
      h('span', { class: 'month-nav-title' }, `${fmtMonth(key)}に使った分`),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '次の月', disabled: key >= range.max, onclick: () => go(shiftMonth(key, 1)) }, icon('chevron-right')),
      key !== monthOf(ui.today) && h('button', { type: 'button', class: 'chip-btn', onclick: () => go(monthOf(ui.today)) }, '今月'));
    const head = h('div', { class: 'toolbar' },
      h('p', { class: 'toolbar-text' }, `${fmtMonth(key)}の使用合計：`, h('b', { class: 'num' }, money(monthTotal)), `（カード${list.length}枚）`),
      nav);
    const blocks = h('div', { class: 'grid-2' }, list.map((p) => billBlock(p, key)));
    const note = h('p', { class: 'note' }, '※ 家計簿の月（設定の月の締め日どおり）ごとに、使った日で集計しています。引き落とし日は、使った日と登録した締め日・支払日から計算した目安です。お店からの請求が遅れて次の月に回った分や、支払日が土日・祝日にあたるときの日付のずれは反映していません。');

    body.replaceChildren(upcoming, head, blocks, note);
  }

  /* ---------- 光熱費：登録した項目を月ごと・前年同月などで比べる ---------- */
  // その月の実績（同じ名前の合計）。入っていない・0円なら null
  function variActual(key, name) {
    const total = data.varis.filter((v) => v.month === key && v.name === name).reduce((sum, v) => sum + v.actual, 0);
    return total > 0 ? total : null;
  }
  const diffText = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${yen(Math.abs(n))}円`;
  const noData = { v: '—', num: true };
  const moneyCell = (n) => (n == null ? noData : { v: money(n), num: true });
  const diffCell = (a, b) => (a == null || b == null ? noData : { v: diffText(a - b), num: true });

  function openVariItemSheet() {
    const input = h('input', { class: 'field-input', type: 'text', maxlength: '20', placeholder: '例：ガス代', 'aria-label': '項目の名前' });
    const add = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); showToast('項目の名前を入力してください'); return; }
      if (data.variItems.includes(name)) { showToast('すでに登録されています'); return; }
      data.variItems.push(name);
      save();
      closeSheet();
      renderAll();
      showToast(`「${name}」を登録しました`);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    openSheet('項目を登録', [
      field('項目の名前', input),
      h('p', { class: 'note' }, '登録すると、月初の「毎月の金額がかわるもの」を追加するときに選べます。名前が同じ分が、月ごとに集計されます。'),
    ], [h('button', { type: 'button', class: 'btn btn-primary', onclick: add }, '登録')]);
    input.focus();
  }

  function renderUtility() {
    const body = $('#utility-body');
    const key = ui.viewMonth;
    const items = data.variItems;
    const prev = shiftMonth(key, -1);
    const lastYear = shiftMonth(key, -12);

    const itemsPanel = panel('登録した項目', linkBtn('＋ 項目を登録', openVariItemSheet),
      items.length
        ? h('div', { class: 'panel-pad' }, items.map((name) => h('span', { style: 'margin:0 1.2rem .5rem 0;display:inline-flex;gap:.5rem;align-items:center' },
          h('b', null, name),
          linkBtn('削除', async () => {
            const ok = await confirmDialog({ title: `「${name}」の登録をやめますか？`, message: '入れた金額は消えません。この画面に出なくなるだけです（もう一度登録すれば戻ります）。', okLabel: '登録をやめる', danger: true });
            if (!ok) return;
            data.variItems = data.variItems.filter((x) => x !== name);
            save();
            renderAll();
          }))))
        : emptyNote('項目がまだ登録されていません。', '「＋ 項目を登録」から、電気代・水道代などを登録してください。'));
    if (!items.length) { body.replaceChildren(itemsPanel); return; }

    // 登録した項目の合計（実績が入っている項目だけ）。1つも入っていなければ null
    const sum = (k) => {
      const vals = items.map((n) => variActual(k, n)).filter((x) => x != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    const ratioCell = (cur, base) => (cur == null || base == null ? noData : { v: `${Math.round((cur / base) * 100)}%`, num: true });
    const compareRow = (label, cur, p, l) => [{ v: label }, moneyCell(cur), moneyCell(p), diffCell(cur, p), moneyCell(l), diffCell(cur, l), ratioCell(cur, l)];

    const compare = panel(`${fmtMonth(key)}の比べ方`, h('span', { class: 'panel-note' }, `前月＝${fmtMonth(prev)}／前年同月＝${fmtMonth(lastYear)}`),
      table([{ t: '項目' }, { t: fmtMonth(key), num: true }, { t: '前月', num: true }, { t: '前月との差', num: true },
        { t: '前年同月', num: true }, { t: '前年同月との差', num: true }, { t: '前年比', num: true }],
      items.map((n) => ({ cells: compareRow(n, variActual(key, n), variActual(prev, n), variActual(lastYear, n)) })),
      compareRow('合計', sum(key), sum(prev), sum(lastYear))));

    // 12か月の推移（右の列に前年同月の合計と差）
    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(key, i - 11));
    const trend = panel('月ごとの推移（12か月）', h('span', { class: 'panel-note' }, '月を押すと、その月に切りかわります'),
      table([{ t: '月' }, ...items.map((n) => ({ t: n, num: true })), { t: '合計', num: true }, { t: '前年同月の合計', num: true }, { t: '前年同月との差', num: true }],
        months.map((m) => {
          const tot = sum(m);
          const ly = sum(shiftMonth(m, -12));
          return {
            onClick: () => { ui.viewMonth = m; renderAll(); },
            cells: [{ v: m === key ? `${fmtMonth(m)}（表示中）` : fmtMonth(m) }, ...items.map((n) => moneyCell(variActual(m, n))), moneyCell(tot), moneyCell(ly), diffCell(tot, ly)],
          };
        })));

    const note = h('p', { class: 'note' }, '※ 月初の「毎月の金額がかわるもの」に入れた「実績」を、登録した項目の名前ごとに集計しています。実績が入っていない月は「—」で、比べられません。過去の月は、上の月の切りかえで戻って、月初タブから入れられます。');
    body.replaceChildren(itemsPanel, compare, trend, note);
  }

  // その家計簿の月に使った分（カードからのチャージも含む）
  function usedRecords(p, key) {
    return [...data.records, ...cardChargeRecords(p)].filter((r) => r.paymentId === p.id && monthOf(r.date) === key);
  }

  function billBlock(p, key) {
    const recs = usedRecords(p, key).sort(byDate);
    const total = sumAmount(recs);
    // 使った分が、いつ引き落とされるか（月の途中に締め日があると、2回に分かれる）
    const bills = new Map();
    for (const r of recs) { const bk = billMonthOf(p, r.date); bills.set(bk, (bills.get(bk) || 0) + r.amount); }
    const lines = [...bills].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([bk, sum]) => {
      const info = billInfo(p, bk);
      const full = sumAmount(billRecords(p, bk));
      const st = billStatus(info, full);
      return h('p', { class: 'bill-meta' }, '引き落とし日 ', h('b', null, fmtDate(info.payDate)), '　',
        h('b', { class: 'num' }, money(sum)), full !== sum ? `（この日の引き落とし全体 ${money(full)}）` : '', '　', h('span', { class: `badge ${st.cls}` }, st.label),
        h('span', { class: 'card-memo-rule' }, `　対象：${fmtDate(info.start)}〜${fmtDate(info.end)}のご利用分`));
    });
    return panel([dot(p.color), p.name],
      h('b', { class: 'num' }, money(total)),
      h('p', { class: 'bill-meta' }, payRule(p)),
      ...lines,
      recs.length
        ? cardUseTable(recs)
        : emptyNote('この月のご利用はありません'));
  }

  /* ---------- 口座（残高・入金・出金・チャージ） ---------- */
  function renderAccounts() {
    const body = $('#accounts-body');
    const key = ui.viewMonth;
    const { start, end } = periodOf(key);
    const inMonth = (e) => e.date >= start && e.date <= end;
    const flow = (evs) => {
      let inn = 0;
      let out = 0;
      for (const e of evs.filter(inMonth)) { if (e.delta > 0) inn += e.delta; else out -= e.delta; }
      return { inn, out };
    };
    const actBtn = (label, fn) => h('button', { type: 'button', class: 'chip-btn', onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    const pick = (id) => () => { ui.acc.filter = ui.acc.filter === id ? '' : id; renderAccounts(); };
    const neg = (n) => (n < 0 ? 'neg' : '');

    // ---- 銀行口座
    const accRows = data.accounts.map((a) => {
      const id = walletKey('acc', a.id);
      const bal = walletBalance('acc', a.id);
      const { inn, out } = flow(walletEvents('acc', a.id));
      return {
        cls: ui.acc.filter === id ? 'is-current' : '', onClick: pick(id),
        cells: [
          { v: a.name },
          { num: true, cls: neg(bal), v: signedMoney(bal) },
          { num: true, v: inn ? money(inn) : '' },
          { num: true, v: out ? money(out) : '' },
          { v: h('span', { class: 'row-actions' },
            actBtn('入金', () => openMoveSheet(null, { type: 'deposit', accountId: a.id })),
            actBtn('出金', () => openMoveSheet(null, { type: 'withdraw', accountId: a.id }))) },
        ],
      };
    });
    const accTotal = data.accounts.reduce((sum, a) => sum + walletBalance('acc', a.id), 0);
    const accPanel = panel('銀行口座', linkBtn('＋ 口座を追加', () => openAccountSheet(null)),
      data.accounts.length
        ? table([{ t: '口座' }, { t: '今日の残高', num: true }, { t: `${monthName(key)}の入金`, num: true }, { t: `${monthName(key)}の出金`, num: true }, { t: '' }], accRows,
          [{ v: '残高の合計' }, { num: true, v: signedMoney(accTotal) }, { v: '', span: 3 }])
        : emptyNote('銀行口座がまだ登録されていません。', '登録すると、入金・出金を記録して残高がわかります。固定費の口座引落・カードの引き落とし・口座払いの支出も、自動で残高から引かれます。',
          h('button', { type: 'button', class: 'btn btn-primary btn-inline', onclick: () => openAccountSheet(null) }, icon('plus', 'icon-s'), '口座を登録する')));

    // ---- 電子マネー（チャージして使うタイプ）
    const ppList = prepaids();
    const ppRows = ppList.map((p) => {
      const id = walletKey('pay', p.id);
      const bal = walletBalance('pay', p.id);
      const { inn, out } = flow(walletEvents('pay', p.id));
      return {
        cls: ui.acc.filter === id ? 'is-current' : '', onClick: pick(id),
        cells: [
          { v: h('span', { class: 'cell-pay' }, dot(p.color), p.name) },
          { num: true, cls: neg(bal), v: signedMoney(bal) },
          { num: true, v: inn ? money(inn) : '' },
          { num: true, v: out ? money(out) : '' },
          { v: h('span', { class: 'row-actions' }, actBtn('チャージ', () => openMoveSheet(null, { type: 'charge', payId: p.id }))) },
        ],
      };
    });
    const ppPanel = panel('電子マネー（チャージして使うタイプ）', linkBtn('＋ 電子マネーを追加', () => openPaymentSheet(null, { kind: 'other', prepaid: true })),
      ppList.length
        ? table([{ t: '電子マネー' }, { t: '今日の残高', num: true }, { t: `${monthName(key)}のチャージ`, num: true }, { t: `${monthName(key)}の使用`, num: true }, { t: '' }], ppRows)
        : emptyNote('チャージして使う電子マネー（Suica・WAON・nanaco・PayPay など）がまだありません。',
          '追加すると、チャージ（入金）を記録して残高がわかり、「支出」で支払い方法に選ぶと残高が減ります。後払いのタイプは、設定の支払い方法のままで使えます。'));

    // ---- 手元の現金
    const cashId = walletKey('cash', 'cash');
    let cashPanel;
    if (data.cash) {
      const bal = walletBalance('cash', 'cash');
      const { inn, out } = flow(walletEvents('cash', 'cash'));
      cashPanel = panel('現金', linkBtn('始まりの残高を直す', openCashSheet),
        table([{ t: '' }, { t: '今日の残高', num: true }, { t: `${monthName(key)}の入金`, num: true }, { t: `${monthName(key)}の出金`, num: true }, { t: '' }],
          [{
            cls: ui.acc.filter === cashId ? 'is-current' : '', onClick: pick(cashId),
            cells: [
              { v: '現金' },
              { num: true, cls: neg(bal), v: signedMoney(bal) },
              { num: true, v: inn ? money(inn) : '' },
              { num: true, v: out ? money(out) : '' },
              { v: h('span', { class: 'row-actions' },
                actBtn('入金', () => openMoveSheet(null, { type: 'cashin' })),
                actBtn('出金', () => openMoveSheet(null, { type: 'cashout' }))) },
            ],
          }]));
    } else {
      cashPanel = panel('現金', null, emptyNote('手元の現金は、まだ管理していません。',
        '始まりの残高と日付を入れると、現金で払った支出が自動で残高から引かれ、銀行からの引き出しが残高に足されます。',
        h('button', { type: 'button', class: 'btn btn-primary btn-inline', onclick: openCashSheet }, icon('plus', 'icon-s'), '現金の管理をはじめる')));
    }

    // ---- 入出金の履歴（見ている月）
    const wallets = [
      ...(data.cash ? [{ type: 'cash', id: 'cash', key: cashId, name: '現金' }] : []),
      ...data.accounts.map((a) => ({ type: 'acc', id: a.id, key: walletKey('acc', a.id), name: a.name })),
      ...ppList.map((p) => ({ type: 'pay', id: p.id, key: walletKey('pay', p.id), name: p.name })),
    ];
    if (ui.acc.filter && !wallets.some((w) => w.key === ui.acc.filter)) ui.acc.filter = '';
    const filterSel = selectEl([['', 'すべて'], ...wallets.map((w) => [w.key, w.name])], ui.acc.filter, '口座・現金・電子マネーで絞る');
    filterSel.addEventListener('change', () => { ui.acc.filter = filterSel.value; renderAccounts(); });
    const shown = wallets.filter((w) => !ui.acc.filter || w.key === ui.acc.filter);
    const single = ui.acc.filter !== '';
    const lines = [];
    for (const w of shown) {
      const evs = walletEvents(w.type, w.id).sort(byEventDate);
      let bal = walletOpening(w.type, w.id);
      for (const e of evs) {
        bal += e.delta;
        if (inMonth(e)) lines.push({ ...e, wallet: w.name, bal });
      }
    }
    lines.sort(byEventDate);
    const histRows = lines.map((e) => ({
      cls: e.date > ui.today ? 'row-future' : '',
      onClick: e.move ? () => openMoveSheet(e.move) : e.rec ? () => openRecordSheet(e.rec, false) : null,
      cells: [
        { v: fmtDate(e.date), cls: 't-date' },
        { v: e.wallet },
        { v: h('span', null, e.label, e.auto ? h('span', { class: 'tag' }, '自動') : null, e.date > ui.today ? h('span', { class: 'tag' }, '予定') : null) },
        { num: true, v: e.delta > 0 ? money(e.delta) : '' },
        { num: true, v: e.delta < 0 ? money(-e.delta) : '' },
        single && { num: true, cls: neg(e.bal), v: signedMoney(e.bal) },
      ].filter(Boolean),
    }));
    const inTotal = lines.reduce((sum, e) => sum + Math.max(e.delta, 0), 0);
    const outTotal = lines.reduce((sum, e) => sum + Math.max(-e.delta, 0), 0);
    const histHead = [{ t: '日付' }, { t: '口座・現金・電子マネー' }, { t: '内容' }, { t: '入金', num: true }, { t: '出金', num: true }, single && { t: '残高', num: true }].filter(Boolean);
    const addBtn = wallets.length ? linkBtn('＋ 入出金を追加', () => openMoveSheet(null, {
      type: single && shown[0].type === 'pay' ? 'charge' : single && shown[0].type === 'cash' ? 'cashin' : 'deposit',
      accountId: single && shown[0].type === 'acc' ? shown[0].id : '', payId: single && shown[0].type === 'pay' ? shown[0].id : '',
    })) : null;
    const histPanel = panel(`${fmtMonth(key)}の入出金の履歴`, [filterSel, addBtn],
      histRows.length
        ? table(histHead, histRows, [{ v: `${histRows.length}件`, span: 3 }, { num: true, v: money(inTotal) }, { num: true, v: money(outTotal) }, single && { v: '' }].filter(Boolean))
        : emptyNote(wallets.length ? 'この月の入出金はありません' : '口座・現金・電子マネーを登録すると、ここに入出金の履歴が出ます'),
      h('p', { class: 'note note-pad' }, '「自動」の行は、月初の口座引落の固定費・カードの引き落とし・口座払いや電子マネーや現金の支出から自動で入ります（行を押して直せるのは、手で入れた入出金と支出です）。日付が今日より先のものは「予定」で、今日の残高には入りません。'));

    body.replaceChildren(h('div', { class: 'grid-2' }, accPanel, h('div', { class: 'col' }, cashPanel, ppPanel)), histPanel);
  }

  // 手元の現金の「始まりの残高」と基準日（過去の日付もOK）
  function openCashSheet() {
    const c = data.cash;
    const balance = amountField(c ? c.openingBalance : 0, BALANCE_DIGITS);
    const dateInput = h('input', { class: 'field-input', type: 'date', 'aria-label': '現金の基準日' });
    dateInput.value = c ? c.openingDate : ui.today;
    const footer = [h('button', {
      type: 'button', class: 'btn btn-primary',
      onclick: () => {
        const openingDate = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : ui.today;
        data.cash = { openingBalance: balance.get(), openingDate };
        save();
        closeSheet();
        renderAll();
        showToast(c ? '現金の始まりの残高を直しました' : '現金の管理をはじめました');
      },
    }, c ? '保存' : 'はじめる')];
    if (c) {
      footer.unshift(h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const ok = await confirmDialog({ title: '現金の管理をやめますか？', message: '現金の入金・出金の記録は残りますが、残高は出なくなります（支出の記録は消えません）。', okLabel: 'やめる', danger: true });
          if (!ok) return;
          data.cash = null;
          save();
          closeSheet();
          renderAll();
        },
      }, '管理をやめる'));
    }
    openSheet(c ? '現金の始まりの残高を直す' : '現金の管理をはじめる', [
      h('div', { class: 'field-row' }, field('残高（基準日の始まり）', balance.el), field('基準日', dateInput)),
      h('p', { class: 'note' }, '基準日から後の「現金」払いの支出が自動で引かれ、銀行からの引き出しと手で入れた現金の入出金が反映されます。過去の日付から数えたいときは、その日の始まりの残高と、その日を入れてください。基準日より前の分は残高に入りません。'),
    ], footer);
  }

  // 口座の入金・出金、電子マネーへのチャージを追加・直す
  function openMoveSheet(mv, preset = {}) {
    const isNew = !mv;
    const firstAcc = data.accounts[0] ? data.accounts[0].id : '';
    const firstPre = prepaids()[0] ? prepaids()[0].id : '';
    const draft = isNew
      ? { type: preset.type || (data.accounts.length ? 'deposit' : 'charge'), accountId: preset.accountId || firstAcc, payId: preset.payId || firstPre, fromType: 'account', fromId: preset.accountId || firstAcc }
      : { ...mv, accountId: mv.accountId || firstAcc, payId: mv.payId || firstPre };

    const dateInput = h('input', { class: 'field-input', type: 'date', 'aria-label': '日付' });
    dateInput.value = isNew ? ui.today : mv.date;
    const amount = amountField(isNew ? 0 : mv.amount);
    const accSel = selectEl(data.accounts.map((a) => [a.id, a.name]), draft.accountId, '口座');
    const paySel = selectEl(prepaids().map((p) => [p.id, p.name]), draft.payId, '電子マネー');
    const fromOptions = [
      ...data.accounts.map((a) => [`account:${a.id}`, `銀行口座：${a.name}`]),
      ...cards().map((p) => [`card:${p.id}`, `クレジットカード：${p.name}`]),
      ['cash:', '現金'], ['none:', 'チャージ元なし（ポイント・もらった分など）'],
    ];
    const fromSel = selectEl(fromOptions, `${draft.fromType}:${draft.fromId || ''}`, 'チャージ元');
    if (fromSel.value !== `${draft.fromType}:${draft.fromId || ''}`) fromSel.value = fromOptions[0][0];
    const cashBox = h('input', { type: 'checkbox', id: 'cash-link-check' });
    cashBox.checked = isNew ? draft.type !== 'deposit' : draft.type === 'withdraw' ? draft.toCash !== false : !!draft.fromCash;
    const cashLabel = h('label', { for: 'cash-link-check' }, '');
    const cashField = h('div', { class: 'field' }, h('div', { style: 'display:flex;gap:.5rem;align-items:center' }, cashBox, cashLabel));
    const memoInput = h('input', { class: 'field-input', type: 'text', maxlength: '40', placeholder: 'なくてもOK（例：給料・ATM）', 'aria-label': 'メモ' });
    memoInput.value = isNew ? '' : mv.memo;

    const typeBox = h('div', { class: 'seg', role: 'group', 'aria-label': '種類' });
    const accField = h('div', null, field('口座', accSel));
    const chargeFields = h('div', null, field('チャージする電子マネー', paySel), field('チャージ元', fromSel));
    const note = h('p', { class: 'note' });
    const draw = () => {
      const types = [['deposit', '入金（口座へ）', data.accounts.length > 0], ['withdraw', '出金（口座から）', data.accounts.length > 0], ['charge', '電子マネーへチャージ', prepaids().length > 0],
        ['cashin', '現金の入金', !!data.cash], ['cashout', '現金の出金', !!data.cash]];
      typeBox.replaceChildren(...types.map(([t, label, ok]) => h('button', {
        type: 'button', class: 'pay-btn', disabled: !ok, 'aria-pressed': String(draft.type === t),
        onclick: () => { draft.type = t; draw(); },
      }, label)));
      accField.hidden = draft.type !== 'deposit' && draft.type !== 'withdraw';
      chargeFields.hidden = draft.type !== 'charge';
      cashField.hidden = !data.cash || accField.hidden;
      cashLabel.textContent = draft.type === 'withdraw' ? '出金した分を、手元の現金に入れる' : '手元の現金から預け入れた（現金が減る）';
      note.textContent = draft.type === 'deposit' ? '給料の振り込みなど、口座にお金が入ったときに記録します。'
        : draft.type === 'withdraw' ? 'ATMでの引き出しや振り込みなど、口座からお金が出たときに記録します。ATMの引き出しは、手元の現金に入れる（チェックあり）と、現金の残高が増えます。振り込みなどはチェックを外します。'
          : draft.type === 'cashin' ? 'お小遣いや現金でもらったお金など、手元の現金が増えたときに記録します。'
            : draft.type === 'cashout' ? '現金をなくした・渡したなど、手元の現金が口座以外で減ったときに記録します（買い物は「支出」に入れます）。'
              : '電子マネーの残高が増えます。チャージ元を銀行口座にすると、その口座の残高から引かれます。クレジットカードにすると、カードの引き落とし額に入ります（支出にはなりません）。';
    };
    draw();

    const saveBtn = h('button', {
      type: 'button', class: 'btn btn-primary',
      onclick: () => {
        const value = amount.get();
        if (!value) { amount.input.focus(); showToast('金額を入力してください'); return; }
        const date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : (isNew ? ui.today : mv.date);
        const out = { id: isNew ? newId() : mv.id, date, type: draft.type, amount: value, memo: memoInput.value.trim().slice(0, 40), createdAt: isNew ? Date.now() : mv.createdAt };
        if (draft.type === 'charge') {
          if (!paySel.value) { showToast('チャージする電子マネーを選んでください'); return; }
          const [fromType, ...rest] = fromSel.value.split(':');
          Object.assign(out, { payId: paySel.value, fromType, fromId: rest.join(':') });
        } else if (draft.type === 'cashin' || draft.type === 'cashout') {
          if (!data.cash) { showToast('先に現金の管理をはじめてください'); return; }
        } else {
          if (!accSel.value) { showToast('口座を選んでください'); return; }
          out.accountId = accSel.value;
          if (data.cash && draft.type === 'withdraw' && !cashBox.checked) out.toCash = false;
          if (data.cash && draft.type === 'deposit' && cashBox.checked) out.fromCash = true;
        }
        if (isNew) data.moves.push(out);
        else data.moves[data.moves.findIndex((m) => m.id === mv.id)] = out;
        // 基準日より前の日付のチャージは数えられないので、電子マネーの基準日をその日まで前に戻す
        let moved = '';
        if (out.type === 'charge') {
          const pay = payById(out.payId);
          if (pay.openingDate && out.date < pay.openingDate) { pay.openingDate = out.date; moved = `（${pay.name}の基準日を${fmtDate(out.date)}に変えました）`; }
        }
        save();
        closeSheet();
        renderAll();
        showToast(`${isNew ? `${MOVE_LABEL[out.type]}を記録しました` : `${MOVE_LABEL[out.type]}を直しました`}${moved}`);
      },
    }, isNew ? '追加' : '保存');
    const footer = [saveBtn];
    if (!isNew) {
      footer.unshift(h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const ok = await confirmDialog({ title: `この${MOVE_LABEL[mv.type]}を削除しますか？`, message: `${fmtDate(mv.date)}　${yen(mv.amount)}円${mv.memo ? '　' + mv.memo : ''}`, okLabel: '削除する', danger: true });
          if (!ok) return;
          data.moves = data.moves.filter((m) => m.id !== mv.id);
          save();
          closeSheet();
          renderAll();
          showToast('削除しました');
        },
      }, '削除'));
    }
    openSheet(isNew ? '入金・出金・チャージを追加' : '入金・出金・チャージを直す', [
      field('種類', typeBox),
      h('div', { class: 'field-row' }, field('日付', dateInput), field('金額', amount.el)),
      accField, chargeFields, cashField,
      field('メモ', memoInput),
      note,
    ], footer);
  }

  /* ---------- 表示する月の切りかえ ---------- */
  const MONTH_TABS = ['start', 'spend', 'summary', 'cards', 'utility', 'accounts'];

  function renderMonthNav() {
    const key = ui.viewMonth;
    const range = monthRange();
    $('#month-nav').hidden = !MONTH_TABS.includes(ui.tab) || (ui.tab === 'summary' && ui.sum.range === 'all');
    $('#month-title').textContent = fmtMonth(key);
    $('#month-range').textContent = periodText(key);
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

    $('#closing-day').value = String(data.settings.closingDay);
    const cur = monthOf(ui.today);
    $('#closing-now').textContent = `今は ${fmtMonth(cur)} の途中です（${periodText(cur)}）`;

    $('#cat-list').replaceChildren(...data.categories.map((c, i, list) => h('li', { class: 'cat-row' },
      h('button', { type: 'button', class: 'cat-row-main', onclick: () => openCategorySheet(c) },
        catIcon(c), h('span', { class: 'cat-row-name' }, c.name)),
      moveButtons(list, i, c.name))));

    $('#pay-setting-list').replaceChildren(...data.payments.map((p, i, list) => h('li', { class: 'cat-row' },
      h('button', { type: 'button', class: 'cat-row-main', onclick: () => (p.kind === 'bank' ? openAccountSheet(accountOf(p.accountId)) : openPaymentSheet(p)) },
        dot(p.color),
        h('span', { class: 'cat-row-name' }, p.name,
          h('span', { class: 'cat-row-sub' }, paySub(p))),
        h('span', { class: `badge${p.kind === 'card' ? ' badge-card' : ''}` }, p.prepaid ? 'チャージ式' : PAY_KIND_LABEL[p.kind])),
      moveButtons(list, i, p.name))));

    $('#account-list').replaceChildren(...(data.accounts.length
      ? data.accounts.map((a, i, list) => h('li', { class: 'cat-row' },
        h('button', { type: 'button', class: 'cat-row-main', onclick: () => openAccountSheet(a) },
          h('span', { class: 'cat-row-name' }, a.name, h('span', { class: 'cat-row-sub' }, `残高 ${signedMoney(walletBalance('acc', a.id))}`))),
        moveButtons(list, i, a.name)))
      : [h('li', { class: 'empty-s' }, 'まだ口座がありません')]));

    const last = data.settings.lastBackup;
    $('#last-backup').textContent = last ? `最後のバックアップ：${fmtFullDate(last)}` : 'まだバックアップしていません';
  }

  function paySub(p) {
    if (p.kind === 'card') {
      const acc = p.accountId && accountOf(p.accountId);
      return payRule(p) + (acc ? `　引き落とし口座：${acc.name}` : '');
    }
    if (p.kind === 'cash') return '手元のお金';
    if (p.kind === 'bank') return `口座払い（デビットなど）　残高 ${signedMoney(walletBalance('acc', p.accountId))}`;
    if (p.prepaid) return `チャージして使う電子マネー　残高 ${signedMoney(walletBalance('pay', p.id))}`;
    return '電子マネー・口座振替など（残高は管理しない）';
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
  function attachAmountFormat(input, maxDigits = MAX_DIGITS, allowPlus = false) {
    const format = () => {
      const raw = input.value.normalize('NFKC');
      const digits = toHalfDigits(raw).replace(/[^0-9]/g, '').replace(/^0+/, '').slice(0, maxDigits);
      // 支出の表では、金額のあとの「＋」（税抜 → 税込にする印）を残す
      input.value = digits ? yen(Number(digits)) + (allowPlus && raw.includes('+') ? '+' : '') : '';
    };
    input.addEventListener('input', (e) => { if (!e.isComposing) format(); });
    input.addEventListener('compositionend', format);
    return () => Number(input.value.replace(/[^0-9]/g, '')) || 0;
  }

  function amountField(initial, maxDigits = MAX_DIGITS) {
    const input = h('input', {
      class: 'field-input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
      'aria-label': '金額', placeholder: '0',
    });
    input.value = initial > 0 ? yen(initial) : '';
    return { el: h('div', { class: 'field-amount' }, input), input, get: attachAmountFormat(input, maxDigits) };
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

  // 支出の記録を直す（isNew なら新しく追加する）
  function openRecordSheet(rec, isNew) {
    const amount = amountField(rec.amount);
    const catSel = selectEl(data.categories.map((c) => [c.id, `${c.icon} ${c.name}`]), rec.categoryId, '項目');
    const paySel = selectEl(data.payments.map((p) => [p.id, p.name]), rec.paymentId, '支払い方法');
    const dateInput = h('input', { class: 'field-input', type: 'date', 'aria-label': '日付' });
    dateInput.value = rec.date;
    const memoInput = h('input', { class: 'field-input', type: 'text', maxlength: '40', placeholder: 'なくてもOK', 'aria-label': 'メモ' });
    memoInput.value = rec.memo;
    const storeInput = h('input', { class: 'field-input', type: 'text', maxlength: '20', list: 'store-list', autocomplete: 'off', placeholder: 'なくてもOK', 'aria-label': '購入先' });
    storeInput.value = rec.store || '';

    const footer = [
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const value = amount.get();
          if (!value) { amount.input.focus(); showToast('金額を入力してください'); return; }
          const date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : rec.date;
          Object.assign(rec, { amount: value, categoryId: catSel.value, paymentId: paySel.value, date, store: cleanStore(storeInput.value), memo: memoInput.value.trim().slice(0, 40) });
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

    openSheet(isNew ? '支出を追加' : '記録を直す', [
      field('金額', amount.el),
      h('div', { class: 'field-row' }, field('項目', catSel), field('支払い方法', paySel)),
      h('div', { class: 'field-row' }, field('日付', dateInput), field('購入先（店舗名）', storeInput)),
      field('メモ（品名など）', memoInput),
    ], footer);
  }

  // 固定費（現金支出・口座引落）を追加・直す
  function openFixedSheet(f, presetAccount) {
    const isNew = !f;
    const key = ui.viewMonth;
    const nameInput = h('input', { class: 'field-input', type: 'text', maxlength: '20', placeholder: '例：国民健康保険', 'aria-label': '項目名' });
    nameInput.value = isNew ? '' : f.name;
    const amount = amountField(isNew ? 0 : f.amount);
    const accSel = selectEl([['', '現金支出（固定）'], ...data.accounts.map((a) => [a.id, `口座引落：${a.name}`])], isNew ? (presetAccount || '') : f.accountId, '支払い先');
    const daySel = h('select', { class: 'field-input', 'aria-label': '日' },
      h('option', { value: '0' }, '指定なし'),
      Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1) }, `${i + 1}日`)),
      h('option', { value: String(END_OF_MONTH) }, '末日'));
    daySel.value = String(isNew ? 0 : f.day);

    const footer = [
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const name = nameInput.value.trim();
          const value = amount.get();
          if (!name) { nameInput.focus(); showToast('項目名を入力してください'); return; }
          if (!value) { amount.input.focus(); showToast('金額を入力してください'); return; }
          const values = { name, amount: value, accountId: accSel.value, day: Number(daySel.value) };
          if (isNew) data.fixeds.push({ id: newId(), month: key, ...values });
          else Object.assign(f, values);
          save();
          closeSheet();
          renderAll();
          showToast(isNew ? '固定費を追加しました' : '固定費を直しました');
        },
      }, isNew ? '追加' : '保存'),
    ];
    if (!isNew) {
      footer.unshift(h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'この固定費を削除しますか？', message: `${f.name}　${yen(f.amount)}円`, okLabel: '削除する', danger: true });
          if (!ok) return;
          data.fixeds = data.fixeds.filter((x) => x.id !== f.id);
          save();
          closeSheet();
          renderAll();
          showToast('削除しました');
        },
      }, '削除'));
    }
    openSheet(isNew ? `${fmtMonth(key)}の固定費を追加` : '固定費を直す', [
      field('項目名', nameInput),
      field('金額', amount.el),
      h('div', { class: 'field-row' }, field('支払い先', accSel), field('支払い・引落の日', daySel)),
      h('p', { class: 'note' }, 'この月だけの金額です。毎月同じなら、次の月の月初で「前の月の内容をコピー」を使うと楽です。'),
    ], footer);
  }

  // 銀行口座を追加・直す（月初の口座引落の分け方にも使う）
  function openAccountSheet(acc) {
    const isNew = !acc;
    const nameInput = h('input', { class: 'field-input', type: 'text', maxlength: '12', placeholder: '例：JA', 'aria-label': '口座の名前' });
    nameInput.value = isNew ? '' : acc.name;
    const balance = amountField(isNew ? 0 : acc.openingBalance, BALANCE_DIGITS);
    const dateInput = h('input', { class: 'field-input', type: 'date', 'aria-label': '残高の基準日' });
    dateInput.value = isNew ? ui.today : acc.openingDate;
    const footer = [
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) { nameInput.focus(); showToast('名前を入力してください'); return; }
          if (data.accounts.some((a) => a.name === name && (isNew || a.id !== acc.id))) { nameInput.focus(); showToast('同じ名前の口座があります'); return; }
          const openingDate = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : ui.today;
          if (isNew) data.accounts.push({ id: `a${newId()}`, name, openingBalance: balance.get(), openingDate });
          else Object.assign(acc, { name, openingBalance: balance.get(), openingDate });
          ensureBankPayments(data.accounts, data.payments);
          save();
          closeSheet();
          renderAll();
          showToast(isNew ? `「${name}」を追加しました` : `「${name}」を保存しました`);
        },
      }, isNew ? '追加' : '保存'),
    ];
    if (!isNew) {
      footer.unshift(h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: async () => {
          const bankPay = data.payments.find((p) => p.kind === 'bank' && p.accountId === acc.id);
          const fixedCount = data.fixeds.filter((x) => x.accountId === acc.id).length;
          const recCount = bankPay ? data.records.filter((r) => r.paymentId === bankPay.id).length : 0;
          const moveCount = data.moves.filter((m) => m.accountId === acc.id).length;
          const notes = [];
          if (fixedCount) notes.push(`この口座の固定費 ${fixedCount}件は「現金支出（固定）」に移ります。`);
          if (recCount) notes.push(`口座払いの支出 ${recCount}件は「現金」に移ります。`);
          if (moveCount) notes.push(`この口座の入金・出金の記録 ${moveCount}件は削除されます。`);
          const ok = await confirmDialog({ title: `「${acc.name}」を削除しますか？`, message: notes.join('\n'), okLabel: '削除する', danger: true });
          if (!ok) return;
          data.fixeds.forEach((x) => { if (x.accountId === acc.id) x.accountId = ''; });
          data.incomes.forEach((x) => { if (x.accountId === acc.id) x.accountId = ''; });
          if (bankPay) {
            data.records.forEach((r) => { if (r.paymentId === bankPay.id) r.paymentId = CASH_ID; });
            data.payments = data.payments.filter((p) => p.id !== bankPay.id);
            if (ui.paymentId === bankPay.id) ui.paymentId = CASH_ID;
          }
          data.payments.forEach((p) => { if (p.accountId === acc.id) delete p.accountId; });
          data.moves = data.moves.filter((m) => m.accountId !== acc.id);
          data.moves.forEach((m) => { if (m.fromType === 'account' && m.fromId === acc.id) { m.fromType = 'none'; m.fromId = ''; } });
          data.accounts = data.accounts.filter((a) => a.id !== acc.id);
          save();
          closeSheet();
          renderAll();
          showToast(`「${acc.name}」を削除しました`);
        },
      }, '削除'));
    }
    openSheet(isNew ? '口座を追加' : '口座を直す', [
      field('口座の名前', nameInput),
      h('div', { class: 'field-row' }, field('残高（基準日の始まり）', balance.el), field('基準日', dateInput)),
      h('p', { class: 'note' }, '基準日から後の入金・出金・チャージ、月初の口座引落の固定費、この口座から引き落とすカードの支払い、口座払いの支出が、自動で残高に反映されます。基準日より前の分は残高に入れないので、登録した日と、その日の始まりの残高を入れてください。'),
      h('p', { class: 'note' }, '口座を登録すると、「支出」の支払い方法に「口座名（口座）」が自動で増えます（デビットカード・口座払い用）。'),
    ], footer);
  }

  // 収入（給料など）を追加・直す
  function openIncomeSheet(inc) {
    const isNew = !inc;
    const key = ui.viewMonth;
    const nameInput = h('input', { class: 'field-input', type: 'text', maxlength: '20', placeholder: '例：給料', 'aria-label': '項目' });
    nameInput.value = isNew ? '' : inc.name;
    const amount = amountField(isNew ? 0 : inc.amount);
    const accSel = selectEl([['', '口座に入れない（現金など）'], ...data.accounts.map((a) => [a.id, a.name])], isNew ? '' : (inc.accountId || ''), '入金される口座');
    const daySel = dayOrNoneSelect(isNew ? 0 : (inc.day || 0));

    const footer = [
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const name = nameInput.value.trim();
          const value = amount.get();
          if (!name) { nameInput.focus(); showToast('項目を入力してください'); return; }
          if (!value) { amount.input.focus(); showToast('金額を入力してください'); return; }
          const extra = { accountId: accSel.value, day: Number(daySel.value) };
          if (isNew) data.incomes.push({ id: newId(), month: key, name, amount: value, ...extra });
          else Object.assign(inc, { name, amount: value, ...extra });
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
    openSheet(isNew ? `${fmtMonth(key)}の収入を追加` : '収入を直す', [
      field('項目', nameInput), field('金額', amount.el),
      h('div', { class: 'field-row' }, field('入金される口座', accSel), field('入金日', daySel)),
      h('p', { class: 'note' }, '口座を選ぶと、入金日（指定なしならその月の最後の日）に、「口座」タブの残高へ自動で入ります。'),
    ], footer);
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
    const yomiInput = h('input', { class: 'field-input', type: 'text', maxlength: '20', placeholder: '例：こども', autocomplete: 'off', 'aria-label': 'よみ（ひらがな）' });
    yomiInput.value = draft.yomi || '';
    const taxSel = selectEl([['8', '8%（食料品など）'], ['10', '10%']], String(draft.tax || 10), '税率');
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
      field('よみ（ひらがな）', yomiInput),
      h('p', { class: 'note' }, '支出の表の「項目」で、よみの最初の字（例：「こ」）を打つと、この項目が選ばれます。'),
      field('税率（金額に「＋」を付けたとき）', taxSel),
      h('p', { class: 'note' }, '支出の表で金額を「1000＋」のように打つと、この税率をかけて税込の金額にします（1円未満は切り上げ）。'),
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
        const yomi = toHiragana(yomiInput.value).trim().slice(0, 20);
        if (isNew) data.categories.push({ id: `c${newId()}`, name, icon: draft.icon, yomi, tax: Number(taxSel.value) === 8 ? 8 : 10, color: draft.color });
        else Object.assign(cat, { name, icon: draft.icon, yomi, tax: Number(taxSel.value) === 8 ? 8 : 10, color: draft.color });
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
          Object.keys(data.budgets).forEach((m) => { delete data.budgets[m][cat.id]; if (!Object.keys(data.budgets[m]).length) delete data.budgets[m]; });
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

  function openPaymentSheet(pay, preset) {
    const isNew = !pay;
    const isCash = !isNew && pay.id === CASH_ID;
    const draft = isNew
      ? { name: '', kind: 'card', color: unusedColor(data.payments), ...CARD_DEFAULT, prepaid: false, openingBalance: 0, openingDate: ui.today, accountId: '', ...preset }
      : { ...CARD_DEFAULT, prepaid: false, openingBalance: 0, openingDate: ui.today, accountId: '', ...pay };

    const nameInput = h('input', { class: 'field-input', type: 'text', maxlength: '12', placeholder: draft.kind === 'card' ? '例：楽天カード' : '例：Suica', 'aria-label': '名前' });
    nameInput.value = draft.name;
    const kindBox = h('div', { class: 'seg', role: 'group', 'aria-label': '種類' });
    const closingSel = daySelect(draft.closingDay, '締め日');
    const offsetSel = h('select', { class: 'field-input', 'aria-label': '引き落としの月' },
      h('option', { value: '1' }, '翌月'), h('option', { value: '2' }, '翌々月'));
    offsetSel.value = String(draft.payOffset);
    const payDaySel = daySelect(draft.payDay, '引き落とし日');
    const cardAccSel = selectEl([['', '指定しない'], ...data.accounts.map((a) => [a.id, a.name])], draft.accountId || '', '引き落とされる口座');
    const example = h('p', { class: 'note' });
    const cardFields = h('div', null,
      field('締め日', h('div', { class: 'inline-fields' }, '毎月', closingSel, 'に締め')),
      field('支払日（口座から引き落とされる日）', h('div', { class: 'inline-fields' }, offsetSel, 'の', payDaySel, 'に引き落とし')),
      field('引き落とされる口座（登録した口座の残高から、支払日に自動で引きます）', cardAccSel),
      example);

    const prepaidBox = h('input', { type: 'checkbox', id: 'prepaid-check' });
    prepaidBox.checked = !!draft.prepaid;
    const balance = amountField(draft.openingBalance, BALANCE_DIGITS);
    const baseDate = h('input', { class: 'field-input', type: 'date', 'aria-label': '残高の基準日' });
    baseDate.value = draft.openingDate;
    const prepaidFields = h('div', null,
      h('div', { class: 'field-row' }, field('今の残高', balance.el), field('基準日（その日の始まりの残高）', baseDate)),
      h('p', { class: 'note' }, 'チャージ（入金）は「口座」タブで記録します。「支出」でこの電子マネーを支払い方法に選ぶと、残高が減ります。'));
    const otherFields = h('div', null,
      h('label', { class: 'check-row', for: 'prepaid-check' }, prepaidBox, 'チャージして使うタイプ（残高を管理する）'),
      prepaidFields,
      h('p', { class: 'note' }, 'チェックを入れないと、締め日のない支払い方法（後払いの電子マネー・口座振替など）として、残高は管理しません。'));

    const draw = () => {
      draft.closingDay = Number(closingSel.value);
      draft.payOffset = Number(offsetSel.value);
      draft.payDay = Number(payDaySel.value);
      kindBox.replaceChildren(...[['card', 'クレジットカード'], ['other', 'その他（電子マネー・口座振替など）']].map(([k, label]) => h('button', {
        type: 'button', class: 'pay-btn', 'aria-pressed': String(draft.kind === k),
        onclick: () => { draft.kind = k; draw(); },
      }, label)));
      cardFields.hidden = draft.kind !== 'card';
      otherFields.hidden = draft.kind !== 'other';
      prepaidFields.hidden = !prepaidBox.checked;
      const info = billInfo(draft, billMonthOf(draft, ui.today));
      example.textContent = `例：今日（${fmtDate(ui.today)}）使った分は、${fmtDate(info.start)}〜${fmtDate(info.end)}のご利用分として、${fmtFullDate(info.payDate)}に引き落とされます。`;
    };
    [closingSel, offsetSel, payDaySel].forEach((el) => el.addEventListener('change', draw));
    prepaidBox.addEventListener('change', draw);
    draw();

    const body = [field('名前', nameInput)];
    if (!isCash) body.push(field('種類', kindBox), cardFields, otherFields);
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
        if (!isNew && pay.prepaid && !(draft.kind === 'other' && prepaidBox.checked) && data.moves.some((m) => m.payId === pay.id)) {
          showToast('チャージの記録があるため、「チャージして使うタイプ」は外せません。先にチャージの記録を消してください'); return;
        }
        const values = { name, color: draft.color };
        if (!isCash) {
          values.kind = draft.kind;
          if (draft.kind === 'card') {
            Object.assign(values, { closingDay: draft.closingDay, payOffset: draft.payOffset, payDay: draft.payDay });
            if (cardAccSel.value) values.accountId = cardAccSel.value;
          }
          if (draft.kind === 'other' && prepaidBox.checked) {
            const date = /^\d{4}-\d{2}-\d{2}$/.test(baseDate.value) ? baseDate.value : ui.today;
            Object.assign(values, { prepaid: true, openingBalance: balance.get(), openingDate: date });
          }
        }
        if (isNew) {
          data.payments.push({ id: `p${newId()}`, ...values });
        } else {
          Object.assign(pay, values);
          if (pay.kind !== 'card') {
            delete pay.closingDay; delete pay.payOffset; delete pay.payDay; delete pay.accountId;
            data.moves.forEach((m) => { if (m.fromType === 'card' && m.fromId === pay.id) { m.fromType = 'none'; m.fromId = ''; } });
          } else if (!values.accountId) delete pay.accountId;
          if (!values.prepaid) { delete pay.prepaid; delete pay.openingBalance; delete pay.openingDate; }
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
          const moveCount = data.moves.filter((m) => m.payId === pay.id).length;
          const cash = payById(CASH_ID);
          const notes = [];
          if (count > 0) notes.push(`この支払い方法の記録 ${count}件は「${cash.name}」に移ります。`);
          if (moveCount > 0) notes.push(`チャージの記録 ${moveCount}件は削除されます。`);
          const ok = await confirmDialog({ title: `「${pay.name}」を削除しますか？`, message: notes.join('\n'), okLabel: '削除する', danger: true });
          if (!ok) return;
          data.records.forEach((r) => { if (r.paymentId === pay.id) r.paymentId = CASH_ID; });
          data.moves = data.moves.filter((m) => m.payId !== pay.id);
          data.moves.forEach((m) => { if (m.fromType === 'card' && m.fromId === pay.id) { m.fromType = 'none'; m.fromId = ''; } });
          data.payments = data.payments.filter((p) => p.id !== pay.id);
          if (ui.paymentId === pay.id) ui.paymentId = CASH_ID;
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
    const rows = [['日付', 'カテゴリ', '購入先', '支払い方法', '金額', 'メモ', '引き落とし予定日']];
    const sorted = data.records.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
    for (const r of sorted) {
      const p = payById(r.paymentId);
      const bill = p.kind === 'card' ? slash(billInfo(p, billMonthOf(p, r.date)).payDate) : '';
      rows.push([slash(r.date), catById(r.categoryId).name, r.store || '', p.name, r.amount, r.memo, bill]);
    }
    // 先頭の ﻿（BOM）は、Excelで開いたときに文字化けしないための印
    const csv = '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
    shareOrDownload(`家計簿_${ui.today}.csv`, new Blob([csv], { type: 'text/csv' }));
  }

  /* ---------- 画面の切りかえ ---------- */
  function renderAll() {
    renderStart();
    renderSpend();
    renderCards();
    renderUtility();
    renderAccounts();
    renderSummary();
    renderSettings();
    renderMonthNav();
    renderReminder();
  }

  function showTab(name) {
    ui.tab = name;
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === name));
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    renderAll();
    window.scrollTo(0, 0);
    if (name === 'spend') { const el = $('#spend-body tr.is-new select'); if (el) el.focus(); }
  }

  // 日付が変わったら「今日」を新しい日に合わせる（開いたまま日をまたいだとき）
  function checkDayChange() {
    const now = todayStr();
    if (now === ui.today) return;
    const wasToday = ui.date === ui.today;
    const cur = monthOf(ui.today);
    const wasThisMonth = ui.viewMonth === cur;
    ui.today = now;
    if (wasToday) ui.date = now;
    if (wasThisMonth) ui.viewMonth = monthOf(now);
    renderAll();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応なしでも動く */ });
    }
  }

  function init() {
    $('#app-version').textContent = APP_VERSION;

    // キーボード：Esc で小窓を閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheetOpen && $('#dialog-root').hidden) closeSheet();
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
    const closingSel = $('#closing-day');
    closingSel.append(...Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1) }, `${i + 1}日`)),
      h('option', { value: String(END_OF_MONTH) }, '末日（暦どおりの月）'));
    closingSel.addEventListener('change', () => {
      data.settings.closingDay = clampDay(closingSel.value, DEFAULT_CLOSING_DAY);
      save();
      ui.viewMonth = monthOf(ui.today);
      renderAll();
      showToast(`締め日を ${data.settings.closingDay === END_OF_MONTH ? '末日' : data.settings.closingDay + '日'} にしました`);
    });
    $('#add-cat-btn').addEventListener('click', () => openCategorySheet(null));
    $('#add-pay-btn').addEventListener('click', () => openPaymentSheet(null));
    $('#add-account-btn').addEventListener('click', () => openAccountSheet(null));
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

    if (data.accounts.length) save();   // 基準日をはじめて決めた口座を、その日のまま残すため
    applyTheme();
    registerServiceWorker();
    renderAll();
  }

  init();
})();
