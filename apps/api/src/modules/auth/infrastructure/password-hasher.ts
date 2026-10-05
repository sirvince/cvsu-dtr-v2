import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

/** SECURITY-PRIVACY §2: argon2id, memory ≥ 19 MiB, t = 2, p = 1. */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordHasher implements OnModuleInit {
  /** Verified against for unknown emails, so "no such user" takes as long as "wrong password". */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash('timing-equaliser-not-a-real-password', OPTIONS);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  /** Constant-time compare inside argon2. A malformed stored hash counts as a mismatch. */
  async verify(hash: string | null, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? this.dummyHash, password);
    } catch {
      return false;
    }
  }

  /** Burns the same time as a real check. Use when there is no user to check against. */
  async verifyDummy(password: string): Promise<void> {
    await this.verify(this.dummyHash, password);
  }

  /** True when the stored hash uses weaker parameters than today's; rehash on next login. */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }
}
