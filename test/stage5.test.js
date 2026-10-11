// Автоматичні тести етапу 5. Не змінюйте цей файл.
// Запуск: npm test (разом із тестами попередніх етапів)
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const mod = (name) => { const p = path.join(ROOT, 'src', name); assert.ok(fs.existsSync(p), `має існувати файл src/${name}`); return require(p); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stage5-'));
let dbCounter = 0;
const freshDb = () => path.join(TMP, `test-${++dbCounter}.db`);

async function start(dbFile) {
  const app = mod('rest.js').createRestApp({ dbFile });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, headers = {}) => {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = typeof body === 'string' ? body : JSON.stringify(body); }
    const r = await fetch(base + p, init);
    const text = await r.text();
    let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: r.status, json, headers: r.headers, text };
  };
  return { call, close: () => { server.closeAllConnections?.(); server.close(); } };
}

// Якщо сервер не вдалося створити, кожен тест падає з цією причиною (а не «скасовується»).
async function safeStart(dbFile, setup) {
  try { const s = await start(dbFile); if (setup) await setup(s); return s; } catch (e) { return { call: async () => { throw e; }, close() {} }; }
}

const P = (over = {}) => ({ title: 'Кобзар', categoryId: 1, price: 250, quantity: 3, date: '2026-09-01', ...over });

describe('етап 5: структура', () => {
  test('є src/rest.js з createRestApp і express у залежностях', () => {
    assert.equal(typeof mod('rest.js').createRestApp, 'function', 'src/rest.js має експортувати createRestApp');
  });
});

describe('етап 5: категорії', () => {
  let s;
  before(async () => { s = await safeStart(freshDb()); });
  after(() => s?.close());

  test('POST /api/categories - 201, тіло і заголовок Location', async () => {
    const r = await s.call('POST', '/api/categories', { name: 'Поезія' });
    assert.equal(r.status, 201);
    assert.equal(r.json.name, 'Поезія');
    assert.ok(Number.isInteger(r.json.id));
    assert.equal(r.headers.get('location'), `/api/categories/${r.json.id}`);
  });
  test('валідація: порожня назва - 400 з details', async () => {
    const r = await s.call('POST', '/api/categories', { name: '   ' });
    assert.equal(r.status, 400);
    assert.equal(typeof r.json.error, 'string');
    assert.ok(Array.isArray(r.json.details) && r.json.details.some((d) => d.field === 'name'), 'details має містити помилку для поля name');
  });
  test('дублікат назви - 409', async () => {
    assert.equal((await s.call('POST', '/api/categories', { name: 'Поезія' })).status, 409);
  });
  test('GET список, GET за id, 404, 400', async () => {
    await s.call('POST', '/api/categories', { name: 'Проза' });
    const list = await s.call('GET', '/api/categories');
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.map((c) => c.name), ['Поезія', 'Проза']);
    const one = await s.call('GET', `/api/categories/${list.json[1].id}`);
    assert.deepEqual(one.json, list.json[1]);
    assert.equal((await s.call('GET', '/api/categories/999')).status, 404);
    assert.equal((await s.call('GET', '/api/categories/abc')).status, 400);
  });
  test('PATCH - перейменування; 404 для неіснуючої', async () => {
    const r = await s.call('PATCH', '/api/categories/2', { name: 'Художня проза' });
    assert.equal(r.status, 200);
    assert.equal(r.json.name, 'Художня проза');
    assert.equal((await s.call('PATCH', '/api/categories/999', { name: 'X' })).status, 404);
  });
});

