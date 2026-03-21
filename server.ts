import express from "express";
import "dotenv/config";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const DB_PATH = path.join(__dirname, "tales.db");
const DATA_DIR = path.join(__dirname, "data");
const RESOLVED_DATA_DIR = path.resolve(DATA_DIR);
const IMAGES_DIR = path.join(DATA_DIR, "images");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const CHAPTER_CACHE_TTL = 2 * 60 * 1000;
const chapterRequestCache = new Map<string, { expiresAt: number; data: any }>();

function pruneChapterCache() {
  const now = Date.now();
  for (const [key, value] of chapterRequestCache) {
    if (value.expiresAt <= now) {
      chapterRequestCache.delete(key);
    }
  }
}

// Создаём папки для ассетов
fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Инициализация БД
let db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS stories (
    story_id TEXT PRIMARY KEY,
    created_at INTEGER,
    updated_at INTEGER,
    world_mode TEXT,
    age_label TEXT,
    world_description TEXT,
    hero_description TEXT,
    antagonist_description TEXT,
    world_image TEXT,
    hero_image TEXT,
    antagonist_image TEXT,
    title TEXT,
    chapters_json TEXT
  );

  CREATE TABLE IF NOT EXISTS chapters (
    node_id TEXT PRIMARY KEY,
    story_id TEXT,
    title TEXT,
    narration_text TEXT,
    scene_image_url TEXT,
    choices_json TEXT,
    state_summary TEXT,
    FOREIGN KEY(story_id) REFERENCES stories(story_id) ON DELETE CASCADE
  );
`);

const count = db.prepare("SELECT COUNT(*) as count FROM stories").get() as { count: number };
console.log(`Database initialized. Found ${count.count} stories.`);

// SQL injection protection: whitelist of valid column names
const VALID_COLUMNS = new Set([
  'story_id', 'created_at', 'updated_at', 'world_mode', 'age_label',
  'world_description', 'hero_description', 'antagonist_description',
  'world_image', 'hero_image', 'antagonist_image', 'title', 'chapters_json'
]);

// Проверяем и исправляем схему базы данных
try {
  // Проверяем существование колонки world_mode
  const tableInfo = db.prepare("PRAGMA table_info(stories)").all() as Array<{name: string, type: string}>;
  const hasWorldMode = tableInfo.some(col => col.name === 'world_mode');

  if (!hasWorldMode) {
    console.log("Adding missing world_mode column to stories table...");
    db.prepare("ALTER TABLE stories ADD COLUMN world_mode TEXT").run();
    console.log("Added world_mode column successfully.");
  }

  // Проверяем другие колонки (только из whitelist)
  const requiredColumns = ['age_label', 'world_description', 'hero_description', 'antagonist_description', 'world_image', 'hero_image', 'antagonist_image', 'chapters_json'];
  for (const column of requiredColumns) {
    if (!VALID_COLUMNS.has(column)) {
      console.warn(`Skipping unknown column: ${column}`);
      continue;
    }
    const hasColumn = tableInfo.some(col => col.name === column);
    if (!hasColumn) {
      console.log(`Adding missing ${column} column to stories table...`);
      db.prepare(`ALTER TABLE stories ADD COLUMN ${column} TEXT`).run();
      console.log(`Added ${column} column successfully.`);
    }
  }
} catch (e) {
  console.error("Error during database migration:", e);
}

// Хелпер: удалить файл ассета по пути из БД
function deleteAssetFile(assetPath: string | null) {
  if (!assetPath || assetPath.startsWith("data:")) return;
  try {
    const normalized = path.normalize(path.resolve(DATA_DIR, assetPath.replace("/assets/", "")));
    // Защита от path traversal: проверка что нормализованный путь находится в разрешённой директории
    const isInDataDir = normalized === RESOLVED_DATA_DIR || normalized.startsWith(RESOLVED_DATA_DIR + path.sep);
    if (!isInDataDir) return;
    if (fs.existsSync(normalized)) {
      fs.unlinkSync(normalized);
    }
  } catch (e) {
    console.warn("Failed to delete asset file:", assetPath, e);
  }
}

// --- Статика для ассетов (до Vite middleware!) ---
app.use("/assets", express.static(DATA_DIR, {
  maxAge: "7d",
  immutable: true,
}));

app.use("/backgrounds", express.static(path.join(__dirname, "public/backgrounds"), {
  maxAge: "7d",
  immutable: true,
}));

const jsonParserSmall = express.json({ limit: "5mb" });
const urlencodedParserSmall = express.urlencoded({ limit: "1mb", extended: true });

app.use((req, res, next) => {
  if (req.path === "/api/assets/upload") return next();
  jsonParserSmall(req, res, next);
});

app.use((req, res, next) => {
  if (req.path === "/api/assets/upload") return next();
  urlencodedParserSmall(req, res, next);
});

// Логирование запросов
app.use((req, res, next) => {
//    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const allowedUploadMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/webm"
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.mimetype?.startsWith("audio/")) return cb(null, AUDIO_DIR);
      return cb(null, IMAGES_DIR);
    },
    filename: (req, file, cb) => {
      const rawId = (req.body?.id || "asset").toString();
      const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const extFromMime = file.mimetype?.split("/")[1] || "";
      const extFromName = path.extname(file.originalname).replace(".", "");
      const ext = extFromMime || extFromName || "bin";
      cb(null, `${safeId}.${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (allowedUploadMimeTypes.has(file.mimetype)) return cb(null, true);
    cb(new Error("Unsupported file type"));
  },
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.post("/api/assets/upload", upload.single("file"), (req, res) => {
  try {
    const id = req.body?.id;
    const file = req.file;
    if (!id || !file) {
      return res.status(400).json({ error: "Missing id or file" });
    }
    const resolvedType = file.mimetype?.startsWith("audio/") ? "audio" : "image";
    const assetUrl = `/assets/${resolvedType}s/${file.filename}`;
    res.json({ assetUrl });
  } catch (e) {
    console.error("[POST /api/assets/upload] Error:", e);
    res.status(500).json({ error: "Failed to upload asset" });
  }
});

