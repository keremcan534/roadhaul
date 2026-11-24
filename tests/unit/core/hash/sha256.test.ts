import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, sha256Hex, utf8Bytes } from '../../../../src/core/hash/sha256';

describe('sha256', () => {
  it('gives the standard digests (FIPS 180-4 examples)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // Two blocks.
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    // A million bytes.
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('reads text as UTF-8', () => {
    expect([...utf8Bytes('Iş€😀')]).toEqual([0x49, 0xc5, 0x9f, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
    expect(sha256Hex('Işık')).toBe(sha256Hex('Işık'));
    expect(sha256Hex('Işık')).not.toBe(sha256Hex('Isik'));
  });

  it('gives the standard HMACs (RFC 4231)', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('agrees with the crypto module of Node (the digests below) on long keys and long, non-ASCII text', () => {
    const key = 'k'.repeat(131); // Longer than the block: hashed first.
    const text = JSON.stringify({ company: 'Işık Lojistik 🚚', credits: 123_456, notes: 'ü'.repeat(5000) });

    expect(hmacSha256Hex(key, text)).toBe('55f07e7eed2529f950b30df6d934a0602378159bf8eb05d0b7d41d6bd1ac124f');
    expect(sha256Hex(text)).toBe('07f8a23c7fe3f86b4ec1199fc72a5f6cbcf4a99131618648e0cca80ea2bd7545');
  });
});
