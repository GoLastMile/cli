/**
 * lastmile ship
 *
 * The main command: analyze → fix blockers → deploy
 *
 * Flow:
 * 1. Validate environment (auth, git, GitHub remote)
 * 2. Collect project files
 * 3. Check for deployment blockers (fast, pattern-based)
 * 4. If blockers found:
 *    - Show them to user
 *    - Fix each with LLM agent
 *    - Write fixes to disk
 *    - Commit and push changes
 * 5. Deploy to LastMile Cloud
 * 6. Poll for completion and return live URL
 */

import { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import { confirm, input } from '@inquirer/prompts';

import { loadConfig } from '../lib/config.js';
import { createApiClient, type Gap, type Stack } from '../lib/api-client.js';
import { getAuthToken, isLoggedIn } from '../lib/auth.js';
import { collectFiles } from '../lib/file-collector.js';
import * as ui from '../lib/ui.js';
import * as git from '../lib/git.js';
import * as project from '../lib/project.js';
import { applyFixes, mergeFiles } from '../lib/fixer.js';
import { scanForSecrets, type SecretMatch } from '../lib/secrets-scanner.js';

// ============================================================================
// Types
// ============================================================================

interface ShipOptions {
  name?: string;
  branch: string;
  skipFix: boolean;
  yes: boolean;
}

interface ShipContext {
  projectDir: string;
  options: ShipOptions;
  api: ReturnType<typeof createApiClient>;
  repoInfo: git.GitHubRepo;
  projectName: string;
  files: Record<string, string>;
  stack: Stack;
}

// ============================================================================
// Validation Steps
// ============================================================================

async function validateAuth(): Promise<string> {
  if (!await isLoggedIn()) {
    ui.error('You need to be logged in.');
    console.log(chalk.dim('\nRun: lastmile login\n'));
    process.exit(1);
  }

  const token = await getAuthToken();
  if (!token) {
    ui.error('Could not retrieve auth token.');
    process.exit(1);
  }

  return token;
}

async function validateCloudStatus(api: ReturnType<typeof createApiClient>): Promise<void> {
  const spinner = ui.spinner();
  spinner.start('Checking LastMile Cloud...');

  try {
    const status = await api.getCloudStatus();
    if (!status.configured) {
      spinner.stop('LastMile Cloud not configured');
      ui.error('LastMile Cloud is not configured on the backend.');
      process.exit(1);
    }
    spinner.stop('LastMile Cloud ready');
  } catch (error) {
    spinner.stop('Connection failed');
    ui.error('Cannot connect to LastMile API.');
    console.log(chalk.dim(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

function validateGitRepo(projectDir: string): git.GitHubRepo {
  const status = git.getGitStatus(projectDir);

  if (!status.isRepo) {
    ui.error('Not a git repository.');
    console.log(chalk.dim('\nInitialize git first:'));
    console.log(chalk.cyan('  git init'));
    console.log(chalk.cyan('  gh repo create <name> --source=. --push'));
    process.exit(1);
  }

  const repoInfo = git.getGitHubRepo(projectDir);
  if (!repoInfo) {
    ui.error('No GitHub remote found.');
    console.log(chalk.dim('\nAdd a GitHub remote:'));
    console.log(chalk.cyan('  gh repo create <name> --source=. --push'));
    console.log(chalk.dim('\nOr manually:'));
    console.log(chalk.cyan('  git remote add origin https://github.com/<user>/<repo>.git'));
    console.log(chalk.cyan('  git push -u origin main'));
    process.exit(1);
  }

  return repoInfo;
}

async function ensureBranchPushed(
  projectDir: string,
  branch: string,
  skipPrompts: boolean
): Promise<void> {
  const status = git.getGitStatus(projectDir, branch);

  if (status.hasUncommittedChanges) {
    ui.warning('You have uncommitted changes.');
    const shouldContinue = skipPrompts || await confirm({
      message: 'Deploy anyway? (uncommitted changes won\'t be included)',
      default: false,
    });

    if (!shouldContinue) {
      console.log(chalk.dim('Commit your changes and try again.'));
      process.exit(0);
    }
  }

  if (!status.isBranchPushed) {
    ui.warning(`Branch '${branch}' is not pushed to GitHub.`);
    const shouldPush = skipPrompts || await confirm({
      message: 'Push now?',
      default: true,
    });

    if (shouldPush) {
      const spinner = ui.spinner();
      spinner.start('Pushing to GitHub...');

      const pushed = git.push(projectDir, branch, true);
      if (!pushed) {
        spinner.stop('Failed to push');
        ui.error(`Please push manually: git push -u origin ${branch}`);
        process.exit(1);
      }

      spinner.stop('Pushed to GitHub');
    } else {
      console.log(chalk.dim('Please push your code and try again.'));
      process.exit(0);
    }
  }
}

// ============================================================================
// Analysis & Fixing
// ============================================================================

async function analyzeForBlockers(
  api: ReturnType<typeof createApiClient>,
  files: Record<string, string>
): Promise<{ blockers: Gap[]; stack: Stack }> {
  const spinner = ui.spinner();
  spinner.start('Checking for deployment blockers...');

  try {
    const analysis = await api.analyze({ files });
    const blockers = analysis.gaps?.filter(g => g.severity === 'critical') || [];

    if (blockers.length === 0) {
      spinner.stop('No deployment blockers found');
    } else {
      spinner.stop(`Found ${blockers.length} deployment blocker(s)`);
    }

    return { blockers, stack: analysis.stack };
  } catch (error) {
    spinner.stop('Analysis failed');
    throw error;
  }
}

function displayBlockers(blockers: Gap[]): void {
  console.log();
  for (const blocker of blockers) {
    console.log(chalk.red(`  ✗ ${blocker.title}`));
    if (blocker.description) {
      console.log(chalk.dim(`    ${blocker.description}`));
    }
  }
  console.log();
}

async function fixBlockers(
  ctx: ShipContext,
  blockers: Gap[]
): Promise<{ fixed: number; failed: number }> {
  const progress = new ui.FixProgress(blockers.length);
  let fixed = 0;
  let failed = 0;

  for (const blocker of blockers) {
    progress.start(blocker.title);

    try {
      const fixResult = await ctx.api.agentFix({
        gap: {
          id: blocker.id,
          category: blocker.category,
          severity: blocker.severity,
          title: blocker.title,
          description: blocker.description,
          filePath: blocker.filePath,
          lineNumber: blocker.lineNumber || blocker.line,
          autoFixable: blocker.autoFixable ?? true,
          suggestedFix: blocker.suggestedFix,
        },
        stack: {
          language: ctx.stack.language,
          framework: ctx.stack.framework || null,
          database: ctx.stack.database || null,
          orm: ctx.stack.orm,
        },
        files: ctx.files,
      });

      if (fixResult.success && fixResult.filesWritten) {
        const writeResult = applyFixes(ctx.projectDir, fixResult.filesWritten);

        if (writeResult.success) {
          ctx.files = mergeFiles(ctx.files, fixResult.filesWritten);
          progress.done(writeResult.filesWritten.length);
          fixed++;
        } else {
          progress.fail(writeResult.errors[0]);
          failed++;
        }
      } else {
        progress.fail(fixResult.error || 'Fix generation failed');
        failed++;
      }
    } catch (error) {
      progress.fail(error instanceof Error ? error.message : 'Unknown error');
      failed++;
    }
  }

  return { fixed, failed };
}

async function commitAndPushFixes(
  projectDir: string,
  skipPrompts: boolean
): Promise<boolean> {
  const status = git.getGitStatus(projectDir);
  if (!status.hasUncommittedChanges) {
    return true;
  }

  const shouldCommit = skipPrompts || await confirm({
    message: 'Commit and push fixes?',
    default: true,
  });

  if (!shouldCommit) {
    ui.warning('Fixes not committed. Deploy may fail if blockers remain.');
    return false;
  }

  const spinner = ui.spinner();
  spinner.start('Committing fixes...');

  const result = git.commitAndPush(projectDir, 'fix: resolve deployment blockers (via lastmile)');

  if (result.pushed) {
    spinner.stop('Committed and pushed fixes');
    return true;
  } else if (result.committed) {
    spinner.stop('Committed but failed to push');
    ui.warning('Please push manually: git push');
    return false;
  } else {
    spinner.stop('Failed to commit');
    return false;
  }
}

// ============================================================================
// Deployment
// ============================================================================

async function deployToCloud(ctx: ShipContext): Promise<void> {
  const dbInfo = project.detectDatabaseInfo(ctx.projectDir);

  console.log(chalk.bold('\n📦 Deployment Summary:'));
  console.log(`   Project:  ${ctx.projectName}`);
  console.log(`   Repo:     ${ctx.repoInfo.url}`);
  console.log(`   Branch:   ${ctx.options.branch}`);
  if (ctx.repoInfo.rootDirectory) {
    console.log(`   Root:     ${ctx.repoInfo.rootDirectory}`);
  }
  if (dbInfo.detected) {
    console.log(`   Database: Postgres (managed)`);
    if (dbInfo.orm) {
      console.log(`   ORM:      ${dbInfo.orm}`);
    }
  }
  console.log();

  const shouldDeploy = ctx.options.yes || await confirm({
    message: 'Deploy to LastMile Cloud?',
    default: true,
  });

  if (!shouldDeploy) {
    console.log(chalk.dim('Deployment cancelled.'));
    process.exit(0);
  }

  const spinner = ui.spinner();
  spinner.start('Deploying to LastMile Cloud...');

  try {
    const deployment = await ctx.api.deployToCloud({
      projectName: ctx.projectName,
      repoUrl: ctx.repoInfo.url,
      branch: ctx.options.branch,
      withDatabase: dbInfo.detected,
      rootDirectory: ctx.repoInfo.rootDirectory,
      orm: dbInfo.orm,
      migrateCommand: dbInfo.migrateCommand,
    });

    if (deployment.status === 'failed') {
      spinner.stop('Deployment failed');
      ui.error(deployment.error || 'Unknown deployment error');
      process.exit(1);
    }

    // Poll for completion
    const finalDeployment = await pollDeployment(ctx.api, deployment.id, spinner);

    spinner.stop('Deployed!');
    printSuccessMessage(finalDeployment.url, deployment.databaseUrl);
  } catch (error) {
    spinner.stop('Deployment failed');
    ui.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

async function pollDeployment(
  api: ReturnType<typeof createApiClient>,
  deploymentId: string,
  spinner: ReturnType<typeof ui.spinner>
): Promise<{ url: string; status: string }> {
  const maxWaitMs = 5 * 60 * 1000;
  const pollIntervalMs = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const deployment = await api.getCloudDeployment(deploymentId);

    if (deployment.status === 'live') {
      return { url: deployment.url, status: deployment.status };
    }

    if (deployment.status === 'failed') {
      throw new Error(deployment.error || 'Deployment failed');
    }

    spinner.message(`Deploying... (${deployment.status})`);
    await sleep(pollIntervalMs);
  }

  throw new Error('Deployment timeout (5 minutes)');
}

function printSuccessMessage(url: string, databaseUrl?: string): void {
  console.log(chalk.bold('\n✨ Your app is live!\n'));
  console.log(`   ${chalk.cyan(url)}`);

  if (databaseUrl) {
    const maskedUrl = databaseUrl.replace(/:[^:@]+@/, ':****@');
    console.log(chalk.dim(`\n   Database: ${maskedUrl}`));
  }

  console.log();
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Main Command
// ============================================================================

async function ship(pathArg: string, options: ShipOptions): Promise<void> {
  const projectDir = path.resolve(pathArg);

  console.log(chalk.bold('\n🚀 LastMile Ship\n'));

  // Validate project directory exists
  if (!project.directoryExists(projectDir)) {
    ui.error(`Directory not found: ${projectDir}`);
    process.exit(1);
  }

  // Step 1: Validate environment
  const authToken = await validateAuth();
  const config = await loadConfig();
  const api = createApiClient({ ...config, apiKey: authToken });

  await validateCloudStatus(api);

  const repoInfo = validateGitRepo(projectDir);
  console.log(chalk.dim(`Repository: ${repoInfo.url}`));

  await ensureBranchPushed(projectDir, options.branch, options.yes);

  // Step 2: Collect files
  const spinner = ui.spinner();
  spinner.start('Collecting files...');
  const filesMap = await collectFiles(projectDir);
  const files = Object.fromEntries(filesMap);
  spinner.stop(`Collected ${filesMap.size} files`);

  // Step 3: Secrets scan (fail fast before sending to server)
  const secretsSpinner = ui.spinner();
  secretsSpinner.start('Scanning for hardcoded secrets...');
  const secrets = scanForSecrets(filesMap);

  if (secrets.length > 0) {
    secretsSpinner.stop('Hardcoded secrets found');
    console.log();
    ui.error('Cannot deploy: hardcoded secrets detected\n');

    const byType = new Map<string, SecretMatch[]>();
    for (const match of secrets) {
      const existing = byType.get(match.type) || [];
      existing.push(match);
      byType.set(match.type, existing);
    }

    for (const [type, matches] of byType) {
      console.log(chalk.red(`  ${type}:`));
      for (const match of matches) {
        console.log(chalk.dim(`    ${match.file}:${match.line}`));
      }
    }

    console.log(chalk.yellow('\nMove these to environment variables before deploying.'));
    console.log(chalk.dim('Use process.env.SECRET_NAME or equivalent.\n'));
    process.exit(1);
  }

  secretsSpinner.stop('No hardcoded secrets');

  // Step 5: Analyze for other blockers
  const { blockers, stack } = await analyzeForBlockers(api, files);

  // Build context for the rest of the flow
  const ctx: ShipContext = {
    projectDir,
    options,
    api,
    repoInfo,
    projectName: options.name || project.detectProjectName(projectDir),
    files,
    stack,
  };

  // Step 6: Fix blockers if any
  if (blockers.length > 0 && !options.skipFix) {
    displayBlockers(blockers);

    const shouldFix = options.yes || await confirm({
      message: 'Fix these issues before deploying?',
      default: true,
    });

    if (shouldFix) {
      console.log();
      const { fixed, failed } = await fixBlockers(ctx, blockers);
      console.log();

      if (fixed > 0) {
        ui.success(`Fixed ${fixed} issue(s)`);
        if (failed > 0) {
          ui.warning(`Failed to fix ${failed} issue(s)`);
        }

        // Commit and push fixes
        await commitAndPushFixes(projectDir, options.yes);
      } else if (failed > 0) {
        ui.warning('Could not fix any blockers. Deployment may fail.');

        const shouldContinue = options.yes || await confirm({
          message: 'Continue with deployment anyway?',
          default: false,
        });

        if (!shouldContinue) {
          process.exit(1);
        }
      }
    }
  }

  // Step 7: Deploy
  await deployToCloud(ctx);
}

// ============================================================================
// Command Export
// ============================================================================

export const shipCommand = new Command('ship')
  .description('Analyze, fix, and deploy your project to LastMile Cloud')
  .argument('[path]', 'Project directory', '.')
  .option('--name <name>', 'Project name')
  .option('--branch <branch>', 'Git branch to deploy', 'main')
  .option('--skip-fix', 'Deploy without fixing blockers', false)
  .option('--yes', 'Skip confirmation prompts', false)
  .action(async (pathArg: string, opts) => {
    try {
      await ship(pathArg, {
        name: opts.name,
        branch: opts.branch,
        skipFix: opts.skipFix,
        yes: opts.yes,
      });
    } catch (error) {
      ui.error(error instanceof Error ? error.message : 'An unexpected error occurred');
      process.exit(1);
    }
  });
