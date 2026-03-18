import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { Genre, GENRES, AgeGroup } from "../config/worlds";
import { Story } from "../types";
import { generateWorldSetup, generateImage, WorldSetupOption, callLocalApi } from "../services/ai";
import "./StoryWizard.css";

interface StoryWizardProps {
  worldMode: Genre;
  ageGroup: AgeGroup;
  onStoryCreated: (story: Story) => void;
  onCancel: () => void;
  onExitToLanding: () => void;
}

const VALUES = [
  "✨ О настоящей дружбе",
  "🦁 О смелости",
  "🌟 О доброте",
  "🔍 О любопытстве",
  "💫 О честности",
  "🌱 О труде и терпении",
  "🤝 Об уважении",
  "⭐ Об ответственности"
];

export function StoryWizard({ worldMode, ageGroup, onStoryCreated, onCancel, onExitToLanding }: StoryWizardProps) {
  const world = GENRES[worldMode];
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"value" | "generating" | "options" | "preview">("value");
  const [story, setStory] = useState<Partial<Story> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [options, setOptions] = useState<WorldSetupOption[]>([]);
  const [typedWorlds, setTypedWorlds] = useState<string[]>([]);
  const [currentWorldIndex, setCurrentWorldIndex] = useState(0);
  const [progressStatus, setProgressStatus] = useState("");
  const [showImageGenModal, setShowImageGenModal] = useState(false);
  const [existingStories, setExistingStories] = useState<Story[]>([]);
  const [bgImageIndex, setBgImageIndex] = useState(0);
  const [viewImage, setViewImage] = useState<{ src: string; title: string; description: string } | null>(null);

  useEffect(() => {
    fetch("/api/stories")
      .then(res => res.json())
      .then(data => setExistingStories(data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!showImageGenModal) return;
    const interval = setInterval(() => {
      setBgImageIndex(prev => {
        const images = existingStories.flatMap(s => [s.heroImage, s.antagonistImage].filter(Boolean));
        if (images.length === 0) return 0;
        return (prev + 1) % images.length;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [showImageGenModal, existingStories]);

  useEffect(() => {
    if (!loading || step !== "generating") return;
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        const newProgress = prev + (95 / 350);
        return Math.min(newProgress, 95);
      });
    }, 100);

    return () => clearInterval(progressInterval);
  }, [loading, step]);

  const handleGenerateWorld = async (valueOverride?: string) => {
    setLoading(true);
    setError(null);
    setProgress(0);
    setTypedWorlds([]);
    setCurrentWorldIndex(0);
    
    try {
      setProgressStatus("Создаю 1 мир...");
      
      // Generate each world one by one
      const allOptions: WorldSetupOption[] = [];
      const world = GENRES[worldMode];
      
      for (let i = 0; i < 3; i++) {
        setCurrentWorldIndex(i);
        setProgressStatus(`Создаю ${i + 1} мир...`);
        
        const response = await callLocalApi<{ world_options?: Array<any> }>("/api/ai/generate-world", {
          genre: world.name,
          ageGroup,
          valueTheme: valueOverride ?? selectedValue ?? undefined,
          clientRequestId: `world-${i}-${Date.now()}`,
        });
        
        const option = response?.world_options?.[0];
        if (option) {
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
          
          // Typewriter effect for this world
          const fullText = `${resolvedWorld.name}\n\n${resolvedWorld.description_short}\n\nГерой: ${resolvedWorld.hero_description}\n\nАнтагонист: ${resolvedWorld.conflict_description}`;
          
          let textIndex = 0;
          await new Promise<void>((resolve) => {
            const timer = setInterval(() => {
              textIndex += 3;
              setTypedWorlds(prev => {
                const newWorlds = [...prev];
                newWorlds[i] = fullText.slice(0, textIndex);
                return newWorlds;
              });
              if (textIndex >= fullText.length) {
                clearInterval(timer);
                resolve();
              }
            }, 30);
          });
          
          setProgressStatus(`Рисую ${i + 1} мир...`);
          const prompt = resolvedWorld.cover_image_prompt || resolvedWorld.description_short;
          const worldImage = await generateImage(prompt, world.imageStyleSuffix).catch(() => "");
          
          allOptions.push({
            world: resolvedWorld,
            worldImage,
          });
        }
        
        setProgress(Math.round(((i + 1) / 3) * 100));
      }
      
      setOptions(allOptions);
      setProgressStatus("Готово!");
      setStep("options");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка при создании мира";
      setError(message);
      console.error("Failed to generate world:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOptionSelect = async (option: WorldSetupOption) => {
    setLoading(true);
    setShowImageGenModal(true);
    setStep("generating");
    
    try {
      const selectedWorld = option.world;
      
      const heroDesc = selectedWorld?.hero_description || "Добрый герой";
      const antagDesc = selectedWorld?.conflict_description || "Препятствие";
      
      const [heroImage, antagonistImage] = await Promise.all([
        generateImage(heroDesc, world.imageStyleSuffix).catch(() => ""),
        generateImage(antagDesc, world.imageStyleSuffix).catch(() => ""),
      ]);

      const newStory: Partial<Story> = {
        id: uuidv4(),
        title: selectedWorld?.name || world.name,
        worldMode,
        ageLabel: ageGroup,
        worldDescription: selectedWorld?.description_long || selectedWorld?.description_short || "",
        heroDescription: heroDesc,
        antagonistDescription: antagDesc,
        worldImage: option.worldImage,
        heroImage,
        antagonistImage,
        chapters: [],
        currentChapter: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setStory(newStory);
      setShowImageGenModal(false);
      setStep("preview");
    } catch (err) {
      console.error("Failed to generate images:", err);
      setError(err instanceof Error ? err.message : "Ошибка при создании");
      setShowImageGenModal(false);
    } finally {
      setLoading(false);
    }
  };

  const handleStartStory = () => {
    if (story) {
      onStoryCreated(story as Story);
    }
  };

  return (
    <div className={`story-wizard ${step === "value" ? "value-mode" : ""} ${step === "options" ? "options-mode" : ""} ${step === "preview" ? "preview-mode" : ""}`}
      style={step === "preview" && story?.worldImage ? { 
        backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.4) 100%), url(${story.worldImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      } : undefined}
    >
      {step === "value" && (
        <div className="wizard-values">
          <div className="wizard-values-header">
            <button className="btn-secondary" onClick={onCancel}>Выход</button>
            <h2 className="values-title">Выбери, о чем будет твоя история</h2>
            <div className="wizard-values-spacer" />
          </div>
          <div className="values-grid">
            {VALUES.map((value) => (
              <button
                key={value}
                type="button"
                className={`value-card ${selectedValue === value ? "selected" : ""}`}
                onClick={() => {
                  setSelectedValue(value);
                  setStep("generating");
                  handleGenerateWorld(value);
                }}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      )}
      {step === "generating" && !showImageGenModal && (
        <div className="wizard-generating" style={{ backgroundColor: loading ? world.accentColor : undefined }}>
          {loading ? (
            <div className="loading-screen">
              <div className="worlds-typing">
                {typedWorlds.map((text, i) => (
                  <div key={i} className={`world-typing ${i < currentWorldIndex ? 'completed' : i === currentWorldIndex ? 'current' : ''}`}>
                    <pre className="typing-text">{text}{i === currentWorldIndex && <span className="cursor">▋</span>}</pre>
                  </div>
                ))}
              </div>
              <div className="progress-container">
                <div className="progress-bar" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="progress-status">{progressStatus}</p>
            </div>
          ) : (
            <>
              <h2>✨ Создаём твой мир...</h2>
              <p className="world-name">{world.name}</p>
              {error && <div className="error-message">{error}</div>}
              <button
                className="btn-primary"
                onClick={() => handleGenerateWorld()}
                disabled={loading}
              >
                {loading ? "⏳ Загружаем..." : "🚀 Начать"}
              </button>
              <button className="btn-secondary" onClick={onCancel}>
                ← Отмена
              </button>
            </>
          )}
        </div>
      )}
      {step === "options" && (
        <div className="wizard-options">
          <div className="wizard-options-header">
            <button className="btn-secondary" onClick={onExitToLanding}>Выход</button>
            <h2>Выбери свой жанр</h2>
            <div className="wizard-options-spacer" />
          </div>
          {error && <div className="error-message">{error}</div>}
          <div className="options-grid">
            {options.map((option, index) => (
              <button
                key={`${option.world.name}-${index}`}
                type="button"
                className="option-card"
                onClick={() => handleOptionSelect(option)}
              >
                <div className="option-image">
                  {option.worldImage ? (
                    <img src={option.worldImage} alt="Мир" />
                  ) : (
                    <div className="option-placeholder">🌍</div>
                  )}
                </div>
                <div className="option-body">
                  <h3>{option.world.name}</h3>
                  <p>{option.world.description_short}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="wizard-actions">
            <button className="btn-primary" disabled>
              🔄 Другие варианты
            </button>
            <button className="btn-secondary" onClick={onCancel}>
              🚪 Выход
            </button>
          </div>
        </div>
      )}
      {step === "preview" && story && (
        <div className="wizard-preview">
          <h2>{story.title}</h2>

          <div className="preview-section">
            <h3>🌍 Мир</h3>
            <p>{story.worldDescription}</p>
          </div>

          <div className="preview-section">
            <h3>🦸 Герой</h3>
            {story.heroImage && (
              <img 
                src={story.heroImage} 
                alt="Герой" 
                className="preview-hero-image clickable"
                onClick={() => setViewImage({ 
                  src: story.heroImage!, 
                  title: "Герой", 
                  description: story.heroDescription || "" 
                })}
              />
            )}
            <p>{story.heroDescription}</p>
          </div>

          <div className="preview-section">
            <h3>⚔️ Препятствие</h3>
            {story.antagonistImage && (
              <img 
                src={story.antagonistImage} 
                alt="Препятствие" 
                className="preview-hero-image clickable"
                onClick={() => setViewImage({ 
                  src: story.antagonistImage!, 
                  title: "Препятствие", 
                  description: story.antagonistDescription || "" 
                })}
              />
            )}
            <p>{story.antagonistDescription}</p>
          </div>

          <div className="wizard-actions">
            <button className="btn-primary" onClick={handleStartStory}>
              📖 Начать историю
            </button>
            <button className="btn-secondary" onClick={() => {
              setStep("options");
            }}>
              ← Назад
            </button>
          </div>
        </div>
      )}

      {showImageGenModal && (
        <div className="image-gen-modal">
          {(() => {
            const images = existingStories.flatMap(s => [s.heroImage, s.antagonistImage].filter(Boolean));
            const bgImage = images.length > 0 ? images[bgImageIndex] : null;
            return bgImage ? (
              <div className="image-gen-modal-bg" style={{ backgroundImage: `url(${bgImage})` }} />
            ) : null;
          })()}
          <div className="image-gen-modal-content">
            <div className="blink-text">Создаю ИИ картинки...</div>
          </div>
        </div>
      )}

      {viewImage && (
        <div className="view-image-modal" onClick={() => setViewImage(null)}>
          <div className="view-image-modal-content" onClick={e => e.stopPropagation()}>
            <h3>{viewImage.title}</h3>
            <img src={viewImage.src} alt={viewImage.title} />
            <p>{viewImage.description}</p>
            <button className="btn-primary" onClick={() => setViewImage(null)}>ОК</button>
          </div>
        </div>
      )}
    </div>
  );
}
