import { describe, expect, it } from "vitest";
import {
  completeRanking,
  createRankingSession,
  endRankingEarly,
  getNextGroup,
  getRankingResult,
  recordChoice,
} from "../src/index.js";

describe("ranking session", () => {
  it("uses repeated top-choice evidence to rank a consistent winner first", () => {
    let session = createRankingSession(["a", "b", "c", "d"]);
    const rounds = ["a", "a", "a", "b"];

    for (const winner of rounds) {
      const group = getNextGroup(session);
      expect(group).not.toBeNull();
      expect(group?.candidateTrackIds).toContain(winner);
      session = recordChoice(session, group?.candidateTrackIds ?? [], winner);
    }

    const result = getRankingResult(session);
    expect(result.tracks[0]?.trackId).toBe("a");
    expect(result.tracks[0]?.score).toBeGreaterThan(result.tracks[1]?.score ?? 0);
    expect(result.tracks.find((track) => track.trackId === "a")?.selectedCount).toBe(3);
  });

  it("ignores skipped rounds as preference evidence while counting exposure", () => {
    const initial = createRankingSession(["a", "b", "c", "d"]);
    const group = getNextGroup(initial);
    const session = recordChoice(initial, group?.candidateTrackIds ?? [], null);
    const result = getRankingResult(session);

    expect(result.tracks.every((track) => track.score === 0)).toBe(true);
    expect(result.tracks.every((track) => track.exposureCount === 1)).toBe(true);
    expect(result.coverageRatio).toBe(1);
    expect(result.tracks.every((track) => track.uncertainty > 0)).toBe(true);
  });

  it("marks incomplete and early-ended sessions provisional at the right level", () => {
    const initial = createRankingSession(["a", "b", "c", "d", "e"]);
    const group = getNextGroup(initial);
    const partial = recordChoice(initial, group?.candidateTrackIds ?? [], "a");
    const ended = endRankingEarly(createRankingSession(["a", "b", "c", "d", "e"]));

    expect(getRankingResult(partial).coverageRatio).toBeLessThan(1);
    expect(getRankingResult(partial).status).toBe("in_progress");
    expect(getRankingResult(ended).status).toBe("provisional");
    expect(getRankingResult(ended).tracks.every((track) => track.provisional)).toBe(true);
  });

  it("marks an explicitly completed but uncertain ranking provisional", () => {
    const completed = completeRanking(createRankingSession(["a", "b", "c", "d"]));
    expect(getRankingResult(completed).status).toBe("provisional");
  });

  it("completes a singleton catalog without requiring comparison evidence", () => {
    const result = getRankingResult(completeRanking(createRankingSession(["solo"])));

    expect(result.status).toBe("complete");
    expect(result.tracks[0]?.provisional).toBe(false);
  });

  it("uses the configured uncertainty threshold when determining provisional tracks", () => {
    let session = createRankingSession(["a", "b", "c", "d"], {
      provisionalUncertaintyThreshold: 10,
    });
    for (let i = 0; i < 4; i += 1) {
      const group = getNextGroup(session);
      session = recordChoice(session, group?.candidateTrackIds ?? [], "a");
    }
    const completed = completeRanking(session);

    expect(getRankingResult(completed).status).toBe("complete");
    expect(getRankingResult(completed).tracks.every((track) => !track.provisional)).toBe(true);
  });

  it("returns identical estimates for identical event history", () => {
    let left = createRankingSession(["a", "b", "c", "d", "e"], { seed: 24 });
    let right = createRankingSession(["a", "b", "c", "d", "e"], { seed: 24 });
    const leftGroup = getNextGroup(left);
    const rightGroup = getNextGroup(right);
    expect(leftGroup).toEqual(rightGroup);
    const candidates = leftGroup?.candidateTrackIds ?? [];
    left = recordChoice(left, candidates, candidates[0] ?? null);
    right = recordChoice(right, candidates, candidates[0] ?? null);

    expect(getRankingResult(left)).toEqual(getRankingResult(right));
  });

  it("rejects a choice outside the scheduled group", () => {
    const session = createRankingSession(["a", "b", "c", "d"]);
    const group = getNextGroup(session);
    expect(() => recordChoice(session, group?.candidateTrackIds ?? [], "not-in-group")).toThrow();
  });
});

