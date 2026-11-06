# WU JI — Undermind / Uppermind OS

Лендинг «Undermind / Uppermind OS — Universal AI Skill Presets».

Основа лендинга восстановлена с задеплоенной сборки: разметка, тексты, стили,
анимации и ассеты. Добавлено рабочее пространство WUJI с сохранением этой эстетики.

## Стек

- Vite 7 + React 19 + TypeScript
- Tailwind CSS 3 (+ tailwindcss-animate)
- GSAP 3.15 + ScrollTrigger — анимации секций
- Lenis — плавный скролл
- react-router-dom — маршруты `/` и `/workspace`

## Запуск

```bash
npm install
npm run dev
```

Сборка: `npm run build`, предпросмотр сборки: `npm run preview`.

## Рабочее пространство WUJI

На `/workspace` находится первая интерактивная версия: исходное расписание,
задача и условия, варианты результата. Вход — `WORKSPACE ↗` в навигации.
Сохранены текущий визуальный стиль, палитра, шрифты, графика и CRT-оформление.

Демонстрационные данные и варианты синтетические. Через `[+ ИМПОРТ]` можно
загрузить CSV/XLSX в локальный сервер, подтвердить исходник, сохранять версии
условий и просматривать историю. Сохранённые условия рассчитываются OR-Tools
в отдельном процессе, варианты проходят независимую серверную проверку.
Работают отмена, история запусков и закрепление части варианта с новым расчётом.
Добавлен серверный адаптер OpenAI: текст становится отдельным черновиком
условий, который нужно проверить и подтвердить перед расчётом. Работают вопросы,
отмена, история и учёт доступного usage. Реализация проверена без живого API;
успешное подключение провайдера ещё не подтверждено. Ручные правки создают
отдельные версии с повторной проверкой. Проверенный вариант можно утвердить
и выдать в CSV/XLSX с историей решения и контрольной суммой файла.

Для собственных данных нужны PostgreSQL 16+, Python 3.12 и `uv`:

```bash
npm run api
```

Затем в другом терминале `npm run dev`. API автоматически поднимает отдельный
локальный кластер, применяет миграции и запускает worker. Данные сохраняются в игнорируемом
Git каталоге `.wuji-data/`.

Контракт импорта, версия источника и проверенные сценарии: [docs/DATA_STAGE.md](docs/DATA_STAGE.md).
Устройство сервера: [backend/README.md](backend/README.md).
Расчёт, ограничения, статусы и проверенные суммы: [docs/CALCULATION_STAGE.md](docs/CALCULATION_STAGE.md).
Текстовые черновики, настройка ключа, стоимость и проверка без API: [docs/INTENT_STAGE.md](docs/INTENT_STAGE.md).
Ручные версии, утверждение, экспорт и граница локального пилота: [docs/APPROVAL_STAGE.md](docs/APPROVAL_STAGE.md).

Полный цикл с явно обозначенным контрольным ответом можно открыть через
`npm run ai:preview` и `npm run dev` в разных терминалах. Контрольный API
занимает порт 8000 вместо обычного API и использует отдельную временную базу.
Ключ не нужен. Настоящий адаптер получает OPENAI_API_KEY только из окружения сервера.

Контракт, контрольные суммы и сценарий проверки: [docs/WORKSPACE_DEMO.md](docs/WORKSPACE_DEMO.md).
Порядок следующих этапов: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

Проверки (Node.js 22.6+, проверено на 22.22.3):

```bash
npm test
npm run test:api
npm run api:types:check
npm run build
# Либо весь набор одной командой:
npm run check
```

Исходные синтетические CSV/JSON находятся в `docs/examples/`.
После изменения demo-данных их можно обновить командой `npm run demo:fixtures`.

Добавлен GitHub Actions workflow в `.github/workflows/verify.yml`; первый удалённый
запуск на Ubuntu 24.04 прошёл на `89ce49e`. Общий многопользовательский пилот
потребует аутентификации и изоляции рабочих областей; текущая версия запускается
локально.

## Структура

```
src/
├── main.tsx                     точка входа
├── App.tsx                      роутинг
├── index.css                    базовые стили, CRT-тема
├── pages/Home.tsx               сборка лендинга, Lenis
├── pages/Workspace.tsx          три области рабочего пространства
├── features/workspace/         demo-данные, типы, расчёты и компоненты workspace
├── components/
│   ├── Navigation.tsx           шапка, мобильное меню
│   ├── BrandMark.tsx            общий логотип с исходной разметкой
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
