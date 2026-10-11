// Автоматичні тести етапу 3. Не змінюйте цей файл.
// Запуск: npm test (разом із тестами попередніх етапів)
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const COLLECT = path.join(ROOT, 'src', 'collect.js');
const mod = (name) => { const p = path.join(ROOT, 'src', name); assert.ok(fs.existsSync(p), `має існувати файл src/${name}`); return require(p); };

// Локальний тестовий сервер: інтернет не потрібен.
let server, base;
const flaky = new Map();
before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'item') return json(200, { id: Number(parts[1]) });
    if (parts[0] === 'delay') return setTimeout(() => json(200, { waited: Number(parts[1]) }), Number(parts[1]));
    if (parts[0] === 'status') return json(Number(parts[1]), { error: true });
    if (parts[0] === 'hang') return; // ніколи не відповідає
    if (parts[0] === 'broken') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{not json'); }
    if (parts[0] === 'flaky') { // перші N запитів з ключем key -> 503, далі 200
      const key = parts[1], n = Number(parts[2]);
      const seen = (flaky.get(key) ?? 0) + 1; flaky.set(key, seen);
      return seen <= n ? json(503, { error: 'busy' }) : json(200, { key, attempts: seen });
    }
    json(404, { error: 'not found' });
  });
  server.keepAliveTimeout = 1;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

const run = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [COLLECT, ...args], { cwd: ROOT, timeout: 15000 }, (err, stdout, stderr) => {
    resolve({ code: err ? (err.code ?? 1) : 0, out: stdout.trim(), err: stderr.trim() });
  });
});
const failCli = async (args, code) => {
  const r = await run(...args);
  assert.equal(r.code, code, `код виходу для «${args.join(' ')}» має бути ${code}, stderr: ${r.err}`);
  assert.equal(r.out, '', 'при помилці stdout має бути порожнім');
  assert.match(r.err, /^Error:/, 'повідомлення про помилку має починатися з «Error:»');
};
const time = async (fn) => { const t = Date.now(); const v = await fn(); return [v, Date.now() - t]; };

describe('етап 3: fetchJson', () => {
  test('повертає розібраний JSON', async () => {
    const { fetchJson } = mod('fetcher.js');
    assert.deepEqual(await fetchJson(`${base}/item/7`), { id: 7 });
  });
  test('4xx - помилка «HTTP <код>» без повторів', async () => {
    const { fetchJson } = mod('fetcher.js');
    await assert.rejects(fetchJson(`${base}/status/404`, { retries: 3 }), /HTTP 404/);
  });
  test('5xx після вичерпання повторів - помилка «HTTP 500»', async () => {
    const { fetchJson } = mod('fetcher.js');
    await assert.rejects(fetchJson(`${base}/status/500`, { retries: 1 }), /HTTP 500/);
  });
  test('повтори: 2 збої поспіль і retries=2 - успіх з третьої спроби', async () => {
    const { fetchJson } = mod('fetcher.js');
    assert.deepEqual(await fetchJson(`${base}/flaky/a/2`, { retries: 2 }), { key: 'a', attempts: 3 });
  });
  test('повтори: 2 збої поспіль і retries=1 - помилка', async () => {
    const { fetchJson } = mod('fetcher.js');
    await assert.rejects(fetchJson(`${base}/flaky/b/2`, { retries: 1 }), /HTTP 503/);
  });
  test('тайм-аут: сервер не відповідає - помилка «timeout» приблизно за заданий час', async () => {
    const { fetchJson } = mod('fetcher.js');
    const [, ms] = await time(() => fetchJson(`${base}/hang`, { timeout: 300 }).catch((e) => {
      assert.match(e.message, /timeout/i); return 'ok';
    }));
    assert.ok(ms < 2000, `тайм-аут 300 мс спрацював лише через ${ms} мс`);
  });
  test('некоректний JSON - помилка', async () => {
    const { fetchJson } = mod('fetcher.js');
    await assert.rejects(fetchJson(`${base}/broken`));
  });
});

describe('етап 3: loadAll', () => {
  test('результати в тому самому порядку, помилки не зупиняють решту', async () => {
    const { loadAll } = mod('fetcher.js');
    const urls = [`${base}/item/1`, `${base}/status/404`, `${base}/item/3`];
    const r = await loadAll(urls);
    assert.equal(r.length, 3);
    assert.deepEqual(r.map((x) => x.url), urls);
    assert.deepEqual(r.map((x) => x.ok), [true, false, true]);
    assert.deepEqual(r[0].data, { id: 1 });
    assert.match(r[1].error, /HTTP 404/);
  });
  test('паралельний режим: три запити по 400 мс - разом менше ніж 900 мс', async () => {
    const { loadAll } = mod('fetcher.js');
    const [r, ms] = await time(() => loadAll([`${base}/delay/400`, `${base}/delay/400`, `${base}/delay/400`], { mode: 'parallel' }));
    assert.ok(r.every((x) => x.ok));
    assert.ok(ms < 900, `паралельне завантаження тривало ${ms} мс - схоже, запити йдуть по черзі`);
  });
  test('послідовний режим: три запити по 300 мс - разом не менше ніж 850 мс', async () => {
    const { loadAll } = mod('fetcher.js');
    const [r, ms] = await time(() => loadAll([`${base}/delay/300`, `${base}/delay/300`, `${base}/delay/300`], { mode: 'sequential' }));
    assert.ok(r.every((x) => x.ok));
    assert.ok(ms >= 850, `послідовне завантаження тривало лише ${ms} мс - схоже, запити йдуть одночасно`);
  });
});

