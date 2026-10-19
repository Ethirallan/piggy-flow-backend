import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { constants, createReadStream, type ReadStream } from 'node:fs';
import {
  access,
  mkdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

/** The uploads directory (env UPLOADS_DIR; `uploads` under the working directory by default). */
export const UPLOADS_DIR = Symbol('UPLOADS_DIR');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface StoredPhoto {
  stream: ReadStream;
  size: number;
}

/** Photo files on local disk: `<uploads>/<photo id>.jpg`. */
@Injectable()
export class PhotoStorage implements OnModuleInit {
  constructor(@Inject(UPLOADS_DIR) private readonly dir: string) {}

  /** Where multer streams uploads before they're processed. */
  get incomingDir(): string {
    return join(this.dir, '.incoming');
  }

  /** Creates the directories; the app refuses to start if they aren't writable. */
  async onModuleInit(): Promise<void> {
    await mkdir(this.incomingDir, { recursive: true });
    await access(this.dir, constants.W_OK);
    await access(this.incomingDir, constants.W_OK);
  }

  /** Written to a temp file and renamed, so a crash never leaves half a photo. */
  async write(id: string, data: Buffer): Promise<void> {
    const target = this.path(id);
    const temp = `${target}.tmp`;
    try {
      await writeFile(temp, data);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  /** The photo's file, or null when it's missing. */
  async open(id: string): Promise<StoredPhoto | null> {
    const path = this.path(id);
    try {
      const { size } = await stat(path);
      return { stream: createReadStream(path), size };
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Deletes the photo's file; a missing file is fine. */
  async delete(id: string): Promise<void> {
    try {
      await unlink(this.path(id));
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  private path(id: string): string {
    if (!UUID.test(id)) {
      throw new Error('Invalid photo id');
    }
    return join(this.dir, `${id}.jpg`);
  }
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'ENOENT';
}
