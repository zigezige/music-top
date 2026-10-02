import { createRouter, createWebHistory } from 'vue-router';

export const appRoutes = [
  { path: '/', name: 'search', component: () => import('./views/SearchView.vue') },
  { path: '/catalog', name: 'catalog', component: () => import('./views/CatalogView.vue') },
  { path: '/ranking', name: 'ranking', component: () => import('./views/RankingView.vue') },
  { path: '/paused', name: 'paused', component: () => import('./views/PausedView.vue') },
  { path: '/results', name: 'results', component: () => import('./views/ResultsView.vue') },
  { path: '/share/:shareId', name: 'share', component: () => import('./views/SharedView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export function createAppRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: appRoutes,
    scrollBehavior: () => ({ top: 0 }),
  });
}