// API: Получить все истории
app.get("/api/stories", (req, res) => {
  try {
    const stories = db.prepare("SELECT * FROM stories ORDER BY updated_at DESC").all();
    const transformed = stories.map(transformStoryFromDB);
    console.log(`[API /stories] Returning ${transformed.length} stories`);
    transformed.slice(0, 3).forEach((s, idx) => {
      console.log(`  [${idx}] ${s.title} - worldMode: ${s.worldMode}, chapters: ${s.chapters?.length || 0}`);
    });
    res.json(transformed);
  } catch (e) {
    console.error("[API /stories] Error:", e);
    res.status(500).json({ error: "Failed to fetch stories" });
  }
});

function transformStoryFromDB(row: any) {
  const chapters = row.chapters_json ? JSON.parse(row.chapters_json) : [];
  const currentChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;
  
  return {
    id: row.story_id,
    title: row.title,
    worldMode: row.world_mode,
    ageLabel: row.age_label,
    worldDescription: row.world_description,
    heroDescription: row.hero_description,
    antagonistDescription: row.antagonist_description,
    worldImage: row.world_image,
    heroImage: row.hero_image,
    antagonistImage: row.antagonist_image,
    chapters,
    currentChapter,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// API: Получить конкретную историю
app.get("/api/stories/:id", (req, res) => {
  try {
    const story = db.prepare("SELECT * FROM stories WHERE story_id = ?").get(req.params.id);
    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }
    res.json(transformStoryFromDB(story));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch story" });
  }
});

// API: Сохранить/Обновить историю
app.post("/api/stories", (req, res) => {
  try {
    const {
      id,
      title,
      worldMode,
      ageLabel,
      worldDescription,
      heroDescription,
      antagonistDescription,
      worldImage,
      heroImage,
      antagonistImage,
      chapters,
      currentChapter,
      createdAt,
      updatedAt,
    } = req.body;

    const story_id = id;
    const created_at = createdAt || Date.now();
    const updated_at = updatedAt || Date.now();
    const world_mode = worldMode;
    const age_label = ageLabel;
    const world_description = worldDescription;
    const hero_description = heroDescription;
    const antagonist_description = antagonistDescription;
    const chapters_json = chapters || [];

    const processedWorldImage = worldImage;
    const processedHeroImage = heroImage;
    const processedAntagonistImage = antagonistImage;

    if (
      (processedWorldImage && processedWorldImage.startsWith("data:")) ||
      (processedHeroImage && processedHeroImage.startsWith("data:")) ||
      (processedAntagonistImage && processedAntagonistImage.startsWith("data:"))
    ) {
      return res.status(400).json({ error: "Base64 assets are not allowed. Upload via /api/assets/upload." });
    }

    db.prepare(`
      INSERT OR REPLACE INTO stories
      (story_id, created_at, updated_at, world_mode, age_label, world_description, hero_description, antagonist_description, world_image, hero_image, antagonist_image, title, chapters_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      story_id,
      created_at,
      updated_at,
      world_mode,
      age_label,
      world_description,
      hero_description,
      antagonist_description,
      processedWorldImage,
      processedHeroImage,
      processedAntagonistImage,
      title,
      JSON.stringify(chapters_json)
    );

    res.json({ success: true });
  } catch (e) {
    console.error("[POST /api/stories] Error:", e);
    res.status(500).json({ error: "Failed to save story", details: e instanceof Error ? e.message : String(e) });
  }
});

// API: Удалить историю
app.delete("/api/stories/:id", (req, res) => {
  try {
    const storyRow = db.prepare("SELECT * FROM stories WHERE story_id = ?").get(req.params.id) as any;
    if (storyRow) {
      const chapters = storyRow.chapters_json ? JSON.parse(storyRow.chapters_json) : [];
      const assetPaths = [
        storyRow.world_image,
        storyRow.hero_image,
        storyRow.antagonist_image,
        ...chapters.map((chapter: any) => chapter?.scene_image_url).filter(Boolean)
      ];
      assetPaths.forEach((assetPath: string) => deleteAssetFile(assetPath));
    }
    db.prepare("DELETE FROM chapters WHERE story_id = ?").run(req.params.id);
    db.prepare("DELETE FROM stories WHERE story_id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete story" });
  }
});

// AI API endpoints
const N1N_API_KEY = process.env.N1N_API_KEY;
const N1N_TEXT_MODEL = process.env.N1N_TEXT_MODEL || "gemini-2.5-flash";
const N1N_IMAGE_MODEL = process.env.N1N_IMAGE_MODEL || "gemini-2.5-flash-image";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_TEXT_MODEL = process.env.OPENROUTER_TEXT_MODEL || "google/gemini-2.5-flash";
const OPENROUTER_IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-3.1-flash-image-preview";
const AI_PROVIDER = (process.env.AI_PROVIDER || (OPENROUTER_API_KEY ? "openrouter" : "n1n")).toLowerCase();
const DEFAULT_SYSTEM_INSTRUCTION = `Ты — популярный детский писатель, чутко понимающий 
психологию ребёнка, создающий понятные, яркие и 
волшебные сказки. 

## Стиль повествования 
Используй технику "Зуммирования": описывай детали мира — 
архитектуру, запахи, звуки, текстуры, историю предметов — 
чтобы каждая сцена была живой и чувственной. 
Не заполняй объём водой — каждая деталь должна работать 
на атмосферу или сюжет. 

## Правила 
- Учитывай возраст (age_group): 
  3-5 — простые яркие образы, короткие предложения, повторы; 
  6-8 — яркие образы с деталями: запах, цвет, звук; 
  9-12 — пиши как для взрослого, но в сказочном жанре; 
  auto — выбери стиль сам исходя из жанра. 
- Показывай ценность через события и поступки, 
  без морали в лоб. 
- Конфликт в духе жанра. 
- Используй русский язык. 
- Возвращай только валидный JSON. 
- РОВНО 3 варианта выборов.`;

const ANTI_VALUE_MAP: Record<string, string> = {
  дружба: "эгоизм",
  смелость: "трусость",
  доброта: "грубость",
  любопытство: "равнодушие",
  честность: "хитрость",
  труд: "лень",
  уважение: "пренебрежение",
  ответственность: "безответственность"
};

function resolveAntiValue(valueTheme?: string) {
  if (!valueTheme) return undefined;
  const normalized = valueTheme.toLowerCase();
  for (const [key, value] of Object.entries(ANTI_VALUE_MAP)) {
    if (normalized.includes(key)) {
      return value;
    }
  }
  return undefined;
}

function cleanPromptText(value: unknown) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function tryParseJson(text: string): any | null {
  const trimmed = text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
  
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    console.log("[JSON] Direct parse failed, trying to fix...");
    
    let fixed = trimmed;
    
    const lastBrace = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (lastBrace > 0) {
      fixed = trimmed.substring(0, lastBrace + 1);
    }
    
    let openBraces = (fixed.match(/{/g) || []).length;
    let closeBraces = (fixed.match(/}/g) || []).length;
    let openBrackets = (fixed.match(/\[/g) || []).length;
    let closeBrackets = (fixed.match(/\]/g) || []).length;
    
    while (openBraces > closeBraces) {
      fixed += '}';
      closeBraces++;
    }
    while (openBrackets > closeBrackets) {
      fixed += ']';
      closeBrackets++;
    }
    
    fixed = fixed.replace(/,\s*([\]}])/g, '$1');
    
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      console.log("[JSON] Failed to fix, trying regex extraction...");
      
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e3) {}
      }
      
      const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch (e3) {}
      }
      
      return null;
    }
  }
}

async function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function callN1nJson(prompt: string, systemPrompt: string, model: string = N1N_TEXT_MODEL) {
  if (!N1N_API_KEY) throw new Error("N1N API Key not configured");

  let lastError = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
      console.log(`[N1N] Retry ${attempt + 1}/3 after ${delay}ms...`);
      await sleep(delay);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const resp = await fetch("https://api.n1n.ai/v1/chat/completions", {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${N1N_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" },
          max_tokens: 4000
        })
      });

      clearTimeout(timeoutId);

      if (resp.status === 401 || resp.status === 403) {
        throw new Error(`N1N API auth error (${resp.status})`);
      }

      if (resp.status === 429) {
        if (attempt < 2) continue;
        throw new Error("N1N API rate limited");
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`N1N API error: ${resp.status} - ${text}`);
      }

      const data = await resp.json() as any;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from N1N");

      try {
        let result = tryParseJson(content);
        if (result) return result;
        throw new Error("Failed to parse JSON even after fixes");
      } catch (parseError) {
        const rawContent = content.substring(0, 200);
        console.error(`[N1N] JSON parse failed. Raw content: ${rawContent}`);
        throw new Error(`Invalid JSON from N1N: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }

    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[N1N] Attempt ${attempt + 1} failed:`, lastError);
    }
  }

  throw new Error(`N1N API failed: ${lastError}`);
}

async function callN1nImage(prompt: string, model: string = N1N_IMAGE_MODEL) {
  if (!N1N_API_KEY) throw new Error("N1N API Key not configured");

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await sleep(2000);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const resp = await fetch(`https://api.n1n.ai/v1beta/models/${model}:generateContent`, {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${N1N_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] }
        })
      });

      clearTimeout(timeoutId);

      if (resp.status === 401 || resp.status === 403) {
        return null;
      }

      if (!resp.ok) {
        continue;
      }

      const data = await resp.json() as any;
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return null;

      for (const part of parts) {
        const inlineData = part?.inlineData || part?.inline_data;
        if (inlineData?.data) {
          const mimeType = inlineData.mimeType || "image/png";
          return `data:${mimeType};base64,${inlineData.data}`;
        }
      }
      return null;

    } catch (e) {
      console.error(`[N1N Image] Attempt ${attempt + 1} failed:`, e);
    }
  }

  return null;
}

