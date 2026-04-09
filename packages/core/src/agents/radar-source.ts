import type { WritingLanguage } from "../models/language.js";

export interface RankingEntry {
  readonly title: string;
  readonly author: string;
  readonly category: string;
  readonly extra: string;
}

export interface PlatformRankings {
  readonly platform: string;
  readonly entries: ReadonlyArray<RankingEntry>;
}

/**
 * Pluggable data source for the Radar agent.
 * Implement this interface to feed custom ranking/trend data
 * (e.g. from OpenClaw, custom scrapers, paid APIs).
 */
export interface RadarSource {
  readonly name: string;
  fetch(): Promise<PlatformRankings>;
}

/**
 * Wraps raw natural language text as a radar source.
 * Use this to inject external analysis (e.g. from OpenClaw) into the radar pipeline.
 */
export class TextRadarSource implements RadarSource {
  readonly name: string;
  private readonly text: string;

  constructor(text: string, name = "external") {
    this.name = name;
    this.text = text;
  }

  async fetch(): Promise<PlatformRankings> {
    return {
      platform: this.name,
      entries: [{ title: this.text, author: "", category: "", extra: "[external analysis]" }],
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in sources
// ---------------------------------------------------------------------------

const FANQIE_RANK_TYPES = [
  { sideType: 10, label: "热门榜" },
  { sideType: 13, label: "黑马榜" },
] as const;

const KAKAO_META_TOKENS = new Set([
  "기다무",
  "삼다무",
  "신작",
  "웹소설",
  "웹툰",
  "버튼",
]);

const KAKAO_GENRE_TOKENS = new Set([
  "판타지",
  "현대판타지",
  "무협",
  "로맨스",
  "로판",
  "로맨스판타지",
  "드라마",
  "BL",
  "GL",
  "스포츠",
  "미스터리",
  "라이트노벨",
]);

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(stripTags(value))
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingAgeBadge(value: string): string {
  return value.replace(/^(?:15|19)\s+/, "");
}

function uniqueEntries(entries: ReadonlyArray<RankingEntry>, limit = 20): ReadonlyArray<RankingEntry> {
  const seen = new Set<string>();
  const deduped: RankingEntry[] = [];

  for (const entry of entries) {
    const title = normalizeText(entry.title);
    if (!title) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    deduped.push({
      ...entry,
      title,
      author: normalizeText(entry.author),
      category: normalizeText(entry.category),
      extra: normalizeText(entry.extra),
    });
    if (deduped.length >= limit) break;
  }

  return deduped;
}

function isKakaoMetaToken(token: string): boolean {
  return (
    KAKAO_META_TOKENS.has(token)
    || KAKAO_GENRE_TOKENS.has(token)
    || token.endsWith("업데이트됨")
    || token.endsWith("연령 제한")
    || token.startsWith("작가 ")
  );
}

export class FanqieRadarSource implements RadarSource {
  readonly name = "fanqie";

  async fetch(): Promise<PlatformRankings> {
    const entries: RankingEntry[] = [];

    for (const { sideType, label } of FANQIE_RANK_TYPES) {
      try {
        const url = `https://api-lf.fanqiesdk.com/api/novel/channel/homepage/rank/rank_list/v2/?aid=13&limit=15&offset=0&side_type=${sideType}`;
        const res = await globalThis.fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; InkOS/0.1)" },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as Record<string, unknown>;
        const list = (data as { data?: { result?: unknown[] } }).data?.result;
        if (!Array.isArray(list)) continue;

        for (const item of list) {
          const rec = item as Record<string, unknown>;
          entries.push({
            title: String(rec.book_name ?? ""),
            author: String(rec.author ?? ""),
            category: String(rec.category ?? ""),
            extra: `[${label}]`,
          });
        }
      } catch {
        // skip on network error
      }
    }

    return { platform: "番茄小说", entries };
  }
}

export class QidianRadarSource implements RadarSource {
  readonly name = "qidian";

  async fetch(): Promise<PlatformRankings> {
    const entries: RankingEntry[] = [];

    try {
      const url = "https://www.qidian.com/rank/";
      const res = await globalThis.fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) return { platform: "起点中文网", entries };
      const html = await res.text();

      const bookPattern =
        /<a[^>]*href="\/\/book\.qidian\.com\/info\/(\d+)"[^>]*>([^<]+)<\/a>/g;
      let match: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((match = bookPattern.exec(html)) !== null) {
        const title = match[2].trim();
        if (title && !seen.has(title) && title.length > 1 && title.length < 30) {
          seen.add(title);
          entries.push({ title, author: "", category: "", extra: "[起点热榜]" });
        }
        if (entries.length >= 20) break;
      }
    } catch {
      // skip on network error
    }

    return { platform: "起点中文网", entries };
  }
}

export class NaverSeriesRadarSource implements RadarSource {
  readonly name = "naver-series";

