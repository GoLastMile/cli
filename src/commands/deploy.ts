import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { confirm, select, input } from '@inquirer/prompts';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { getAuthToken, isLoggedIn } from '../lib/auth.js';

export const deployCommand = new Command('deploy')
  .description('Deploy your project to LastMile Cloud')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option('--platform <platform>', 'Deployment platform (cloud, railway, vercel)', 'cloud')
  .option('--name <name>', 'Project name')
  .option('--branch <branch>', 'Git branch to deploy', 'main')
  .option('--with-database', 'Provision a Postgres database')
  .option('--root-directory <path>', 'Root directory within repo (for monorepos)')
  .option('--yes', 'Skip confirmation prompts')
  .action(async (options) => {
    console.log(chalk.bold('\n🚀 LastMile Deploy\n'));

    // Check authentication for LastMile Cloud
    if (!options.platform || options.platform === 'cloud') {
      const loggedIn = await isLoggedIn();
      if (!loggedIn) {
        console.log(chalk.yellow('You need to be logged in to deploy to LastMile Cloud.\n'));
        console.log(chalk.dim('Run: lastmile login\n'));
        process.exit(1);
      }
    }

    const config = await loadConfig();
    const authToken = await getAuthToken();

    // Use auth token if available, fall back to config apiKey
    const api = createApiClient({
      ...config,
      apiKey: authToken || config.apiKey,
    });

    const projectDir = path.resolve(options.directory);

    // Check if directory exists
    if (!fs.existsSync(projectDir)) {
      console.log(chalk.red(`Directory not found: ${projectDir}`));
      process.exit(1);
    }

    // Determine platform
    let platform = options.platform;
    if (!platform || platform === 'cloud') {
      // Default to LastMile Cloud
      platform = 'cloud';
    } else if (!['railway', 'vercel'].includes(platform)) {
      platform = await select({
        message: 'Select deployment platform:',
        choices: [
          { name: 'LastMile Cloud (recommended)', value: 'cloud' },
          { name: 'Railway (your account)', value: 'railway' },
          { name: 'Vercel (your account)', value: 'vercel' },
        ],
      });
    }

    // For non-cloud platforms, use the old flow
    if (platform !== 'cloud') {
      await deployToPlatform(platform, options, config, api);
      return;
    }

    // =========================================================================
    // LastMile Cloud Deployment
    // =========================================================================

    // Check if LastMile Cloud is configured
    const spinner = ora('Checking LastMile Cloud status...').start();
    try {
      const status = await api.getCloudStatus();
      if (!status.configured) {
        spinner.fail('LastMile Cloud is not configured on the backend');
        console.log(chalk.dim('\nMissing configuration. Contact support.\n'));
        process.exit(1);
      }
      spinner.succeed('LastMile Cloud is ready');
    } catch (error) {
      spinner.fail('Could not connect to LastMile API');
      console.log(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }

    // Detect project name
    let projectName = options.name;
    if (!projectName) {
      projectName = detectProjectName(projectDir);
      if (!options.yes) {
        projectName = await input({
          message: 'Project name:',
          default: projectName,
        });
      }
    }
    console.log(chalk.dim(`Project: ${projectName}`));

    // Detect GitHub repo
    const repoResult = detectGitHubRepo(projectDir);

    if (repoResult.status === 'no_git') {
      console.log(chalk.red('\n❌ No git repository found.'));
      console.log(chalk.dim('LastMile Cloud deploys from GitHub. Initialize git first:\n'));
      console.log(chalk.cyan(`  cd ${projectDir}`));
      console.log(chalk.cyan('  git init'));
      console.log(chalk.cyan(`  gh repo create ${projectName} --source=. --push`));
      console.log(chalk.dim('\nThen run: lastmile deploy\n'));
      process.exit(1);
    }

    if (repoResult.status === 'no_remote') {
      console.log(chalk.red('\n❌ No GitHub remote found.'));
      console.log(chalk.dim('This project has git but no GitHub remote. Add one:\n'));
      console.log(chalk.cyan(`  gh repo create ${projectName} --source=. --push`));
      console.log(chalk.dim('\nOr manually:'));
      console.log(chalk.cyan('  git remote add origin https://github.com/YOUR_USERNAME/' + projectName + '.git'));
      console.log(chalk.cyan('  git push -u origin main'));
      console.log(chalk.dim('\nThen run: lastmile deploy\n'));
      process.exit(1);
    }

    // At this point, repoResult.status === 'found'
    const repoInfo = repoResult;
    // Use CLI flag or auto-detected rootDirectory from monorepo detection
    const rootDirectory = options.rootDirectory || repoInfo.rootDirectory;

    console.log(chalk.dim(`Repository: ${repoInfo.url}`));
    console.log(chalk.dim(`Branch: ${options.branch}`));
    if (rootDirectory) {
      console.log(chalk.dim(`Root directory: ${rootDirectory}`));
    }

    // Check for uncommitted changes
    const hasUncommittedChanges = checkUncommittedChanges(projectDir);
    if (hasUncommittedChanges) {
      console.log(chalk.yellow('\n⚠️  You have uncommitted changes.'));
      const shouldContinue = options.yes || await confirm({
        message: 'Deploy anyway? (uncommitted changes won\'t be included)',
        default: false,
      });
      if (!shouldContinue) {
        console.log(chalk.dim('Commit your changes and try again.'));
        process.exit(0);
      }
    }

    // Check if branch is pushed
    const isPushed = checkBranchPushed(projectDir, options.branch);
    if (!isPushed) {
      console.log(chalk.yellow(`\n⚠️  Branch '${options.branch}' is not pushed to GitHub.`));
      const shouldPush = options.yes || await confirm({
        message: 'Push now?',
        default: true,
      });
      if (shouldPush) {
        const pushSpinner = ora('Pushing to GitHub...').start();
        try {
          execSync(`git push -u origin ${options.branch}`, {
            cwd: projectDir,
            stdio: 'pipe',
          });
          pushSpinner.succeed('Pushed to GitHub');
        } catch (error) {
          pushSpinner.fail('Failed to push');
          console.log(chalk.red('Please push manually: git push -u origin ' + options.branch));
          process.exit(1);
        }
      } else {
        console.log(chalk.dim('Please push your code and try again.'));
        process.exit(0);
      }
    }

    // Detect if database is needed
    let withDatabase = options.withDatabase;
    if (withDatabase === undefined) {
      withDatabase = detectDatabaseUsage(projectDir);
      if (withDatabase && !options.yes) {
        withDatabase = await confirm({
          message: 'Database detected. Provision Postgres?',
          default: true,
        });
      }
    }

    // Confirm deployment
    console.log(chalk.bold('\n📦 Deployment Summary:'));
    console.log(`   Project:  ${projectName}`);
    console.log(`   Repo:     ${repoInfo.url}`);
    console.log(`   Branch:   ${options.branch}`);
    if (rootDirectory) {
      console.log(`   Root:     ${rootDirectory}`);
    }
    console.log(`   Database: ${withDatabase ? 'Yes (Postgres)' : 'No'}`);
    console.log();

    const shouldDeploy = options.yes || await confirm({
      message: 'Deploy to LastMile Cloud?',
      default: true,
    });

    if (!shouldDeploy) {
      console.log(chalk.dim('Deployment cancelled.'));
      return;
    }

    // Deploy!
    const deploySpinner = ora('Deploying to LastMile Cloud...').start();

    try {
      const deployment = await api.deployToCloud({
        projectName,
        repoUrl: repoInfo.url,
        branch: options.branch,
        withDatabase,
        rootDirectory,
      });

      if (deployment.error || deployment.status === 'failed') {
        deploySpinner.fail('Deployment failed');
        console.log(chalk.red(`\nError: ${deployment.error}\n`));
        process.exit(1);
      }

      deploySpinner.text = 'Building...';

      // Stream build logs
      let lastStatus = deployment.status;
      let logLines: string[] = [];

      try {
        for await (const event of api.streamDeploymentLogs(deployment.id)) {
          if (event.status && event.status !== lastStatus) {
            lastStatus = event.status;
            const statusText = getStatusText(event.status);
            deploySpinner.text = statusText;
          }

          if (event.logs && event.logs.length > 0) {
            // Show new log lines
            for (const line of event.logs) {
              logLines.push(line);
              // Show last few lines in spinner
              if (!options.yes) {
                const trimmedLine = line.length > 60 ? line.slice(0, 57) + '...' : line;
                deploySpinner.text = chalk.dim(trimmedLine);
              }
            }
          }

          if (event.type === 'complete') {
            // Handle both Railway status (SUCCESS) and LastMile status (live)
            const isSuccess = event.status === 'SUCCESS' || event.status === 'live';
            if (isSuccess) {
              deploySpinner.succeed(chalk.green('Deployed successfully!'));
            } else {
              deploySpinner.fail('Deployment failed');
              console.log(chalk.dim('\nBuild logs:'));
              logLines.slice(-20).forEach(line => console.log(chalk.dim(`  ${line}`)));
              process.exit(1);
            }
            break;
          }

          if (event.type === 'error') {
            deploySpinner.fail('Deployment failed');
            console.log(chalk.red(`\nError: ${event.error}\n`));
            process.exit(1);
          }
        }
      } catch {
        // Streaming not available, fall back to polling
        deploySpinner.text = 'Waiting for deployment...';
        await waitForDeployment(api, deployment.id, deploySpinner);
      }

      // Get final deployment status
      const finalDeployment = await api.getCloudDeployment(deployment.id);

      console.log(chalk.bold('\n✨ Your app is live!\n'));
      console.log(`   ${chalk.cyan(finalDeployment.url)}`);
      if (deployment.databaseUrl) {
        console.log(chalk.dim(`\n   Database: ${deployment.databaseUrl.replace(/:[^:@]+@/, ':****@')}`));
      }
      console.log();
    } catch (error) {
      deploySpinner.fail('Deployment failed');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Detect project name from package.json or directory name
 */
function detectProjectName(projectDir: string): string {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.name && !pkg.name.startsWith('@')) {
        return pkg.name;
      }
    } catch {}
  }
  return path.basename(projectDir);
}

type GitRepoResult =
  | { status: 'found'; url: string; owner: string; repo: string; rootDirectory?: string }
  | { status: 'no_git' }
  | { status: 'no_remote' };

/**
 * Detect GitHub repository from git remote
 * Returns different statuses to help guide the user
 * For monorepos, calculates the relative root directory
 */
function detectGitHubRepo(projectDir: string): GitRepoResult {
  // Check if this directory is a git repo
  let gitRoot: string;
  try {
    gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Not inside any git repo
    return { status: 'no_git' };
  }

  // Check if the project directory IS the git root (not a subdirectory)
  const resolvedProjectDir = path.resolve(projectDir);
  const resolvedGitRoot = path.resolve(gitRoot);

  // Calculate relative path for monorepo subdirectories
  let rootDirectory: string | undefined;
  if (resolvedProjectDir !== resolvedGitRoot) {
    // Project is inside a git repo subdirectory (monorepo scenario)
    // Calculate relative path from git root to project directory
    rootDirectory = path.relative(resolvedGitRoot, resolvedProjectDir);
  }

  // Get the remote URL (from git root for monorepos)
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd: gitRoot,  // Use git root, not project dir
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Parse GitHub URL (supports HTTPS and SSH)
    const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/);
    if (match) {
      const owner = match[1];
      const repo = match[2];
      return {
        status: 'found',
        url: `https://github.com/${owner}/${repo}`,
        owner,
        repo,
        rootDirectory,  // Include the monorepo subdirectory path
      };
    }
  } catch {}

  // Has git but no remote
  return { status: 'no_remote' };
}

