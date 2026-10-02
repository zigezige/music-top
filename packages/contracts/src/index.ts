export type TrackVersionKind =
  | "studio"
  | "live"
  | "instrumental"
  | "remix"
  | "cover"
  | "other";

export interface ArtistCandidate {
  id: string;
  name: string;
  sourceName: string;
  sourceArtistId: string;
  disambiguation?: string;
}

export interface OutboundLink {
  provider: string;
  url: string;
  label: string;
}

export interface CatalogTrack {
  id: string;
  title: string;
  creditedArtists: string[];
  albumTitle?: string;
  albumCoverUrl?: string;
  releaseDate?: string;
  versionKind: TrackVersionKind;
  sources: string[];
  outboundLinks: OutboundLink[];
}

export interface CatalogSnapshot {
  artist: ArtistCandidate;
  version: string;
  fetchedAt: string;
  tracks: CatalogTrack[];
}

export interface ComparisonChoice {
  id: string;
  candidateTrackIds: string[];
  selectedTrackId: string | null;
  kind: "choice" | "skip";
  roundKind: "coverage" | "calibration" | "revival";
  createdAt: string;
}

export interface RankedTrack {
  trackId: string;
  score: number;
  uncertainty: number;
  exposureCount: number;
  selectedCount: number;
  provisional: boolean;
}

export interface RankingResult {
  tracks: RankedTrack[];
  coverageRatio: number;
  completedRounds: number;
  status: "in_progress" | "provisional" | "complete";
  algorithmVersion: string;
}

export interface ShareSnapshot {
  artistName: string;
  catalogSources?: string[];
  tracks: Array<{
    title: string;
    creditedArtists: string[];
    albumTitle?: string;
    albumCoverUrl?: string;
    versionKind: TrackVersionKind;
    rank: number;
    outboundLinks: OutboundLink[];
  }>;
  status: "provisional" | "complete";
  createdAt: string;
  expiresAt: string;
}

export interface CatalogIssuePayload {
  artistId: string;
  trackId?: string;
  kind: "missing" | "duplicate" | "misattributed";
  details?: string;
}