async function callOpenRouterJson(prompt: string, systemPrompt: string, model: string = OPENROUTER_TEXT_MODEL) {
  if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API Key not configured");

  let lastError = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
      await sleep(delay);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" },
          max_tokens: 4000
        })
      });

      clearTimeout(timeoutId);

      if (resp.status === 401 || resp.status === 403) {
        throw new Error(`OpenRouter API auth error (${resp.status})`);
      }

      if (resp.status === 429) {
        if (attempt < 2) continue;
        throw new Error("OpenRouter API rate limited");
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`OpenRouter API error: ${resp.status} - ${text}`);
      }

      const data = await resp.json() as any;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from OpenRouter");

      try {
        const result = tryParseJson(content);
        if (result) return result;
        throw new Error("Failed to parse JSON even after fixes");
      } catch (parseError) {
        const rawContent = content.substring(0, 200);
        console.error(`[OpenRouter] JSON parse failed. Raw content: ${rawContent}`);
        throw new Error(`Invalid JSON from OpenRouter: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[OpenRouter] Attempt ${attempt + 1} failed:`, lastError);
    }
  }

  throw new Error(`OpenRouter API failed: ${lastError}`);
}

// Определяет — является ли модель Gemini-моделью (для маршрутизации через N1N)
function isGeminiModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gemini") || m.startsWith("google/gemini");
}

