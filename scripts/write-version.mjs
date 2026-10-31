// Writes <dir>/version.json with the package's name and version, the git commit and the build time.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // Not a git checkout, or no commits yet.
}

mkdirSync(dir, { recursive: true });
const info = { name, version, commit, buildTime: new Date().toISOString() };
writeFileSync(join(dir, 'version.json'), `${JSON.stringify(info, null, 2)}\n`);
