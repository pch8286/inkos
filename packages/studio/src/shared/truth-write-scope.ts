import type { TruthAssistRequest, TruthSaveRequest, TruthWriteScope } from "./contracts.js";

function normalizeTargetFileName(fileName: string): string {
  return fileName.trim();
}

function normalizeTruthWriteScope(scope: TruthWriteScope): TruthWriteScope {
  if (scope.kind === "read-only") {
    return scope;
  }
  if (scope.kind === "file") {
    return {
      kind: "file",
      fileName: normalizeTargetFileName(scope.fileName),
    };
  }
  return {
    kind: "bundle",
    fileNames: [...new Set(scope.fileNames.map(normalizeTargetFileName).filter(Boolean))] as [string, ...string[]],
  };
}

export function canWriteTruthFile(scope: TruthWriteScope, fileName: string): boolean {
  const targetFileName = normalizeTargetFileName(fileName);
  const normalizedScope = normalizeTruthWriteScope(scope);

  switch (normalizedScope.kind) {
    case "read-only":
      return false;
    case "file":
      return normalizedScope.fileName === targetFileName;
    case "bundle":
      return normalizedScope.fileNames.includes(targetFileName);
    default: {
      const exhaustiveScope: never = normalizedScope;
      void exhaustiveScope;
      return false;
    }
  }
}

export function isTruthProposalApplicable(scope: TruthWriteScope, fileName: string): boolean {
  return canWriteTruthFile(scope, fileName);
}

export function buildTruthAssistRequest(input: {
  readonly fileNames: ReadonlyArray<string>;
  readonly instruction: string;
  readonly mode: "proposal" | "question";
  readonly scope: TruthWriteScope;
  readonly conversation?: TruthAssistRequest["conversation"];
  readonly alignment?: TruthAssistRequest["alignment"];
}): TruthAssistRequest {
  const uniqueFileNames = [...new Set(input.fileNames.map(normalizeTargetFileName).filter(Boolean))];
  const scope = normalizeTruthWriteScope(input.scope);
  if (uniqueFileNames.length === 0) {
    throw new Error("Truth assist requests require at least one target file.");
  }

  if (scope.kind === "file") {
    if (uniqueFileNames.length !== 1 || !canWriteTruthFile(scope, uniqueFileNames[0]!)) {
      throw new Error("File-scoped truth assist requests must target exactly one matching file.");
    }
  }

  if (scope.kind === "bundle") {
    const normalizedScopeFiles = [...scope.fileNames];
    if (
      uniqueFileNames.length !== normalizedScopeFiles.length
      || uniqueFileNames.some((fileName) => !normalizedScopeFiles.includes(fileName))
    ) {
      throw new Error("Bundle-scoped truth assist requests must target the same files as the scope.");
    }
  }

  if (input.mode === "proposal" && scope.kind === "read-only") {
    throw new Error("Truth proposal requests require explicit file scope.");
  }

  if (input.mode === "proposal") {
    if (scope.kind === "file") {
      return {
        instruction: input.instruction,
        mode: "proposal" as const,
        conversation: input.conversation,
        alignment: input.alignment,
        scope,
        fileName: uniqueFileNames[0]!,
      };
    }

    return {
      fileNames: uniqueFileNames as [string, ...string[]],
      instruction: input.instruction,
      mode: "proposal" as const,
      conversation: input.conversation,
      alignment: input.alignment,
      scope,
    };
  }

  return uniqueFileNames.length === 1
    ? {
      instruction: input.instruction,
      mode: "question" as const,
      conversation: input.conversation,
      alignment: input.alignment,
      scope,
      fileName: uniqueFileNames[0]!,
    }
    : {
      instruction: input.instruction,
      mode: "question" as const,
      conversation: input.conversation,
      alignment: input.alignment,
      scope,
      fileNames: uniqueFileNames as [string, ...string[]],
    };
}

export function buildTruthSaveRequest(content: string, scope: TruthWriteScope): TruthSaveRequest {
  return { content, scope: normalizeTruthWriteScope(scope) };
}
