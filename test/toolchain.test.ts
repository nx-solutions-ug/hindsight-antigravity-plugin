import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');

describe('Toolchain configuration', () => {
  test('package.json tracks the upgraded toolchain ranges', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };

    expect(pkg.devDependencies['@types/node']).toBe('^26.0.0');
    expect(pkg.devDependencies['typescript']).toBe('^6.0.0');
  });

  test('tsconfig declares node types explicitly and silences TS6 baseUrl deprecation', () => {
    const tsconfig = JSON.parse(readFileSync(join(repoRoot, 'tsconfig.json'), 'utf8')) as {
      compilerOptions: Record<string, unknown>;
    };

    expect(tsconfig.compilerOptions.types).toEqual(['node']);
    expect(tsconfig.compilerOptions.ignoreDeprecations).toBe('6.0');
  });

  test('bun.lock resolves the upgraded toolchain versions', () => {
    const lockfile = readFileSync(join(repoRoot, 'bun.lock'), 'utf8');

    expect(lockfile).toContain('"typescript@6.');
    expect(lockfile).toMatch(/"@types\/node@26\./);
    expect(lockfile).not.toContain('"typescript@5.');
  });
});
