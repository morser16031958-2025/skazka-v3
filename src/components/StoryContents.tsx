import { Story, ChapterNode } from "../types";
import "./StoryContents.css";

interface StoryContentsProps {
  story: Story;
  onBack: () => void;
  onSelectChapter: (chapterId: string) => void;
}

interface TreeNode {
  chapter: ChapterNode;
  choiceText: string | null;
  children: TreeNode[];
  depth: number;
  isLast: boolean;
}

function buildTree(chapters: ChapterNode[]): TreeNode[] {
  const childrenMap = new Map<string, ChapterNode[]>();
  const roots: ChapterNode[] = [];

  for (const ch of chapters) {
    if (!ch.parentChapterId) {
      roots.push(ch);
    } else {
      if (!childrenMap.has(ch.parentChapterId)) {
        childrenMap.set(ch.parentChapterId, []);
      }
      childrenMap.get(ch.parentChapterId)!.push(ch);
    }
  }

  function toNode(ch: ChapterNode, depth: number, isLast: boolean): TreeNode {
    const parent = chapters.find((c) => c.id === ch.parentChapterId);
    const choiceText =
      parent && ch.choiceIndex !== undefined
        ? parent.choices[ch.choiceIndex]?.text ?? ch.selectedChoiceText ?? null
        : ch.selectedChoiceText ?? null;

    const kids = (childrenMap.get(ch.id) || []).sort(
      (a, b) => (a.choiceIndex ?? 99) - (b.choiceIndex ?? 99)
    );

    return {
      chapter: ch,
      choiceText,
      depth,
      isLast,
      children: kids.map((kid, i) => toNode(kid, depth + 1, i === kids.length - 1)),
    };
  }

  return roots.map((r, i) => toNode(r, 0, i === roots.length - 1));
}

interface TreeNodeRowProps {
  node: TreeNode;
  currentChapterId: string | null;
  onSelect: (id: string) => void;
  prefixParts: boolean[];
}

function TreeNodeRow({
  node,
  currentChapterId,
  onSelect,
  prefixParts,
}: TreeNodeRowProps) {
  const isCurrent = node.chapter.id === currentChapterId;
  const isLeaf = node.children.length === 0;

  const connector = node.depth === 0 ? "" : node.isLast ? "└─ " : "├─ ";
  const prefix = prefixParts
    .map((continues) => (continues ? "│  " : "   "))
    .join("");

  const nextPrefix = [...prefixParts, !node.isLast];

  return (
    <>
      <div
        className={`tree-node tree-node--leaf ${isCurrent ? "tree-node--current" : ""}`}
        onClick={() => onSelect(node.chapter.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node.chapter.id);
          }
        }}
      >
        <span className="tree-prefix" aria-hidden="true">
          {prefix}
          {connector}
        </span>

        <span className="tree-content">
          {node.choiceText && (
            <span className="tree-choice-label">"{node.choiceText}" →</span>
          )}
          <span className="tree-chapter-title">{node.chapter.title || `Глава`}</span>
          {isCurrent && <span className="tree-current-badge">● сейчас</span>}
        </span>
      </div>

      {node.children.map((child) => (
        <TreeNodeRow
          key={child.chapter.id}
          node={child}
          currentChapterId={currentChapterId}
          onSelect={onSelect}
          prefixParts={nextPrefix}
        />
      ))}
    </>
  );
}

export function StoryContents({
  story,
  onBack,
  onSelectChapter,
}: StoryContentsProps) {
  const tree = buildTree(story.chapters);
  const currentId = story.currentChapter?.id ?? null;

  return (
    <div className="story-contents">
      <div className="story-contents-bg" />
      <div className="story-contents-overlay" />
      <div className="story-contents-body">
        <div className="story-contents-header">
          <button className="btn-back-menu" onClick={onBack}>
            ← Назад
          </button>
          <h1>{story.title}</h1>
        </div>

        {story.worldImage && (
          <div className="story-contents-hero">
            <img src={story.worldImage} alt="Мир" />
          </div>
        )}

        <div className="story-tree">
          {tree.map((root) => (
            <TreeNodeRow
              key={root.chapter.id}
              node={root}
              currentChapterId={currentId}
              onSelect={onSelectChapter}
              prefixParts={[]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
