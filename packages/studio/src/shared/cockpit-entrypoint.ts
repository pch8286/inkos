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
  options?: Readonly<{ readonly bookId?: string }>,
): string {
  const normalizedRoot = normalizeSharedPathWithTrailingSlash(pathname);
  const cockpitPath = normalizedRoot === "/" ? "/cockpit/" : `${normalizedRoot}cockpit/`;
  const params = new URLSearchParams();

  if (options?.bookId?.trim()) {
    params.set("bookId", options.bookId.trim());
  }

  const search = params.toString();
  return search ? `${cockpitPath}?${search}` : cockpitPath;
}