/**
 * Check for uncommitted changes
 */
function checkUncommittedChanges(projectDir: string): boolean {
  try {
    const status = execSync('git status --porcelain', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if branch is pushed to remote
 */
function checkBranchPushed(projectDir: string, branch: string): boolean {
  try {
    execSync(`git rev-parse --verify origin/${branch}`, {
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect if project uses a database
 */
function detectDatabaseUsage(projectDir: string): boolean {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const dbPackages = ['prisma', '@prisma/client', 'drizzle-orm', 'typeorm', 'sequelize', 'knex', 'pg', 'mysql2', 'mongoose'];
      return dbPackages.some(p => deps[p]);
    } catch {}
  }
  return false;
}

/**
 * Convert Railway status to display text
 */
function getStatusText(status: string): string {
  const statusMap: Record<string, string> = {
    'QUEUED': 'Queued...',
    'BUILDING': 'Building...',
    'DEPLOYING': 'Deploying...',
    'SUCCESS': 'Deployed!',
    'FAILED': 'Failed',
    'CRASHED': 'Crashed',
    'REMOVED': 'Removed',
    'PENDING': 'Pending...',
    'pending': 'Pending...',
    'deploying': 'Deploying...',
    'configuring': 'Configuring...',
    'live': 'Live!',
    'failed': 'Failed',
  };
  return statusMap[status] || `Status: ${status}`;
}

/**
 * Fallback polling for deployment status
 */
async function waitForDeployment(
  api: ReturnType<typeof createApiClient>,
  deploymentId: string,
  spinner: ReturnType<typeof ora>
): Promise<void> {
  const maxWaitMs = 5 * 60 * 1000; // 5 minutes
  const pollIntervalMs = 5000; // 5 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const deployment = await api.getCloudDeployment(deploymentId);

    if (deployment.status === 'live') {
      spinner.succeed(chalk.green('Deployed successfully!'));
      return;
    }

    if (deployment.status === 'failed') {
      spinner.fail('Deployment failed');
      if (deployment.error) {
        console.log(chalk.red(`\nError: ${deployment.error}\n`));
      }
      process.exit(1);
    }

    spinner.text = getStatusText(deployment.status);
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  spinner.warn('Deployment is taking longer than expected');
  console.log(chalk.dim('Check your deployment status with: lastmile deploy status'));
}

/**
 * Deploy to Railway/Vercel (original flow)
 */
async function deployToPlatform(
  platform: string,
  options: { yes?: boolean },
  config: Awaited<ReturnType<typeof loadConfig>>,
  api: ReturnType<typeof createApiClient>
) {
  const tokenKey = platform === 'vercel' ? 'vercelToken' : 'railwayToken';
  const token = config.deployment?.[tokenKey as keyof typeof config.deployment] ||
                process.env[`${platform.toUpperCase()}_TOKEN`];

  if (!token) {
    console.log(chalk.red(`\nNo ${platform} token found.`));
    console.log(chalk.dim(`Set it in .lastmilerc or ${platform.toUpperCase()}_TOKEN env var.\n`));
    process.exit(1);
  }

  const shouldDeploy = options.yes || await confirm({
    message: `Deploy to ${platform}?`,
    default: true,
  });

  if (!shouldDeploy) {
    console.log(chalk.dim('Deployment cancelled.'));
    return;
  }

  const spinner = ora(`Deploying to ${platform}...`).start();

  try {
    const deployment = await api.deploy({
      platform,
      token: token as string,
      files: {},
    });

    let status = deployment.status;
    while (status === 'pending' || status === 'building') {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const updated = await api.getDeployment(deployment.id);
      status = updated.status;
      spinner.text = `Deploying to ${platform}... (${status})`;
    }

    if (status === 'success') {
      spinner.succeed(chalk.green('Deployed successfully!'));
      console.log(chalk.bold(`\n🚀 Your app is live at: ${chalk.cyan(deployment.url)}\n`));
    } else {
      spinner.fail('Deployment failed');
      console.log(chalk.red(`\nError: ${deployment.error}\n`));
      process.exit(1);
    }
  } catch (error) {
    spinner.fail('Deployment failed');
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}
