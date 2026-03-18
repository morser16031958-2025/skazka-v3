# Схема запросов к моделям (текущая логика)

Пример: жанр = "Русские народные" (fairytale), возраст = "3-5", ценность = "доброта".

## 1) Генерация миров (как сейчас)

### 1.1 Клиент делает 3 запроса подряд
POST `/api/ai/generate-world`
```json
{
  "genre": "Русские народные",
  "ageGroup": "3-5",
  "valueTheme": "доброта",
  "clientRequestId": "world-0-<timestamp>"
}
```

### 1.2 System prompt (server.ts: DEFAULT_SYSTEM_INSTRUCTION)
```
Ты — популярный детский писатель, чутко понимающий психологию ребёнка, создающий понятные, яркие и волшебные сказки.

## Стиль повествования
Используй технику "Зуммирования": описывай детали мира — архитектуру, запахи, звуки, текстуры, историю предметов —
чтобы каждая сцена была живой и чувственной.
Не заполняй объём водой — каждая деталь должна работать на атмосферу или сюжет.

## Правила
- Учитывай возраст (age_group):
  3-5 — простые яркие образы, короткие предложения, повторы;
  6-8 — яркие образы с деталями: запах, цвет, звук;
  9-12 — пиши как для взрослого, но в сказочном жанре;
  auto — выбери стиль сам исходя из жанра.
- Показывай ценность через события и поступки, без морали в лоб.
- Конфликт в духе жанра.
- Используй русский язык.
- Возвращай только валидный JSON.
- РОВНО 3 варианта выборов.
```

### 1.3 User prompt для /api/ai/generate-world (server.ts)
```
Ты знаменитый детский писатель тонко понимающий разные жанры сказок и особенности возраста детей, создающий необычно яркие и волшебные образы. Сгенерируй РОВНО 3 варианта волшебного мира.
Каждый вариант должен быть УНИКАЛЬНЫМ —
разные названия, разные правила, разная атмосфера.
Жанр: Русские народные.
Возраст: 3-5.
Ценность: доброта.
Антиценность: (вычисляется сервером, если не задано)

Верни JSON с полем world_options — массив из РОВНО 3
объектов, каждый с полями:
id, name, description_short, description_long,
world_rules, visual_style, cover_image_prompt,
hero_description, conflict_description.

ВАЖНО: все 3 мира должны отличаться друг от друга!
```

### 1.4 Клиент берёт только world_options[0]
Так происходит 3 раза, из-за чего миры часто повторяются.

## 2) Генерация картинок миров

Клиент вызывает `generateImage(prompt, styleSuffix)`:
POST `/api/ai/generate-image`
```json
{
  "prompt": "<cover_image_prompt>. russian folk art, Palekh style, warm gold crimson"
}
```

Сервер отправляет запрос в N1N (Gemini image).

## 3) Генерация героя и антагониста (картинки)

POST `/api/ai/generate-image`
```json
{
  "prompt": "<hero_description>. russian folk art, Palekh style, warm gold crimson"
}
```

POST `/api/ai/generate-image`
```json
{
  "prompt": "<conflict_description>. russian folk art, Palekh style, warm gold crimson"
}
```

## 4) Генерация первой главы

### 4.1 System prompt (src/services/ai.ts)
```
Ты — автор детских историй в жанре "Русские народные".
Конфликт главы: испытание.
Сохраняй мягкий тон и ясность.
Возвращай только валидный JSON по схеме. Никакого текста вне JSON.
Используй русский язык.
```

### 4.2 User prompt (src/services/ai.ts)
```
Напиши следующую главу истории.
Мир: <worldDescription>.
Герой: <heroDescription>.
Антагонист: <antagonistDescription>.
Текущее состояние: История только начинается.
Это первая глава.

Длина текста: 800-1200 символов.
Верни JSON строго по схеме:
{
  "title": "...",
  "narration_text": "...",
  "scene_image_prompt": "...",
  "choices": [{"text": "..."}, {"text": "..."}, {"text": "..."}],
  "state_summary_end": "..."
}
choices — ровно 3 объекта с полем text.
```

### 4.3 Запрос клиента
POST `/api/ai/generate-chapter`
```json
{
  "worldMode": "fairytale",
  "systemPrompt": "<system prompt выше>",
  "prompt": "<user prompt выше>",
  "clientRequestId": "req_<uuid>"
}
```

## 5) Генерация картинки сцены главы

POST `/api/ai/generate-image`
```json
{
  "prompt": "<scene_image_prompt>. russian folk art, Palekh style, warm gold crimson"
}
```

## Итого: какие модели используются
- Текстовые запросы (`generate-world`, `generate-chapter`) → OpenRouter (по умолчанию gemini-2.5-flash)
- Картинки (`generate-image`) → N1N (gemini-2.5-flash-image)
