import { formatLengthCount, resolveLengthCountingMode } from "@actalk/inkos-core";

export type CliLanguage = "ko" | "zh" | "en";

type StructuralGateFindingShape = {
  readonly code: string;
  readonly message: string;
  readonly evidence?: string;
  readonly location?: string;
};

type StructuralGateNoticeShape = {
  readonly summary: string;
  readonly criticalFindings: ReadonlyArray<StructuralGateFindingShape>;
  readonly softFindings: ReadonlyArray<StructuralGateFindingShape>;
};

type WriteIssue = {
  readonly severity: string;
  readonly category: string;
  readonly description: string;
};

type WriteResultShape = {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly status: string;
  readonly revised: boolean;
  readonly issues: ReadonlyArray<WriteIssue>;
  readonly auditPassed?: boolean;
  readonly passedAudit?: boolean;
};

type ImportResultShape = {
  readonly importedCount: number;
  readonly totalWords: number;
  readonly nextChapter: number;
  readonly continueBookId: string;
};

type RadarRecommendationShape = {
  readonly confidence: number;
  readonly platform: string;
  readonly genre: string;
  readonly concept: string;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
};

type RadarResultShape = {
  readonly marketSummary: string;
  readonly recommendations: ReadonlyArray<RadarRecommendationShape>;
};

function localize(language: CliLanguage, messages: { ko: string; zh: string; en: string }): string {
  if (language === "en") return messages.en;
  if (language === "zh") return messages.zh;
  return messages.ko;
}

export function resolveCliLanguage(language?: string): CliLanguage {
  if (language === "en") return "en";
  if (language === "zh") return "zh";
  return "ko";
}

export function formatBookCreateResume(language: CliLanguage, bookId: string): string {
  return localize(language, {
    ko: `미완성 책 생성 작업을 이어갑니다: "${bookId}"...`,
    zh: `继续未完成的书籍创建：「${bookId}」...`,
    en: `Resuming incomplete book creation for "${bookId}"...`,
  });
}

export function formatBookCreateCreating(
  language: CliLanguage,
  title: string,
  genre: string,
  platform: string,
): string {
  return localize(language, {
    ko: `책 "${title}" (${genre} / ${platform}) 생성 중...`,
    zh: `创建书籍 "${title}"（${genre} / ${platform}）...`,
    en: `Creating book "${title}" (${genre} / ${platform})...`,
  });
}

export function formatBookCreateCreated(language: CliLanguage, bookId: string): string {
  return localize(language, {
    ko: `책 생성 완료: ${bookId}`,
    zh: `已创建书籍：${bookId}`,
    en: `Book created: ${bookId}`,
  });
}

export function formatBookCreateLocation(language: CliLanguage, bookId: string): string {
  return localize(language, {
    ko: `  위치: books/${bookId}/`,
    zh: `  位置：books/${bookId}/`,
    en: `  Location: books/${bookId}/`,
  });
}

export function formatBookCreateFoundationReady(language: CliLanguage): string {
  return localize(language, {
    ko: "  스토리 바이블, 개요, 책 규칙을 생성했습니다.",
    zh: "  故事圣经、大纲和书籍规则已生成。",
    en: "  Story bible, outline, book rules generated.",
  });
}

export function formatBookCreateNextStep(language: CliLanguage, bookId: string): string {
  return localize(language, {
    ko: `다음 단계: inkos write next ${bookId}`,
    zh: `下一步：inkos write next ${bookId}`,
    en: `Next: inkos write next ${bookId}`,
  });
}

export function formatWriteNextProgress(
  language: CliLanguage,
  current: number,
  total: number,
  bookId: string,
): string {
  return localize(language, {
    ko: `[${current}/${total}] "${bookId}" 다음 화 집필 중...`,
    zh: `[${current}/${total}] 为「${bookId}」撰写章节...`,
    en: `[${current}/${total}] Writing chapter for "${bookId}"...`,
  });
}

