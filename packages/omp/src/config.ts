import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { object, parseConfig } from './state.ts';
import type { Config } from './state.ts';

export async function loadConfig({ cwd, home, path }: { cwd: string; home: string; path?: string }): Promise<Config> {
  const paths = path === undefined
    ? [resolve(cwd, '.volit', 'volit.config.json'), resolve(home, '.volit', 'volit.config.json')]
    : [resolve(cwd, path)];
  for (const candidate of paths) {
    let content: string;
    try {
      content = await readFile(candidate, 'utf8');
    } catch (error) {
      if (path === undefined && object(error) && error.code === 'ENOENT') continue;
      throw new Error(`Cannot read Volit configuration at ${candidate}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    try {
      return parseConfig(JSON.parse(content));
    } catch (error) {
      throw new Error(`Invalid Volit configuration at ${candidate}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  throw new Error(`Volit configuration not found. Searched: ${paths.join(', ')}`);
}