  async fetch(): Promise<PlatformRankings> {
    const entries: RankingEntry[] = [];

    try {
      const url = "https://series.naver.com/novel/top100List.series?rankingTypeCode=DAILY&categoryCode=ALL";
      const res = await globalThis.fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; InkOS/0.1)" },
      });
      if (!res.ok) return { platform: "NAVER 시리즈", entries };

      const html = await res.text();
      const blocks = html.split('<div class="comic_cont">').slice(1);

      for (const block of blocks) {
        const title = normalizeText(block.match(/<h3>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "");
        const author = normalizeText(block.match(/<span class="author">([\s\S]*?)<\/span>/)?.[1] ?? "");
        const description = normalizeText(block.match(/<p class="dsc">([\s\S]*?)<\/p>/)?.[1] ?? "");
        entries.push({
          title,
          author,
          category: "",
          extra: description ? `[일간 TOP100] ${description}` : "[일간 TOP100]",
        });
      }
    } catch {
      // skip on network error
    }

    return { platform: "NAVER 시리즈", entries: uniqueEntries(entries) };
  }
}

export class KakaoPageRadarSource implements RadarSource {
  readonly name = "kakao-page";

  async fetch(): Promise<PlatformRankings> {
    const entries: RankingEntry[] = [];

    try {
      const url = "https://page.kakao.com/menu/10011";
      const res = await globalThis.fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; InkOS/0.1)" },
      });
      if (!res.ok) return { platform: "카카오페이지", entries };

      const html = await res.text();
      for (const match of html.matchAll(/aria-label="작품, ([^"]+)"/g)) {
        const label = normalizeText(match[1] ?? "");
        if (!label || label.includes("웹툰")) continue;

        const tokens = label.split(",").map((token) => token.trim()).filter(Boolean);
        let boundary = tokens.findIndex((token) => isKakaoMetaToken(token));
        if (boundary === -1) {
          boundary = Math.min(tokens.length, 1);
        }

        const title = normalizeText(tokens.slice(0, boundary).join(", "));
        const metaTokens = tokens.slice(boundary).filter((token) => token !== "버튼");
        const author = normalizeText(
          metaTokens.find((token) => token.startsWith("작가 "))?.slice("작가 ".length) ?? "",
        );
        const category = metaTokens.find((token) => KAKAO_GENRE_TOKENS.has(token)) ?? "";
        const extraTokens = metaTokens.filter((token) =>
          token !== "웹소설"
          && token !== category
          && !token.startsWith("작가 ")
        );

        entries.push({
          title,
          author,
          category,
          extra: extraTokens.length > 0 ? `[지금핫한] ${extraTokens.join(" · ")}` : "[지금핫한]",
        });
      }
    } catch {
      // skip on network error
    }

    return { platform: "카카오페이지", entries: uniqueEntries(entries) };
  }
}

export class NovelpiaRadarSource implements RadarSource {
  readonly name = "novelpia";

  async fetch(): Promise<PlatformRankings> {
    const entries: RankingEntry[] = [];

    try {
      const url = "https://novelpia.com/top100";
      const res = await globalThis.fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; InkOS/0.1)" },
      });
      if (!res.ok) return { platform: "노벨피아", entries };

      const html = await res.text();
      const blocks = html.split('<div class="col-md-2 novelbox mobile_hidden').slice(1);

      for (const block of blocks) {
        const title = stripLeadingAgeBadge(normalizeText(
          block.match(/<b style="letter-spacing: -2px;font-size: 14px;" class="cut_line_one">([\s\S]*?)<\/b>/)?.[1] ?? "",
        ));
        const author = normalizeText(
          block.match(/<font style="font-size:12px;color:#666;font-weight:400;">([\s\S]*?)<\/font>/)?.[1] ?? "",
        );
        const rank = normalizeText(block.match(/<div class="thumb_s1">\s*([\s\S]*?)\s*<\/div>/)?.[1] ?? "");
        const episode = normalizeText(block.match(/<div class="thumb_s2">\s*([\s\S]*?)\s*<\/div>/)?.[1] ?? "");
        const likes = normalizeText(
          block.match(/<div class="thumb_s5">[\s\S]*?<font class="thumb_s4">[\s\S]*?([0-9.]+K?)\s*<\/font>/)?.[1] ?? "",
        );

        const extraParts = ["[실시간 TOP100]"];
        if (rank) extraParts.push(`#${rank}`);
        if (episode) extraParts.push(episode);
        if (likes) extraParts.push(`선호작 ${likes}`);

        entries.push({
          title,
          author,
          category: "",
          extra: extraParts.join(" "),
        });
      }
    } catch {
      // skip on network error
    }

    return { platform: "노벨피아", entries: uniqueEntries(entries) };
  }
}

export function defaultRadarSourcesForLanguage(language: WritingLanguage): ReadonlyArray<RadarSource> {
  if (language === "ko") {
    return [
      new NaverSeriesRadarSource(),
      new KakaoPageRadarSource(),
      new NovelpiaRadarSource(),
    ];
  }

  return [
    new FanqieRadarSource(),
    new QidianRadarSource(),
  ];
}
