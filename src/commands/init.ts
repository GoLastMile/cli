import { Command } from 'commander';
import { input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { writeFile, mkdir, readFile, access } from 'fs/promises';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';

const LASTMILE_DIR = '.lastmile';
const PROJECT_FILE = 'project.json';

interface ProjectConfig {
  projectId: string;
  name: string;
  createdAt: string;
  repoUrl?: string;
}

async function getGitRemoteUrl(): Promise<string | null> {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return url || null;
  } catch {
    return null;
  }
}

async function getGitRepoName(): Promise<string | null> {
  try {
    const url = await getGitRemoteUrl();
    if (!url) return null;
    const match = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadProjectConfig(): Promise<ProjectConfig | null> {
  try {
    const content = await readFile(join(LASTMILE_DIR, PROJECT_FILE), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export const initCommand = new Command('init')
  .description('Initialize LastMile for this project')
  .option('--name <name>', 'Project name')
  .option('--force', 'Overwrite existing project config')
  .action(async (options) => {
    console.log(chalk.bold('\n  LastMile Project Setup\n'));

    // Check if already initialized
    const existingConfig = await loadProjectConfig();
    if (existingConfig && !options.force) {
      console.log(chalk.yellow(`  Project already initialized: ${existingConfig.name}`));
      console.log(chalk.dim(`  Project ID: ${existingConfig.projectId}`));
      console.log(chalk.dim(`\n  Use --force to reinitialize.\n`));
      return;
    }

    // Load config for API key
    const config = await loadConfig();
    if (!config.apiKey) {
      console.log(chalk.red('  Not logged in. Run `lastmile login` first.\n'));
      process.exit(1);
    }

    const api = createApiClient(config);

    // Verify authentication
    try {
      await api.getMe();
    } catch (error) {
      console.log(chalk.red('  Authentication failed. Run `lastmile login` to re-authenticate.\n'));
      process.exit(1);
    }

    // Detect git info
    const repoUrl = await getGitRemoteUrl();
    const repoFullName = await getGitRepoName();

    // Get project name
    let projectName = options.name;
    if (!projectName) {
      const defaultName = repoFullName?.split('/')[1] || basename(process.cwd());
      projectName = await input({
        message: 'Project name:',
        default: defaultName,
      });
    }

    // Show what we detected
    console.log('');
    if (repoUrl) {
      console.log(chalk.dim(`  Git remote: ${repoUrl}`));
    } else {
      console.log(chalk.dim('  No git remote detected'));
    }
    console.log('');

    // Create project in backend
    let project;
    try {
      console.log(chalk.dim('  Registering project...'));
      project = await api.createProject({
        name: projectName,
        repoUrl: repoUrl || undefined,
        repoFullName: repoFullName || undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.log(chalk.red(`\n  Failed to create project: ${message}\n`));
      process.exit(1);
    }

    // Create .lastmile directory
    const lastmileDir = LASTMILE_DIR;
    if (!(await fileExists(lastmileDir))) {
      await mkdir(lastmileDir, { recursive: true });
    }

    // Write project config
    const projectConfig: ProjectConfig = {
      projectId: project.id,
      name: project.name,
      createdAt: project.createdAt,
      repoUrl: project.repoUrl || undefined,
    };
    await writeFile(
      join(lastmileDir, PROJECT_FILE),
      JSON.stringify(projectConfig, null, 2) + '\n'
    );

    // Add to .gitignore if it exists
    const gitignorePath = '.gitignore';
    if (await fileExists(gitignorePath)) {
      const gitignore = await readFile(gitignorePath, 'utf-8');
      if (!gitignore.includes('.lastmile/')) {
        const shouldAdd = await confirm({
          message: 'Add .lastmile/ to .gitignore?',
          default: true,
        });
        if (shouldAdd) {
          await writeFile(gitignorePath, gitignore.trimEnd() + '\n\n# LastMile\n.lastmile/\n');
          console.log(chalk.dim('  Added .lastmile/ to .gitignore'));
        }
      }
    }

    console.log(chalk.green(`\n  Project initialized: ${project.name}`));
    console.log(chalk.dim(`  Project ID: ${project.id}`));
    console.log(chalk.dim(`\n  Run \`lastmile analyze\` to analyze your project.\n`));
  });