export function formatWriteNextResultLines(
  language: CliLanguage,
  result: WriteResultShape,
): string[] {
  const auditPassed = result.auditPassed ?? result.passedAudit ?? false;
  const lengthLabel = formatLengthCount(result.wordCount, resolveLengthCountingMode(language));
  const lines = [
    localize(language, {
      ko: `  ${result.chapterNumber}화: ${result.title}`,
      zh: `  第${result.chapterNumber}章：${result.title}`,
      en: `  Chapter ${result.chapterNumber}: ${result.title}`,
    }),
    localize(language, {
      ko: `  분량: ${lengthLabel}`,
      zh: `  字数：${lengthLabel}`,
      en: `  Length: ${lengthLabel}`,
    }),
    localize(language, {
      ko: `  감사: ${auditPassed ? "통과" : "재검토 필요"}`,
      zh: `  审计：${auditPassed ? "通过" : "需复核"}`,
      en: `  Audit: ${auditPassed ? "PASSED" : "NEEDS REVIEW"}`,
    }),
  ];

  if (result.revised) {
    lines.push(localize(language, {
      ko: "  자동 수정: 실행됨 (치명 이슈 수정 완료)",
      zh: "  自动修正：已执行（已修复关键问题）",
      en: "  Auto-revised: YES (critical issues were fixed)",
    }));
  }

  lines.push(localize(language, {
    ko: `  상태: ${result.status}`,
    zh: `  状态：${result.status}`,
    en: `  Status: ${result.status}`,
  }));

  if (result.issues.length > 0) {
    lines.push(localize(language, {
      ko: "  이슈:",
      zh: "  问题：",
      en: "  Issues:",
    }));
    for (const issue of result.issues) {
      lines.push(`    [${issue.severity}] ${issue.category}: ${issue.description}`);
    }
  }

  return lines;
}

export function formatWriteNextComplete(language: CliLanguage): string {
  return localize(language, {
    ko: "완료.",
    zh: "完成。",
    en: "Done.",
  });
}

export function formatWriteStructuralGateNoticeLines(
  language: CliLanguage,
  gate: StructuralGateNoticeShape,
  status: "blocked" | "passed",
): string[] {
  if (status === "passed") {
    if (gate.softFindings.length === 0) {
      return [];
    }

    const codes = gate.softFindings.slice(0, 3).map((finding) => finding.code).join(", ");
    const extraCount = gate.softFindings.length - 3;
    const suffix = gate.softFindings.length > 3
      ? `${codes}, ${localize(language, {
          ko: `+${extraCount}건 더`,
          zh: `另有 ${extraCount} 个`,
          en: `+${extraCount} more`,
        })}`
      : codes;

    return [
      localize(language, {
        ko: `  구조 게이트 참고: 소프트 이슈 ${gate.softFindings.length}건 (${suffix})`,
        zh: `  结构门禁提示：${gate.softFindings.length} 个软性问题（${suffix}）`,
        en: `  Structural gate note: ${gate.softFindings.length} soft finding(s) (${suffix})`,
      }),
    ];
  }

  const lines = [
    localize(language, {
      ko: `  구조 게이트 실패: ${gate.summary}`,
      zh: `  结构门禁失败：${gate.summary}`,
      en: `  Structural gate failed closed: ${gate.summary}`,
    }),
  ];

  if (gate.criticalFindings.length === 0) {
    lines.push(localize(language, {
      ko: "  치명 이슈가 기록되지 않았습니다.",
      zh: "  未记录关键问题。",
      en: "  No critical findings were recorded.",
    }));
    return lines;
  }

  lines.push(localize(language, {
    ko: `  치명 이슈 (${gate.criticalFindings.length}건):`,
    zh: `  关键问题（${gate.criticalFindings.length} 个）：`,
    en: `  Critical findings (${gate.criticalFindings.length}):`,
  }));

  for (const finding of gate.criticalFindings) {
    lines.push(`    - [${finding.code}] ${finding.message}`);
    if (finding.evidence) {
      lines.push(localize(language, {
        ko: `      근거: ${finding.evidence}`,
        zh: `      证据：${finding.evidence}`,
        en: `      Evidence: ${finding.evidence}`,
      }));
    }
    if (finding.location) {
      lines.push(localize(language, {
        ko: `      위치: ${finding.location}`,
        zh: `      位置：${finding.location}`,
        en: `      Location: ${finding.location}`,
      }));
    }
  }

  return lines;
}

