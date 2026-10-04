// Автоматичні тести етапу 2. Не змінюйте цей файл.
// Запуск: npm test (разом із тестами попередніх етапів)
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REPORT = path.join(ROOT, 'src', 'report.js');
const FX = path.join(__dirname, 'fixtures', 'stage2-items.json');
const fx = (name) => path.join(__dirname, 'fixtures', name);
const loadFx = () => JSON.parse(fs.readFileSync(FX, 'utf8'));

const run = (...args) => {
  const r = spawnSync(process.execPath, [REPORT, ...args], { encoding: 'utf8', timeout: 5000, cwd: ROOT });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
};
const okJson = (args) => {
  const r = run(...args);
  assert.equal(r.code, 0, `код виходу для «${args.join(' ')}» має бути 0, stderr: ${r.err}`);
  try { return JSON.parse(r.out); } catch { assert.fail(`вивід для «${args.join(' ')}» має бути коректним JSON, отримано: ${r.out.slice(0, 200)}`); }
};
const fail = (args, code) => {
  const r = run(...args);
  assert.equal(r.code, code, `код виходу для «${args.join(' ')}» має бути ${code}, stderr: ${r.err}`);
  assert.equal(r.out, '', 'при помилці stdout має бути порожнім');
  assert.match(r.err, /^Error:/, 'повідомлення про помилку має починатися з «Error:»');
};
const ids = (arr) => arr.map((x) => x.id);
const mod = (name) => { const p = path.join(ROOT, 'src', name); assert.ok(fs.existsSync(p), `має існувати файл src/${name}`); return require(p); };

