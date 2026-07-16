// PIN のハッシュ化と照合。生の PIN は保存しない。
// PIN は 4桁で本質的に総当たり可能なため、ここでの目的は
// 「平文で保存しない・誤編集/なりすまし防止」レベル(要件どおり)。
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// 保存形式: "salt(hex):hash(hex)"
export function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pin), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPin(pin, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(String(pin), salt, expected.length);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// PIN の形式チェック(4桁の数字)
export function isValidPinFormat(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}
