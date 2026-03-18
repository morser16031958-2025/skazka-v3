import { useState, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { Story } from "./types";
import { Genre, AgeGroup, GENRES } from "./config/worlds";
import { Landing } from "./components/Landing";
import { DoorSelect } from "./components/DoorSelect";
import { StoryWizard } from "./components/StoryWizard";
import { StoryReader } from "./components/StoryReader";
import { MyStories } from "./components/MyStories";
import { StoryContents } from "./components/StoryContents";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./App.css";

type AppScreen = "landing" | "menu" | "stories" | "wizard" | "contents" | "reader";

function App() {
  const [screen, setScreen] = useState<AppScreen>("landing");
  const [stories, setStories] = useState<Story[]>([]);
  const [currentStory, setCurrentStory] = useState<Story | null>(null);
  const [selectedWorldMode, setSelectedWorldMode] = useState<Genre | null>(null);
  const [selectedAgeGroup, setSelectedAgeGroup] = useState<AgeGroup>("auto");
  const [showChapterGenModal, setShowChapterGenModal] = useState(false);
  const [chapterGenBgIndex, setChapterGenBgIndex] = useState(0);
  const saveQueueRef = useRef(new Map<string, Promise<void>>());
  const pendingStoryRef = useRef(new Map<string, Story>());

  const dataUrlToBlob = (dataUrl: string) => {
    const [meta, base64] = dataUrl.split(",");
    const mimeMatch = meta.match(/data:([^;]+);base64/);
    const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  };

  const persistAsset = async (
    dataUrl: string | undefined,
    id: string
  ): Promise<string | undefined> => {
    if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
    const blob = dataUrlToBlob(dataUrl);
    const extension = blob.type.split("/")[1] || "bin";
    const formData = new FormData();
    formData.append("id", id);
    formData.append("file", new File([blob], `${id}.${extension}`, { type: blob.type }));
    const response = await fetch("/api/assets/upload", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `API error: ${response.status}`);
    }
    const data = await response.json();
    return data.assetUrl || dataUrl;
  };

  const persistStoryAssets = async (story: Story): Promise<Story> => {
    const [worldImage, heroImage, antagonistImage] = await Promise.all([
      persistAsset(story.worldImage, `world_${story.id}`),
      persistAsset(story.heroImage, `hero_${story.id}`),
      persistAsset(story.antagonistImage, `antag_${story.id}`),
    ]);

    const chapters = await Promise.all(
      story.chapters.map(async (chapter) => {
        const sceneImage = await persistAsset(chapter.scene_image_url, `scene_${chapter.id}`);
        if (!sceneImage || sceneImage === chapter.scene_image_url) return chapter;
        return { ...chapter, scene_image_url: sceneImage };
      })
    );

    return {
      ...story,
      worldImage: worldImage || story.worldImage,
      heroImage: heroImage || story.heroImage,
      antagonistImage: antagonistImage || story.antagonistImage,
      chapters,
    };
  };

  const queueStorySave = (story: Story) => {
    pendingStoryRef.current.set(story.id, story);
    const existing = saveQueueRef.current.get(story.id);
    if (existing) return existing;
    const task = (async () => {
      while (pendingStoryRef.current.has(story.id)) {
        const nextStory = pendingStoryRef.current.get(story.id)!;
        pendingStoryRef.current.delete(story.id);
        const persistedStory = await persistStoryAssets(nextStory);
        setCurrentStory((prev) => (prev?.id === persistedStory.id ? persistedStory : prev));
        setStories((prev) => prev.map((s) => (s.id === persistedStory.id ? persistedStory : s)));
        await fetch("/api/stories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(persistedStory),
        });
      }
    })().finally(() => {
      saveQueueRef.current.delete(story.id);
    });
    saveQueueRef.current.set(story.id, task);
    return task;
  };

  const loadStories = async () => {
    try {
      const response = await fetch("/api/stories");
      if (response.ok) {
        const data = await response.json();
        // Преобразуем старый формат v1 в v2 (если нужно)
        // Пока просто сохраняем как есть
        console.log("[DEBUG] Loaded stories from API:", data.length, "stories");
        data.forEach((story: Story, idx: number) => {
          console.log(`  [${idx}] ${story.title} - worldMode: ${story.worldMode}, ageLabel: ${story.ageLabel}, chapters: ${story.chapters?.length}`);
        });
        setStories(data);
      } else {
        console.error("[ERROR] API returned status:", response.status);
      }
    } catch (error) {
      console.error("Failed to load stories:", error);
    }
  };

  // Загрузить истории при старте
  useEffect(() => {
    loadStories();
  }, []);

  // Обновлять библиотеку при входе на экран
  useEffect(() => {
    if (screen === "stories") {
      loadStories();
    }
  }, [screen]);

  // Смена фона при генерации главы
  useEffect(() => {
    if (!showChapterGenModal || stories.length === 0) return;
    const interval = setInterval(() => {
      setChapterGenBgIndex(prev => {
        const images = stories.flatMap(s => [s.heroImage, s.antagonistImage].filter(Boolean));
        if (images.length === 0) return 0;
        return (prev + 1) % images.length;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [showChapterGenModal, stories]);

  const handleDoorSelect = (worldMode: Genre, ageGroup: AgeGroup) => {
    setSelectedWorldMode(worldMode);
    setSelectedAgeGroup(ageGroup);
    setScreen("wizard");
  };

  const handleStoryCreated = async (newStory: Story) => {
    setShowChapterGenModal(true);
    try {
      const { generateChapter, generateImage } = await import("./services/ai");

      const firstChapter = await generateChapter(
        newStory.worldMode!,
        newStory.worldDescription,
        newStory.heroDescription,
        newStory.antagonistDescription,
        "История только начинается"
      );

      const world = GENRES[newStory.worldMode];
      let sceneImageUrl = "";
      if (firstChapter.scene_image_prompt) {
        try {
          sceneImageUrl = await generateImage(firstChapter.scene_image_prompt, world?.imageStyleSuffix);
        } catch (e) {
          console.warn("Failed to generate scene image:", e);
        }
      }

      const chapterNode = {
        id: "chapter_0",
        title: firstChapter.title,
        narration_text: firstChapter.narration_text,
        scene_image_url: sceneImageUrl,
        choices: firstChapter.choices.map((c, i) => ({
          id: `choice_${i}`,
          text: c.text,
        })),
        state_summary: firstChapter.state_summary_end,
      };

      const storyWithChapter: Story = {
        ...newStory,
        chapters: [chapterNode],
        currentChapter: chapterNode,
        worldImage: sceneImageUrl || newStory.worldImage,
      };

      const persistedStory = await persistStoryAssets(storyWithChapter);
      console.log("[DEBUG] Saving story:", persistedStory.title, "worldMode:", persistedStory.worldMode);

      const saveResponse = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(persistedStory),
      });

      if (!saveResponse.ok) {
        const errorText = await saveResponse.text();
        console.error("[ERROR] Failed to save story:", saveResponse.status, errorText);
        throw new Error(`Failed to save: ${saveResponse.status}`);
      }

      console.log("[DEBUG] Story saved successfully");
      setCurrentStory(persistedStory);
      setStories((prev) => [...prev, persistedStory]);
      setShowChapterGenModal(false);
      setScreen("reader");
    } catch (error) {
      console.error("Failed to create first chapter:", error);
      setShowChapterGenModal(false);
      alert("Ошибка при создании первой главы: " + (error instanceof Error ? error.message : ""));
    }
  };

  const handleBackToMenu = () => {
    setScreen("menu");
    setCurrentStory(null);
    setSelectedWorldMode(null);
  };

  const handleOpenStory = (story: Story) => {
    const firstChapter = story.chapters?.[0] || null;
    setCurrentStory({ ...story, currentChapter: firstChapter });
    setScreen("contents");
  };

  const handleRegenerateConflict = async (story: Story) => {
    try {
      const { generateAntagonist } = await import("./services/ai");
      const { antagonistDescription, antagonistImage } = await generateAntagonist(
        story.worldMode,
        story.worldDescription,
        story.heroDescription
      );
      const newStory: Story = {
        ...story,
        id: uuidv4(),
        antagonistDescription,
        antagonistImage,
        chapters: [],
        currentChapter: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await handleStoryCreated(newStory);
    } catch (error) {
      console.error("Failed to regenerate conflict:", error);
      alert("Ошибка при пересоздании конфликта: " + (error instanceof Error ? error.message : ""));
    }
  };

  const handleRegenerateHero = async (story: Story) => {
    try {
      const { generateHeroAndAntagonist } = await import("./services/ai");
      const { heroDescription, heroImage, antagonistDescription, antagonistImage } = await generateHeroAndAntagonist(
        story.worldMode,
        story.worldDescription
      );
      const newStory: Story = {
        ...story,
        id: uuidv4(),
        heroDescription,
        heroImage,
        antagonistDescription,
        antagonistImage,
        chapters: [],
        currentChapter: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await handleStoryCreated(newStory);
    } catch (error) {
      console.error("Failed to regenerate hero:", error);
      alert("Ошибка при пересоздании героя: " + (error instanceof Error ? error.message : ""));
    }
  };

  const handleBackToLibrary = () => {
    setScreen("stories");
    setCurrentStory(null);
  };

  const handleBackToContents = () => {
    setScreen("contents");
  };

  const handleOpenChapter = (chapterId: string) => {
    if (!currentStory) return;
    const chapter = currentStory.chapters.find((c) => c.id === chapterId) || null;
    setCurrentStory({ ...currentStory, currentChapter: chapter });
    setScreen("reader");
  };

  const handleUpdateStory = (updatedStory: Story) => {
    setCurrentStory(updatedStory);
    setStories((prev) => prev.map((s) => (s.id === updatedStory.id ? updatedStory : s)));
    queueStorySave(updatedStory).catch((error) => {
      console.error("Failed to update story:", error);
      alert("Ошибка при сохранении истории: " + (error instanceof Error ? error.message : ""));
    });
  };

  const handleDeleteStory = async (storyId: string) => {
    try {
      await fetch(`/api/stories/${storyId}`, { method: "DELETE" });
      setStories((prev) => prev.filter((s) => s.id !== storyId));
      if (currentStory?.id === storyId) {
        setCurrentStory(null);
      }
    } catch (error) {
      console.error("Failed to delete story:", error);
      alert("Ошибка при удалении истории");
    }
  };

  const handleNewStory = () => {
    setScreen("menu");
    setCurrentStory(null);
  };

  const handleShowStories = () => {
    setScreen("stories");
  };

  const handleLandingCreateStory = () => {
    setScreen("menu");
  };

  const handleLandingLibrary = () => {
    setScreen("stories");
  };

  return (
    <ErrorBoundary>
      {screen === "landing" && (
        <Landing 
          onCreateStory={handleLandingCreateStory} 
          onLibrary={handleLandingLibrary} 
        />
      )}

      {screen === "menu" && (
        <DoorSelect onSelect={handleDoorSelect} onExit={() => setScreen("landing")} />
      )}

      {screen === "wizard" && selectedWorldMode && (
        <StoryWizard
          worldMode={selectedWorldMode}
          ageGroup={selectedAgeGroup}
          onStoryCreated={handleStoryCreated}
          onCancel={handleBackToMenu}
          onExitToLanding={() => setScreen("landing")}
        />
      )}

      {screen === "reader" && currentStory && (
        <StoryReader
          story={currentStory}
          backgroundImage={currentStory.worldImage}
          onChapterUpdate={handleUpdateStory}
          onBack={handleBackToContents}
        />
      )}

      {showChapterGenModal && (
        <div className="chapter-gen-modal">
          {(() => {
            const images = stories.flatMap(s => [s.heroImage, s.antagonistImage].filter(Boolean));
            const bgImage = images.length > 0 ? images[chapterGenBgIndex] : null;
            return bgImage ? (
              <div className="chapter-gen-modal-bg" style={{ backgroundImage: `url(${bgImage})` }} />
            ) : null;
          })()}
          <div className="chapter-gen-modal-content">
            <div className="blink-text">Создаю сказку...</div>
          </div>
        </div>
      )}

      {screen === "contents" && currentStory && (
        <StoryContents
          story={currentStory}
          onBack={handleBackToLibrary}
          onSelectChapter={handleOpenChapter}
        />
      )}

      {screen === "stories" && (
        <MyStories
          stories={stories}
          onSelectStory={handleOpenStory}
          onNewStory={handleNewStory}
          onDeleteStory={handleDeleteStory}
          onRegenerateConflict={handleRegenerateConflict}
          onRegenerateHero={handleRegenerateHero}
          onBack={() => setScreen("landing")}
        />
      )}
    </ErrorBoundary>
  );
}

export default App;
