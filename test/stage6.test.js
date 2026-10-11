// Автоматичні тести етапу 6. Не змінюйте цей файл.
// Запуск: npm test (разом із тестами попередніх етапів)
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const mod = (name) => { const p = path.join(ROOT, 'src', name); assert.ok(fs.existsSync(p), `має існувати файл src/${name}`); return require(p); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stage6-'));
const SECRET = 'test-secret-for-stage-6-0123456789';
const ADMIN = 'admin@duikt.edu.ua';
const PASSWORD = 'Sup3r-Secret-Pa55';

async function start(dbFile, auth) {
  const app = mod('rest.js').createRestApp({ dbFile, auth });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, token) => {
    const init = { method, headers: {} };
    if (token) init.headers.authorization = `Bearer ${token}`;
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await fetch(base + p, init);
    const text = await r.text();
    let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: r.status, json, text };
  };
  return { call, close: () => { server.closeAllConnections?.(); server.close(); } };
}
async function safeStart(dbFile, auth, setup) {
  try { const s = await start(dbFile, auth); if (setup) await setup(s); return s; } catch (e) { return { call: async () => { throw e; }, close() {} }; }
}

const decode = (token) => JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
const tamper = (token, changes) => {
  const [h, , s] = token.split('.');
  const payload = { ...decode(token), ...changes };
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
};
const PRODUCT = { title: 'Кобзар', categoryId: 1, price: 250, quantity: 3, date: '2026-09-01' };

