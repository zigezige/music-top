import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { createMusicRankStore, musicRankStoreKey } from './stores/musicRankStore.ts';
import { createAppRouter } from './router.ts';
import { createRouteGuard } from './services/routePolicy.ts';

const router = createAppRouter();
const store = createMusicRankStore(router);

const routeGuard = createRouteGuard(store.initialize, () => ({
    hasCatalog: Boolean(store.catalog.value),
    hasRanking: Boolean(store.ranking.value),
    hasCurrentGroup: Boolean(store.currentGroup.value),
}));

router.beforeEach((to) => routeGuard(String(to.name ?? '')));

const app = createApp(App);
app.use(router);
app.provide(musicRankStoreKey, store);
app.mount('#app');
