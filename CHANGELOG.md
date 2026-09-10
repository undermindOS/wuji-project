# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [Unreleased]

### Добавлено

- `vercel.json` — конфигурация деплоя на Vercel (framework `vite`, сборка в `dist`,
  rewrite всех путей на `index.html`).
- Раздел «Деплой на Vercel» в `README.md`.
- Продакшен развёрнут: https://wuji-project.vercel.app (автодеплой из `main`).

### Изменено

- `base` в `vite.config.ts`: `'./'` → `'/'`. Пути к ассетам в сборке стали
  абсолютными, вложенные маршруты больше не ломают загрузку JS, CSS и картинок.

## [0.1.0] - 2026-09-10

### Добавлено

- Исходники лендинга, восстановленные 1:1 с задеплоенной сборки: секции
  `OSSelector`, `Hero`, `SkillGrid`, `TerminalPreview`, `Stats`, навигация и подвал.
- Конфигурация Vite + React + TypeScript + Tailwind.
- Ассеты: `brain-bg.png`, `logo-head-mouth.png`, `cursor-win98.png`.
