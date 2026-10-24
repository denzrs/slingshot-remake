import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { classifyRelease, inspectReleaseTag, prepareRelease } from './release.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function fixture(t, { empty = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'slingshot-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = join(directory, 'remote.git');
  const root = join(directory, 'checkout');
  mkdirSync(remote);
  mkdirSync(root);
  git(remote, 'init', '--bare', '--initial-branch=main');
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Release fixture');
  git(root, 'config', 'user.email', 'release@example.test');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'tag.gpgsign', 'false');
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'src/news/images'), { recursive: true });
  copyFileSync(new URL('./finalize-news.mjs', import.meta.url), join(root, 'scripts/finalize-news.mjs'));
  writeFileSync(join(root, 'package.json'), '{"version":"1.0.0"}\n');
  const copy = { de: 'Neue Funktion', en: 'New feature' };
  writeFileSync(join(root, 'src/news/releases.json'), JSON.stringify({
    draft: { items: empty ? [] : [{ id: 'new-feature', title: copy, text: copy }] },
    releases: [],
  }));
  git(root, 'add', '.');
  git(root, 'commit', '--message', 'Add a feature');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '--set-upstream', 'origin', 'main');
  return { root, remote, source: git(root, 'rev-parse', 'HEAD') };
}

test('publish finalized news and the annotated tag atomically, then recognize the generated commit', (t) => {
  const { root, remote, source } = fixture(t);
  const result = prepareRelease(root, source);
  assert.equal(result.tag, 'v1.1.0');
  assert.equal(result.reused, false);
  assert.equal(git(remote, 'rev-parse', 'main'), result.sha);
  assert.equal(git(remote, 'rev-parse', 'v1.1.0^{commit}'), result.sha);
  assert.equal(git(remote, 'cat-file', '-t', 'v1.1.0'), 'tag');
  assert.equal(git(root, 'show', '-s', '--format=%P', result.sha), source);
  assert.equal(git(root, 'show', '-s', '--format=%B', result.sha).includes('[skip ci]'), false);
  const news = JSON.parse(readFileSync(join(root, 'src/news/releases.json'), 'utf8'));
  assert.equal(news.releases[0].tag, result.tag);
  assert.equal(news.releases[0].items[0].id, 'new-feature');
  assert.deepEqual(news.draft.items, []);
  assert.deepEqual(classifyRelease(root, result.sha), { source, tag: result.tag, sha: result.sha });
  assert.equal(classifyRelease(root, source), null);
  assert.deepEqual(inspectReleaseTag(root, result.tag, result.sha), { tag: result.tag, sha: result.sha, deploy: true });
});

test('a retry reuses the same commit and version even after a later merge', (t) => {
  const { root, remote, source } = fixture(t);
  const first = prepareRelease(root, source);
  writeFileSync(join(root, 'follow-up.txt'), 'Next merge\n');
  git(root, 'add', '.');
  git(root, 'commit', '--message', 'Another feature');
  git(root, 'push', 'origin', 'HEAD:refs/heads/main');
  const newest = git(remote, 'rev-parse', 'main');
  const retry = prepareRelease(root, source);
  assert.deepEqual(retry, { ...first, reused: true });
  assert.equal(git(remote, 'rev-parse', 'main'), newest);
  assert.equal(git(remote, 'tag', '--list'), 'v1.1.0');
});

test('an empty draft still gets an identifiable release commit', (t) => {
  const { root, source } = fixture(t, { empty: true });
  const result = prepareRelease(root, source);
  assert.notEqual(result.sha, source);
  assert.equal(git(root, 'diff', '--name-only', source, result.sha), '');
  assert.equal(classifyRelease(root, result.sha)?.tag, result.tag);
  assert.equal(inspectReleaseTag(root, result.tag, result.sha).deploy, true);
});

test('a newer main commit is left for its own checked pipeline', (t) => {
  const { root, remote, source } = fixture(t);
  writeFileSync(join(root, 'newer.txt'), 'Newer merge\n');
  git(root, 'add', '.');
  git(root, 'commit', '--message', 'Newer merge');
  git(root, 'push', 'origin', 'main');
  const newest = git(remote, 'rev-parse', 'main');
  const result = prepareRelease(root, source);
  assert.equal(result.release, false);
  assert.equal(git(remote, 'rev-parse', 'main'), newest);
  assert.equal(git(remote, 'tag', '--list'), '');
});

test('a rejected main push publishes neither the release commit nor its tag', (t) => {
  const { root, remote, source } = fixture(t);
  const hook = join(remote, 'hooks/update');
  writeFileSync(hook, '#!/bin/sh\nif [ "$1" = refs/heads/main ]; then exit 1; fi\n');
  chmodSync(hook, 0o755);
  assert.throws(() => prepareRelease(root, source), /Atomic release push failed/);
  assert.equal(git(remote, 'rev-parse', 'main'), source);
  assert.equal(git(remote, 'tag', '--list'), '');
  assert.equal(git(root, 'tag', '--list'), '');
});

