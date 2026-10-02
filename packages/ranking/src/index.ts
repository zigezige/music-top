import type {
  ComparisonChoice,
  RankedTrack,
  RankingResult,
} from "@music-rank/contracts";

export type RankingCompletion = "in_progress" | "ended_early" | "completed";

export interface RankingSessionOptions {
  /** Target group size. Values outside 4-6 are rejected; smaller catalogs shrink automatically. */
  groupSize?: number;
  /** Stable ordering seed used only to break scheduling ties. */
  seed?: number;
  /** Number of calibration rounds between revival challenges. */
  calibrationRoundsBeforeRevival?: number;
  /** Maximum number of post-coverage comparison rounds. */
  calibrationBudget?: number;
  /** Prior strength used to keep finite, regularized Plackett-Luce estimates. */
  priorStrength?: number;
  /** A track is considered sufficiently supported below this uncertainty estimate. */
  provisionalUncertaintyThreshold?: number;
}

export interface ComparisonGroup {
  candidateTrackIds: string[];
  roundKind: ComparisonChoice["roundKind"];
  roundNumber: number;
}

export interface RankingSession {
  trackIds: string[];
  choices: ComparisonChoice[];
  options: Required<RankingSessionOptions>;
  completion: RankingCompletion;
}

const DEFAULT_OPTIONS: Required<RankingSessionOptions> = {
  groupSize: 4,
  seed: 1,
  calibrationRoundsBeforeRevival: 2,
  calibrationBudget: 20,
  priorStrength: 0.5,
  provisionalUncertaintyThreshold: 0.55,
};

const ALGORITHM_VERSION = "pl-top-choice-v1";
const MAX_PL_ITERATIONS = 300;
const PL_TOLERANCE = 1e-9;

export function createRankingSession(
  trackIds: string[],
  options: RankingSessionOptions = {},
): RankingSession {
  if (new Set(trackIds).size !== trackIds.length) {
    throw new Error("Track IDs must be unique");
  }
  if (trackIds.some((trackId) => trackId.trim().length === 0)) {
    throw new Error("Track IDs must be non-empty");
  }

  const normalized = { ...DEFAULT_OPTIONS, ...options };
  if (!Number.isInteger(normalized.groupSize) || normalized.groupSize < 4 || normalized.groupSize > 6) {
    throw new Error("groupSize must be an integer from 4 through 6");
  }
  if (!Number.isInteger(normalized.calibrationRoundsBeforeRevival) || normalized.calibrationRoundsBeforeRevival < 1) {
    throw new Error("calibrationRoundsBeforeRevival must be a positive integer");
  }
  if (!Number.isInteger(normalized.calibrationBudget) || normalized.calibrationBudget < 0) {
    throw new Error("calibrationBudget must be a non-negative integer");
  }
  if (!(normalized.priorStrength > 0) || !(normalized.provisionalUncertaintyThreshold > 0)) {
    throw new Error("priorStrength and provisionalUncertaintyThreshold must be positive");
  }

  return {
    trackIds: [...trackIds],
    choices: [],
    options: normalized,
    completion: "in_progress",
  };
}

