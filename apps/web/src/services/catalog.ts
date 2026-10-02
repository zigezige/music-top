import type { ArtistCandidate, CatalogSnapshot } from '@music-rank/contracts';

type FetchResponse = { ok: boolean; json(): Promise<unknown> };
type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

export interface CatalogOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

export type CatalogResult<T> =
  | { source: 'api'; items: T[]; label?: never; message?: never }
  | { source: 'unavailable'; items: T[]; label?: never; message: string };

function getFetch(options: CatalogOptions): FetchLike {
  return options.fetchImpl ?? fetch;
}

function unwrapItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    if ('items' in payload && Array.isArray(payload.items)) return payload.items as T[];
    if ('artists' in payload && Array.isArray(payload.artists)) return payload.artists as T[];
  }
  return [];
}

export async function searchArtists(query: string, options: CatalogOptions): Promise<CatalogResult<ArtistCandidate>> {
  const trimmed = query.trim();
  if (!trimmed) return { source: 'api', items: [] };

  try {
    const response = await getFetch(options)(`${options.baseUrl ?? ''}/api/v1/artists?query=${encodeURIComponent(trimmed)}`);
    if (!response.ok) throw new Error('Catalog API unavailable');
    const items = unwrapItems<ArtistCandidate>(await response.json());
    return { source: 'api', items };
  } catch {
    return { source: 'unavailable', items: [], message: '暂时无法连接曲库，请稍后重试。' };
  }
}

export async function getArtistCatalog(artist: ArtistCandidate, options: CatalogOptions): Promise<CatalogResult<CatalogSnapshot>> {
  try {
    const response = await getFetch(options)(`${options.baseUrl ?? ''}/api/v1/artists/${encodeURIComponent(artist.id)}/catalog`);
    if (!response.ok) throw new Error('Catalog API unavailable');
    const payload = await response.json();
    const snapshot = payload && typeof payload === 'object' && 'snapshot' in payload ? payload.snapshot : payload;
    if (!snapshot || typeof snapshot !== 'object' || !('tracks' in snapshot) || !Array.isArray(snapshot.tracks)) {
      throw new Error('Invalid catalog response');
    }
    return { source: 'api', items: [snapshot as CatalogSnapshot] };
  } catch {
    return { source: 'unavailable', items: [], message: '暂时无法加载该歌手的曲库，请稍后重试。' };
  }
}
