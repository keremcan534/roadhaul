// Sound files for the trailer: 16-bit stereo PCM at 48 kHz, read and written as WAV.

export const SAMPLE_RATE = 48000;

/** A WAV file around interleaved 16-bit stereo PCM. */
export function wavFile(pcm, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** A 16-bit stereo WAV file's samples, as floats: { left, right }. */
export function readWav(file) {
  let at = 12;
  let data = null;
  while (at + 8 <= file.length) {
    const id = file.toString('ascii', at, at + 4);
    const size = file.readUInt32LE(at + 4);
    if (id === 'data') {
      data = file.subarray(at + 8, at + 8 + size);
      break;
    }
    at += 8 + size + (size & 1);
  }
  if (data === null) throw new Error('A WAV file without data.');
  const frames = data.length / 4;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = data.readInt16LE(i * 4) / 32768;
    right[i] = data.readInt16LE(i * 4 + 2) / 32768;
  }
  return { left, right };
}
