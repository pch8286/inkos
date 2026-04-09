import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KakaoPageRadarSource,
  NaverSeriesRadarSource,
  NovelpiaRadarSource,
  defaultRadarSourcesForLanguage,
} from "../agents/radar-source.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("radar sources", () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it("parses NAVER Series daily ranking blocks", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => `
        <div class="comic_cont">
          <h3><em class="ico ico_update">새로운 에피소드</em><a href="/novel/detail.series?productNo=8981942">절대회귀 [독점]</a></h3>
          <p class="info"><span class="author">장영훈</span></p>
          <p class="dsc">복수를 위한 첫걸음은 그렇게 시작되었다.</p>
        </div>
        <div class="comic_cont">
          <h3><a href="/novel/detail.series?productNo=123">게임 속 바바리안으로 살아남기 [독점]</a></h3>
          <p class="info"><span class="author">정윤강</span></p>
        </div>
      `,
    } as Response);

    const result = await new NaverSeriesRadarSource().fetch();

    expect(result.platform).toBe("NAVER 시리즈");
    expect(result.entries).toEqual([
      {
        title: "절대회귀 [독점]",
        author: "장영훈",
        category: "",
        extra: "[일간 TOP100] 복수를 위한 첫걸음은 그렇게 시작되었다.",
      },
      {
        title: "게임 속 바바리안으로 살아남기 [독점]",
        author: "정윤강",
        category: "",
        extra: "[일간 TOP100]",
      },
    ]);
  });

  it("parses KakaoPage webnovel cards and keeps titles containing commas", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => `
        <a href="/content/55806263" aria-label="작품, 의원, 다시 살다, 기다무, 최신 회차 업데이트됨, 웹소설, 버튼"></a>
        <a href="/content/62631873" aria-label="작품, 천재 대장장이의 게임, 기다무, 최신 회차 업데이트됨, 웹소설, 버튼"></a>
        <a href="/content/56714856" aria-label="작품, 계모인데, 딸이 너무 귀여워, 기다무, 웹툰, 버튼"></a>
        <a href="/content/68867526" aria-label="작품, OTT 씹어먹는 천재 디렉터, 기다무, 최신 회차 업데이트됨, 작가 샤이나크, 버튼"></a>
      `,
    } as Response);

    const result = await new KakaoPageRadarSource().fetch();

    expect(result.platform).toBe("카카오페이지");
    expect(result.entries).toEqual([
      {
        title: "의원, 다시 살다",
        author: "",
        category: "",
        extra: "[지금핫한] 기다무 · 최신 회차 업데이트됨",
      },
      {
        title: "천재 대장장이의 게임",
        author: "",
        category: "",
        extra: "[지금핫한] 기다무 · 최신 회차 업데이트됨",
      },
      {
        title: "OTT 씹어먹는 천재 디렉터",
        author: "샤이나크",
        category: "",
        extra: "[지금핫한] 기다무 · 최신 회차 업데이트됨",
      },
    ]);
  });

  it("parses Novelpia top100 desktop blocks", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => `
        <div class="col-md-2 novelbox mobile_hidden hash_ s_inv">
          <div onclick="location='/novel/387014';">
            <div class="thumb_s5"><font class="thumb_s4">7.1K</font></div>
            <div class="thumb_s1">1</div>
            <div class="thumb_s2">EP.174</div>
            <tr>
              <td>
                <b style="letter-spacing: -2px;font-size: 14px;" class="cut_line_one">
                  <span class="b_15_t s_inv">15</span>&nbsp; 가챠 중독자의 퓨전펑크 생활
                </b>
                <font style="font-size:12px;color:#666;font-weight:400;">섦게지는꽃</font>
              </td>
            </tr>
          </div>
        </div>
        <div class="col-md-2 novelbox mobile_hidden hash_ s_inv">
          <div onclick="location='/novel/372180';">
            <div class="thumb_s5"><font class="thumb_s4">6.6K</font></div>
            <div class="thumb_s1">2</div>
            <div class="thumb_s2">EP.237</div>
            <tr>
              <td>
                <b style="letter-spacing: -2px;font-size: 14px;" class="cut_line_one">갤질하는 천재 의사</b>
                <font style="font-size:12px;color:#666;font-weight:400;">렛츠두딧스</font>
              </td>
            </tr>
          </div>
        </div>
      `,
    } as Response);

    const result = await new NovelpiaRadarSource().fetch();

    expect(result.platform).toBe("노벨피아");
    expect(result.entries).toEqual([
      {
        title: "가챠 중독자의 퓨전펑크 생활",
        author: "섦게지는꽃",
        category: "",
        extra: "[실시간 TOP100] #1 EP.174 선호작 7.1K",
      },
      {
        title: "갤질하는 천재 의사",
        author: "렛츠두딧스",
        category: "",
        extra: "[실시간 TOP100] #2 EP.237 선호작 6.6K",
      },
    ]);
  });

  it("switches default radar sources to Korean platforms for Korean projects", () => {
    const names = defaultRadarSourcesForLanguage("ko").map((source) => source.name);
    expect(names).toEqual(["naver-series", "kakao-page", "novelpia"]);
  });
});
