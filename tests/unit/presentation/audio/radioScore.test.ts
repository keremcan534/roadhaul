import { describe, expect, it } from 'vitest';
import { RADIO_CHOICES, RADIO_STATIONS, nextRadioChoice } from '../../../../src/data/config/radio';
import { createScoreNotes, midiFrequency, RadioScore, STATION_STYLES } from '../../../../src/presentation/audio/radioScore';

/** The parts and pitches a station plays over `bars` bars. */
function play(station: (typeof RADIO_STATIONS)[number], bars: number) {
  const score = new RadioScore(station);
  const notes = createScoreNotes();
  const played: { bar: number; part: string; midi: number }[] = [];
  for (let step = 0; step < bars * 16; step++) {
    const count = score.next(notes);
    for (let i = 0; i < count; i++) {
      played.push({ bar: Math.floor(step / 16), part: notes[i]!.part, midi: notes[i]!.midi });
    }
  }
  return played;
}

describe('the cab radio\'s music', () => {
  it('plays each station\'s beat, bass, chords and a lead, in its own key and tempo', () => {
    for (const station of RADIO_STATIONS) {
      const played = play(station, 8);
      const parts = new Set(played.map((note) => note.part));
      for (const part of ['kick', 'snare', 'hat', 'bass', 'chord', 'lead']) {
        expect(parts.has(part), `${station} ${part}`).toBe(true);
      }
      // A chord of three a bar.
      expect(played.filter((note) => note.part === 'chord')).toHaveLength(8 * 3);
      // The lead stays within a few octaves, in the station's scale.
      const style = STATION_STYLES[station];
      for (const note of played.filter((note) => note.part === 'lead')) {
        expect(note.midi).toBeGreaterThan(style.root - 12);
        expect(note.midi).toBeLessThan(style.root + 48);
        expect(style.scale).toContain((((note.midi - style.root) % 12) + 12) % 12);
      }
      expect(new RadioScore(station).stepSeconds).toBeCloseTo(60 / style.bpm / 4, 9);
    }
    expect(new Set(RADIO_STATIONS.map((station) => STATION_STYLES[station].bpm)).size).toBe(RADIO_STATIONS.length);
  });

  it('rests the lead two bars in every eight, and plays the same from the top each time', () => {
    const played = play('highway', 16);
    for (const bar of [6, 7, 14, 15]) {
      expect(played.some((note) => note.bar === bar && note.part === 'lead')).toBe(false);
    }
    expect(played.some((note) => note.bar === 5 && note.part === 'lead')).toBe(true);
    expect(play('highway', 4)).toEqual(played.filter((note) => note.bar < 4));
  });

  it('tunes A to 440 Hz', () => {
    expect(midiFrequency(69)).toBe(440);
    expect(midiFrequency(81)).toBeCloseTo(880, 9);
  });

  it('steps through the stations and back to off', () => {
    let choice: (typeof RADIO_CHOICES)[number] = RADIO_CHOICES[0];
    const seen: (typeof RADIO_CHOICES)[number][] = [choice];
    for (let i = 0; i < RADIO_CHOICES.length; i++) {
      choice = nextRadioChoice(choice);
      seen.push(choice);
    }
    expect(seen).toEqual(['off', 'highway', 'night', 'country', 'off']);
  });
});
