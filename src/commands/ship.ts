/**
 * lastmile ship
 *
 * The ONE command that matters:
 * Take a repo → make it deployable → deploy it → return live URL
 *
 * Focused flow:
 * 1. Collect files
 * 2. Check deployability (not full analysis)
 * 3. Fix only deployment blockers (templates, no LLM)
 * 4. Deploy to LastMile Cloud
 * 5. Return URL
 */

import { Command } from 'commander';
import { resolve, dirname, basename } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { execSync } from 'child_process';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';
import * as ui from '../lib/ui.js';

async function getGitRemoteUrl(projectRoot: string): Promise<string | null> {
  try {
    const remote = execSync('git remote get-url origin', { cwd: projectRoot, encoding: 'utf-8' }).trim();
    // Convert SSH to HTTPS format if needed
    if (remote.startsWith('git@github.com:')) {
      return remote.replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '');
    }
    return remote.replace(/\.git$/, '');
  } catch {
    return null;
  }
}

async function getGitBranch(projectRoot: string): Promise<string> {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();
  } catch {
    return 'main';
  }
}

async function getProjectName(projectRoot: string): Promise<string> {
  try {
    const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf-8'));
    if (packageJson.name && !packageJson.name.startsWith('@')) {
      return packageJson.name;
    }
  } catch {}
  return basename(projectRoot);
}

interface DeployabilityResult {
  deployable: boolean;
  blockers: Array<{
    id: string;
    category: string;
    severity: string;
    title: string;
    description?: string;
    autoFixable: boolean;
    suggestedFix?: string;
  }>;
  warnings: string[];
  stack: {
    language: string | null;
    framework: string | null;
    database: string | null;
    orm: string | null;
  };
}

