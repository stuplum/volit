import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-ast';

interface SourceManifest {
  name: string;
  version: string;
  description?: string;
  repository?: { type: string; url: string };
  license?: string;
  exports?: string | Record<string, string>;
  dependencies?: Record<string, string>;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'dist/package');
const libraryNames = ['judge', 'core', 'jev', 'omp'];

const printer = ts.createPrinter();

function compiledFile(source: string): string {
  if (!source.startsWith('./src/') || !source.endsWith('.ts')) {
    throw new Error(`Unsupported internal export: ${source}`);
  }
  return `${source.slice('./src/'.length, -'.ts'.length)}.js`;
}

function relativeModule({ from, to }: { from: string; to: string }): string {
  const path = relative(dirname(from), to).replaceAll('\\', '/');
  return path.startsWith('.') ? path : `./${path}`;
}

function rewriteImports({ code, path, modules }: { code: string; path: string; modules: ReadonlyMap<string, string> }): string {
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  const result = ts.transform(source, [(context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isStringLiteralLike(node) && node.text.startsWith('@volit/')) {
        const parent = node.parent;
        const isModule = ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node)
          || (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent) && parent.parent.argument === parent)
          || (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword && parent.arguments[0] === node);
        if (isModule) {
          const target = modules.get(node.text);
          if (!target) throw new Error(`Unmapped internal import ${node.text} in ${path}`);
          return ts.factory.createStringLiteral(relativeModule({ from: path, to: target }));
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (root) => ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  try {
    return printer.printFile(result.transformed[0]!);
  } finally {
    result.dispose();
  }
}

async function packageRelease(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as SourceManifest;
  const libraries = await Promise.all(libraryNames.map(async (directory) => ({
    directory,
    manifest: JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8')) as SourceManifest,
  })));
  const modules = new Map<string, string>();
  for (const { directory, manifest: library } of libraries) {
    if (!library.exports) throw new Error(`Missing exports in ${library.name}`);
    const exports = typeof library.exports === 'string' ? { '.': library.exports } : library.exports;
    for (const [name, source] of Object.entries(exports)) {
      modules.set(library.name + (name === '.' ? '' : name.slice(1)), join(destination, 'dist', directory, compiledFile(source)));
    }
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(join(destination, 'dist'), { recursive: true });

  for (const { directory, manifest: library } of libraries) {
    for (const dependency of Object.keys(library.dependencies ?? {})) {
      if (!modules.has(dependency)) throw new Error(`Unpackaged dependency ${dependency} in ${library.name}`);
    }
    const sources = await readdir(join(root, 'packages', directory, 'src'), { recursive: true });
    for (const source of sources) {
      if (!source.endsWith('.ts') || source.endsWith('.d.ts')) continue;
      for (const extension of ['.js', '.d.ts']) {
        const emitted = `${source.slice(0, -'.ts'.length)}${extension}`;
        const path = join(destination, 'dist', directory, emitted);
        const code = await readFile(join(root, 'dist/compiled', directory, 'src', emitted), 'utf8');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, rewriteImports({ code, path, modules }));
      }
    }
  }

  const entries = [
    { name: '.', specifier: '@volit/omp/jev' },
    { name: './core', specifier: '@volit/core' },
    { name: './judge', specifier: '@volit/judge' },
    { name: './jev', specifier: '@volit/jev' },
    { name: './omp', specifier: '@volit/omp' },
  ];
  const exports: Record<string, { types: string; default: string }> = {};
  for (const entry of entries) {
    const target = modules.get(entry.specifier);
    if (!target) throw new Error(`Missing public entry ${entry.specifier}`);
    let path = target;
    if (entry.name === '.') {
      path = join(destination, 'dist/index.js');
      const content = `export { default } from '${relativeModule({ from: path, to: target })}';\n`;
      await writeFile(path, content);
      await writeFile(path.slice(0, -'.js'.length) + '.d.ts', content);
    }
    const exported = relativeModule({ from: join(destination, 'package.json'), to: path });
    exports[entry.name] = { types: exported.slice(0, -'.js'.length) + '.d.ts', default: exported };
  }

  await writeFile(join(destination, 'package.json'), `${JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    repository: manifest.repository,
    license: manifest.license,
    type: 'module',
    engines: { node: '>=22' },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports,
    omp: { extensions: ['./dist/index.js'] },
    files: ['dist', 'README.md', 'LICENSE', 'volit.example.json'],
  }, null, 2)}\n`);
  for (const file of ['README.md', 'LICENSE', 'volit.example.json']) {
    await copyFile(join(root, file), join(destination, file));
  }
  console.log(`Prepared ${manifest.name}@${manifest.version} in ${destination}`);
}

await packageRelease().catch((error: unknown) => {
  console.error('Failed to prepare the Volit release package:', error);
  process.exitCode = 1;
});
