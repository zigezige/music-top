import type { ArtistCandidate, CatalogTrack } from "@music-rank/contracts";
import { ApiError } from "../errors.js";
import type { CatalogProvider } from "./provider.js";

export type QqMusicFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface QqMusicCatalogProviderOptions {
  pageSize?: number;
  maxPages?: number;
}

const defaultBaseUrl = "http://localhost:3200";
// Larger song limits still shift QQ's page offsets, although it returns at most 60 rows.
const maxQqPageSize = 60;
const defaultPageSize = maxQqPageSize;
const defaultMaxPages = 100;
const artistIdPattern = /^qqmusic:([^:]+)$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function number(...values: unknown[]): number | undefined {
  for (const value of values) {
    const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(result) && result >= 0) return result;
  }
  return undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ApiError(503, "QQMUSIC_INVALID_RESPONSE", "QQ Music API returned invalid JSON.");
  }
}

function encodeArtistId(mid: string, name: string): string {
  return `qqmusic:${Buffer.from(JSON.stringify([mid, name])).toString("base64url")}`;
}

function decodeArtistId(value: string): { mid: string; name: string } | null {
  const match = artistIdPattern.exec(value);
  if (!match?.[1]) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || typeof decoded[0] !== "string" || typeof decoded[1] !== "string") return null;
    if (!decoded[0].trim() || !decoded[1].trim()) return null;
    return { mid: decoded[0], name: decoded[1] };
  } catch {
    return null;
  }
}

function unwrapResponse(value: unknown): Record<string, unknown> {
  let root = record(value);
  for (let depth = 0; depth < 3; depth += 1) {
    const next = record(root?.response) ?? record(root?.body);
    if (!next) break;
    root = next;
  }
  return root ?? {};
}

function responseCode(value: Record<string, unknown>): number | undefined {
  const code = value.code ?? record(value.response)?.code;
  const parsed = typeof code === "number" ? code : typeof code === "string" ? Number(code) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isSuccessful(value: Record<string, unknown>): boolean {
  const code = responseCode(value);
  return code === undefined || code === 0;
}

function singerRows(value: unknown): unknown[] {
  const root = unwrapResponse(value);
  const data = record(root.data) ?? root;
  const singer = record(data.singer) ?? data;
  const rows = singer.list ?? singer.itemlist ?? singer.itemList ?? singer.singers;
  if (!Array.isArray(rows)) {
    throw new ApiError(503, "QQMUSIC_INVALID_RESPONSE", "QQ Music API returned invalid singer search data.");
  }
  return rows;
}

function songData(value: unknown): { rows: unknown[]; total?: number } {
  const root = unwrapResponse(value);
  const data = record(root.data) ?? root;
  const singer = record(data.singer) ?? data;
  const singerData = record(singer.data) ?? singer;
  const rows = singerData.songlist ?? singerData.songList ?? data.songlist ?? data.songList ?? root.songlist ?? root.songList;
  if (!Array.isArray(rows)) {
    throw new ApiError(503, "QQMUSIC_INVALID_RESPONSE", "QQ Music API returned invalid singer song data.");
  }
  const total = number(singerData.total_song, singerData.totalSong, data.total_song, data.totalSong);
  return { rows, ...(total === undefined ? {} : { total }) };
}

function singerAlbumData(value: unknown): { rows: unknown[]; total?: number } {
  const root = unwrapResponse(value);
  const data = record(root.data) ?? root;
  const singer = record(data.singer) ?? data;
  const singerData = record(singer.data) ?? singer;
  const rows = singerData.albumList ?? singerData.albumlist ?? singerData.albums;
  if (!Array.isArray(rows)) {
    throw new ApiError(503, "QQMUSIC_INVALID_RESPONSE", "QQ Music API returned invalid singer album data.");
  }
  const total = number(singerData.total, singerData.total_album, singerData.totalAlbum);
  return { rows, ...(total === undefined ? {} : { total }) };
}

function albumTypeFromInfo(value: unknown): string | undefined {
  const root = unwrapResponse(value);
  const data = record(root.data) ?? root;
  const album = record(data.album) ?? data;
  return text(album.albumType, album.albumtype, album.typeName, album.type);
}

function songAlbumMid(value: unknown): string | undefined {
  const outer = record(value);
  const item = record(outer?.songInfo) ?? outer;
  const album = record(item?.album);
  return text(album?.mid, album?.albumMid, item?.albummid, item?.albumMid);
}

function artistCandidate(mid: string, name: string): ArtistCandidate {
  return {
    id: encodeArtistId(mid, name),
    name,
    sourceName: name,
    sourceArtistId: mid,
    disambiguation: "QQ 音乐",
  };
}

function dateOnly(value: string | undefined): string | undefined {
  const match = value && /^(\d{4}(?:-\d{2}(?:-\d{2})?))/.exec(value);
  return match?.[1];
}

function namesFromValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const name = text(item?.name, item?.title) ?? (typeof entry === "string" ? entry.trim() : undefined);
    return name ? [name] : [];
  });
}

