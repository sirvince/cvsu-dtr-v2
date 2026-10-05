import { loadBreachedPasswords } from '../infrastructure/breached-passwords';
import { checkPassword } from './password-policy';

const breached = new Set(['passwordpassword', 'qwertyuiop123']);
const ctx = { email: 'juan.delacruz@cvsu.edu.ph', breached };
const messages = (password: string) => checkPassword(password, ctx).map((e) => e.message);

describe('checkPassword', () => {
  it('accepts a long, unbreached password', () => {
    expect(checkPassword('Kape-at-Pandesal-2026!', ctx)).toEqual([]);
    expect(checkPassword('correct horse battery staple', ctx)).toEqual([]);
  });

  it('requires at least 12 characters, counting code points', () => {
    expect(messages('Short-Pass1')).toEqual(['Use at least 12 characters.']);
    expect(checkPassword('Pass-word-12', ctx)).toEqual([]); // exactly 12
    // 11 emoji are 22 UTF-16 units but only 11 characters
    expect(messages('😀'.repeat(11))).toEqual(['Use at least 12 characters.']);
  });

  it('caps the length so argon2 input stays bounded', () => {
    expect(messages('a1-'.repeat(43) + 'x')).toEqual(['Use at most 128 characters.']);
  });

  it('rejects breached passwords case-insensitively', () => {
    expect(messages('PasswordPassword')).toEqual([
      'This password appears in known data breaches. Choose another.',
    ]);
  });

  it('rejects a password containing the email local part', () => {
    expect(messages('Juan.DelaCruz-2026')).toEqual([
      'Do not include your email address in the password.',
    ]);
  });

  it('rejects one repeated character', () => {
    expect(messages('aaaaaaaaaaaaaa')).toEqual(['Do not repeat a single character.']);
  });

  it('reports the field it was asked about', () => {
    expect(checkPassword('short', ctx, 'password')[0]?.field).toBe('password');
  });
});

describe('bundled breached-password list', () => {
  const list = loadBreachedPasswords();

  it('loads lowercased entries of 12+ characters and skips the header', () => {
    expect(list.size).toBeGreaterThan(1000);
    for (const entry of list) {
      expect(entry).toBe(entry.toLowerCase());
      expect([...entry].length).toBeGreaterThanOrEqual(12);
      expect(entry.startsWith('#')).toBe(false);
    }
  });

  it('contains well-known breached passwords', () => {
    expect(list.has('123456789012')).toBe(true);
    expect(checkPassword('123456789012', { email: 'x@y.z', breached: list })).not.toEqual([]);
  });
});
