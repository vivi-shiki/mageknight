import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyDatabase } from './model';
import type { MultiplayerDatabaseData } from './model';

export class JsonStore {
  private constructor(
    readonly filePath: string,
    readonly data: MultiplayerDatabaseData,
  ) {}

  static async open(filePath: string): Promise<JsonStore> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as MultiplayerDatabaseData;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.rooms)) {
        throw new Error('多人数据文件格式不受支持。');
      }
      return new JsonStore(filePath, parsed);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      return new JsonStore(filePath, emptyDatabase());
    }
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}
