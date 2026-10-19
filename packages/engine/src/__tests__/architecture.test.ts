import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('workspace boundaries', () => {
  it('ST-001 keeps the engine independent of React, DOM and web application modules', () => {
    const directory = path.resolve(import.meta.dirname, '..');
    const readSources = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const target = path.join(folder, entry.name);
      if (entry.isDirectory() && entry.name !== '__tests__') return readSources(target);
      return entry.isFile() && entry.name.endsWith('.ts') ? [readFileSync(target, 'utf8')] : [];
    });
    const source = readSources(directory).join('\n');
    expect(source).not.toMatch(/from ['"]react/);
    expect(source).not.toMatch(/apps[\\/]web|document\.|window\./);
    expect(source).not.toContain('@mageknight/content-schema');
  });

  it('ST-210 keeps v0.2 rule ownership in explicit modules', () => {
    const directory = path.resolve(import.meta.dirname, '../conquest');
    const files = new Set(readdirSync(directory).filter((file) => file.endsWith('.ts')));
    expect([...files]).toEqual(expect.arrayContaining(['cards.ts', 'combat.ts', 'engine.ts', 'map.ts', 'market.ts', 'scenario.ts', 'turn.ts', 'zones.ts']));
  });
});