// Генерация картинки через N1N (нативный Gemini API — единственный надёжный способ для Gemini)
async function callN1nImageByModel(prompt: string, model: string) {
  // Вырезаем префикс "google/" если есть — N1N принимает "gemini-2.5-flash-image"
  const n1nModel = model.replace(/^google\//i, "");
  // console.log(`[N1N Image] Starting with model: ${n1nModel}`);

  if (!N1N_API_KEY) throw new Error("N1N API Key not configured");

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const resp = await fetch(`https://api.n1n.ai/v1beta/models/${n1nModel}:generateContent`, {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${N1N_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] }
        })
      });

      clearTimeout(timeoutId);

      if (resp.status === 401 || resp.status === 403) {
        console.error(`[N1N Image] Auth error (${resp.status})`);
        return null;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[N1N Image] HTTP ${resp.status}:`, errText);
        continue;
      }

      const data = await resp.json() as any;
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) {
        console.error(`[N1N Image] No parts in response`);
        return null;
      }

      for (const part of parts) {
        const inlineData = part?.inlineData || part?.inline_data;
        if (inlineData?.data) {
          const mimeType = inlineData.mimeType || "image/png";
          // console.log(`[N1N Image] Got image, mimeType: ${mimeType}`);
          return `data:${mimeType};base64,${inlineData.data}`;
        }
      }

      console.error(`[N1N Image] No image data in parts:`, JSON.stringify(data).substring(0, 300));
      return null;

    } catch (e) {
      console.error(`[N1N Image] Attempt ${attempt + 1} failed:`, e);
    }
  }

  return null;
}

// Генерация картинки через OpenRouter (все модели включая Gemini)
async function callOpenRouterImage(prompt: string, model: string = OPENROUTER_IMAGE_MODEL) {
  // console.log(`[OpenRouter Image] Starting with model: ${model}`);
  if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API Key not configured");

  // Gemini требует ["image", "text"], остальные (flux, riverflow и т.д.) — ["image"]
  const gemini = isGeminiModel(model);
  const modalities = gemini ? ["image", "text"] : ["image"];
  // Gemini нужно явное указание на генерацию картинки — без этого модель отвечает текстом
  const finalPrompt = gemini
    ? `Please generate an image (do not respond with text). Illustration: ${prompt}`
    : prompt;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: finalPrompt }],
          modalities
        })
      });

      clearTimeout(timeoutId);

      if (resp.status === 401 || resp.status === 403) {
        const errText = await resp.text();
        console.error(`[OpenRouter Image] Auth error (${resp.status}):`, errText);
        return null;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[OpenRouter Image] HTTP ${resp.status}:`, errText);
        continue;
      }

      const data = await resp.json() as any;
      const message = data?.choices?.[0]?.message;

      // Путь 1: message.images[] — актуальный формат OpenRouter (camelCase imageUrl)
      if (Array.isArray(message?.images) && message.images.length > 0) {
        const img = message.images[0];
        const url = img?.imageUrl?.url || img?.image_url?.url;
        if (url) {
          // console.log(`[OpenRouter Image] Got image via message.images[]`);
          return url;
        }
      }

      // Путь 2: content[] массив (старый формат / другие модели)
      const content = message?.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === "image_url") {
            const url = item.imageUrl?.url || item.image_url?.url;
            if (url) {
              // console.log(`[OpenRouter Image] Got image via content[image_url]`);
              return url;
            }
          }
          const b64 = item?.image_base64?.b64_json || item?.b64_json;
          if (b64) {
            // console.log(`[OpenRouter Image] Got image via content[b64]`);
            return `data:image/png;base64,${b64}`;
          }
        }
      }

      // Путь 3: content — строка data URL
      if (typeof content === "string" && content.startsWith("data:image")) {
        // console.log(`[OpenRouter Image] Got image via content string`);
        return content;
      }

      console.error(`[OpenRouter Image] No image found. Response:`, JSON.stringify(data).substring(0, 400));
      return null;

    } catch (e) {
      console.error(`[OpenRouter Image] Attempt ${attempt + 1} failed:`, e);
    }
  }

  return null;
}

