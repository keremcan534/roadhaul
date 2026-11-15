/** The build of a game made on a desktop (not by CI): it has no release of its own to tell about. */
export const DEVELOPMENT_BUILD = 'dev';

/**
 * Whether What's New opens by itself at the main menu: once for each new
 * build, for a player who played one before (a saved company, or notes seen
 * before). A new player is not told what changed; nor is anyone on a
 * development build (`?news=1` opens it all the same: `forced`).
 */
export function notesToShow(build: string, seenBuild: string | null, hasSavedGame: boolean, forced = false): boolean {
  if (forced) {
    return true;
  }
  if (build === DEVELOPMENT_BUILD || seenBuild === build) {
    return false;
  }
  return seenBuild !== null || hasSavedGame;
}

/** The notes in `language`, else in English, else none. */
export function notesIn(notes: Readonly<Record<string, string>>, language: string): string | null {
  return notes[language] ?? notes['en'] ?? null;
}