/** Returns the deterministic next group; repeated calls do not advance the session. */
export function getNextGroup(session: RankingSession): ComparisonGroup | null {
  if (session.completion !== "in_progress" || session.trackIds.length < 2) return null;

  const groupSize = Math.min(session.options.groupSize, session.trackIds.length);
  const exposureCounts = countExposures(session.trackIds, session.choices);
  const unseen = orderBySeed(
    session.trackIds.filter((trackId) => (exposureCounts.get(trackId) ?? 0) === 0),
    session.options.seed,
  );
  const roundNumber = session.choices.length + 1;

  if (unseen.length > 0) {
    const selected = unseen.slice(0, groupSize);
    if (selected.length < groupSize) {
      const fill = orderCoverageFill(
        session.trackIds.filter((trackId) => !selected.includes(trackId)),
        exposureCounts,
        session.options.seed + roundNumber,
      );
      selected.push(...fill.slice(0, groupSize - selected.length));
    }
    return { candidateTrackIds: selected, roundKind: "coverage", roundNumber };
  }

  const postCoverage = session.choices.filter((choice) => choice.roundKind !== "coverage");
  const postCoverageEvidence = postCoverage.filter(isValidEvidence);
  if (postCoverageEvidence.length >= session.options.calibrationBudget) return null;

  const calibrationSinceRevival = countCalibrationSinceRevival(postCoverageEvidence);
  const roundKind: ComparisonGroup["roundKind"] =
    calibrationSinceRevival >= session.options.calibrationRoundsBeforeRevival
      ? "revival"
      : "calibration";
  const ranked = estimateTracks(
    session.trackIds,
    session.choices,
    session.options.priorStrength,
    session.options.provisionalUncertaintyThreshold,
  );
  const candidateTrackIds = roundKind === "revival"
    ? buildRevivalGroup(ranked, groupSize, session.options.seed + roundNumber)
    : buildCalibrationGroup(ranked, groupSize, session.options.seed + roundNumber);
  const avoidingRepeat = avoidRecentSkippedGroup(candidateTrackIds, session, groupSize);

  return { candidateTrackIds: avoidingRepeat, roundKind, roundNumber };
}

/** Records exactly the current group. A null winner is a skip and creates no preference evidence. */
export function recordChoice(
  session: RankingSession,
  candidateTrackIds: string[],
  selectedTrackId: string | null,
): RankingSession {
  if (session.completion !== "in_progress") throw new Error("Ranking session is already finished");
  const group = getNextGroup(session);
  if (group === null) throw new Error("Ranking session has no remaining comparison rounds");
  if (!sameMembers(candidateTrackIds, group.candidateTrackIds)) {
    throw new Error("Submitted candidates do not match the scheduled group");
  }
  if (selectedTrackId !== null && !candidateTrackIds.includes(selectedTrackId)) {
    throw new Error("Selected track must be part of the comparison group");
  }

  const choice: ComparisonChoice = {
    id: `choice-${session.choices.length + 1}`,
    candidateTrackIds: [...group.candidateTrackIds],
    selectedTrackId,
    kind: selectedTrackId === null ? "skip" : "choice",
    roundKind: group.roundKind,
    createdAt: new Date().toISOString(),
  };

  return {
    ...session,
    trackIds: [...session.trackIds],
    choices: [...session.choices, choice],
  };
}

/** Freezes the current result as a provisional, early-ended ranking. */
export function endRankingEarly(session: RankingSession): RankingSession {
  return { ...session, completion: "ended_early" };
}

/** Marks the user flow complete; weakly supported tracks remain individually provisional. */
export function completeRanking(session: RankingSession): RankingSession {
  return { ...session, completion: "completed" };
}

export function getRankingResult(session: RankingSession): RankingResult {
  const ranked = estimateTracks(
    session.trackIds,
    session.choices,
    session.options.priorStrength,
    session.options.provisionalUncertaintyThreshold,
  );
  const coveredCount = ranked.filter((track) => track.exposureCount > 0).length;
  const coverageRatio = session.trackIds.length <= 1 ? 1 : coveredCount / session.trackIds.length;
  const allSupported = ranked.every((track) => !track.provisional);

  let status: RankingResult["status"] = "in_progress";
  if (session.completion === "ended_early") {
    status = "provisional";
  } else if (session.completion === "completed") {
    status = coverageRatio === 1 && allSupported ? "complete" : "provisional";
  }

  return {
    tracks: ranked,
    coverageRatio,
    completedRounds: session.choices.length,
    status,
    algorithmVersion: ALGORITHM_VERSION,
  };
}

function estimateTracks(
  trackIds: string[],
  choices: ComparisonChoice[],
  priorStrength: number,
  provisionalUncertaintyThreshold: number,
): RankedTrack[] {
  const exposureCounts = countExposures(trackIds, choices);
  const selectedCounts = new Map(trackIds.map((trackId) => [trackId, 0]));
  const evidence = choices.filter(isValidEvidence);
  for (const choice of evidence) {
    const selected = choice.selectedTrackId;
    if (selected !== null) selectedCounts.set(selected, (selectedCounts.get(selected) ?? 0) + 1);
  }

  const strengths = new Map(trackIds.map((trackId) => [trackId, 1]));
  const wins = selectedCounts;
  for (let iteration = 0; iteration < MAX_PL_ITERATIONS; iteration += 1) {
    const denominatorExposure = new Map(trackIds.map((trackId) => [trackId, 0]));
    for (const choice of evidence) {
      const total = choice.candidateTrackIds.reduce(
        (sum, trackId) => sum + (strengths.get(trackId) ?? 0),
        0,
      );
      if (total <= 0) continue;
      for (const trackId of choice.candidateTrackIds) {
        denominatorExposure.set(
          trackId,
          (denominatorExposure.get(trackId) ?? 0) + 1 / total,
        );
      }
    }

    const nextStrengths = new Map<string, number>();
    for (const trackId of trackIds) {
      const next = ((wins.get(trackId) ?? 0) + priorStrength) /
        ((denominatorExposure.get(trackId) ?? 0) + priorStrength);
      nextStrengths.set(trackId, next);
    }
    const geometricMean = Math.exp(
      [...nextStrengths.values()].reduce((sum, value) => sum + Math.log(value), 0) /
        Math.max(nextStrengths.size, 1),
    );
    let maxDelta = 0;
    for (const trackId of trackIds) {
      const normalized = (nextStrengths.get(trackId) ?? 1) / geometricMean;
      maxDelta = Math.max(
        maxDelta,
        Math.abs(Math.log(normalized) - Math.log(strengths.get(trackId) ?? 1)),
      );
      strengths.set(trackId, normalized);
    }
    if (maxDelta < PL_TOLERANCE) break;
  }

  const rawScores = new Map(trackIds.map((trackId) => [trackId, Math.log(strengths.get(trackId) ?? 1)]));
  const scoreMean = trackIds.length === 0
    ? 0
    : [...rawScores.values()].reduce((sum, score) => sum + score, 0) / trackIds.length;
  const information = new Map(trackIds.map((trackId) => [trackId, priorStrength]));
  for (const choice of evidence) {
    const total = choice.candidateTrackIds.reduce(
      (sum, trackId) => sum + (strengths.get(trackId) ?? 0),
      0,
    );
    if (total <= 0) continue;
    for (const trackId of choice.candidateTrackIds) {
      const probability = (strengths.get(trackId) ?? 0) / total;
      information.set(
        trackId,
        (information.get(trackId) ?? priorStrength) + probability * (1 - probability),
      );
    }
  }

  return trackIds
    .map((trackId) => {
      const exposureCount = exposureCounts.get(trackId) ?? 0;
      const trackInformation = information.get(trackId) ?? priorStrength;
      const uncertainty = Math.sqrt(1 / trackInformation);
      return {
        trackId,
        score: normalizeZero(round(rawScores.get(trackId)! - scoreMean)),
        uncertainty: round(uncertainty),
        exposureCount,
        selectedCount: selectedCounts.get(trackId) ?? 0,
        provisional: trackIds.length > 1 &&
          (exposureCount === 0 || uncertainty > provisionalUncertaintyThreshold),
      } satisfies RankedTrack;
    })
    .sort((left, right) => right.score - left.score || left.trackId.localeCompare(right.trackId));
}

function buildCalibrationGroup(ranked: RankedTrack[], size: number, seed: number): string[] {
  const byUncertainty = [...ranked].sort(
    (left, right) => right.uncertainty - left.uncertainty ||
      left.exposureCount - right.exposureCount || left.trackId.localeCompare(right.trackId),
  );
  const anchor = byUncertainty[0];
  if (anchor === undefined) return [];
  const selected = [anchor.trackId];
  const sorted = ranked.filter((track) => track.trackId !== anchor.trackId).sort(
    (left, right) => Math.abs(left.score - anchor.score) - Math.abs(right.score - anchor.score) ||
      right.uncertainty - left.uncertainty || left.trackId.localeCompare(right.trackId),
  );
  selected.push(...sorted.slice(0, size - 1).map((track) => track.trackId));
  return orderSelected(selected, seed);
}

