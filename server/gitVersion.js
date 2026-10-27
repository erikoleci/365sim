// The commit this process was started from. Render sets RENDER_GIT_COMMIT; on a plain server
// (Contabo ...) it is read from the checkout's .git, so "is the latest code running?" is one GET.
// Read once at boot: a process that has not restarted after a `git pull` still reports the OLD commit,
// which is exactly the thing worth seeing.
import fs from 'fs';
import path from 'path';

export function readGitVersion(root = process.cwd(), env = process.env) {
  if (env.RENDER_GIT_COMMIT) return { commit: env.RENDER_GIT_COMMIT, branch: env.RENDER_GIT_BRANCH || null };
  if (env.GIT_COMMIT) return { commit: env.GIT_COMMIT, branch: env.GIT_BRANCH || null };
  try {
    const gitDir = path.join(root, '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return { commit: head || null, branch: null }; // detached HEAD
    const ref = head.slice(5);
    const branch = ref.replace(/^refs\/heads\//, '');
    try {
      return { commit: fs.readFileSync(path.join(gitDir, ref), 'utf8').trim(), branch };
    } catch {
      const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(' ' + ref));
      return { commit: packed ? packed.split(' ')[0] : null, branch };
    }
  } catch {
    return { commit: null, branch: null };
  }
}