describe('етап 6: реєстрація і вхід', () => {
  const dbFile = path.join(TMP, 'auth.db');
  let s;
  before(async () => { s = await safeStart(dbFile, { secret: SECRET, adminEmails: [ADMIN] }); });
  after(() => s?.close());

  test('POST /api/auth/register - 201 {id, email, role}, без пароля у відповіді', async () => {
    const r = await s.call('POST', '/api/auth/register', { email: 'student@duikt.edu.ua', password: PASSWORD });
    assert.equal(r.status, 201);
    assert.equal(r.json.email, 'student@duikt.edu.ua');
    assert.equal(r.json.role, 'user');
    assert.ok(Number.isInteger(r.json.id));
    assert.doesNotMatch(r.text, /Sup3r-Secret-Pa55/, 'пароль не має повертатися у відповіді');
    assert.equal(r.json.password, undefined);
    assert.equal(r.json.passwordHash, undefined, 'хеш пароля теж не повертається');
  });
  test('email зі списку adminEmails отримує роль admin', async () => {
    const r = await s.call('POST', '/api/auth/register', { email: ADMIN, password: PASSWORD });
    assert.equal(r.status, 201);
    assert.equal(r.json.role, 'admin');
  });
  test('валідація: некоректний email і короткий пароль - 400 з details', async () => {
    const r = await s.call('POST', '/api/auth/register', { email: 'not-an-email', password: '123' });
    assert.equal(r.status, 400);
    assert.deepEqual((r.json.details ?? []).map((d) => d.field).sort(), ['email', 'password']);
  });
  test('повторна реєстрація того самого email - 409', async () => {
    assert.equal((await s.call('POST', '/api/auth/register', { email: 'student@duikt.edu.ua', password: PASSWORD })).status, 409);
  });
  test('POST /api/auth/login - 200 {token}; JWT із sub, role, exp', async () => {
    const r = await s.call('POST', '/api/auth/login', { email: 'student@duikt.edu.ua', password: PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.token, 'string');
    assert.equal(r.json.token.split('.').length, 3, 'токен має бути JWT з трьох частин');
    const p = decode(r.json.token);
    assert.ok(p.sub !== undefined, 'у payload має бути sub - id користувача');
    assert.equal(p.role, 'user');
    assert.ok(p.exp > Date.now() / 1000, 'у payload має бути exp у майбутньому');
  });
  test('неправильний пароль і неіснуючий email - 401', async () => {
    assert.equal((await s.call('POST', '/api/auth/login', { email: 'student@duikt.edu.ua', password: 'wrong-password' })).status, 401);
    assert.equal((await s.call('POST', '/api/auth/login', { email: 'nobody@duikt.edu.ua', password: PASSWORD })).status, 401);
  });
  test('GET /api/auth/me - поточний користувач за токеном', async () => {
    const { json } = await s.call('POST', '/api/auth/login', { email: 'student@duikt.edu.ua', password: PASSWORD });
    const me = await s.call('GET', '/api/auth/me', undefined, json.token);
    assert.equal(me.status, 200);
    assert.equal(me.json.email, 'student@duikt.edu.ua');
    assert.equal((await s.call('GET', '/api/auth/me')).status, 401);
  });
  test('паролі зберігаються в БД лише у вигляді хешу', () => {
    const bytes = fs.readFileSync(dbFile);
    assert.ok(!bytes.includes(Buffer.from(PASSWORD)), 'у файлі бази даних знайдено пароль у відкритому вигляді - його треба хешувати');
  });
});

describe('етап 6: захист маршрутів і ролі', () => {
  let s, userToken, adminToken;
  before(async () => {
    s = await safeStart(path.join(TMP, 'roles.db'), { secret: SECRET, adminEmails: [ADMIN] }, async (x) => {
      await x.call('POST', '/api/auth/register', { email: 'user@duikt.edu.ua', password: PASSWORD });
      await x.call('POST', '/api/auth/register', { email: ADMIN, password: PASSWORD });
      userToken = (await x.call('POST', '/api/auth/login', { email: 'user@duikt.edu.ua', password: PASSWORD })).json.token;
      adminToken = (await x.call('POST', '/api/auth/login', { email: ADMIN, password: PASSWORD })).json.token;
    });
  });
  after(() => s?.close());

  test('читання (GET) доступне без токена', async () => {
    assert.equal((await s.call('GET', '/api/categories')).status, 200);
    assert.equal((await s.call('GET', '/api/products')).status, 200);
  });
  test('категорії змінює лише admin: без токена - 401, user - 403, admin - 201', async () => {
    assert.equal((await s.call('POST', '/api/categories', { name: 'Поезія' })).status, 401);
    assert.equal((await s.call('POST', '/api/categories', { name: 'Поезія' }, userToken)).status, 403);
    assert.equal((await s.call('POST', '/api/categories', { name: 'Поезія' }, adminToken)).status, 201);
  });
  test('товари змінює будь-який автентифікований: без токена - 401, з токеном - 201/200/204', async () => {
    assert.equal((await s.call('POST', '/api/products', PRODUCT)).status, 401);
    const c = await s.call('POST', '/api/products', PRODUCT, userToken);
    assert.equal(c.status, 201);
    assert.equal((await s.call('PATCH', `/api/products/${c.json.id}`, { price: 1 })).status, 401);
    assert.equal((await s.call('PATCH', `/api/products/${c.json.id}`, { price: 1 }, userToken)).status, 200);
    assert.equal((await s.call('DELETE', `/api/products/${c.json.id}`)).status, 401);
    assert.equal((await s.call('DELETE', `/api/products/${c.json.id}`, undefined, userToken)).status, 204);
  });
  test('підроблений токен (змінено role на admin) - 401', async () => {
    const fake = tamper(userToken, { role: 'admin' });
    assert.equal((await s.call('POST', '/api/categories', { name: 'Хак' }, fake)).status, 401);
    assert.equal((await s.call('GET', '/api/auth/me', undefined, fake)).status, 401);
  });
  test('токен, підписаний іншим секретом, і сміття замість токена - 401', async () => {
    assert.equal((await s.call('GET', '/api/auth/me', undefined, 'abc.def.ghi')).status, 401);
    assert.equal((await s.call('GET', '/api/auth/me', undefined, 'not-a-token')).status, 401);
  });
  test('помилки автентифікації - JSON з полем error', async () => {
    const r = await s.call('POST', '/api/products', PRODUCT);
    assert.equal(typeof r.json?.error, 'string');
  });
});

describe('етап 6: термін дії токена', () => {
  test('після закінчення tokenTtl токен не приймається - 401', async () => {
    const s = await safeStart(path.join(TMP, 'ttl.db'), { secret: SECRET, tokenTtl: 1 });
    try {
      await s.call('POST', '/api/auth/register', { email: 'ttl@duikt.edu.ua', password: PASSWORD });
      const { json } = await s.call('POST', '/api/auth/login', { email: 'ttl@duikt.edu.ua', password: PASSWORD });
      assert.equal((await s.call('GET', '/api/auth/me', undefined, json.token)).status, 200);
      await new Promise((r) => setTimeout(r, 2100));
      assert.equal((await s.call('GET', '/api/auth/me', undefined, json.token)).status, 401);
    } finally { s.close(); }
  });
});
