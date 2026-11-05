// Release notes for a GitHub Release: the fixed text in .github/release-intro.md
// ({version} is filled in), then the version's section from CHANGELOG.md, if any,
// with a link to the whole CHANGELOG.md on the main branch.
//
//   node scripts/release-notes.mjs 0.2.0 > notes.md
//
// A section starts at a "## " heading naming the version ("## 0.2.0",
// "## v0.2.0", "## [0.2.0] - 2026-11-04", ...) and runs to the next "## ".
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The CHANGELOG.md section for `version`, without its heading; '' when there is none. */
export function changelogSection(changelog, version) {
  const v = version.replace(/^v/, '').replace(/\./g, '\\.');
  const heading = new RegExp(`^##\\s+\\[?v?${v}\\]?(?![\\w.-])`);
  const lines = String(changelog || '').split(/\r?\n/);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

export const CHANGELOG_URL = 'https://github.com/sj/whiskybase-chromium-browser-extension/blob/main/CHANGELOG.md';

export function releaseNotes(version, intro, changelog) {
  const parts = [intro.replaceAll('{version}', version.replace(/^v/, '')).trim()];
  const changes = changelogSection(changelog, version);
  if (changes) parts.push(`## What's changed since last version\n\n${changes}`, `All changes: [CHANGELOG.md](${CHANGELOG_URL})`);
  return parts.join('\n\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/release-notes.mjs <version>');
    process.exit(1);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '');
  process.stdout.write(releaseNotes(version, read('.github/release-intro.md'), read('CHANGELOG.md')));
}
