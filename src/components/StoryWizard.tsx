import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { Genre, GENRES, AgeGroup } from "../config/worlds";
import { Story } from "../types";
import { generateWorldSetup, WorldSetupOption } from "../services/ai";
import "./StoryWizard.css";

interface StoryWizardProps {
  worldMode: Genre;
  ageGroup: AgeGroup;
  onStoryCreated: (story: Story) => void;
  onCancel: () => void;
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

export function StoryWizard({ worldMode, ageGroup, onStoryCreated, onCancel }: StoryWizardProps) {
  const world = GENRES[worldMode];
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"value" | "generating" | "options" | "preview">("value");
  const [story, setStory] = useState<Partial<Story> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [options, setOptions] = useState<WorldSetupOption[]>([]);
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    if (!loading || step !== "generating") {
      setTypedText("");
      return;
    }

    const fullText = world.loading_text || "";
    let index = 0;
    setTypedText("");
    const timer = setInterval(() => {
      index += 1;
      setTypedText(fullText.slice(0, index));
      if (index >= fullText.length) {
        clearInterval(timer);
      }
    }, 50);

    return () => clearInterval(timer);
  }, [loading, step, world.loading_text]);

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
    try {
      const setupOptions = await generateWorldSetup(
        worldMode,
        valueOverride ?? selectedValue ?? undefined,
        ageGroup
      );

      setOptions(setupOptions);
      setProgress(100);
      setStep("options");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка при создании мира";
      setError(message);
      console.error("Failed to generate world:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOptionSelect = (option: WorldSetupOption) => {
    const selectedWorld = option.world;
    const newStory: Partial<Story> = {
      id: uuidv4(),
      title: selectedWorld?.name || world.name,
      worldMode,
      ageLabel: ageGroup,
      worldDescription: selectedWorld?.description_long || selectedWorld?.description_short || "",
      heroDescription: selectedWorld?.hero_description || "",
      antagonistDescription: selectedWorld?.conflict_description || "",
      worldImage: option.worldImage,
      heroImage: "",
      antagonistImage: "",
      chapters: [],
      currentChapter: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setStory(newStory);
    setStep("preview");
  };

  const handleStartStory = () => {
    if (story) {
      onStoryCreated(story as Story);
    }
  };

  return (
    <div className={`story-wizard ${step === "value" ? "value-mode" : ""} ${step === "preview" ? "preview-mode" : ""}`}
      style={step === "preview" && story?.worldImage ? { backgroundImage: `url(${story.worldImage})` } : undefined}
    >
      {step === "value" && (
        <div className="wizard-values">
          <h2 className="values-title">О чём будет твоя история?</h2>
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
          <button className="btn-secondary" onClick={onCancel}>
            ← Отмена
          </button>
        </div>
      )}
      {step === "generating" && (
        <div className="wizard-generating" style={{ backgroundColor: loading ? world.accentColor : undefined }}>
          {loading ? (
            <div className="loading-screen">
              <h2>{typedText}</h2>
              <div className="progress-container">
                <div className="progress-bar" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="progress-text">{Math.round(progress)}%</p>
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
          <h2>Выбери свой мир</h2>
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
            <button className="btn-primary" onClick={() => {
              setStep("generating");
              handleGenerateWorld();
            }}>
              🔄 Другие варианты
            </button>
            <button className="btn-secondary" onClick={() => {
              setSelectedValue(null);
              setOptions([]);
              setStep("value");
            }}>
              ← Назад
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
              <img src={story.heroImage} alt="Герой" className="preview-hero-image" />
            )}
            <p>{story.heroDescription}</p>
          </div>

          <div className="preview-section">
            <h3>⚔️ Препятствие</h3>
            {story.antagonistImage && (
              <img src={story.antagonistImage} alt="Препятствие" className="preview-hero-image" />
            )}
            <p>{story.antagonistDescription}</p>
          </div>

          <div className="wizard-actions">
            <button className="btn-primary" onClick={handleStartStory}>
              📖 Начать историю
            </button>
            <button className="btn-secondary" onClick={() => {
              setSelectedValue(null);
              setOptions([]);
              setStep("value");
            }}>
              🔄 Создать другой мир
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
