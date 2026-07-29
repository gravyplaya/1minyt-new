/**
 * ULID-ish 26-char sortable identifier. Not a real ULID — just Crockford base32
 * over (time_ms << 80) | random. Plenty unique, URL-safe, lexical-time order.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

function encode(num: bigint, length: number): string {
  let n = num;
  let out = '';
  for (let i = 0; i < length; i++) {
    out = ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

export function newId(): string {
  const time = BigInt(Date.now());
  const rand = BigInt('0x' + randomBytes(10).toString('hex'));
  return encode(time, 10) + encode(rand, 16);
}