export function formatImportChaptersDiscovery(
  language: CliLanguage,
  chapterCount: number,
  bookId: string,
): string {
  return localize(language, {
    ko: `${chapterCount}화를 발견했습니다. "${bookId}"에 가져올 준비를 합니다.`,
    zh: `发现 ${chapterCount} 章，准备导入到「${bookId}」。`,
    en: `Found ${chapterCount} chapters to import into "${bookId}".`,
  });
}

export function formatImportChaptersResume(
  language: CliLanguage,
  resumeFrom: number,
): string {
  return localize(language, {
    ko: `${resumeFrom}화부터 다시 가져옵니다.`,
    zh: `从第 ${resumeFrom} 章继续导入。`,
    en: `Resuming from chapter ${resumeFrom}.`,
  });
}

export function formatImportChaptersComplete(
  language: CliLanguage,
  result: ImportResultShape,
): string[] {
  const lengthLabel = formatLengthCount(result.totalWords, resolveLengthCountingMode(language));
  return [
    localize(language, {
      ko: "가져오기 완료:",
      zh: "导入完成：",
      en: "Import complete:",
    }),
    localize(language, {
      ko: `  가져온 화수: ${result.importedCount}`,
      zh: `  已导入章节：${result.importedCount}`,
      en: `  Chapters imported: ${result.importedCount}`,
    }),
    localize(language, {
      ko: `  총 분량: ${lengthLabel}`,
      zh: `  总长度：${lengthLabel}`,
      en: `  Total length: ${lengthLabel}`,
    }),
    localize(language, {
      ko: `  다음 화 번호: ${result.nextChapter}`,
      zh: `  下一章编号：${result.nextChapter}`,
      en: `  Next chapter number: ${result.nextChapter}`,
    }),
    "",
    localize(language, {
      ko: `"inkos write next ${result.continueBookId}"를 실행해 이어서 집필하세요.`,
      zh: `运行 "inkos write next ${result.continueBookId}" 继续写作。`,
      en: `Run "inkos write next ${result.continueBookId}" to continue writing.`,
    }),
  ];
}

export function formatImportCanonStart(
  language: CliLanguage,
  parentBookId: string,
  targetBookId: string,
): string {
  return localize(language, {
    ko: `"${parentBookId}"의 정전을 "${targetBookId}"에 가져오는 중...`,
    zh: `把 "${parentBookId}" 的正典导入到 "${targetBookId}"...`,
    en: `Importing canon from "${parentBookId}" into "${targetBookId}"...`,
  });
}

export function formatImportCanonComplete(language: CliLanguage): string[] {
  return [
    localize(language, {
      ko: "정전 가져오기 완료: story/parent_canon.md",
      zh: "正典已导入：story/parent_canon.md",
      en: "Canon imported: story/parent_canon.md",
    }),
    localize(language, {
      ko: "Writer와 auditor가 외전 모드에서 이 파일을 자동 인식합니다.",
      zh: "Writer 和 auditor 会在番外模式下自动识别这个文件。",
      en: "Writer and auditor will auto-detect this file for spinoff mode.",
    }),
  ];
}

export function formatRadarScanStart(language: CliLanguage): string {
  return localize(language, {
    ko: "시장 레이더 스캔 중...",
    zh: "扫描市场中...",
    en: "Scanning market...",
  });
}

