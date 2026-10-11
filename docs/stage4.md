# Етап 4. HTTP-сервер: модуль http і Express

Дисципліна «JavaScript у створенні серверів» · наскрізний проєкт · **етап 4 з 6** (5 балів; захищається на заліку)

Етап виконується **у тому самому репозиторії**, що й етапи 1-3. Попередні утиліти й тести мають і далі проходити.

Ідея етапу: ваші дані з етапу 2 стають доступними через HTTP. Спершу ви пишете сервер на «голому» модулі `http`, щоб побачити, що відбувається всередині, а потім той самий API - на Express. Обидва сервери мають поводитися **однаково**: тести перевіряють їх одним і тим самим набором запитів.

## 0. Підготовка

```bash
git fetch course
git checkout course/main -- docs/stage4.md test/stage4.test.js .github/workflows/tests.yml
npm install express
git add package.json package-lock.json
git commit -m "Етап 4: умова, тести, express"
```

Оновлений `.github/workflows/tests.yml` встановлює залежності перед запуском тестів на GitHub - без нього тести з Express у вкладці Actions не запустяться. Папку `node_modules` не комітьте (додайте її в `.gitignore`).

## 1. Контракт API

Однаковий для обох серверів. Дані - з вашого `data/items.json` (етап 2); фільтрацію й статистику беріть із свого `src/query.js`.

| Запит | Відповідь |
|---|---|
| `GET /health` | `200` `{ "status": "ok" }` |
| `GET /api/items` | `200` масив усіх записів |
| `GET /api/items?category=…&minPrice=…&maxPrice=…` | `200` відфільтрований масив (незадані параметри ігноруються, межі включні) |
| `GET /api/items/:id` | `200` запис; `404`, якщо такого id немає; `400`, якщо id - не ціле додатне число |
| `GET /api/stats` (необов’язково `?category=`) | `200` результат `stats` |
| невідомий маршрут під `/api/...` | `404` |
| інший метод (POST, PUT, DELETE…) на маршрутах API | `405` із заголовком `Allow`, що містить `GET` |
| `OPTIONS` на маршрутах API (preflight) | `204`, заголовок `Access-Control-Allow-Methods` містить `GET` |

Загальні вимоги:
- усі відповіді API - JSON із заголовком `Content-Type: application/json`;
- усі помилки - JSON вигляду `{ "error": "зрозумілий опис" }`;
- некоректне число у `minPrice` / `maxPrice` - `400`;
- відповіді API містять CORS-заголовок `Access-Control-Allow-Origin: *`.

### Статичні файли

Усе, що не `/health` і не `/api/...`, віддається з папки `public`:
- `GET /` - `public/index.html`;
- інші файли - за шляхом, з правильним `Content-Type` (`text/html`, `text/css`, `text/javascript`, зображення);
- неіснуючий файл - `404`;
- **запит не може вийти за межі папки `public`**: `/..%2fpackage.json` і подібні шляхи не мають віддавати файли проєкту. Тести це перевіряють.

Створіть `public/index.html` - просту сторінку про вашу предметну область (за бажанням - з JavaScript, який показує дані з `/api/items`).

## 2. Сервер на модулі http - `src/http-server.js`

Без Express і без сторонніх пакетів, лише `node:http`, `node:fs`, `node:path`.

```js
module.exports = { createServer };
// createServer({ dataFile, publicDir }) -> http.Server (ще не запущений)
```

- `dataFile` - шлях до JSON із даними, за замовчуванням `data/items.json`;
- `publicDir` - папка зі статикою, за замовчуванням `public`;
- функція **не** викликає `listen` - це робить код запуску, а тести запускають сервер самі.

Запуск: `node src/http-server.js` (порт з `PORT`, за замовчуванням 3000) - для цього наприкінці файлу:

```js
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`http://localhost:${port}`));
}
```

## 3. Той самий API на Express - `src/app.js`

```js
module.exports = { createApp };
// createApp({ dataFile, publicDir }) -> Express-застосунок (app), без listen
```

Вимоги:
- маршрути через `express.Router()`;
- статика через `express.static`;
- **дві власні middleware** (написані вами, не з npm):
  - CORS для API: заголовки й відповідь `204` на `OPTIONS`;
  - `X-Response-Time`: кожна відповідь (і API, і статика, і помилки) має заголовок із часом обробки у форматі `12.34ms`;
- **централізована обробка помилок**: middleware з чотирма параметрами `(err, req, res, next)`, яка перетворює помилки на JSON-відповідь із правильним кодом.

Запуск - так само, через `require.main === module`, і додайте в `package.json` скрипт `"start": "node src/app.js"`.

## Перевірка

```bash
npm test
```

Тести етапу - у `test/stage4.test.js` (не змінюйте їх). Вони самі запускають обидва сервери на вільному порту з тестовими даними. Етап готовий до захисту, коли проходять усі тести - етапів 1-4.

Перевірте й руками: запустіть сервер і відкрийте у браузері `http://localhost:3000/` і `http://localhost:3000/api/items`, або надішліть запити через `curl -i`.
