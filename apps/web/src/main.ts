import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { createMusicRankStore, musicRankStoreKey } from './stores/musicRankStore.ts';
import { createAppRouter } from './router.ts';

const router = createAppRouter();
const store = createMusicRankStore(router);

router.beforeEach((to) => {
  if (to.name === 'search' || to.name === 'share') return true;
  if (!store.catalog.value) return { name: 'search', replace: true };
  if (to.name === 'ranking' && !store.currentGroup.value) return { name: 'results', replace: true };
  if ((to.name === 'paused' || to.name === 'results') && !store.ranking.value) return { name: 'search', replace: true };
  return true;
});

const app = createApp(App);
app.use(router);
app.provide(musicRankStoreKey, store);
app.mount('#app');
