import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with argon2id and verifies the same password', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'correct horse battery')).resolves.toBe(
      true,
    );
  });

  it('rejects a different password', async () => {
    const hash = await service.hash('correct horse battery');
    await expect(service.verify(hash, 'wrong horse battery')).resolves.toBe(
      false,
    );
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('always rejects in the dummy check used for unknown emails', async () => {
    await expect(service.verifyDummy('anything')).resolves.toBe(false);
  });

  it('prepares the dummy hash at startup, so the first unknown-email login costs no extra hash', async () => {
    const fresh = new PasswordService();
    await fresh.onModuleInit();
    const hash = vi.spyOn(fresh, 'hash');

    await fresh.verifyDummy('anything');

    expect(hash).not.toHaveBeenCalled();
  });
});
