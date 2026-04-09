import { useState } from "react";
import type { StudioLanguage } from "../shared/language";

const CARDS: ReadonlyArray<{
  lang: StudioLanguage;
  title: string;
  genres: string;
  platforms: string;
}> = [
  {
    lang: "ko",
    title: "한국어 창작",
    genres: "현대판타지 · 판타지 · 무협 · 로맨스판타지 · 일반",
    platforms: "네이버 시리즈 · 카카오페이지 · 문피아 · 노벨피아",
  },
  {
    lang: "zh",
    title: "中文创作",
    genres: "玄幻 · 仙侠 · 都市 · 恐怖 · 通用",
    platforms: "番茄小说 · 起点中文网 · 飞卢",
  },
  {
    lang: "en",
    title: "English Writing",
    genres: "LitRPG · Progression · Romantasy · Sci-Fi · Isekai",
    platforms: "Royal Road · Kindle Unlimited · Scribble Hub",
  },
];

export function LanguageSelector({ onSelect }: { onSelect: (lang: StudioLanguage) => void }) {
  const [hovering, setHovering] = useState<StudioLanguage | null>(null);
  const [selected, setSelected] = useState<StudioLanguage | null>(null);

  const handleSelect = (lang: StudioLanguage) => {
    setSelected(lang);
    // Brief pause for the selection animation before transitioning
    setTimeout(() => onSelect(lang), 400);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8">
      {/* Logo — cinematic scale */}
      <div className="mb-16 text-center">
        <div className="flex items-baseline justify-center gap-1.5 mb-4">
          <span className="font-serif text-6xl italic text-primary">Ink</span>
          <span className="text-5xl font-semibold tracking-tight text-foreground">OS</span>
        </div>
        <div className="text-base text-muted-foreground tracking-widest uppercase">Studio</div>
      </div>

      {/* Language cards — generous, distinct, immersive */}
      <div className="grid gap-6 md:grid-cols-3 mb-16 w-full max-w-5xl">
        {CARDS.map((card) => (
          <button
            key={card.lang}
            onClick={() => handleSelect(card.lang)}
            onMouseEnter={() => setHovering(card.lang)}
            onMouseLeave={() => setHovering(null)}
            className={`group border rounded-lg p-10 text-left transition-all duration-300 ${
              selected === card.lang
                ? "studio-surface-active scale-[1.02]"
                : hovering === card.lang
                  ? "border-border bg-card studio-surface-hover"
                  : "border-border bg-card/50"
            }`}
          >
            <div className="font-serif text-3xl mb-4 text-foreground">
              {card.title}
            </div>
            <div className="text-base text-foreground/70 leading-relaxed mb-6">
              {card.genres}
            </div>
            <div className="text-sm text-muted-foreground">
              {card.platforms}
            </div>
          </button>
        ))}
      </div>

      <div className="text-sm text-muted-foreground">
        설정에서 변경 가능 · Can be changed in Settings
      </div>
    </div>
  );
}
