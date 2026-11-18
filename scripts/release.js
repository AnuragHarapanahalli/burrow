// Publishes a release to GitHub: `npm run release` (needs GH_TOKEN, a token with Contents: Read and write).
//
// Why this script exists: electron-builder uploads the installer and the portable copy at the same
// time, and if the GitHub release doesn't exist yet, *both* uploads create one — you end up with two
// "v0.2.0" releases, each holding half the files. So this first makes sure exactly one release exists
// for this version (and stops if there are duplicates), then lets electron-builder upload into it.
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');
const pub = (pkg.build.publish || []).find((p) => p.provider === 'github');
const tag = `v${pkg.version}`;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!token) {
  console.error('GH_TOKEN is not set. In PowerShell:\n  $env:GH_TOKEN = [Environment]::GetEnvironmentVariable("GH_TOKEN", "User"); npm run release');
  process.exit(1);
}

const api = async (method, url, body) => {
  const res = await fetch(`https://api.github.com/repos/${pub.owner}/${pub.repo}${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'burrow-release-script', 'x-github-api-version': '2022-11-28' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

(async () => {
  // Every release (drafts too) with this version's tag.
  const all = await api('GET', '/releases?per_page=100');
  if (all.status !== 200) { console.error(`GitHub said ${all.status}: ${all.data?.message || ''}`); process.exit(1); }
  const mine = all.data.filter((r) => r.tag_name === tag);
  if (mine.length > 1) {
    console.error(`There are ${mine.length} GitHub releases called ${tag} (from an earlier upload race).`);
    console.error(`Delete them on https://github.com/${pub.owner}/${pub.repo}/releases (the tag can stay), then run this again.`);
    process.exit(1);
  }
  if (!mine.length) {
    const made = await api('POST', '/releases', { tag_name: tag, name: pkg.version, draft: false, prerelease: false, generate_release_notes: true });
    if (made.status !== 201) { console.error(`Couldn't create the release (${made.status}): ${made.data?.message || ''}`); process.exit(1); }
    console.log(`Created the GitHub release ${tag}.`);
  } else console.log(`The GitHub release ${tag} already exists; uploading into it.`);

  // Build, then upload every file into that one release.
  const bin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
  spawnSync(process.execPath, [path.join(__dirname, 'make-icon.js')], { stdio: 'inherit' });
  const r = spawnSync(bin, ['--win', '--publish', 'always'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);

  // Check that everything arrived — especially latest.yml, which installed copies use to find updates.
  const check = await api('GET', `/releases/tags/${tag}`);
  const names = (check.data?.assets || []).map((a) => a.name);
  const want = [`Burrow-Setup-${pkg.version}.exe`, `Burrow-Setup-${pkg.version}.exe.blockmap`, `Burrow-${pkg.version}-portable.exe`, 'latest.yml'];
  const missing = want.filter((n) => !names.includes(n));
  if (missing.length) { console.error(`Uploaded, but these are missing from the release: ${missing.join(', ')}`); process.exit(1); }
  console.log(`\nDone: ${check.data.html_url}\n  ${names.join('\n  ')}`);
})().catch((err) => { console.error(err.message || err); process.exit(1); });