// Маршрутизация: всё через OpenRouter, N1N как фоллбек
async function callSmartImage(prompt: string, model: string = OPENROUTER_IMAGE_MODEL): Promise<string | null> {
  // console.log(`[Image] Routing ${model} → OpenRouter`);
  return callOpenRouterImage(prompt, model);
}

// API: Генерировать главу
app.post("/api/ai/generate-chapter", async (req, res) => {
  try {
    const {
      genre,
      ageGroup = "auto",
      valueTheme,
      antiValueTheme,
      worldBible,
      heroBible,
      antagonistBible,
      stateSummary,
      choiceText,
      storyId,
      provider,
      prompt,
      systemPrompt,
      clientRequestId,
    } = req.body;

    if (clientRequestId) {
      pruneChapterCache();
      const cached = chapterRequestCache.get(clientRequestId);
      if (cached && cached.expiresAt > Date.now()) {
        res.json(cached.data);
        return;
      }
      if (cached && cached.expiresAt <= Date.now()) {
        chapterRequestCache.delete(clientRequestId);
      }
    }

    if (prompt && systemPrompt && !genre) {
      const resolvedSystemPrompt = systemPrompt || DEFAULT_SYSTEM_INSTRUCTION;
      const result = await callOpenRouterJson(prompt, resolvedSystemPrompt);
      if (clientRequestId) {
        chapterRequestCache.set(clientRequestId, { expiresAt: Date.now() + CHAPTER_CACHE_TTL, data: result });
      }
      res.json(result);
      return;
    }

    if (!genre) {
      return res.status(400).json({ error: "Missing genre" });
    }

    const cleanWorldBible = cleanPromptText(worldBible);
    const cleanHeroBible = cleanPromptText(heroBible);
    const cleanAntagBible = cleanPromptText(antagonistBible);
    const resolvedSystemPrompt = systemPrompt || DEFAULT_SYSTEM_INSTRUCTION;
    const resolvedValueTheme = valueTheme || "не указано";
    const resolvedAntiValueTheme = antiValueTheme || resolveAntiValue(valueTheme) || "не указано";
    const resolvedStateSummary = stateSummary || "История только начинается";
    const generatedPrompt = `Ты знаменитый детский писатель тонко понимающий разные жанры сказок и особенности возраста детей, создающий необычно яркие и волшебные образы. Напиши следующую главу сказки. 
Жанр: ${genre}. 
Возраст читателя: ${ageGroup}. 
Ценность: ${resolvedValueTheme}. 
Антиценность: ${resolvedAntiValueTheme}. 
Мир: ${cleanWorldBible}. 
Герой: ${cleanHeroBible}. 
Антагонист: ${cleanAntagBible}. 
Текущее состояние: ${resolvedStateSummary}. 
${choiceText ? `Выбор читателя: ${choiceText}` : "Это первая глава."} 
Длина: 3000-5000 символов. 
РОВНО 3 варианта выборов. 
Верни JSON с полями:
- chapter_id (строка)
- title (строка)
- narration_text (текст главы, 3000-5000 символов)
- scene_image_prompt (строка для генерации картинки)
- choices (массив из 3 объектов, каждый с полями: id, text, intent_tag)
- state_summary_end (строка)`;

    const result = await callOpenRouterJson(generatedPrompt, resolvedSystemPrompt);
    if (clientRequestId) {
      chapterRequestCache.set(clientRequestId, { expiresAt: Date.now() + CHAPTER_CACHE_TTL, data: result });
    }
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to generate chapter" });
  }
});

