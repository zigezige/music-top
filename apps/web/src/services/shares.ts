import type { ShareSnapshot } from '@music-rank/contracts';

type FetchResponse = { ok: boolean; json(): Promise<unknown> };
type FetchLike = (input: string) => Promise<FetchResponse>;

export type SharedSnapshotResult =
  | { status: 'ok'; snapshot: ShareSnapshot }
  | { status: 'unavailable'; message: string };

export async function getSharedSnapshot(shareId: string, fetchImpl: FetchLike = fetch): Promise<SharedSnapshotResult> {
  try {
    const response = await fetchImpl(`/api/v1/shares/${encodeURIComponent(shareId)}`);
    if (!response.ok) throw new Error('Share is unavailable');
    const payload = await response.json();
    const snapshot = payload && typeof payload === 'object' && 'snapshot' in payload ? payload.snapshot : null;
    if (!snapshot || typeof snapshot !== 'object' || !('tracks' in snapshot) || !Array.isArray(snapshot.tracks)) {
      throw new Error('Invalid share response');
    }
    return { status: 'ok', snapshot: snapshot as ShareSnapshot };
  } catch {
    return { status: 'unavailable', message: '链接已失效或暂时不可用。' };
  }
}
