import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readGitVersion } from '../server/gitVersion.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gv-'));
describe('readGitVersion', () => {
  it('prefers the host variables (Render), then GIT_COMMIT', () => {
    expect(readGitVersion('/nope', { RENDER_GIT_COMMIT: 'abc', RENDER_GIT_BRANCH: 'main' })).toEqual({ commit: 'abc', branch: 'main' });
    expect(readGitVersion('/nope', { GIT_COMMIT: 'def' })).toEqual({ commit: 'def', branch: null });
  });
  it('reads the checkout: loose ref, packed ref and detached HEAD', () => {
    const d = tmp(); fs.mkdirSync(path.join(d, '.git/refs/heads'), { recursive: true });
    fs.writeFileSync(path.join(d, '.git/HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(d, '.git/refs/heads/main'), '890f243fb869d33e2004aa98b9c17839defcf7b1\n');
    expect(readGitVersion(d, {})).toEqual({ commit: '890f243fb869d33e2004aa98b9c17839defcf7b1', branch: 'main' });
    fs.rmSync(path.join(d, '.git/refs/heads/main'));
    fs.writeFileSync(path.join(d, '.git/packed-refs'), '# pack-refs\n82cc12ffff refs/heads/main\n');
    expect(readGitVersion(d, {})).toEqual({ commit: '82cc12ffff', branch: 'main' });
    fs.writeFileSync(path.join(d, '.git/HEAD'), '1234567890abcdef\n');
    expect(readGitVersion(d, {})).toEqual({ commit: '1234567890abcdef', branch: null });
  });
  it('is null without a checkout', () => {
    expect(readGitVersion(tmp(), {})).toEqual({ commit: null, branch: null });
  });
});
