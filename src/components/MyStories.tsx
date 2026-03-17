import { useState } from "react";
import { Story } from "../types";
import "./MyStories.css";

interface MyStoriesProps {
  stories: Story[];
  onSelectStory: (story: Story) => void;
  onNewStory: () => void;
  onDeleteStory: (storyId: string) => void;
  onRegenerateConflict: (story: Story) => void;
  onRegenerateHero: (story: Story) => void;
  onBack: () => void;
}

function getAgeRank(ageLabel?: string): number {
  if (!ageLabel) return 99;
  const match = ageLabel.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 99;
}

function getAgeLabel(ageLabel?: string): string {
  if (!ageLabel) return "Все возрасты";
  // Normalize: extract range like "3-5", "6-8", "9-12"
  const range = ageLabel.match(/(\d+[-–]\d+)/);
  if (range) return range[0];
  const single = ageLabel.match(/(\d+)/);
  if (single) return single[0] + "+";
  return ageLabel;
}

function getUpdatedAtValue(updatedAt?: string) {
  if (!updatedAt) return 0;
  const parsed = Date.parse(updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Group stories by age, each age = one shelf
function buildShelves(stories: Story[]): Array<{ title: string; ageRank: number; stories: Story[] }> {
  const groups = new Map<number, { title: string; ageRank: number; stories: Story[] }>();

  stories.forEach((story) => {
    const rank = getAgeRank(story.ageLabel);
    if (!groups.has(rank)) {
      groups.set(rank, { title: getAgeLabel(story.ageLabel), ageRank: rank, stories: [] });
    }
    groups.get(rank)!.stories.push(story);
  });

  const shelves = Array.from(groups.values());
  // Sort shelves by age ascending
  shelves.sort((a, b) => a.ageRank - b.ageRank);

  // Sort books within shelf by title then by date
  shelves.forEach((shelf) => {
    shelf.stories.sort((a, b) => {
      const titleCmp = a.title.localeCompare(b.title);
      if (titleCmp !== 0) return titleCmp;
      return getUpdatedAtValue(b.updatedAt) - getUpdatedAtValue(a.updatedAt);
    });
  });

  return shelves;
}

function shortText(text?: string, max = 90) {
  if (!text) return "—";
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/[.,;:!?]?\s*$/, "") + "…";
}

// Palette for books without images
const SPINE_COLORS = [
  "linear-gradient(180deg,#4a3060 0%,#2a1840 100%)",
  "linear-gradient(180deg,#2a5040 0%,#143028 100%)",
  "linear-gradient(180deg,#5a2828 0%,#381818 100%)",
  "linear-gradient(180deg,#3a4a6a 0%,#1e2a48 100%)",
  "linear-gradient(180deg,#5a4a20 0%,#382e10 100%)",
  "linear-gradient(180deg,#4a2a50 0%,#2a1438 100%)",
];

function spineColor(index: number) {
  return SPINE_COLORS[index % SPINE_COLORS.length];
}

export function MyStories({
  stories,
  onSelectStory,
  onNewStory,
  onDeleteStory: _onDeleteStory,
  onRegenerateConflict,
  onRegenerateHero,
  onBack,
}: MyStoriesProps) {
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const shelves = buildShelves(stories);

  const openModal = (story: Story) => setSelectedStory(story);
  const closeModal = () => setSelectedStory(null);

  const handleRead = () => {
    if (selectedStory) {
      onSelectStory(selectedStory);
      closeModal();
    }
  };

  return (
    <div className="my-stories">
      <div className="stories-background" />
      <div className="stories-overlay" />
      <div className="stories-content">

        <div className="stories-header">
          <h1>📚 Библиотека</h1>
          <button className="btn-back-menu" onClick={onBack}>Выход</button>
        </div>

        {shelves.length === 0 ? (
          <div className="empty-state">
            <p>У вас ещё нет историй.</p>
            <p>Создайте первую — начните со сказки, приключения или магии!</p>
            <button className="btn-primary" onClick={onNewStory}>🚀 Создать первую историю</button>
          </div>
        ) : (
          <div className="stories-shelves">
            {shelves.map((shelf, shelfIdx) => (
              <div key={shelf.title} className="world-shelf">
                <h2 className="shelf-title">{shelf.title}</h2>

                {/* Books row */}
                <div className="shelf-row">
                  {shelf.stories.map((story, bookIdx) => {
                    const globalIdx = shelfIdx * 10 + bookIdx;
                    const hasImages = story.worldImage || story.heroImage || story.antagonistImage;
                    return (
                      <div
                        key={story.id}
                        className="book-spine"
                        style={!hasImages ? { background: spineColor(globalIdx) } : undefined}
                        onClick={() => openModal(story)}
                        role="button"
                        tabIndex={0}
                        aria-label={story.title}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openModal(story);
                          }
                        }}
                      >
                        <div className="book-spine-header">
                          {story.title.split(" ").slice(0, 2).join(" ")}
                        </div>
                        <div className="book-spine-images">
                          {/* Мир */}
                          <div className="book-spine-img-wrap">
                            {story.worldImage
                              ? <img src={story.worldImage} alt="Мир" />
                              : <div className="placeholder">🌍</div>}
                          </div>
                          <div className="book-spine-divider" />
                          {/* Герой */}
                          <div className="book-spine-img-wrap">
                            {story.heroImage
                              ? <img src={story.heroImage} alt="Герой" />
                              : <div className="placeholder">🦸</div>}
                          </div>
                          <div className="book-spine-divider" />
                          {/* Антигерой */}
                          <div className="book-spine-img-wrap">
                            {story.antagonistImage
                              ? <img src={story.antagonistImage} alt="Антигерой" />
                              : <div className="placeholder">⚔️</div>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Wooden plank */}
                <div className="shelf-plank" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {selectedStory && (
        <div
          className="modal-overlay"
          onClick={closeModal}
          style={{
            backgroundImage: selectedStory.worldImage ? `url(${selectedStory.worldImage})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            {/* Фон — картинка мира */}
            <div
              className="modal-bg"
              style={{
                backgroundImage: selectedStory.worldImage
                  ? `url(${selectedStory.worldImage})`
                  : selectedStory.heroImage
                  ? `url(${selectedStory.heroImage})`
                  : undefined
              }}
            />
            <div className="modal-bg-overlay" />

            <div className="modal-inner">
              {/* 3 images horizontal */}
              <div className="modal-images">
                <div className="modal-image-item">
                  {selectedStory.worldImage
                    ? <img src={selectedStory.worldImage} alt="Мир" />
                    : <div className="modal-image-placeholder">🌍</div>}
                  <span className="modal-image-label">Мир</span>
                </div>
                <div className="modal-image-item">
                  {selectedStory.heroImage
                    ? <img src={selectedStory.heroImage} alt="Герой" />
                    : <div className="modal-image-placeholder">🦸</div>}
                  <span className="modal-image-label">Герой</span>
                </div>
                <div className="modal-image-item">
                  {selectedStory.antagonistImage
                    ? <img src={selectedStory.antagonistImage} alt="Антигерой" />
                    : <div className="modal-image-placeholder">⚔️</div>}
                  <span className="modal-image-label">Антигерой</span>
                </div>
              </div>

              <div className="modal-body">
                <h2 className="modal-title">{selectedStory.title}</h2>

                <div className="modal-descriptions">
                  <div className="modal-description">
                    <span className="modal-description-label">Мир:</span>
                    <span className="modal-description-text">{shortText(selectedStory.worldDescription)}</span>
                  </div>
                  <div className="modal-description">
                    <span className="modal-description-label">Герой:</span>
                    <span className="modal-description-text">{shortText(selectedStory.heroDescription)}</span>
                  </div>
                  <div className="modal-description">
                    <span className="modal-description-label">Антигерой:</span>
                    <span className="modal-description-text">{shortText(selectedStory.antagonistDescription)}</span>
                  </div>
                </div>

                <div className="modal-meta">
                  <span className="modal-age">{selectedStory.ageLabel || "Возраст не указан"}</span>
                  <span className="modal-chapters">{selectedStory.chapters.length} глав</span>
                </div>

                <div className="modal-actions">
                  <button className="btn-modal-return" onClick={closeModal}>← Вернуть</button>
                  <button className="btn-modal-read" onClick={handleRead}>Читать →</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