app.post("/api/ai/generate-world", async (req, res) => {
  try {
    const { genre, ageGroup = "auto", valueTheme, antiValueTheme, provider, systemPrompt } = req.body;
    if (!genre) {
      return res.status(400).json({ error: "Missing genre" });
    }

    const resolvedSystemPrompt =
      systemPrompt ||
      "Следуй инструкциям пользователя. Возвращай только валидный JSON, без дополнительного текста.";
    const resolvedValueTheme = valueTheme || "не указано";
    const resolvedAntiValueTheme = antiValueTheme || resolveAntiValue(valueTheme) || "не указано";
    const prompt = `Ты знаменитый детский писатель, тонко понимающий разные жанры сказок и особенности возраста детей, создающий яркие и волшебные образы.
Сгенерируй РОВНО 3 мира. Они должны быть СИЛЬНО разными тематически:
- разные центральные темы (theme_tag),
- разные центральные образы/метафоры,
- разные среды/локации,
- разные типы конфликтов.

Жанр: ${genre}.
Возраст: ${ageGroup}.
Ценность: ${resolvedValueTheme}.
Антиценность: ${resolvedAntiValueTheme}.

Верни JSON:
world_options: [
 {id, name, theme_tag, theme_summary, description_short, description_long,
  world_rules, visual_style, cover_image_prompt, hero_description, conflict_description},
 ... (ровно 3)
]

ВАЖНО:
- theme_tag у всех 3 должен быть разный
- ключевые образы/локации не должны повторяться
- не повторяй ключевые слова в названиях миров`;

    const result = await callOpenRouterJson(prompt, resolvedSystemPrompt);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to generate world" });
  }
});