export const shipCommand = new Command('ship')
  .description('Deploy your project to production')
  .argument('[path]', 'Directory to deploy', '.')
  .option('--yes', 'Skip confirmation prompts')
  .option('--skip-fix', 'Deploy without fixing blockers')
  .option('--dry-run', 'Check deployability without deploying')
  .option('--full', 'Run full analysis (not just deployability)')
  .action(async (pathArg, options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    const projectRoot = resolve(process.cwd(), pathArg);

    console.log();
    ui.log.info('LastMile Ship');
    console.log();

    try {
      // Step 1: Collect files
      const s = ui.spinner();
      s.start('Collecting files...');
      const files = await collectFiles(projectRoot, {
        ignorePaths: config.analysis?.ignorePaths ?? [],
      });
      s.stop(`${files.size} files`);

      // Step 2: Check deployability
      s.start('Checking deployability...');

      let result: DeployabilityResult;

      if (options.full) {
        // Full analysis mode (slower, more comprehensive)
        const analysis = await api.analyze({
          files: Object.fromEntries(files),
          options: { mode: 'full' },
        });

        result = {
          deployable: analysis.gaps.filter(g => g.severity === 'critical').length === 0,
          blockers: analysis.gaps.filter(g => g.severity === 'critical'),
          warnings: analysis.gaps.filter(g => g.severity === 'warning').map(g => g.title),
          stack: analysis.stack,
        };
      } else {
        // Fast deployability check (default)
        const analysis = await api.analyze({
          files: Object.fromEntries(files),
          options: { mode: 'deployability' },
        });

        result = {
          deployable: analysis.gaps.filter(g => g.severity === 'critical').length === 0,
          blockers: analysis.gaps.filter(g => g.severity === 'critical'),
          warnings: analysis.gaps.filter(g => g.severity === 'warning').map(g => g.title),
          stack: analysis.stack,
        };
      }

      s.stop('Done');

      // Show deployability status
      console.log();
      ui.log.message('Deployability Check');
      console.log();

      if (result.blockers.length === 0) {
        ui.log.success('No deployment blockers found');
      } else {
        for (const blocker of result.blockers) {
          const fixable = blocker.autoFixable ? '' : ' (manual fix required)';
          ui.log.error(`${blocker.title}${fixable}`);
        }
        console.log();
      }

      if (result.warnings.length > 0) {
        ui.log.warning(`${result.warnings.length} warning(s):`);
        for (const warning of result.warnings.slice(0, 3)) {
          ui.log.warning(warning);
        }
        if (result.warnings.length > 3) {
          ui.log.info(`... and ${result.warnings.length - 3} more`);
        }
        console.log();
      }

      // Dry run mode - just show status
      if (options.dryRun) {
        if (result.deployable) {
          ui.log.success('Project is deployable');
        } else {
          ui.log.error(`${result.blockers.length} blocker(s) must be fixed before deployment`);
        }
        return;
      }

      // Step 3: Fix blockers if needed
      const fixableBlockers = result.blockers.filter(b => b.autoFixable);

      if (fixableBlockers.length > 0 && !options.skipFix) {
        const shouldFix = options.yes || await ui.confirm(
          `Fix ${fixableBlockers.length} blocker(s)?`,
          true
        );

        if (shouldFix) {
          s.start(`Fixing ${fixableBlockers.length} blocker(s)...`);

          let fixedCount = 0;
          for (const blocker of fixableBlockers) {
            try {
              const fixResult = await api.agentFix({
                gap: {
                  id: blocker.id,
                  category: blocker.category,
                  severity: blocker.severity as 'critical' | 'warning' | 'info',
                  title: blocker.title,
                  description: blocker.description || '',
                  autoFixable: true,
                  suggestedFix: blocker.suggestedFix,
                },
                stack: {
                  language: result.stack.language,
                  framework: result.stack.framework,
                  database: result.stack.database,
                },
                files: Object.fromEntries(files),
              });

              if (fixResult.success && fixResult.filesWritten) {
                for (const [filePath, content] of Object.entries(fixResult.filesWritten)) {
                  const fullPath = resolve(projectRoot, filePath);
                  await mkdir(dirname(fullPath), { recursive: true });
                  await writeFile(fullPath, content, 'utf-8');
                }
                fixedCount++;
              }
            } catch (err) {
              // Continue with other fixes
              console.error(`Failed to fix: ${blocker.title}`);
            }
          }

          s.stop(`Fixed ${fixedCount}/${fixableBlockers.length}`);
        }
      }

      // Check if there are still unfixable blockers
      const unfixableBlockers = result.blockers.filter(b => !b.autoFixable);
      if (unfixableBlockers.length > 0) {
        console.log();
        ui.log.error('Cannot deploy: manual fixes required');
        for (const blocker of unfixableBlockers) {
          ui.log.error(blocker.title);
          if (blocker.suggestedFix) {
            ui.log.info(`  ${blocker.suggestedFix}`);
          }
        }
        process.exit(1);
      }

      // Step 4: Deploy
      // Check for git remote (required for Railway deployment)
      const repoUrl = await getGitRemoteUrl(projectRoot);
      if (!repoUrl) {
        ui.log.error('No git remote found. Push your code to GitHub first.');
        ui.log.info('Run: git remote add origin https://github.com/your-username/your-repo');
        process.exit(1);
      }

      const branch = await getGitBranch(projectRoot);
      const projectName = await getProjectName(projectRoot);

      console.log();
      ui.log.info(`Repository: ${repoUrl}`);
      ui.log.info(`Branch: ${branch}`);
      ui.log.info(`Project: ${projectName}`);
      console.log();

      const shouldDeploy = options.yes || await ui.confirm('Deploy to production?', true);

      if (!shouldDeploy) {
        ui.log.info('Deployment cancelled');
        return;
      }

      s.start('Deploying to LastMile Cloud...');

      // Auto-detect if database is needed based on stack
      const needsDatabase = !!(result.stack.database || result.stack.orm);

      if (needsDatabase) {
        ui.log.info(`Database detected (${result.stack.orm || result.stack.database}) - provisioning PostgreSQL`);
      }

      const deployment = await api.deployToCloud({
        projectName,
        repoUrl,
        branch,
        withDatabase: needsDatabase,
        orm: result.stack.orm || undefined,
      });

      if (deployment.status === 'failed') {
        s.stop('Deployment failed');
        ui.log.error(deployment.error || 'Unknown error');
        process.exit(1);
      }

      // Poll for completion
      let status = deployment.status;
      while (status === 'pending' || status === 'deploying' || status === 'configuring') {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const updated = await api.getCloudDeployment(deployment.id);
        status = updated.status;
        s.message(`Deploying... (${status})`);
      }

      if (status === 'live') {
        s.stop('Deployed!');
        console.log();
        ui.log.success(`Your app is live at: ${deployment.url}`);
        console.log();
      } else {
        s.stop('Deployment failed');
        ui.log.error(deployment.error || `Deployment ended with status: ${status}`);
        process.exit(1);
      }

    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          ui.log.error('Could not connect to LastMile API');
          ui.log.info('Make sure the backend is running');
        } else {
          ui.log.error(error.message);
        }
      } else {
        ui.log.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });
