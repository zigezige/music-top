import type { RankingSession } from './sessionStore.ts';

type SessionInfo = { artistId: string; completion: string };

export function shouldConfirmSessionReplacement(active: SessionInfo | null, nextArtistId: string): boolean {
  return Boolean(active && active.artistId !== nextArtistId && active.completion !== 'completed');
}

export function hasSpentCalibrationBudget(session: Pick<RankingSession, 'choices' | 'options'>): boolean {
  const evidenceRounds = session.choices.filter((choice) =>
    choice.roundKind !== 'coverage' &&
    choice.kind === 'choice' &&
    choice.selectedTrackId !== null &&
    choice.candidateTrackIds.includes(choice.selectedTrackId),
  ).length;
  return evidenceRounds >= session.options.calibrationBudget;
}

export function extendCalibrationBudget<T extends Pick<RankingSession, 'options' | 'choices'>>(session: T, additionalRounds = 20): T {
  if (!hasSpentCalibrationBudget(session as Pick<RankingSession, 'options' | 'choices'>)) return session;
  return { ...session, options: { ...session.options, calibrationBudget: session.options.calibrationBudget + additionalRounds } };
}

export function getRankingIdentity(artistId: string, catalogVersion: string, session: Pick<RankingSession, 'trackIds' | 'choices'>, sessionId: string): string {
  const choices = session.choices.map((choice) => [choice.candidateTrackIds, choice.selectedTrackId, choice.kind, choice.roundKind]);
  return JSON.stringify([artistId, catalogVersion, sessionId, session.trackIds, choices]);
}
