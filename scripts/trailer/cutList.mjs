// The trailer's cut list: which shot (edit.mjs SHOTS) is on screen from which beat (timeline.mjs), and the words over
// them (captions.mjs). Plain data, so the tests can check it keeps to the beat.

/**
 * The cut, by beat: each clip shows `shot` from `from` to the next clip, starting `at` seconds into it (or `mark`:
 * at the frame a mark of the shot's came true, less `before` beats), at its own pace (or `speed`). `in` is how it
 * comes in: a cut, a whip, a flash or a dip; `punch` pushes in on a hit; `zoom` drifts [from, to]; `sound` scales
 * the game's sound under it (0: none) and `tail` lets it ring past the cut.
 */
export const CUT = [
  { shot: 'open', from: 0, at: 0, zoom: [1.0, 1.04] },
  { shot: 'jobs', from: 8, at: 0, in: 'flash' },
  { shot: 'cabin', from: 12, at: 0, in: 'whip' },
  { shot: 'harbour', from: 16, at: 0.1 },
  { shot: 'bridge', from: 20, at: 0.1, in: 'whip' },
  { shot: 'mist', from: 24, at: 0.2, punch: true },
  { shot: 'rainbow', from: 26, at: 0.2, punch: true },
  { shot: 'storm', from: 28, at: 0.55, punch: true, sound: 1.2, tail: 0.6 },
  { shot: 'snow', from: 30, at: 0.2, punch: true },
  { shot: 'paid', from: 32, mark: 'result', before: 3.5, sound: 1.4, tail: 0.6 },
  { shot: 'paint', from: 38, at: 0, in: 'flash' },
  { shot: 'reefer', from: 42, at: 0.2 },
  { shot: 'fleet', from: 44, at: 0, in: 'whip' },
  { shot: 'rivals', from: 48, at: 0 },
  { shot: 'hero', from: 52, at: 0, in: 'flash', sound: 0 },
  { shot: 'sunset', from: 56, at: 0, sound: 0.6 },
];

/**
 * The words, by beat: a caption's key (captions.mjs), when it is on screen, and where: low on the left, or `side`, in
 * a narrow column left of a panel.
 */
export const WORDS = [
  { key: 'start', from: 0.6, to: 7.6 },
  { key: 'job', from: 8.3, to: 11.8, place: 'side' },
  { key: 'road', from: 12.3, to: 23.6 },
  { key: 'weather', from: 24.3, to: 31.7 },
  { key: 'paid', from: 32.3, to: 35.3, place: 'side' },
  { key: 'garage', from: 38.3, to: 43.8 },
  { key: 'fleet', from: 44.3, to: 47.8 },
  { key: 'rivals', from: 48.3, to: 51.8, place: 'side' },
];
