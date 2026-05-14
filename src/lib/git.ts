/**
 * Git utilities for the LastMile CLI
 *
 * Handles git repository detection, GitHub remote parsing,
 * and git operations like commit and push.
 */

import { execSync } from 'child_process';
import path from 'path';

export interface GitHubRepo {
  url: string;
  owner: string;
  repo: string;
  rootDirectory?: string;
}

export interface GitStatus {
  isRepo: boolean;
  hasRemote: boolean;
  hasUncommittedChanges: boolean;
  currentBranch: string | null;
  isBranchPushed: boolean;
}

/**
 * Execute a git command and return the output
 * Returns null if the command fails
 */
function gitExec(command: string, cwd: string): string | null {
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if a directory is inside a git repository
 */
export function isGitRepo(dir: string): boolean {
  return gitExec('git rev-parse --git-dir', dir) !== null;
}

/**
 * Get the root directory of the git repository
 */
export function getGitRoot(dir: string): string | null {
  return gitExec('git rev-parse --show-toplevel', dir);
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(dir: string): string | null {
  return gitExec('git branch --show-current', dir);
}

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(dir: string): boolean {
  const status = gitExec('git status --porcelain', dir);
  return status !== null && status.length > 0;
}

/**
 * Check if the current branch is pushed to the remote
 */
export function isBranchPushed(dir: string, branch: string): boolean {
  const result = gitExec(`git rev-parse --verify origin/${branch}`, dir);
  return result !== null;
}

/**
 * Parse a GitHub URL (HTTPS or SSH) into owner and repo
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Detect GitHub repository from git remote
 * Handles monorepo scenarios by calculating the relative root directory
 */
export function getGitHubRepo(projectDir: string): GitHubRepo | null {
  const gitRoot = getGitRoot(projectDir);
  if (!gitRoot) return null;

  const remoteUrl = gitExec('git config --get remote.origin.url', gitRoot);
  if (!remoteUrl) return null;

  const parsed = parseGitHubUrl(remoteUrl);
  if (!parsed) return null;

  const resolvedProjectDir = path.resolve(projectDir);
  const resolvedGitRoot = path.resolve(gitRoot);

  let rootDirectory: string | undefined;
  if (resolvedProjectDir !== resolvedGitRoot) {
    rootDirectory = path.relative(resolvedGitRoot, resolvedProjectDir);
  }

  return {
    url: `https://github.com/${parsed.owner}/${parsed.repo}`,
    owner: parsed.owner,
    repo: parsed.repo,
    rootDirectory,
  };
}

/**
 * Get comprehensive git status for a directory
 */
export function getGitStatus(dir: string, branch: string = 'main'): GitStatus {
  const isRepo = isGitRepo(dir);

  if (!isRepo) {
    return {
      isRepo: false,
      hasRemote: false,
      hasUncommittedChanges: false,
      currentBranch: null,
      isBranchPushed: false,
    };
  }

  const gitRoot = getGitRoot(dir) || dir;

  return {
    isRepo: true,
    hasRemote: getGitHubRepo(dir) !== null,
    hasUncommittedChanges: hasUncommittedChanges(gitRoot),
    currentBranch: getCurrentBranch(gitRoot),
    isBranchPushed: isBranchPushed(gitRoot, branch),
  };
}

/**
 * Stage files for commit
 */
export function stageFiles(dir: string, files: string[] = ['-A']): boolean {
  const gitRoot = getGitRoot(dir) || dir;
  const args = files.join(' ');
  return gitExec(`git add ${args}`, gitRoot) !== null;
}

/**
 * Create a commit with the given message
 */
export function commit(dir: string, message: string): boolean {
  const gitRoot = getGitRoot(dir) || dir;
  const escaped = message.replace(/"/g, '\\"');
  return gitExec(`git commit -m "${escaped}"`, gitRoot) !== null;
}

/**
 * Push to the remote
 */
export function push(dir: string, branch?: string, setUpstream: boolean = false): boolean {
  const gitRoot = getGitRoot(dir) || dir;
  const branchArg = branch || '';
  const upstreamArg = setUpstream ? '-u origin' : '';
  return gitExec(`git push ${upstreamArg} ${branchArg}`.trim(), gitRoot) !== null;
}

/**
 * Stage, commit, and push changes in one operation
 */
export function commitAndPush(
  dir: string,
  message: string,
  options: { branch?: string; setUpstream?: boolean } = {}
): { staged: boolean; committed: boolean; pushed: boolean } {
  const staged = stageFiles(dir);
  if (!staged) return { staged: false, committed: false, pushed: false };

  const committed = commit(dir, message);
  if (!committed) return { staged: true, committed: false, pushed: false };

  const pushed = push(dir, options.branch, options.setUpstream);
  return { staged: true, committed: true, pushed };
}
