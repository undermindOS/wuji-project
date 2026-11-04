# WuJi

Лендинг WuJi: решения с ИИ, которые можно проверить. Оформление и анимации
сохранены с восстановленной сборки (CRT, цифровой дождь), тексты описывают продукт.

## Стек

- Vite 7 + React 19 + TypeScript
- Tailwind CSS 3 (+ tailwindcss-animate)
- GSAP 3.15 + ScrollTrigger — анимации секций
- Lenis — плавный скролл
- react-router-dom — роутинг (одна страница `/`)

## Запуск

```bash
npm install
npm run dev
```

Сборка: `npm run build`, предпросмотр сборки: `npm run preview`.

## Структура

```
src/
├── main.tsx                     точка входа
├── App.tsx                      роутинг
├── index.css                    базовые стили, CRT-тема
├── pages/Home.tsx               сборка лендинга, Lenis
├── components/
│   ├── Navigation.tsx           шапка, мобильное меню
│   ├── ScanlineOverlay.tsx      CRT-развёртка поверх страницы
│   ├── ProgressiveCodeCanvas.tsx цифровой дождь (canvas, 4 фазы)
│   ├── Typewriter.tsx           посимвольный набор текста
│   ├── SectionLabel.tsx         подпись секции
│   └── Footer.tsx               подвал
└── sections/
    ├── HeroSection.tsx          WU JI и обещание продукта
    ├── ContrastSection.tsx      Black Box против WuJi
    ├── EvidenceSection.tsx      пять меток доказательств
    ├── RunLogSection.tsx        журнал запуска, синтетические данные
    └── StatsSection.tsx         счётчики
```

## Деплой на Vercel

Продакшен: **https://wuji-project.vercel.app**

В репозитории лежит `vercel.json`: фреймворк `vite`, сборка `npm run build`,
каталог `dist`, плюс rewrite всех путей на `index.html` — чтобы прямой заход по
адресу отдавал приложение, а не 404.

Подключение (один раз):

1. Открыть [vercel.com/new](https://vercel.com/new) и выбрать репозиторий
   `undermindOS/wuji-project` — или сразу по прямой ссылке:
   [vercel.com/new/git/external?repository-url=https://github.com/undermindOS/wuji-project](https://vercel.com/new/git/external?repository-url=https://github.com/undermindOS/wuji-project)
2. Настройки не трогать — Vercel прочитает их из `vercel.json`.
3. Нажать **Deploy**.

Дальше деплой автоматический: push в `main` — продакшен, push в любую другую
ветку — preview-сборка со своим адресом.

### Про пути к ассетам

В `vite.config.ts` стоит `base: '/'` — пути в сборке абсолютные (`/assets/…`,
`/images/…`). Вместе с rewrite это значит, что приложение корректно поднимается
с любого адреса, включая вложенные маршруты вида `/docs/intro`.

В оригинальной сборке на kimi.page стоял относительный `base: './'`; при нём
вложенные маршруты ломали загрузку ассетов, поэтому для Vercel он заменён.
Если проект когда-нибудь понадобится отдавать не из корня домена, а из подпапки —
относительный `base` придётся вернуть.
