import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test file gets its own uploads directory (PhotoStorage reads it at startup).
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'piggy-uploads-'));
