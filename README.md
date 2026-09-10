# WU JI — Undermind / Uppermind OS

Лендинг «Undermind / Uppermind OS — Universal AI Skill Presets».

Исходники восстановлены 1:1 с задеплоенной сборки: разметка, тексты, стили,
анимации и ассеты перенесены без изменений.

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
├── pages/Home.tsx               сборка страницы, Lenis
├── components/
│   ├── Navigation.tsx           шапка, мобильное меню
│   ├── ScanlineOverlay.tsx      CRT-развёртка поверх страницы
│   ├── ProgressiveCodeCanvas.tsx цифровой дождь (canvas, 4 фазы)
│   ├── Typewriter.tsx           посимвольный набор текста
│   ├── SectionLabel.tsx         подпись секции
│   ├── SkillCard.tsx            карточка скилла
│   └── Footer.tsx               подвал
└── sections/
    ├── OSSelectorSection.tsx    выбор OS, GSAP-переключение панелей
    ├── HeroSection.tsx          заголовок
    ├── SkillGridSection.tsx     сетка скиллов с фильтрами
    ├── TerminalPreviewSection.tsx имитация установки в терминале
    └── StatsSection.tsx         счётчики
```

## Заглушки

Всё ниже перенесено из оригинала как есть — реальных адресов там нет,
везде стоит `https://github.com`:

| Место | Файл |
| --- | --- |
| Пункты меню `DOCS`, `GITHUB` | `src/components/Navigation.tsx` |
| Кнопка `INSTALL_UPPERMIND_OS →` | `src/sections/OSSelectorSection.tsx` |
| Кнопка `INSTALL_UNDERMIND_OS →` | `src/sections/OSSelectorSection.tsx` |
| Ссылка `INSTALL_→` в каждой карточке | `src/components/SkillCard.tsx` |
| Кнопки `EXPLORE_ON_GITHUB →` и `READ_DOCS →` | `src/sections/TerminalPreviewSection.tsx` |
