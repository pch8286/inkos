function normalizeSharedRootPath(pathname: string): string {
  const trimmedPath = pathname.replace(/\/+$/u, "") || "/";
  return trimmedPath.endsWith("/cockpit")
    ? trimmedPath.slice(0, -"/cockpit".length)
    : trimmedPath;
}

function normalizeSharedPathWithTrailingSlash(pathname: string): string {
  const rootPath = normalizeSharedRootPath(pathname);
  return rootPath === "/" ? "/" : `${rootPath}/`;
}

export function buildStudioEntrypointUrl(
  pathname: string,
  params?: Readonly<Record<string, string>>,
): string {
  const normalizedPath = normalizeSharedPathWithTrailingSlash(pathname);
  const query = new URLSearchParams(params).toString();
  return query ? `${normalizedPath}?${query}` : normalizedPath;
}

export function buildStandaloneCockpitUrl(
  pathname: string,
  options?: Readonly<{ readonly bookId?: string; readonly newSetup?: boolean }>,
): string {
  const normalizedRoot = normalizeSharedPathWithTrailingSlash(pathname);
  const cockpitPath = normalizedRoot === "/" ? "/cockpit/" : `${normalizedRoot}cockpit/`;
  const params = new URLSearchParams();

  if (!options?.newSetup && options?.bookId?.trim()) {
    params.set("bookId", options.bookId.trim());
  }
  if (options?.newSetup) {
    params.set("newSetup", "1");
  }

  const search = params.toString();
  return search ? `${cockpitPath}?${search}` : cockpitPath;
}

export function resolveCockpitStartupFromSearch(search: string): {
  readonly initialBookId?: string;
  readonly forceNewSetup: boolean;
} {
  const params = new URLSearchParams(search);
  const forceNewSetup = params.get("newSetup") === "1";
  const bookId = params.get("bookId")?.trim() || undefined;

  return {
    initialBookId: forceNewSetup ? undefined : bookId,
    forceNewSetup,
  };
}
