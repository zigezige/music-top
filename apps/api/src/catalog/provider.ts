import type { ArtistCandidate, CatalogTrack } from "@music-rank/contracts";

export interface CatalogFilters {
  versionKind?: CatalogTrack["versionKind"];
}

export interface CatalogProvider {
  searchArtists(query: string): Promise<ArtistCandidate[]>;
  getArtist(artistId: string): Promise<ArtistCandidate | null>;
  getArtistCatalog(artistId: string): Promise<CatalogTrack[]>;
}

export interface CatalogReadinessProvider {
  checkReady(): Promise<boolean>;
}
