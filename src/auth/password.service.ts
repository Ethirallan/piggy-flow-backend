import { Injectable, type OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  /** Hashed once and reused, so unknown-email logins cost the same as real ones. */
  private dummyHash: Promise<string> | undefined;

  /** Prepares the dummy hash at startup, so even the first unknown-email login isn't slower. */
  async onModuleInit(): Promise<void> {
    await this.dummy();
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Runs a full verification that can never succeed. */
  async verifyDummy(password: string): Promise<false> {
    await this.verify(await this.dummy(), password);
    return false;
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.hash('dummy-password-for-unknown-emails');
    return this.dummyHash;
  }
}
