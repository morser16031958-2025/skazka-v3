import { Story } from "../types";
import "./MyStories.css";

interface MyStoriesProps {
  stories: Story[];
  onSelectStory: (story: Story) => void;
  onNewStory: () => void;
  onDeleteStory: (storyId: string) => void;
  onBack: () => void;
}

function getAgeRank(ageLabel?: string) {
  if (!ageLabel) return Number.MAX_SAFE_INTEGER;
  const match = ageLabel.match(/\d+/);
  return match ? parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
}

function buildShelves(stories: Story[]): Array<{ title: string; ageRank: number; stories: Story[] }> {
  const groups = new Map<string, { title: string; ageRank: number; stories: Story[] }>();

  stories.forEach((story) => {
    const ageLabel = story.ageLabel || "Возраст не указан";
    const ageRank = getAgeRank(ageLabel);
    if (!groups.has(ageLabel)) {
      groups.set(ageLabel, { title: ageLabel, ageRank, stories: [] });
    }
    groups.get(ageLabel)!.stories.push(story);
  });

  const shelves = Array.from(groups.values());
  shelves.sort((a, b) => a.ageRank - b.ageRank);
  shelves.forEach((shelf) => {
    shelf.stories.sort((a, b) => a.title.localeCompare(b.title));
  });

  return shelves;
}

export function MyStories({ stories, onSelectStory, onNewStory: _onNewStory, onDeleteStory: _onDeleteStory, onBack }: MyStoriesProps) {
  const shelves = buildShelves(stories);

  return (
    <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: "url('/backgrounds/biblio.png')", backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.5, zIndex: 0 }} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(8, 5, 20, 0.6)', zIndex: 1 }} />
      <div style={{ position: 'relative', zIndex: 2 }}>

        <div className="stories-header">
          <button className="btn-back-menu" onClick={onBack}>Выход</button>
          <h1>📚 Библиотека</h1>
          <div style={{ width: '100px' }} />
        </div>

        {shelves.length === 0 ? (
          <div className="empty-state">
            <p>У вас ещё нет историй.</p>
            <button className="btn-primary" onClick={_onNewStory}>🚀 Создать первую историю</button>
          </div>
        ) : (
          <div className="stories-shelves">
            {shelves.map((shelf) => (
              <div key={shelf.title} className="world-shelf">
                <div className="shelf-title">{shelf.title}</div>
                <div className="stories-grid">
                  {shelf.stories.map((story) => (
                    <button
                      key={story.id}
                      type="button"
                      className="story-card"
                      onClick={() => onSelectStory(story)}
                    >
                      <div className="spine-title-cell">
                        <span className="spine-title-text">{story.title}</span>
                      </div>
                      <div className="spine-img-cell">
                        {story.worldImage ? <img src={story.worldImage} alt="" /> : <span>🌍</span>}
                      </div>
                      <div className="spine-img-cell">
                        {story.heroImage ? <img src={story.heroImage} alt="" /> : <span>🦸</span>}
                      </div>
                      <div className="spine-img-cell">
                        {story.antagonistImage ? <img src={story.antagonistImage} alt="" /> : <span>⚔️</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