test('a main update during the atomic push is skipped without publishing a dangling tag', (t) => {
  const { root, remote, source } = fixture(t);
  const concurrent = git(root, 'commit-tree', `${source}^{tree}`, '-p', source, '-m', 'Concurrent merge');
  git(root, 'push', 'origin', `${concurrent}:refs/heads/concurrent-fixture`);
  const hook = join(root, '.git/hooks/pre-push');
  writeFileSync(hook, `#!/bin/sh\ngit --git-dir='${remote}' update-ref refs/heads/main '${concurrent}' '${source}'\n`);
  chmodSync(hook, 0o755);
  const result = prepareRelease(root, source);
  assert.equal(result.release, false);
  assert.match(result.reason, /advanced during the atomic push/);
  assert.equal(git(remote, 'rev-parse', 'main'), concurrent);
  assert.equal(git(remote, 'tag', '--list'), '');
});

test('major markers affect the next version and older releases cannot deploy over newer ones', (t) => {
  const { root, source } = fixture(t);
  const first = prepareRelease(root, source);
  writeFileSync(join(root, 'breaking.txt'), 'Breaking change\n');
  git(root, 'add', '.');
  git(root, 'commit', '--message', 'Change the rules [major]');
  git(root, 'push', 'origin', 'HEAD:refs/heads/main');
  const second = prepareRelease(root, git(root, 'rev-parse', 'HEAD'));
  assert.equal(second.tag, 'v2.0.0');
  assert.equal(inspectReleaseTag(root, second.tag, second.sha).deploy, true);
  assert.equal(inspectReleaseTag(root, first.tag, first.sha).deploy, false);
});

test('a matching commit title alone cannot suppress the main checks', (t) => {
  const { root, source } = fixture(t);
  writeFileSync(join(root, 'gameplay.txt'), 'This is a real code change\n');
  git(root, 'add', '.');
  git(root, 'commit', '--message', 'chore(release): v1.1.0', '--message', `Release-Source: ${source}`);
  git(root, 'tag', 'v1.1.0');
  assert.equal(classifyRelease(root, git(root, 'rev-parse', 'HEAD')), null);
});

test('a manual tag must be finalized, reachable from main, and still at its original SHA', (t) => {
  const { root, source } = fixture(t);
  git(root, 'tag', 'v1.0.0');
  git(root, 'push', 'origin', 'v1.0.0');
  assert.throws(() => inspectReleaseTag(root, 'main', source), /Select a release tag/);
  assert.throws(() => inspectReleaseTag(root, 'v1.0.0', source), /manually pushed tag/);
  assert.throws(() => inspectReleaseTag(root, 'v1.0.0', 'a'.repeat(40)), /Tag v1.0.0 moved/);
  git(root, 'checkout', '--detach', source);
  writeFileSync(join(root, 'unmerged.txt'), 'Unreviewed change\n');
  git(root, 'add', '.');
  git(root, 'commit', '--message', 'Unmerged change');
  const unmerged = git(root, 'rev-parse', 'HEAD');
  git(root, 'tag', 'v9.0.0');
  git(root, 'push', 'origin', 'v9.0.0');
  assert.throws(() => inspectReleaseTag(root, 'v9.0.0', unmerged), /not part of main/);
});

for (const changed of [false, true]) {
  test(`relay deployment ${changed ? 'restarts and keeps rollback files for changed artifacts' : 'keeps an unchanged service running'}`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'slingshot-relay-deploy-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    const calls = join(directory, 'systemctl.log');
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SYSTEMCTL_CALLS"\nexit 0\n');
    chmodSync(join(bin, 'systemctl'), 0o755);
    writeFileSync(join(directory, 'slingshot-server'), 'old binary');
    writeFileSync(join(directory, 'slingshot-server.new'), changed ? 'new binary' : 'old binary');
    writeFileSync(join(directory, 'relay.env'), 'PORT=8080\n');
    writeFileSync(join(directory, 'relay.env.new'), 'PORT=8080\n');
    const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    const remoteDeploy = /remote_deploy='([\s\S]*?)'\n/.exec(workflow)?.[1];
    assert.ok(remoteDeploy, 'deploy.yml must contain the remote deployment script');
    execFileSync('bash', ['-c', remoteDeploy], {
      cwd: directory,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SYSTEMCTL_CALLS: calls },
    });
    const commands = readFileSync(calls, 'utf8');
    assert.equal(commands.includes('--user restart'), changed);
    if (changed) {
      assert.equal(readFileSync(join(directory, 'slingshot-server'), 'utf8'), 'new binary');
      assert.equal(readFileSync(join(directory, 'slingshot-server.prev'), 'utf8'), 'old binary');
    }
  });
}

test('rollback without a previous deployment preserves the running files', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'slingshot-relay-rollback-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  for (const command of ['systemctl', 'sleep']) {
    writeFileSync(join(bin, command), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, command), 0o755);
  }
  writeFileSync(join(directory, 'slingshot-server'), 'running binary');
  writeFileSync(join(directory, 'relay.env'), 'PORT=8080\n');
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const rollback = /remote_rollback='([\s\S]*?)'\n/.exec(workflow)?.[1];
  assert.ok(rollback);
  execFileSync('bash', ['-c', rollback], { cwd: directory, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(readFileSync(join(directory, 'slingshot-server'), 'utf8'), 'running binary');
  assert.equal(readFileSync(join(directory, 'relay.env'), 'utf8'), 'PORT=8080\n');
});
