type RouteName = 'search' | 'catalog' | 'ranking' | 'paused' | 'results' | 'share' | string;

interface RouteState {
  hasCatalog: boolean;
  hasRanking: boolean;
  hasCurrentGroup?: boolean;
}

export function createRouteGuard(
  restoreState: (routeName: string) => Promise<void>,
  readState: () => RouteState,
) {
  return async (routeName: string) => {
    if (routeName === 'share') return true;
    await restoreState(routeName);
    const redirect = getRouteRedirect(routeName, readState());
    return redirect ? { path: redirect, replace: true as const } : true;
  };
}

export function getRouteRedirect(routeName: RouteName, state: RouteState): string | null {
  if (routeName === 'search' || routeName === 'share') return null;
  if (!state.hasCatalog) return '/';
  if (routeName === 'ranking') {
    if (!state.hasRanking) return '/';
    if (!state.hasCurrentGroup) return '/results';
  }
  if ((routeName === 'paused' || routeName === 'results') && !state.hasRanking) return '/';
  return null;
}
