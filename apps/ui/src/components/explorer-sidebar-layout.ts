const DEFAULT_EXPLORER_SIDEBAR_WIDTH = 320;
const MIN_EXPLORER_SIDEBAR_WIDTH = 240;
const MIN_WORKSPACE_BODY_WIDTH = 400;

export function resolveExplorerSidebarWidth(input: {
  requestedWidth?: number;
  containerWidth: number;
  /** Width the dock's own content needs to stay usable (e.g. an icon-only tab rail). */
  minimumWidth?: number;
}): number {
  const requestedWidth = input.requestedWidth ?? DEFAULT_EXPLORER_SIDEBAR_WIDTH;
  const minimumWidth = Math.max(MIN_EXPLORER_SIDEBAR_WIDTH, input.minimumWidth ?? 0);
  const maximumVisibleWidth =
    input.containerWidth > 0
      ? Math.max(minimumWidth, input.containerWidth - MIN_WORKSPACE_BODY_WIDTH)
      : requestedWidth;
  return Math.max(minimumWidth, Math.min(maximumVisibleWidth, requestedWidth));
}

export function resolveExplorerSidebarDockSizes(input: {
  requestedWidth?: number;
  containerWidth: number;
  minimumWidth?: number;
}): number[] {
  if (input.containerWidth <= 0) {
    return [1, 0];
  }
  const width = resolveExplorerSidebarWidth(input);
  const ratio = width / input.containerWidth;
  return [1 - ratio, ratio];
}
