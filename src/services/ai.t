import { Genre, GENRES, AgeGroup } from "../config/worlds";

const MIN_REQUEST_INTERVAL = 1000;

function resolveGenre(mode: string) {
  const normalized = mode === "fairy_tale" ? "fairytale" : mode;
  return GENRES[normalized as Genre] || GENRES.fairytale;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

let lastRequestTime = 0;

class RequestQueue {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      // Issue 5: Catch errors from processQueue
      this.processQueue().catch((err) => {
        console.error("[RequestQueue] processQueue error:", err);
      });
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
          await sleep(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
        }

        lastRequestTime = Date.now();
        await task();

        await sleep(MIN_REQUEST_INTERVAL);
      }
    }

    this.processing = false;
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  isProcessing(): boolean {
    return this.processing;
  }
}

const requestQueue = new RequestQueue();

export async function callLocalApi<T>(endpoint: string, body: any): Promise<T> {
  return requestQueue.add(async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    return response.json();
  });
}

export interface ChapterResponse {
  title: string;
  narration_text: string;
  scene_image_prompt: string;
  choices: Array<{ text: string }>;
  state_summary_end: string;
}

export interface WorldSetupOption {
  world: {
    id?: string;
    name: string;
    description_short: string;
    description_long: string;
    world_rules?: string;
    visual_style?: string;
    cover_image_prompt?: string;
    hero_description?: string;
    conflict_description?: string;
  };
  worldImage: string;
}

const DEFAULT_WORLD_OPTION: WorldSetupOption = {
  world: {
    name: "Волшебный мир",
    description_short: "Таинственный мир",
    description_long: "Таинственный мир"
  },
  worldImage: ""
};

/**
 * Генерировать текст главы
 */
export async function generateChapter(
  worldMode: Genre,
  worldBible: string,
  heroBible: string,
  antagonistBible: string,
  stateSummary: string,
  choiceText?: string
): Promise<ChapterResponse> {
  const world = resolveGenre(worldMode);
  const systemPrompt = `Ты — автор детских историй в жанре "${world.name}".
Конфликт главы: ${world.conflictType}.
Сохраняй мягкий тон и ясность.
Возвращай только валидный JSON по схеме. Никакого текста вне JSON.
Используй русский язык.`;

  const prompt = `Напиши следующую главу истории.
Мир: ${worldBible}.
Герой: ${heroBible}.
Антагонист: ${antagonistBible}.
Текущее состояние: ${stateSummary}.
${choiceText ? `Выбор читателя: ${choiceText}` : "Это первая глава."}

Длина текста: 800-1200 символов.
Верни JSON: title, narration_text, scene_image_prompt, choices (ровно 3), state_summary_end.`;

  const response = await callLocalApi<any>("/api/ai/generate-chapter", {
    worldMode,
    systemPrompt,
    prompt,
    clientRequestId: createRequestId(),
  });

  console.log("[generateChapter] Server response:", response);

  // Issue 7: Validate required fields and normalize choice format
  if (!response.title || !response.narration_text || !Array.isArray(response.choices) || response.choices.length === 0) {
    throw new Error("Invalid chapter response: missing required fields (title, narration_text, or choices)");
  }

  console.log("[generateChapter] Raw choices:", response.choices);

  // Normalize choices: server sends button_text but we expect text
  const normalizedChoices = response.choices.map((c: any, index: number) => ({
    id: `choice-${index + 1}`,
    text: c.text || c.button_text || "",
  }));

  console.log("[generateChapter] Normalized choices:", normalizedChoices);

  return {
    title: response.title,
    narration_text: response.narration_text,
    scene_image_prompt: response.scene_image_prompt || "",
    choices: normalizedChoices,
    state_summary_end: response.state_summary_end || "",
  };
}

/**
 * Генерировать картинку (prompt уже содержит стиль от клиента)
 */
export async function generateImage(prompt: string, styleSuffix?: string): Promise<string> {
  const fullPrompt = styleSuffix ? `${prompt}. ${styleSuffix}` : prompt;
  const result = await callLocalApi<{ imageUrl: string }>("/api/ai/generate-image", {
    prompt: fullPrompt,
  });

  if (!result?.imageUrl) {
    throw new Error("No image URL returned");
  }

  return result.imageUrl;
}

/**
 * Генерировать мир, героя и антагониста одновременно
 */