describe('етап 3: analyzeLog (Streams)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-'));
  const big = path.join(dir, 'big.log');
  before(() => {
    const lines = [];
    for (let i = 0; i < 60000; i++) {
      const ts = new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString();
      const level = i % 10 === 0 ? 'ERROR' : i % 3 === 0 ? 'WARN' : 'INFO';
      const msg = level === 'ERROR' ? ['disk full', 'db timeout', 'db timeout', 'auth failed', 'oops'][i % 50 / 10] : `request ${i}`;
      lines.push(`${ts} ${level} ${msg}`);
      if (i === 100) lines.push('', 'garbage line without format');
    }
    fs.writeFileSync(big, lines.join('\n') + '\n');
  });
  test('рахує рядки, рівні, перший/останній час і топ помилок', async () => {
    const { analyzeLog } = mod('logstats.js');
    const s = await analyzeLog(big);
    assert.equal(s.lines, 60000);
    assert.equal(s.invalid, 1);
    assert.deepEqual(s.levels, { INFO: 36000, WARN: 18000, ERROR: 6000 });
    assert.equal(s.first, '2026-10-01T00:00:00.000Z');
    assert.equal(s.last, new Date(Date.UTC(2026, 9, 1, 0, 0, 59999)).toISOString());
    assert.deepEqual(s.topErrors, [
      { message: 'db timeout', count: 2400 },
      { message: 'auth failed', count: 1200 },
      { message: 'disk full', count: 1200 },
    ]);
  });
  test('файл читається потоком, а не цілком у пам’ять', async () => {
    const { analyzeLog } = mod('logstats.js');
    const orig = { sync: fs.readFileSync, prom: fs.promises.readFile, cb: fs.readFile };
    const ban = () => { throw new Error('readFile заборонено: використовуйте Streams (fs.createReadStream)'); };
    fs.readFileSync = ban; fs.promises.readFile = ban; fs.readFile = ban;
    try {
      const s = await analyzeLog(big);
      assert.equal(s.lines, 60000);
    } finally {
      fs.readFileSync = orig.sync; fs.promises.readFile = orig.prom; fs.readFile = orig.cb;
    }
  });
  test('неіснуючий файл - відхилений проміс', async () => {
    const { analyzeLog } = mod('logstats.js');
    await assert.rejects(analyzeLog(path.join(dir, 'nope.log')));
  });
});

describe('етап 3: утиліта collect', () => {
  test('fetch: JSON-масив результатів, код 0', async () => {
    const r = await run('fetch', `${base}/item/1`, `${base}/item/2`);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out).map((x) => x.data), [{ id: 1 }, { id: 2 }]);
  });
  test('fetch: хоча б одна невдача - результати в stdout і код 5', async () => {
    const r = await run('fetch', `${base}/item/1`, `${base}/status/500`);
    assert.equal(r.code, 5);
    assert.deepEqual(JSON.parse(r.out).map((x) => x.ok), [true, false]);
  });
  test('fetch --sequential працює послідовно', async () => {
    const [r, ms] = await time(() => run('fetch', '--sequential', `${base}/delay/300`, `${base}/delay/300`, `${base}/delay/300`));
    assert.equal(r.code, 0, r.err);
    assert.ok(ms >= 850, `--sequential тривало ${ms} мс`);
  });
  test('fetch --timeout і --retries', async () => {
    const r = await run('fetch', '--timeout', '300', '--retries', '2', `${base}/hang`, `${base}/flaky/cli/2`);
    assert.equal(r.code, 5);
    const [a, b] = JSON.parse(r.out);
    assert.match(a.error, /timeout/i);
    assert.equal(b.ok, true);
  });
  test('log: статистика файлу журналу', async () => {
    const f = path.join(os.tmpdir(), `stage3-small-${process.pid}.log`);
    fs.writeFileSync(f, '2026-10-01T10:00:00Z INFO start\n2026-10-01T10:00:01Z ERROR boom\n');
    const r = await run('log', f);
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.equal(s.lines, 2);
    assert.deepEqual(s.levels, { INFO: 1, WARN: 0, ERROR: 1 });
    assert.deepEqual(s.topErrors, [{ message: 'boom', count: 1 }]);
  });
  test('помилки: немає команди / невідома команда / невідома опція - 1', async () => {
    await failCli([], 1);
    await failCli(['download', base], 1);
    await failCli(['fetch', '--fast', `${base}/item/1`], 1);
  });
  test('помилки: fetch без URL, log без файлу - 2', async () => {
    await failCli(['fetch'], 2);
    await failCli(['log'], 2);
  });
  test('помилки: некоректне значення --timeout або --retries - 3', async () => {
    await failCli(['fetch', '--timeout', 'abc', `${base}/item/1`], 3);
    await failCli(['fetch', '--retries', '-1', `${base}/item/1`], 3);
  });
  test('помилки: файл журналу не існує - 4', async () => {
    await failCli(['log', path.join(os.tmpdir(), 'definitely-missing.log')], 4);
  });
});