export function formatRadarReportLines(
  language: CliLanguage,
  result: RadarResultShape,
  savedPath: string,
): string[] {
  const lines = [
    localize(language, {
      ko: "시장 요약:",
      zh: "市场概要：",
      en: "Market Summary:",
    }),
    result.marketSummary,
    "",
    localize(language, {
      ko: "추천:",
      zh: "推荐：",
      en: "Recommendations:",
    }),
  ];

  for (const rec of result.recommendations) {
    lines.push(`  [${(rec.confidence * 100).toFixed(0)}%] ${rec.platform}/${rec.genre}`);
    lines.push(localize(language, {
      ko: `    콘셉트: ${rec.concept}`,
      zh: `    概念：${rec.concept}`,
      en: `    Concept: ${rec.concept}`,
    }));
    lines.push(localize(language, {
      ko: `    근거: ${rec.reasoning}`,
      zh: `    理由：${rec.reasoning}`,
      en: `    Reasoning: ${rec.reasoning}`,
    }));
    lines.push(localize(language, {
      ko: `    비교작: ${rec.benchmarkTitles.join(", ")}`,
      zh: `    对标：${rec.benchmarkTitles.join(", ")}`,
      en: `    Benchmarks: ${rec.benchmarkTitles.join(", ")}`,
    }));
    lines.push("");
  }

  lines.push(localize(language, {
    ko: `레이더 결과 저장: ${savedPath}`,
    zh: `雷达结果已保存：${savedPath}`,
    en: `Radar result saved to ${savedPath}`,
  }));

  return lines;
}

function normalizeRadarFailureMessageForKo(error: string): string {
  const trimmed = error.trim();

  if (!trimmed) {
    return "요청을 처리할 수 없었습니다. 잠시 후 다시 시도해 주세요.";
  }

  if (/API 返回 400|API returned 400|400 \(invalid request|400 \(bad request/i.test(trimmed)) {
    return "요청 파라미터 오류(400)로 스캔이 실패했습니다. 모델명, max_tokens, stream, 메시지 형식 지원 여부를 확인해 주세요.";
  }

  if (/API 返回 401|API returned 401|401 \(unauthorized/i.test(trimmed)) {
    return "인증 실패(401)로 스캔을 진행하지 못했습니다. API 키와 인증 정보를 다시 확인해 주세요.";
  }

  if (/API 返回 403|API returned 403|403 \(forbidden/i.test(trimmed)) {
    return "요청이 거부(403)되어 스캔이 실패했습니다. 계정/권한 또는 네트워크 정책을 확인해 주세요.";
  }

  if (/API 返回 429|API returned 429|429 \(too many requests/i.test(trimmed)) {
    return "요청이 너무 빈번합니다(429). 잠시 후 다시 시도해 주세요.";
  }

  if (/无法连接到 API 服务|Could not connect to the API service/.test(trimmed) || /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(trimmed)) {
    return "API 연결에 실패했습니다. baseUrl·네트워크·방화벽 설정을 확인해 주세요.";
  }

  if (/API 提供方要求使用流式请求|provider requires streaming|stream must be set to true/i.test(trimmed)) {
    return "제공자가 스트리밍 모드(stream=true)를 요구합니다. 해당 설정으로 다시 시도해 주세요.";
  }

  if (/[\u4e00-\u9fff]/.test(trimmed)) {
    return "레이더 스캔 중 제공자 응답을 처리하지 못했습니다. 로그에서 상세 원인을 확인하고 모델·파라미터를 점검해 주세요.";
  }

  return trimmed;
}

export function formatRadarScanFailed(
  language: CliLanguage,
  error: unknown,
): string {
  const normalizedError = String(error);
  const localizedError = language === "ko"
    ? normalizeRadarFailureMessageForKo(normalizedError)
    : `Radar scan failed: ${normalizedError}`;

  if (language === "ko") {
    return `레이더 스캔 실패: ${localizedError}`;
  }

  return localizedError;
}