describe('етап 2: структура репозиторію', () => {
  test('package.json із назвою та скриптом test', () => {
    const p = path.join(ROOT, 'package.json');
    assert.ok(fs.existsSync(p), 'має існувати package.json');
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.ok(pkg.name, 'у package.json має бути поле name');
    assert.ok(pkg.scripts && pkg.scripts.test, 'у package.json має бути скрипт test');
  });
  test('README.md із розділами «Предметна область» і «Запуск»', () => {
    const p = path.join(ROOT, 'README.md');
    assert.ok(fs.existsSync(p), 'має існувати README.md');
    const t = fs.readFileSync(p, 'utf8');
    assert.match(t, /^##\s+Предметна область/m, 'README.md має містити розділ «## Предметна область»');
    assert.match(t, /^##\s+Запуск/m, 'README.md має містити розділ «## Запуск»');
  });
  test('модулі src/data.js, src/query.js, src/report.js; report.js використовує query.js', () => {
    for (const f of ['data.js', 'query.js', 'report.js']) assert.ok(fs.existsSync(path.join(ROOT, 'src', f)), `має існувати src/${f}`);
    const src = fs.readFileSync(REPORT, 'utf8');
    assert.match(src, /require\(\s*['"]\.\/query(\.js)?['"]\s*\)/, 'src/report.js має підключати модуль ./query');
    assert.match(src, /require\(\s*['"]\.\/data(\.js)?['"]\s*\)/, 'src/report.js має підключати модуль ./data');
  });
  test('власний набір даних data/items.json (≥ 20 записів, коректна схема)', () => {
    const p = path.join(ROOT, 'data', 'items.json');
    assert.ok(fs.existsSync(p), 'має існувати data/items.json з даними вашої предметної області');
    const items = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.ok(Array.isArray(items), 'data/items.json має містити масив');
    assert.ok(items.length >= 20, 'у data/items.json має бути щонайменше 20 записів');
    const seen = new Set();
    for (const it of items) {
      const where = `запис ${JSON.stringify(it).slice(0, 80)}`;
      assert.ok(Number.isInteger(it.id) && it.id > 0, `${where}: id — додатне ціле`);
      assert.ok(!seen.has(it.id), `${where}: id має бути унікальним`); seen.add(it.id);
      assert.ok(typeof it.title === 'string' && it.title.trim(), `${where}: title — непорожній рядок`);
      assert.ok(typeof it.category === 'string' && it.category.trim(), `${where}: category — непорожній рядок`);
      assert.ok(typeof it.price === 'number' && Number.isFinite(it.price) && it.price >= 0, `${where}: price — невід’ємне число`);
      assert.ok(Number.isInteger(it.quantity) && it.quantity >= 0, `${where}: quantity — невід’ємне ціле`);
      assert.match(String(it.date), /^\d{4}-\d{2}-\d{2}$/, `${where}: date у форматі РРРР-ММ-ДД`);
    }
    assert.ok(new Set(items.map((x) => x.category)).size >= 3, 'у даних має бути щонайменше 3 різні категорії');
  });
});

describe('етап 2: модулі', () => {
  test('data.loadItems', () => {
    const { loadItems } = mod('data.js');
    assert.equal(typeof loadItems, 'function', 'src/data.js має експортувати функцію loadItems');
    assert.deepEqual(ids(loadItems(FX)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.throws(() => loadItems(fx('missing.json')), 'для відсутнього файлу loadItems має кидати помилку');
    assert.throws(() => loadItems(fx('stage2-broken.json')), 'для некоректного JSON loadItems має кидати помилку');
    assert.throws(() => loadItems(fx('stage2-not-array.json')), 'якщо у файлі не масив, loadItems має кидати помилку');
  });
  test('query.filterItems', () => {
    const { filterItems } = mod('query.js');
    const items = loadFx();
    assert.deepEqual(ids(filterItems(items, {})), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(ids(filterItems(items, { category: 'A' })), [1, 3, 6, 9]);
    assert.deepEqual(ids(filterItems(items, { minPrice: 20 })), [2, 4, 7, 9]);
    assert.deepEqual(ids(filterItems(items, { category: 'B', maxPrice: 15 })), [5, 8]);
    assert.deepEqual(ids(filterItems(items, { minPrice: 10, maxPrice: 15 })), [1, 5, 6, 10]);
    assert.deepEqual(items, loadFx(), 'filterItems не має змінювати вхідний масив');
  });
  test('query.groupCount', () => {
    const { groupCount } = mod('query.js');
    const items = loadFx();
    assert.deepEqual(groupCount(items, 'category'), { A: 4, B: 3, C: 2, D: 1 });
    assert.deepEqual(groupCount(items, 'year'), { 2025: 1, 2026: 9 });
  });
  test('query.stats', () => {
    const { stats } = mod('query.js');
    assert.deepEqual(stats(loadFx()), { count: 10, totalQuantity: 54, totalValue: 792.45, avgPrice: 29.52, minPrice: 5, maxPrice: 100 });
    assert.deepEqual(stats([]), { count: 0, totalQuantity: 0, totalValue: 0, avgPrice: 0, minPrice: null, maxPrice: null });
  });
  test('query.topN', () => {
    const { topN } = mod('query.js');
    const items = loadFx();
    assert.deepEqual(ids(topN(items, 3, 'price')), [4, 9, 7]);
    assert.deepEqual(ids(topN(items, 2, 'quantity')), [8, 3]);
    assert.deepEqual(ids(topN(items, 3, 'quantity').slice(0, 1)), [8]);
    assert.deepEqual(items, loadFx(), 'topN не має змінювати вхідний масив');
  });
});

describe('етап 2: консольна утиліта report', () => {
  test('list із фільтрами', () => {
    assert.deepEqual(ids(okJson(['list', '--file', FX, '--category', 'A'])), [1, 3, 6, 9]);
    assert.deepEqual(ids(okJson(['list', '--file', FX, '--min-price', '10', '--max-price', '15'])), [1, 5, 6, 10]);
    assert.equal(okJson(['list', '--file', FX]).length, 10);
  });
  test('group', () => {
    assert.deepEqual(okJson(['group', '--file', FX, '--by', 'category']), { A: 4, B: 3, C: 2, D: 1 });
    assert.deepEqual(okJson(['group', '--file', FX, '--by', 'year']), { 2025: 1, 2026: 9 });
  });
  test('stats', () => {
    assert.deepEqual(okJson(['stats', '--file', FX, '--category', 'A']), { count: 4, totalQuantity: 16, totalValue: 182.5, avgPrice: 21.81, minPrice: 7.25, maxPrice: 60 });
  });
  test('top', () => {
    assert.deepEqual(ids(okJson(['top', '--file', FX, '--n', '3', '--by', 'price'])), [4, 9, 7]);
    assert.deepEqual(ids(okJson(['top', '--file', FX, '--n', '2'])), [4, 9], 'за замовчуванням --by price');
  });
  test('без --file використовуються ваші дані data/items.json', () => {
    const g = okJson(['group', '--by', 'category']);
    assert.ok(Object.keys(g).length >= 3, 'group за вашими даними має повернути щонайменше 3 категорії');
  });
  test('помилки та коди виходу', () => {
    fail([], 1);
    fail(['sort', '--file', FX], 1);
    fail(['list', '--file', FX, '--colour', 'red'], 1);
    fail(['group', '--file', FX], 2);
    fail(['top', '--file', FX], 2);
    fail(['group', '--file', FX, '--by', 'colour'], 3);
    fail(['top', '--file', FX, '--n', '0'], 3);
    fail(['top', '--file', FX, '--n', 'abc'], 3);
    fail(['top', '--file', FX, '--n', '2', '--by', 'title'], 3);
    fail(['list', '--file', FX, '--min-price', 'abc'], 3);
    fail(['list', '--file', fx('missing.json')], 4);
    fail(['list', '--file', fx('stage2-broken.json')], 4);
    fail(['list', '--file', fx('stage2-not-array.json')], 4);
  });
});
