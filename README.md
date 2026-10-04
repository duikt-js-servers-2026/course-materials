# Матеріали курсу «JavaScript у створенні серверів»

Умови й автотести етапів наскрізного проєкту. Кожен етап виконується **у вашому власному репозиторії**, створеному на етапі 1 із шаблону [stage1-calc-template](https://github.com/duikt-js-servers-2026/stage1-calc-template).

| Етап | Умова | Тести |
|---|---|---|
| 1 | у шаблоні етапу 1 | `test/cli.test.js` |
| 2 | [docs/stage2.md](docs/stage2.md) | `test/stage2.test.js` |

## Як додати новий етап у свій репозиторій

Один раз підключіть цей репозиторій як додаткове джерело:

```bash
git remote add course https://github.com/duikt-js-servers-2026/course-materials.git
```

Щоразу, коли викладач оголошує новий етап (приклад для етапу 2):

```bash
git fetch course
git checkout course/main -- docs/stage2.md test/stage2.test.js test/fixtures
git commit -m "Етап 2: умова та тести"
git push
```

Команда `git checkout course/main -- <файли>` лише копіює вказані файли у ваш проєкт — ваш код вона не змінює.
