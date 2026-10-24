import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const versionPattern = /^v(\d+)\.(\d+)\.(\d+)$/;
const shaPattern = /^[a-f0-9]{40}$/;
const newsFile = 'src/news/releases.json';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function optionalGit(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function version(tag) {
  const match = versionPattern.exec(tag);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compare(left, right) {
  const a = version(left);
  const b = version(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function tags(root, merged) {
  const args = ['tag', '--list', 'v*'];
  if (merged) args.push('--merged', merged);
  return git(root, ...args).split('\n').filter((tag) => version(tag)).sort((a, b) => compare(b, a));
}

function fetchMain(root) {
  git(root, 'fetch', '--tags', 'origin', '+refs/heads/main:refs/remotes/origin/main');
}

function news(root, ...args) {
  try {
    const output = execFileSync(process.execPath, ['scripts/finalize-news.mjs', ...args], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(output);
  } catch (error) {
    throw new Error(error.stderr?.toString().trim() || error.message);
  }
}

function assertSha(sha) {
  if (!shaPattern.test(sha ?? '')) throw new Error('Expected a full Git commit SHA.');
}

// Recognize our own commit by its parent, trailer, tag and changed files. A title alone
// must not suppress checks for an ordinary merge with a similar PR title.
function releaseCommit(root, sha) {
  const subject = git(root, 'show', '-s', '--format=%s', sha);
  const match = /^chore\(release\): (v\d+\.\d+\.\d+)$/.exec(subject);
  if (!match || !version(match[1])) return null;
  const message = git(root, 'show', '-s', '--format=%B', sha);
  const sources = [...message.matchAll(/^Release-Source: ([a-f0-9]{40})$/gm)];
  if (sources.length !== 1) return null;
  const source = sources[0][1];
  if (git(root, 'show', '-s', '--format=%P', sha) !== source) return null;
  const files = git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha).split('\n').filter(Boolean);
  if (files.some((file) => file !== newsFile)) return null;
  const tag = match[1];
  if (optionalGit(root, 'rev-parse', '--verify', `refs/tags/${tag}^{commit}`) !== sha) return null;
  return { source, tag, sha };
}

export function classifyRelease(root, sha) {
  assertSha(sha);
  return releaseCommit(root, sha);
}

function existingRelease(root, source) {
  const candidates = git(root, 'log', 'origin/main', '--format=%H', '--fixed-strings', `--grep=Release-Source: ${source}`);
  for (const sha of candidates.split('\n').filter(Boolean)) {
    const existing = releaseCommit(root, sha);
    if (existing?.source === source) return existing;
  }
  return null;
}

export function prepareRelease(root, source) {
  assertSha(source);
  fetchMain(root);
  const existing = existingRelease(root, source);
  if (existing) return { release: true, reused: true, tag: existing.tag, sha: existing.sha };
  if (git(root, 'rev-parse', 'origin/main') !== source) {
    return { release: false, reason: 'main has advanced; its newer CI run will prepare the release' };
  }
  if (git(root, 'status', '--porcelain', '--untracked-files=no')) {
    throw new Error('Release preparation requires a clean working tree.');
  }
  const tagged = tags(root).find((tag) => git(root, 'rev-parse', `refs/tags/${tag}^{commit}`) === source);
  if (tagged) return { release: true, reused: true, tag: tagged, sha: source };

  const latest = tags(root)[0];
  const fallback = `v${JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version}`;
  const baseVersion = latest ?? fallback;
  if (!version(baseVersion)) throw new Error('package.json.version must be a three-part version.');
  const [major, minor] = version(baseVersion);
  const reachable = tags(root, source)[0];
  const messages = git(root, 'log', '--format=%B', reachable ? `${reachable}..${source}` : source);
  const tag = /\[major\]/i.test(messages) ? `v${major + 1}.0.0` : `v${major}.${minor + 1}.0`;

  git(root, 'checkout', '--detach', source);
  news(root, '--finalize', tag);
  git(root, 'add', '--', newsFile);
  // Always create a release commit so a retry can recover the exact version, even
  // when this release has no player-facing news. No [skip ci]: the tag must run CI.
  git(root, 'commit', '--allow-empty', '-m', `chore(release): ${tag}`, '-m', `Release-Source: ${source}`);
  const sha = git(root, 'rev-parse', 'HEAD');
  git(root, 'tag', '--annotate', tag, sha, '--message', `Slingshot ${tag}\n\nRelease-Source: ${source}`);
  try {
    git(root, 'push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`);
  } catch (error) {
    // A rejected main update must never leave a tag pointing at unpublished news.
    // Delete only the local tag made above before refreshing the remote state.
    git(root, 'tag', '--delete', tag);
    fetchMain(root);
    const published = existingRelease(root, source);
    if (published) return { release: true, reused: true, tag: published.tag, sha: published.sha };
    if (git(root, 'rev-parse', 'origin/main') !== source) {
      return { release: false, reason: 'main advanced during the atomic push; its newer CI run will prepare the release' };
    }
    throw new Error(`Atomic release push failed. Check the release App installation, Contents permission and Ruleset bypass.\n${error.stderr?.toString() ?? error.message}`);
  }
  return { release: true, reused: false, tag, sha };
}

export function inspectReleaseTag(root, tag, expectedSha) {
  if (!version(tag)) throw new Error('Select a release tag such as v2.4.0. Branches cannot run the deployment workflow.');
  assertSha(expectedSha);
  fetchMain(root);
  const sha = git(root, 'rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  if (sha !== expectedSha) throw new Error(`Tag ${tag} moved after this workflow was triggered. Refusing to deploy.`);
  if (optionalGit(root, 'merge-base', '--is-ancestor', sha, 'origin/main') === null) {
    throw new Error(`Tag ${tag} is not part of main. Merge the release source before tagging it.`);
  }
  git(root, 'checkout', '--detach', sha);
  news(root, '--assert-tag', tag);
  return { tag, sha, deploy: tags(root, 'origin/main')[0] === tag };
}

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}: ${value}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, argument, expectedSha] = process.argv.slice(2);
    const root = process.cwd();
    if (command === 'classify') output({ generated: Boolean(classifyRelease(root, argument)) });
    else if (command === 'prepare') output(prepareRelease(root, argument));
    else if (command === 'inspect-tag') output(inspectReleaseTag(root, argument, expectedSha));
    else throw new Error('Usage: node scripts/release.mjs classify <sha> | prepare <source-sha> | inspect-tag <tag> <expected-sha>');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