function mapVersionKind(
  title: string,
  subtitle?: string,
  albumTitle?: string,
  albumSubtitle?: string,
  albumType?: string,
): CatalogTrack["versionKind"] {
  // QQ's numeric version value mixes live and ordinary tracks; descriptive metadata is safer.
  const value = `${title} ${subtitle ?? ""} ${albumTitle ?? ""} ${albumSubtitle ?? ""} ${albumType ?? ""}`.toLowerCase();
  if (/live|现场|演唱会|演唱會|音乐会|音樂會|concert|unplugged/.test(value)) return "live";
  if (/instrumental|伴奏/.test(value)) return "instrumental";
  if (/remix|混音/.test(value)) return "remix";
  if (/cover|翻唱/.test(value)) return "cover";
  if (/demo|试听|試聽|片段|karaoke|卡拉ok/.test(value)) return "other";
  if (/studio|录音室|single|单曲|\bep\b|迷你专辑|专辑|合辑|精选辑|精选集|compilation|原声带|soundtrack|\bost\b/.test(albumType?.toLowerCase() ?? "")) {
    return "studio";
  }
  return "other";
}

interface MappedTrack {
  track: CatalogTrack;
  deduplicationKey: string;
}

function normalizedKeyPart(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function trackDeduplicationKey(track: CatalogTrack, sourceId: string, duration: number | undefined): string {
  if (duration === undefined) return `source:${sourceId}`;
  const title = normalizedKeyPart(track.title);
  const artists = track.creditedArtists.map(normalizedKeyPart).filter(Boolean).sort();
  if (!title || artists.length === 0) return `source:${sourceId}`;
  return JSON.stringify([title, artists, duration]);
}

function albumMetadataScore(track: CatalogTrack): number {
  return Number(Boolean(track.albumTitle)) * 2
    + Number(Boolean(track.albumCoverUrl))
    + Number(Boolean(track.releaseDate));
}

function preferTrack(candidate: CatalogTrack, current: CatalogTrack): boolean {
  const candidateScore = albumMetadataScore(candidate);
  const currentScore = albumMetadataScore(current);
  if (candidateScore !== currentScore) return candidateScore > currentScore;
  if (candidate.releaseDate && current.releaseDate && candidate.releaseDate !== current.releaseDate) {
    return candidate.releaseDate < current.releaseDate;
  }
  if (candidate.releaseDate && !current.releaseDate) return true;
  return false;
}

function mapTrack(value: unknown, fallbackArtist: string, albumTypes: ReadonlyMap<string, string>): MappedTrack | null {
  const outer = record(value);
  const item = record(outer?.songInfo) ?? outer;
  if (!item) return null;
  const sourceId = text(item.mid, item.songmid, item.songMid, item.id);
  const title = text(item.name, item.title);
  if (!sourceId || !title) return null;

  const album = record(item.album);
  const albumTitle = text(album?.name, album?.title, item.albumname, item.albumName);
  const albumSubtitle = text(album?.subtitle);
  const albumMid = text(album?.mid, album?.albumMid, item.albummid, item.albumMid);
  const albumPictureId = text(album?.pmid, item.albumpmid, item.albumPmid);
  const releaseDate = dateOnly(text(
    album?.time_public,
    album?.publishDate,
    item.time_public,
    item.publishDate,
  ));
  const creditedArtists = [
    ...namesFromValue(item.singer),
    ...namesFromValue(item.artists),
    ...namesFromValue(item.artist),
  ];
  const names = [...new Set(creditedArtists.length ? creditedArtists : [fallbackArtist])];
  const albumCoverUrl = albumPictureId
    ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${encodeURIComponent(albumPictureId)}.jpg`
    : albumMid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${encodeURIComponent(albumMid)}_1.jpg`
      : undefined;
  const track: CatalogTrack = {
    id: `qqmusic:${encodeURIComponent(sourceId)}`,
    title,
    creditedArtists: names,
    ...(albumTitle ? { albumTitle } : {}),
    ...(albumCoverUrl ? { albumCoverUrl } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    versionKind: mapVersionKind(
      title,
      text(item.subtitle),
      albumTitle,
      albumSubtitle,
      albumMid ? albumTypes.get(albumMid) : undefined,
    ),
    sources: ["qqmusic"],
    outboundLinks: [],
  };
  const duration = number(item.interval);
  return {
    track,
    deduplicationKey: trackDeduplicationKey(track, sourceId, duration && duration > 0 ? duration : undefined),
  };
}

export class QqMusicCatalogProvider implements CatalogProvider {
  private readonly fetcher: QqMusicFetch;
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly maxPages: number;

  constructor(
    fetcher: QqMusicFetch = fetch,
    baseUrl = process.env.QQ_MUSIC_API_URL ?? defaultBaseUrl,
    options: QqMusicCatalogProviderOptions = {},
  ) {
    this.fetcher = fetcher;
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
    this.pageSize = Number.isInteger(options.pageSize) && options.pageSize! > 0
      ? Math.min(options.pageSize!, maxQqPageSize)
      : defaultPageSize;
    this.maxPages = Number.isInteger(options.maxPages) && options.maxPages! > 0 ? options.maxPages! : defaultMaxPages;
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams(params);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}?${query.toString()}`, {
        headers: {
          accept: "application/json",
          "user-agent": "music-rank-h5/0.1 (QQ Music API catalog)",
        },
      });
    } catch {
      throw new ApiError(503, "QQMUSIC_UNAVAILABLE", "QQ Music API is temporarily unavailable.");
    }
    if (!response.ok) throw new ApiError(503, "QQMUSIC_UNAVAILABLE", "QQ Music API is temporarily unavailable.");
    const payload = parseJson(await response.text());
    const root = unwrapResponse(payload);
    if (!isSuccessful(root)) throw new ApiError(503, "QQMUSIC_UNAVAILABLE", "QQ Music API returned an error.");
    return payload;
  }

  async searchArtists(query: string): Promise<ArtistCandidate[]> {
    const payload = await this.request("/getSmartbox", {
      key: query.trim(),
    });
    const found = new Map<string, ArtistCandidate>();
    for (const row of singerRows(payload)) {
      const item = record(row);
      const mid = text(item?.mid, item?.singerMID, item?.singerMid, item?.id, item?.docid);
      const name = text(item?.name, item?.singerName, item?.singer, item?.title);
      if (mid && name && !found.has(mid)) found.set(mid, artistCandidate(mid, name));
    }
    return [...found.values()].slice(0, 100);
  }

  async getArtist(artistId: string): Promise<ArtistCandidate | null> {
    const parsed = decodeArtistId(artistId);
    return parsed ? artistCandidate(parsed.mid, parsed.name) : null;
  }

  private async getSingerAlbumTypes(singerMid: string): Promise<Map<string, string>> {
    const albumTypes = new Map<string, string>();
    let total: number | undefined;
    let fetchedCount = 0;
    for (let page = 0; page < this.maxPages; page += 1) {
      const payload = await this.request("/getSingerAlbum", {
        singermid: singerMid,
        limit: String(this.pageSize),
        // This endpoint treats page as an offset, unlike getSingerHotsong.
        page: String(page * this.pageSize),
      });
      const result = singerAlbumData(payload);
      total = result.total ?? total;
      fetchedCount += result.rows.length;
      for (const row of result.rows) {
        const item = record(row);
        const albumMid = text(item?.albumMid, item?.albummid, item?.mid);
        const albumType = text(item?.albumType, item?.albumtype, item?.type);
        if (albumMid && albumType) albumTypes.set(albumMid, albumType);
      }
      if (
        result.rows.length === 0 ||
        (total !== undefined && fetchedCount >= total) ||
        (total === undefined && result.rows.length < this.pageSize)
      ) break;
    }
    return albumTypes;
  }

  private async resolveMissingAlbumTypes(songRows: unknown[], albumTypes: Map<string, string>): Promise<void> {
    const unresolved = [...new Set(songRows.map(songAlbumMid).filter((mid): mid is string => Boolean(mid)))]
      .filter((mid) => !albumTypes.has(mid));
    const batchSize = 8;
    for (let index = 0; index < unresolved.length; index += batchSize) {
      const batch = unresolved.slice(index, index + batchSize);
      const resolved = await Promise.all(batch.map(async (albumMid) => {
        try {
          const payload = await this.request("/getAlbumInfo", { albummid: albumMid });
          return [albumMid, albumTypeFromInfo(payload)] as const;
        } catch {
          return [albumMid, undefined] as const;
        }
      }));
      for (const [albumMid, albumType] of resolved) {
        if (albumType) albumTypes.set(albumMid, albumType);
      }
    }
  }

  async getArtistCatalog(artistId: string): Promise<CatalogTrack[]> {
    const parsed = decodeArtistId(artistId);
    if (!parsed) return [];
    const albumTypes = await this.getSingerAlbumTypes(parsed.mid);
    const songRows: unknown[] = [];
    let total: number | undefined;
    let fetchedCount = 0;
    for (let page = 1; page <= this.maxPages; page += 1) {
      const payload = await this.request("/getSingerHotsong", {
        singermid: parsed.mid,
        limit: String(this.pageSize),
        page: String(page),
      });
      const result = songData(payload);
      total = result.total ?? total;
      fetchedCount += result.rows.length;
      songRows.push(...result.rows);
      if (
        result.rows.length === 0 ||
        (total !== undefined && fetchedCount >= total) ||
        (total === undefined && result.rows.length < this.pageSize)
      ) break;
    }
    await this.resolveMissingAlbumTypes(songRows, albumTypes);

    const tracksBySourceId = new Map<string, MappedTrack>();
    for (const row of songRows) {
      const mapped = mapTrack(row, parsed.name, albumTypes);
      if (!mapped || mapped.track.versionKind !== "studio") continue;
      const existing = tracksBySourceId.get(mapped.track.id);
      if (!existing || preferTrack(mapped.track, existing.track)) {
        tracksBySourceId.set(mapped.track.id, mapped);
      }
    }
    const uniqueTracks = new Map<string, CatalogTrack>();
    for (const mapped of tracksBySourceId.values()) {
      const existing = uniqueTracks.get(mapped.deduplicationKey);
      if (!existing || preferTrack(mapped.track, existing)) {
        uniqueTracks.set(mapped.deduplicationKey, mapped.track);
      }
    }
    return [...uniqueTracks.values()];
  }
}
