import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhotoStorage } from './photo-storage.js';

describe('PhotoStorage', () => {
  let dir: string;
  let storage: PhotoStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'photo-storage-'));
    storage = new PhotoStorage(dir);
    await storage.onModuleInit();
  });

  it('creates the incoming directory at startup', async () => {
    expect(await readdir(dir)).toEqual(['.incoming']);
  });

  it('writes <id>.jpg without leaving a temp file, and reads it back', async () => {
    const id = randomUUID();

    await storage.write(id, Buffer.from('jpeg bytes'));

    expect((await readdir(dir)).sort()).toEqual(['.incoming', `${id}.jpg`]);
    expect(await readFile(join(dir, `${id}.jpg`), 'utf8')).toBe('jpeg bytes');
    const file = await storage.open(id);
    expect(file?.size).toBe(10);
    file?.stream.destroy();
  });

  it('returns null for a missing photo and ignores deleting one', async () => {
    const id = randomUUID();

    expect(await storage.open(id)).toBeNull();
    await expect(storage.delete(id)).resolves.toBeUndefined();
  });

  it('keeps an opened photo readable across a delete', async () => {
    const id = randomUUID();
    await storage.write(id, Buffer.from('jpeg bytes'));
    const file = await storage.open(id);

    await storage.delete(id);
    const chunks: Buffer[] = [];
    for await (const chunk of file!.stream) {
      chunks.push(chunk as Buffer);
    }

    expect(Buffer.concat(chunks).toString()).toBe('jpeg bytes');
  });

  it('deletes a stored photo', async () => {
    const id = randomUUID();
    await storage.write(id, Buffer.from('x'));

    await storage.delete(id);

    expect(await readdir(dir)).toEqual(['.incoming']);
  });

  it.each(['../etc/passwd', 'abc', `${randomUUID()}.jpg`, ''])(
    'refuses the id %j',
    async (id) => {
      await expect(storage.write(id, Buffer.from('x'))).rejects.toThrow(
        'Invalid photo id',
      );
      await expect(storage.open(id)).rejects.toThrow('Invalid photo id');
      await expect(storage.delete(id)).rejects.toThrow('Invalid photo id');
    },
  );
});
