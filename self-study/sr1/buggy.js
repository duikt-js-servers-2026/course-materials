// Самостійна робота 1. Знайдіть і виправте 3 помилки за допомогою налагоджувача.
// Запуск: node self-study/sr1/buggy.js
// Очікуваний правильний вивід наведено в self-study/sr1/README.md.

const students = [
  { name: 'Олена', scores: ['90', '85', '100'] },
  { name: 'Тарас', scores: ['70', '65', '80'] },
  { name: 'Ірина', scores: ['95', '90', '88'] },
];

// Середній бал студента, округлений до 2 знаків.
function average(scores) {
  let sum = 0;
  for (let i = 0; i <= scores.length; i++) {
    sum += scores[i];
  }
  return Math.round((sum / scores.length) * 100) / 100;
}

// Звіт: рядок для кожного студента, нумерація з 1.
function report(list) {
  const lines = [];
  for (var i = 0; i < list.length; i++) {
    lines.push(() => `${i + 1}. ${list[i].name}: ${average(list[i].scores)}`);
  }
  return lines.map((makeLine) => makeLine());
}

console.log(report(students).join('\n'));
