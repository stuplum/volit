import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/config.ts';

let root: string;
let cwd: string;
let home: string;
let projectPath: string;
let userPath: string;

const configInput = (version: string) => ({
  profiles: [{ id: 'implementation', description: 'Implementation work', targets: ['main'] }],
  targets: [{ id: 'main', provider: 'fixture', model: 'main', effort: 'high' }],
  policy: { version, minimumProbability: 0.8, minimumMargin: 0.2, downgradeProbability: 0.9, cooldownMs: 0, downgradeTransitions: [] },
  outputReserve: 1024,
  evidenceMaxChars: 4000,
  timeoutMs: 500,
});

async function put({ path, content }: { path: string; content: unknown }): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'volit-config-'));
  cwd = join(root, 'project');
  home = join(root, 'home');
  projectPath = join(cwd, '.volit', 'volit.config.json');
  userPath = join(home, '.volit', 'volit.config.json');
  await mkdir(cwd);
  await mkdir(home);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test.each(['relative', 'absolute'])('explicit %s configuration overrides both defaults', async kind => {
  const path = join(cwd, 'selected.json');
  await put({ path, content: configInput('explicit') });
  await put({ path: projectPath, content: configInput('project') });
  await put({ path: userPath, content: configInput('user') });
  const config = await loadConfig({ cwd, home, path: kind === 'absolute' ? path : 'selected.json' });
  expect(config.policy.version).toBe('explicit');
});

test('a missing explicit configuration does not fall back', async () => {
  await put({ path: projectPath, content: configInput('project') });
  await put({ path: userPath, content: configInput('user') });
  await expect(loadConfig({ cwd, home, path: 'missing.json' })).rejects.toThrow(join(cwd, 'missing.json'));
});

test('invalid explicit configuration does not fall back', async () => {
  const path = join(cwd, 'selected.json');
  await put({ path, content: '{}' });
  await put({ path: projectPath, content: configInput('project') });
  await expect(loadConfig({ cwd, home, path })).rejects.toThrow(path);
});

test('project configuration overrides user-wide configuration', async () => {
  await put({ path: projectPath, content: configInput('project') });
  await put({ path: userPath, content: configInput('user') });
  expect((await loadConfig({ cwd, home })).policy.version).toBe('project');
});

test('a valid project configuration does not read an invalid user-wide configuration', async () => {
  await put({ path: projectPath, content: configInput('project') });
  await put({ path: userPath, content: '{' });
  expect((await loadConfig({ cwd, home })).policy.version).toBe('project');
});

test.each(['{', '{}'])('invalid project configuration stops fallback: %s', async content => {
  await put({ path: projectPath, content });
  await put({ path: userPath, content: configInput('user') });
  await expect(loadConfig({ cwd, home })).rejects.toThrow(projectPath);
});

test('a project configuration read failure stops fallback', async () => {
  await mkdir(projectPath, { recursive: true });
  await put({ path: userPath, content: configInput('user') });
  await expect(loadConfig({ cwd, home })).rejects.toThrow(projectPath);
});

test('a non-directory project configuration parent stops fallback', async () => {
  await put({ path: join(cwd, '.volit'), content: 'not a directory' });
  await put({ path: userPath, content: configInput('user') });
  await expect(loadConfig({ cwd, home })).rejects.toThrow(projectPath);
});

test('a missing project configuration uses the user-wide configuration', async () => {
  await put({ path: userPath, content: configInput('user') });
  expect((await loadConfig({ cwd, home })).policy.version).toBe('user');
});

test('the former project-root location does not override the user-wide configuration', async () => {
  await put({ path: join(cwd, 'volit.config.json'), content: configInput('legacy') });
  await put({ path: userPath, content: configInput('user') });
  expect((await loadConfig({ cwd, home })).policy.version).toBe('user');
});

test('invalid user-wide configuration identifies the failing file', async () => {
  await put({ path: userPath, content: '{}' });
  await expect(loadConfig({ cwd, home })).rejects.toThrow(userPath);
});

test('missing default configurations report both searched paths', async () => {
  const result = loadConfig({ cwd, home });
  await expect(result).rejects.toThrow(projectPath);
  await expect(result).rejects.toThrow(userPath);
});