describe('етап 5: товари', () => {
  let s;
  before(async () => {
    s = await safeStart(freshDb(), async (x) => {
      await x.call('POST', '/api/categories', { name: 'Поезія' });   // id 1
      await x.call('POST', '/api/categories', { name: 'Історія' });  // id 2
    });
  });
  after(() => s?.close());

  test('POST /api/products - 201 і Location', async () => {
    const r = await s.call('POST', '/api/products', P());
    assert.equal(r.status, 201);
    assert.deepEqual({ ...r.json, id: undefined }, { ...P(), id: undefined });
    assert.equal(r.headers.get('location'), `/api/products/${r.json.id}`);
  });
  test('валідація всіх полів - 400 і details по кожному некоректному полю', async () => {
    const r = await s.call('POST', '/api/products', { title: '', categoryId: 'x', price: -1, quantity: 1.5, date: '2026-13-40' });
    assert.equal(r.status, 400);
    const fields = (r.json.details ?? []).map((d) => d.field).sort();
    assert.deepEqual(fields, ['categoryId', 'date', 'price', 'quantity', 'title']);
  });
  test('відсутні обов’язкові поля - 400', async () => {
    const r = await s.call('POST', '/api/products', { title: 'Без ціни' });
    assert.equal(r.status, 400);
    assert.ok(r.json.details.length >= 4);
  });
  test('неіснуюча категорія - 400 з details для categoryId', async () => {
    const r = await s.call('POST', '/api/products', P({ categoryId: 999 }));
    assert.equal(r.status, 400);
    assert.ok(r.json.details.some((d) => d.field === 'categoryId'));
  });
  test('некоректний JSON у тілі - 400', async () => {
    const r = await s.call('POST', '/api/products', '{bad json');
    assert.equal(r.status, 400);
    assert.equal(typeof r.json.error, 'string');
  });
  test('GET за id, PUT (повна заміна), PATCH (часткова), DELETE', async () => {
    const { json: created } = await s.call('POST', '/api/products', P({ title: 'Енеїда', price: 180 }));
    const id = created.id;
    assert.deepEqual((await s.call('GET', `/api/products/${id}`)).json, created);
    const put = await s.call('PUT', `/api/products/${id}`, P({ title: 'Енеїда (нове видання)', categoryId: 2, price: 200, quantity: 5, date: '2026-10-01' }));
    assert.equal(put.status, 200);
    assert.equal(put.json.categoryId, 2);
    assert.equal((await s.call('PUT', `/api/products/${id}`, { title: 'лише назва' })).status, 400, 'PUT вимагає всі поля');
    const patch = await s.call('PATCH', `/api/products/${id}`, { price: 199.5 });
    assert.equal(patch.status, 200);
    assert.equal(patch.json.price, 199.5);
    assert.equal(patch.json.title, 'Енеїда (нове видання)');
    assert.equal((await s.call('DELETE', `/api/products/${id}`)).status, 204);
    assert.equal((await s.call('GET', `/api/products/${id}`)).status, 404);
    assert.equal((await s.call('DELETE', `/api/products/${id}`)).status, 404);
  });
  test('зв’язок: GET /api/categories/:id/products; категорію з товарами не можна видалити - 409', async () => {
    const r = await s.call('GET', '/api/categories/1/products');
    assert.equal(r.status, 200);
    assert.ok(r.json.length >= 1 && r.json.every((p) => p.categoryId === 1));
    assert.equal((await s.call('DELETE', '/api/categories/1')).status, 409);
  });
});

describe('етап 5: фільтри, сортування, пагінація', () => {
  let s;
  before(async () => {
    s = await safeStart(freshDb(), async (x) => {
      await x.call('POST', '/api/categories', { name: 'A' });
      await x.call('POST', '/api/categories', { name: 'B' });
      const data = [['Gamma', 1, 30], ['Alpha', 1, 10], ['Delta', 2, 40], ['Beta', 2, 20], ['Epsilon', 1, 50]];
      for (const [title, categoryId, price] of data) await x.call('POST', '/api/products', P({ title, categoryId, price }));
    });
  });
  after(() => s?.close());
  const titles = (r) => r.json.map((p) => p.title);

  test('фільтри categoryId, minPrice, maxPrice і заголовок X-Total-Count', async () => {
    const r = await s.call('GET', '/api/products?categoryId=1&minPrice=20&maxPrice=50');
    assert.equal(r.status, 200);
    assert.deepEqual(titles(r), ['Gamma', 'Epsilon']);
    assert.equal(r.headers.get('x-total-count'), '2');
  });
  test('sort=price, -price, title', async () => {
    assert.deepEqual(titles(await s.call('GET', '/api/products?sort=price')), ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']);
    assert.deepEqual(titles(await s.call('GET', '/api/products?sort=-price')), ['Epsilon', 'Delta', 'Gamma', 'Beta', 'Alpha']);
    assert.deepEqual(titles(await s.call('GET', '/api/products?sort=title')), ['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);
  });
  test('limit і offset; X-Total-Count - загальна кількість без пагінації', async () => {
    const r = await s.call('GET', '/api/products?sort=price&limit=2&offset=1');
    assert.deepEqual(titles(r), ['Beta', 'Gamma']);
    assert.equal(r.headers.get('x-total-count'), '5');
  });
  test('некоректні параметри - 400', async () => {
    for (const q of ['minPrice=abc', 'sort=weight', 'limit=0', 'limit=1000', 'offset=-1']) {
      assert.equal((await s.call('GET', `/api/products?${q}`)).status, 400, `?${q} має давати 400`);
    }
  });
  test('невідомий маршрут - 404 JSON', async () => {
    const r = await s.call('GET', '/api/unknown');
    assert.equal(r.status, 404);
    assert.equal(typeof r.json.error, 'string');
  });
});

describe('етап 5: дані зберігаються в SQLite', () => {
  test('після «перезапуску» сервера з тим самим файлом БД дані на місці', async () => {
    const file = freshDb();
    const a = await start(file);
    await a.call('POST', '/api/categories', { name: 'Зберігається' });
    const { json: p } = await a.call('POST', '/api/products', P({ title: 'Тривалий', categoryId: 1 }));
    a.close();
    const b = await start(file);
    try {
      assert.deepEqual((await b.call('GET', '/api/categories')).json.map((c) => c.name), ['Зберігається']);
      assert.deepEqual((await b.call('GET', `/api/products/${p.id}`)).json, p);
    } finally { b.close(); }
    assert.ok(fs.statSync(file).size > 0, 'файл бази даних має бути створений');
  });
});
