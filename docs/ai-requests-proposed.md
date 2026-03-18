# Схема запросов к моделям (предлагаемая логика)

Цель: убрать повторы миров и добиться тематического разнообразия.
Пример: жанр = "Русские народные" (fairytale), возраст = "3-5", ценность = "доброта".

## 1) Генерация миров (ОДИН запрос, 3 мира в ответе)

### 1.1 Клиент делает 1 запрос
POST `/api/ai/generate-world`
```json
{
  "genre": "Русские народные",
  "ageGroup": "3-5",
  "valueTheme": "доброта",
  "clientRequestId": "world-<timestamp>"
}
```

### 1.2 System prompt (без изменений, server.ts: DEFAULT_SYSTEM_INSTRUCTION)
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

### 1.3 User prompt (улучшенный, с тематическим разнообразием)
```
Сгенерируй РОВНО 3 мира. Они должны быть СИЛЬНО разными тематически:
- разные центральные темы (theme_tag),
- разные центральные образы/метафоры,
- разные среды/локации,
- разные типы конфликтов.

Жанр: Русские народные.
Возраст: 3-5.
Ценность: доброта.
Антиценность: (вычисляется сервером, если не задано)

Верни JSON:
world_options: [
 {id, name, theme_tag, theme_summary,
  description_short, description_long,
  world_rules, visual_style, cover_image_prompt,
  hero_description, conflict_description},
 ... (ровно 3)
]

ВАЖНО:
- theme_tag у всех 3 должен быть разный
- ключевые образы/локации не должны повторяться
```

### 1.4 Клиент использует все 3 мира
`world_options[0..2]` без дополнительных запросов.

## 2) Генерация картинок миров (без изменений)

POST `/api/ai/generate-image`
```json
{
  "prompt": "<cover_image_prompt>. russian folk art, Palekh style, warm gold crimson"
}
```

## 3) Генерация героя и антагониста (без изменений)

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

## 4) Генерация первой главы (без изменений)

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

## 5) Генерация картинки сцены главы (без изменений)

POST `/api/ai/generate-image`
```json
{
  "prompt": "<scene_image_prompt>. russian folk art, Palekh style, warm gold crimson"
}
```

## Итого: какие модели используются
- Текстовые запросы (`generate-world`, `generate-chapter`) → OpenRouter (по умолчанию gemini-2.5-flash)
- Картинки (`generate-image`) → N1N (gemini-2.5-flash-image)