export async function generateWorldSetup(
  worldMode: Genre,
  valueTheme?: string,
  ageGroup: AgeGroup = "auto"
): Promise<WorldSetupOption[]> {
  const world = resolveGenre(worldMode);
  const response = await callLocalApi<{ world_options?: Array<any> }>("/api/ai/generate-world", {
    genre: world.name,
    ageGroup,
    valueTheme,
    clientRequestId: createRequestId(),
  });

  const options = Array.isArray(response?.world_options) ? response.world_options : [];

  const trimmed = options.slice(0, 3);
  const resolvedOptions: WorldSetupOption[] = await Promise.all(
    trimmed.map(async (option) => {
      const resolvedWorld: WorldSetupOption["world"] = {
        id: option?.id,
        name: option?.name || "Волшебный мир",
        description_short: option?.description_short || option?.description_long || option?.name || "Таинственный мир",
        description_long: option?.description_long || option?.description_short || option?.name || "Таинственный мир",
        world_rules: option?.world_rules,
        visual_style: option?.visual_style,
        cover_image_prompt: option?.cover_image_prompt,
        hero_description: option?.hero_description,
        conflict_description: option?.conflict_description,
      };
      const prompt = resolvedWorld.cover_image_prompt || resolvedWorld.description_short;
      const worldImage = await generateImage(prompt, world.imageStyleSuffix).catch(() => "");
      
      return {
        world: resolvedWorld,
        worldImage,
      };
    })
  );

  while (resolvedOptions.length < 3) {
    resolvedOptions.push(resolvedOptions[resolvedOptions.length - 1] || DEFAULT_WORLD_OPTION);
  }

  return resolvedOptions;
}

export async function generateAntagonist(
  worldMode: Genre,
  worldDescription: string,
  heroDescription: string
): Promise<{ antagonistDescription: string; antagonistImage: string }> {
  const world = resolveGenre(worldMode);
  const descriptionSystemPrompt = `Ты создаёшь краткие описания для детских историй. Возвращай только валидный JSON с полем "description". Используй русский язык.`;
  const response = await callLocalApi<{ description: string }>("/api/ai/generate-chapter", {
    worldMode,
    systemPrompt: descriptionSystemPrompt,
    prompt: `Создай описание антагониста или препятствия для истории в жанре "${world.name}". Мир: ${worldDescription}. Герой: ${heroDescription}. Это не обязательно враг, может быть загадкой или испытанием. Верни JSON с полем "description".`,
    clientRequestId: createRequestId(),
  });
  const antagonistDescription = response.description || "Испытание";
  const antagonistImage = await generateImage(antagonistDescription, world.imageStyleSuffix).catch(() => "");
  return { antagonistDescription, antagonistImage };
}

export async function generateHeroAndAntagonist(
  worldMode: Genre,
  worldDescription: string
): Promise<{ heroDescription: string; heroImage: string; antagonistDescription: string; antagonistImage: string }> {
  const world = resolveGenre(worldMode);
  const descriptionSystemPrompt = `Ты создаёшь краткие описания для детских историй. Возвращай только валидный JSON с полем "description". Используй русский язык.`;
  const [heroResp, antagonistResp] = await Promise.all([
    callLocalApi<{ description: string }>("/api/ai/generate-chapter", {
      worldMode,
      systemPrompt: descriptionSystemPrompt,
      prompt: `Создай описание главного героя для истории в жанре "${world.name}". Мир: ${worldDescription}. Верни JSON с полем "description".`,
      clientRequestId: createRequestId(),
    }),
    callLocalApi<{ description: string }>("/api/ai/generate-chapter", {
      worldMode,
      systemPrompt: descriptionSystemPrompt,
      prompt: `Создай описание антагониста или препятствия для истории в жанре "${world.name}". Мир: ${worldDescription}. Это не обязательно враг, может быть загадкой или испытанием. Верни JSON с полем "description".`,
      clientRequestId: createRequestId(),
    }),
  ]);
  const heroDescription = heroResp.description || "Доблестный герой";
  const antagonistDescription = antagonistResp.description || "Испытание";
  const [heroImage, antagonistImage] = await Promise.all([
    generateImage(heroDescription, world.imageStyleSuffix).catch(() => ""),
    generateImage(antagonistDescription, world.imageStyleSuffix).catch(() => ""),
  ]);
  return { heroDescription, heroImage, antagonistDescription, antagonistImage };
}

/**
 * Получить информацию об очереди (для отладки)
 */
export function getQueueStats() {
  return {
    queueSize: requestQueue.getQueueSize(),
    queueProcessing: requestQueue.isProcessing(),
  };
}