// API: Генерировать картинку
app.post("/api/ai/generate-image", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    // console.log(`[generate-image] Prompt: ${prompt.substring(0, 200)}`);

    // N1N only for images
    let imageUrl = await callN1nImage(prompt);
    if (!imageUrl) {
      return res.status(500).json({ error: "Failed to generate image" });
    }

    res.json({ imageUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to generate image" });
  }
});

// === Vite middleware (в конце!) ===
async function setupVite() {
  const vite = await createViteServer({
    server: { middlewareMode: true }
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res) => {
    try {
      const url = req.originalUrl;
      let html = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
      html = await vite.transformIndexHtml(url, html);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (e: any) {
      vite.ssrFixStacktrace(e);
      console.error(e);
      res.status(500).end(e.message);
    }
  });
}

// Start server
async function start() {
  await setupVite();

  console.log(`\n🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}`);
  console.log("   Text: OpenRouter, Images: N1N");

  // Issue 6: Warn if no API keys are configured
  if (!N1N_API_KEY && !OPENROUTER_API_KEY) {
    console.warn("\n⚠️  WARNING: No AI API keys configured!");
    console.warn("   Set N1N_API_KEY or OPENROUTER_API_KEY in .env file");
    console.warn("   AI features will not work without valid API keys.\n");
  }

  app.listen(PORT, () => {
    console.log(`✓ Server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