describe("adaptive comparison groups", () => {
  it("covers every track before calibration and uses group sizes from four through six", () => {
    let session = createRankingSession(["a", "b", "c", "d", "e", "f", "g", "h"], { seed: 14 });
    const shown = new Set<string>();

    for (let round = 0; round < 4 && shown.size < 8; round += 1) {
      const group = getNextGroup(session);
      expect(group?.roundKind).toBe("coverage");
      expect(group?.candidateTrackIds.length).toBeGreaterThanOrEqual(4);
      expect(group?.candidateTrackIds.length).toBeLessThanOrEqual(6);
      for (const id of group?.candidateTrackIds ?? []) shown.add(id);
      session = recordChoice(session, group?.candidateTrackIds ?? [], group?.candidateTrackIds[0] ?? null);
    }

    expect(shown).toEqual(new Set(["a", "b", "c", "d", "e", "f", "g", "h"]));
    expect(getNextGroup(session)?.roundKind).toBe("calibration");
  });

  it("shrinks groups for small catalogs and avoids an exact repeat after a skipped group", () => {
    const small = getNextGroup(createRankingSession(["a", "b", "c"]));
    expect(small?.candidateTrackIds).toHaveLength(3);

    const initial = createRankingSession(["a", "b", "c", "d", "e"]);
    const skippedGroup = getNextGroup(initial);
    const skipped = recordChoice(initial, skippedGroup?.candidateTrackIds ?? [], null);
    const next = getNextGroup(skipped);
    expect(next?.candidateTrackIds).not.toEqual(skippedGroup?.candidateTrackIds);
  });

  it("does not cycle among already skipped groups when alternatives remain", () => {
    let session = createRankingSession(["a", "b", "c", "d", "e", "f", "g"], {
      calibrationBudget: 10,
    });
    for (let i = 0; i < 2; i += 1) {
      const group = getNextGroup(session);
      session = recordChoice(session, group?.candidateTrackIds ?? [], group?.candidateTrackIds[0] ?? null);
    }
    const skippedGroups: string[][] = [];
    const signatures = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const group = getNextGroup(session);
      expect(group).not.toBeNull();
      const candidateTrackIds = group?.candidateTrackIds ?? [];
      const signature = [...candidateTrackIds].sort().join(",");
      expect(signatures.has(signature)).toBe(false);
      signatures.add(signature);
      skippedGroups.push(candidateTrackIds);
      session = recordChoice(session, group?.candidateTrackIds ?? [], null);
    }

    expect(new Set(skippedGroups.map((ids) => [...ids].sort().join(","))).size).toBe(3);
  });

  it("does not consume the calibration evidence budget on skipped rounds", () => {
    let session = createRankingSession(["a", "b", "c", "d", "e"], { calibrationBudget: 1 });
    for (let i = 0; i < 2; i += 1) {
      const group = getNextGroup(session);
      session = recordChoice(session, group?.candidateTrackIds ?? [], group?.candidateTrackIds[0] ?? null);
    }

    const firstCalibration = getNextGroup(session);
    expect(firstCalibration?.roundKind).toBe("calibration");
    session = recordChoice(session, firstCalibration?.candidateTrackIds ?? [], null);

    expect(getNextGroup(session)).not.toBeNull();
  });

  it("schedules uncertain lower-ranked tracks in a revival challenge", () => {
    let session = createRankingSession(["a", "b", "c", "d", "e", "f", "g", "h"], {
      calibrationRoundsBeforeRevival: 2,
      calibrationBudget: 8,
    });
    for (let i = 0; i < 2; i += 1) {
      const group = getNextGroup(session);
      session = recordChoice(session, group?.candidateTrackIds ?? [], group?.candidateTrackIds[0] ?? null);
    }
    for (let i = 0; i < 2; i += 1) {
      const group = getNextGroup(session);
      session = recordChoice(session, group?.candidateTrackIds ?? [], group?.candidateTrackIds[0] ?? null);
    }
    const revival = getNextGroup(session);

    expect(revival?.roundKind).toBe("revival");
    expect(revival?.candidateTrackIds.length).toBeGreaterThanOrEqual(4);
    expect(revival?.candidateTrackIds.length).toBeLessThanOrEqual(6);
    expect(revival?.candidateTrackIds).toContain("h");
  });

  it("returns no comparison for an empty or one-track catalog", () => {
    expect(getNextGroup(createRankingSession([]))).toBeNull();
    expect(getNextGroup(createRankingSession(["solo"]))).toBeNull();
  });
});
