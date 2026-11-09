import { git, isDubiousOwnership } from './safe.js';

export interface RepoStatus {
  tracked: Set<string>;
  indexBlobs: Map<string, string>;
  ignored: Set<string>;
  shallow: boolean;
  /** git refused the repo (dubious ownership); grade work-tree files AT-RISK. */
  skipped: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function repoStatus(
  repo: string,
  rels: string[],
  warnings: string[],
): Promise<RepoStatus> {
  const tracked = new Set<string>();
  const indexBlobs = new Map<string, string>();
  const ignored = new Set<string>();
  let shallow = false;
  let skipped = false;

  const shallowRes = await git(repo, ['rev-parse', '--is-shallow-repository']);
  if (shallowRes.code !== 0) {
    if (isDubiousOwnership(shallowRes.stderr)) {
      warnings.push(`repo ${repo} is not owned by the current user; git checks skipped`);
      return { tracked, indexBlobs, ignored, shallow, skipped: true };
    }
  } else {
    shallow = shallowRes.stdout.toString('utf8').trim() === 'true';
    if (shallow) {
      warnings.push(`repo ${repo} is a shallow clone; history incomplete`);
    }
  }

  for (const part of chunk(rels, 500)) {
    const res = await git(repo, ['ls-files', '-s', '-z', '--', ...part]);
    if (res.code !== 0) {
      if (isDubiousOwnership(res.stderr)) {
        warnings.push(`repo ${repo} is not owned by the current user; git checks skipped`);
        return { tracked, indexBlobs, ignored, shallow, skipped: true };
      }
      warnings.push(`git ls-files failed in ${repo}; work-tree files graded conservatively`);
      continue;
    }
    for (const rec of res.stdout.toString('utf8').split('\0')) {
      if (!rec) continue;
      const tab = rec.indexOf('\t');
      if (tab < 0) continue;
      const meta = rec.slice(0, tab).split(' ');
      const rel = rec.slice(tab + 1);
      const sha = meta[1];
      tracked.add(rel);
      if (sha) indexBlobs.set(rel, sha);
    }
  }

  const untracked = rels.filter((r) => !tracked.has(r));
  if (untracked.length > 0) {
    const res = await git(repo, ['check-ignore', '-z', '--stdin'], {
      input: untracked.join('\0') + '\0',
    });
    if (res.code === 0) {
      for (const rec of res.stdout.toString('utf8').split('\0')) {
        if (rec) ignored.add(rec);
      }
    } else if (res.code === 1) {
      // nothing ignored; not an error
    } else if (isDubiousOwnership(res.stderr)) {
      warnings.push(`repo ${repo} is not owned by the current user; git checks skipped`);
      return { tracked, indexBlobs, ignored, shallow, skipped: true };
    }
  }

  return { tracked, indexBlobs, ignored, shallow, skipped };
}
