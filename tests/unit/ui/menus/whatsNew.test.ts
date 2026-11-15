import { describe, expect, it } from 'vitest';
import { notesIn, notesToShow } from '../../../../src/ui/menus/whatsNew';

describe('notesToShow', () => {
  it('opens once for each new build, for a player who played before', () => {
    // Notes seen for an earlier build: this one's are new.
    expect(notesToShow('1201', '1180', false)).toBe(true);
    // A saved company from before notes were kept: an update too.
    expect(notesToShow('1201', null, true)).toBe(true);
    // Seen already.
    expect(notesToShow('1201', '1201', true)).toBe(false);
  });

  it('tells a new player nothing, nor a development build unless asked', () => {
    expect(notesToShow('1201', null, false)).toBe(false);
    expect(notesToShow('dev', '1180', true)).toBe(false);
    expect(notesToShow('dev', null, false, true)).toBe(true);
  });
});

describe('notesIn', () => {
  it('takes the language asked for, else English, else none', () => {
    const notes = { en: 'Smoother.', tr: 'Daha akıcı.' };
    expect(notesIn(notes, 'tr')).toBe('Daha akıcı.');
    expect(notesIn(notes, 'de')).toBe('Smoother.');
    expect(notesIn({}, 'de')).toBeNull();
  });
});