function buildRevivalGroup(ranked: RankedTrack[], size: number, seed: number): string[] {
  const bottomHalf = [...ranked].sort(
    (left, right) => left.score - right.score || right.uncertainty - left.uncertainty,
  ).slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
  const target = bottomHalf.sort(
    (left, right) => right.uncertainty - left.uncertainty || left.score - right.score,
  )[0];
  if (target === undefined) return [];

  const higher = ranked.filter((track) => track.trackId !== target.trackId).sort(
    (left, right) => Math.abs(left.score - target.score) - Math.abs(right.score - target.score) ||
      right.uncertainty - left.uncertainty || left.trackId.localeCompare(right.trackId),
  );
  return orderSelected([target.trackId, ...higher.slice(0, size - 1).map((track) => track.trackId)], seed);
}

function avoidRecentSkippedGroup(
  candidateTrackIds: string[],
  session: RankingSession,
  groupSize: number,
): string[] {
  const signature = groupSignature(candidateTrackIds);
  const skippedSignatures = new Set(
    session.choices
      .filter((choice) => choice.kind === "skip")
      .map((choice) => groupSignature(choice.candidateTrackIds)),
  );
  if (!skippedSignatures.has(signature) || session.trackIds.length <= groupSize) return candidateTrackIds;

  const replacements = orderBySeed(
    session.trackIds.filter((trackId) => !candidateTrackIds.includes(trackId)),
    session.options.seed + session.choices.length,
  );
  for (const replacement of replacements) {
    for (let index = candidateTrackIds.length - 1; index >= 0; index -= 1) {
      const alternate = [...candidateTrackIds];
      alternate[index] = replacement;
      if (!skippedSignatures.has(groupSignature(alternate))) return alternate;
    }
  }
  return candidateTrackIds;
}

function countExposures(trackIds: string[], choices: ComparisonChoice[]): Map<string, number> {
  const counts = new Map(trackIds.map((trackId) => [trackId, 0]));
  for (const choice of choices) {
    for (const trackId of choice.candidateTrackIds) {
      if (counts.has(trackId)) counts.set(trackId, (counts.get(trackId) ?? 0) + 1);
    }
  }
  return counts;
}

function isValidEvidence(choice: ComparisonChoice): boolean {
  return choice.kind === "choice" && choice.selectedTrackId !== null &&
    choice.candidateTrackIds.includes(choice.selectedTrackId);
}

function countCalibrationSinceRevival(choices: ComparisonChoice[]): number {
  let count = 0;
  for (let index = choices.length - 1; index >= 0; index -= 1) {
    const choice = choices[index];
    if (choice?.roundKind === "revival") break;
    if (choice?.roundKind === "calibration") count += 1;
  }
  return count;
}

function orderCoverageFill(
  trackIds: string[],
  exposureCounts: Map<string, number>,
  seed: number,
): string[] {
  return [...trackIds].sort(
    (left, right) => (exposureCounts.get(left) ?? 0) - (exposureCounts.get(right) ?? 0) ||
      seededRank(left, seed) - seededRank(right, seed) || left.localeCompare(right),
  );
}

function orderBySeed(trackIds: string[], seed: number): string[] {
  return [...trackIds].sort(
    (left, right) => seededRank(left, seed) - seededRank(right, seed) || left.localeCompare(right),
  );
}

function orderSelected(trackIds: string[], seed: number): string[] {
  return orderBySeed(trackIds, seed);
}

function seededRank(value: string, seed: number): number {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length &&
    left.every((trackId) => right.includes(trackId));
}

function groupSignature(trackIds: string[]): string {
  return [...trackIds].sort().join("\u0000");
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
