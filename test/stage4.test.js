// Автоматичні тести етапу 4. Не змінюйте цей файл.
// Запуск: npm test (разом із тестами попередніх етапів)
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'fixtures', 'stage2-items.json');
const ITEMS = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const mod = (name) => { const p = path.join(ROOT, 'src', name); assert.ok(fs.existsSync(p), `має існувати файл src/${name}`); return require(p); };

// Тимчасова папка зі статикою для тестів; поруч із нею - «секретний» файл, який сервер не має віддавати.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stage4-'));
const PUBLIC = path.join(TMP, 'public');
fs.mkdirSync(PUBLIC);
fs.writeFileSync(path.join(TMP, 'secret.txt'), 'TOP-SECRET-STAGE4');
fs.writeFileSync(path.join(PUBLIC, 'index.html'), '<!doctype html><html><body><h1>Stage 4</h1></body></html>');
fs.writeFileSync(path.join(PUBLIC, 'style.css'), 'body { color: black; }');
fs.writeFileSync(path.join(PUBLIC, 'app.js'), 'console.log("hi");');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

describe('етап 4: структура репозиторію', () => {
  test('є public/index.html', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'public', 'index.html')), 'має існувати public/index.html - головна сторінка вашого сервера');
  });
  test('express у залежностях package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies && pkg.dependencies.express, 'додайте express у dependencies: npm install express');
  });
});

// Той самий контракт для обох реалізацій.
const IMPLS = [
  ['http', () => mod('http-server.js').createServer({ dataFile: DATA, publicDir: PUBLIC })],
  ['express', () => {
    const app = mod('app.js').createApp({ dataFile: DATA, publicDir: PUBLIC });
    return require('node:http').createServer(app);
  }],
];

for (const [name, make] of IMPLS) {
  describe(`етап 4: контракт API (${name})`, () => {
    let server, base, initError;
    before(async () => {
      try { server = make(); base = await listen(server); } catch (e) { initError = e; }
    });
    after(() => { if (server) { server.closeAllConnections?.(); server.close(); } });
    const get = (p, init) => {
      if (initError) throw initError;
      return fetch(base + p, init);
    };

    test('GET /health - 200 {status: "ok"}', async () => {
      const r = await get('/health');
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type') ?? '', /application\/json/);
      assert.deepEqual(await r.json(), { status: 'ok' });
    });
    test('GET /api/items - усі записи', async () => {
      const r = await get('/api/items');
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), ITEMS);
    });
    test('GET /api/items з фільтрами category, minPrice, maxPrice', async () => {
      const r = await get('/api/items?category=A&minPrice=8&maxPrice=50');
      assert.equal(r.status, 200);
      const expected = ITEMS.filter((x) => x.category === 'A' && x.price >= 8 && x.price <= 50).map((x) => x.id);
      assert.deepEqual((await r.json()).map((x) => x.id), expected);
    });
    test('некоректне число у фільтрі - 400 з полем error', async () => {
      const r = await get('/api/items?minPrice=abc');
      assert.equal(r.status, 400);
      assert.equal(typeof (await r.json()).error, 'string');
    });
    test('GET /api/items/:id - 200 / 404 / 400', async () => {
      const ok = await get(`/api/items/${ITEMS[0].id}`);
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), ITEMS[0]);
      const missing = await get('/api/items/99999');
      assert.equal(missing.status, 404);
      assert.equal(typeof (await missing.json()).error, 'string');
      const bad = await get('/api/items/abc');
      assert.equal(bad.status, 400);
    });
    test('GET /api/stats і /api/stats?category=', async () => {
      const all = await (await get('/api/stats')).json();
      assert.equal(all.count, ITEMS.length);
      const a = await (await get('/api/stats?category=A')).json();
      assert.equal(a.count, ITEMS.filter((x) => x.category === 'A').length);
    });
    test('невідомий маршрут API - 404 JSON', async () => {
      const r = await get('/api/nothing-here');
      assert.equal(r.status, 404);
      assert.equal(typeof (await r.json()).error, 'string');
    });
    test('недозволений метод - 405 із заголовком Allow', async () => {
      const r = await get('/api/items', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      assert.equal(r.status, 405);
      assert.match(r.headers.get('allow') ?? '', /GET/);
    });
    test('CORS: заголовок Access-Control-Allow-Origin і preflight OPTIONS - 204', async () => {
      const r = await get('/api/items');
      assert.equal(r.headers.get('access-control-allow-origin'), '*');
      const pre = await get('/api/items', { method: 'OPTIONS' });
      assert.equal(pre.status, 204);
      assert.match(pre.headers.get('access-control-allow-methods') ?? '', /GET/);
    });
    test('статика: / - index.html, правильні Content-Type для css і js', async () => {
      const home = await get('/');
      assert.equal(home.status, 200);
      assert.match(home.headers.get('content-type') ?? '', /text\/html/);
      assert.match(await home.text(), /Stage 4/);
      assert.match((await get('/style.css')).headers.get('content-type') ?? '', /text\/css/);
      assert.match((await get('/app.js')).headers.get('content-type') ?? '', /javascript/);
      assert.equal((await get('/missing.png')).status, 404);
    });
    test('статика: вихід за межі папки public неможливий', async () => {
      for (const p of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/..%5csecret.txt']) {
        const r = await get(p);
        assert.notEqual(r.status, 200, `запит ${p} не має віддавати файли поза public`);
        assert.doesNotMatch(await r.text(), /TOP-SECRET/, `запит ${p} віддав файл поза папкою public`);
      }
    });
  });
}

describe('етап 4: власна middleware (express)', () => {
  let server, base, initError;
  before(async () => {
    try { server = require('node:http').createServer(mod('app.js').createApp({ dataFile: DATA, publicDir: PUBLIC })); base = await listen(server); } catch (e) { initError = e; }
  });
  after(() => { if (server) { server.closeAllConnections?.(); server.close(); } });
  test('кожна відповідь має заголовок X-Response-Time у форматі «12.34ms»', async () => {
    if (initError) throw initError;
    for (const p of ['/health', '/api/items', '/api/items/99999', '/']) {
      const r = await fetch(base + p);
      assert.match(r.headers.get('x-response-time') ?? '', /^\d+(\.\d+)?ms$/, `немає X-Response-Time для ${p}`);
    }
  });
});
