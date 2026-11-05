const pathOf = (url: string) => url.split(/[?#]/)[0];

/** The page swipe plays only when the page itself changes, never for query strings or anchors. */
export function shouldSwipe(prev: string, next: string): boolean {
  return pathOf(prev) !== pathOf(next);
}
