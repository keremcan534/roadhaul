// The trailer's clock: 30 seconds on a 128 BPM beat, sixteen bars of four. Every cut lands on a beat, and the
// picture (the shots, the words), the music and the game's own sounds all follow this file.
//
// Google Play autoplays a listing's video muted for up to 30 seconds, so everything the trailer says is in these 30
// seconds: real play from the first frame, the loop (take a job, load, drive, deliver, get paid) by the tenth, then
// the world, the garage, the company, and the brand last.

export const BPM = 128;
/** Seconds a beat (0.46875); a bar is four. */
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const BARS = 16;
export const DURATION = BARS * BAR;

/** The time of beat `n` (from 0), in seconds. */
export const beat = (n) => n * BEAT;

/**
 * The sections, by beat: where each starts, and how hard the music drives there (0 still, 1 flat out). The music
 * builds its arrangement on these; the cut fills them with shots.
 */
export const SECTIONS = [
  /** Cold open: the truck roars past a camera low by the road at sunset; the air horn; the beat builds. */
  { id: 'open', from: 0, energy: 0.55 },
  /** The beat drops: the job board, loading at the depot, then on the road (cab, then alongside). */
  { id: 'loop', from: 8, energy: 0.8 },
  /** The world in four quick shots: dawn mist, a rainbow, a thunderstorm at night, snow. */
  { id: 'world', from: 24, energy: 0.9 },
  /** Into the bay, the air brakes, "Delivered!" and the pay: the music thins out under the game's chime. */
  { id: 'deliver', from: 32, energy: 0.5 },
  /** The lift: paints on the beat, upgrades, the three trucks; the fleet on the road; the rivals. */
  { id: 'grow', from: 36, energy: 1 },
  /** The finale's three words, on three hits, over a slow-motion hero shot. */
  { id: 'finale', from: 52, energy: 0.85 },
  /** The brand over the road: one big hit, then a held chord to the end. */
  { id: 'brand', from: 56, energy: 0.4 },
];

/** Moments the music marks (beats): the horn of the cold open, the drop, the finale's hits, the brand's impact. */
export const HITS = {
  horn: 3,
  drop: 8,
  finale: [52, 53, 54],
  brand: 56,
};
