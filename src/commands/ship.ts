import { Command } from 'commander';
import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { confirm, select } from '@inquirer/prompts';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';
import { formatGaps } from '../lib/output.js';
import { displayDiff, applyFixes } from '../lib/diff.js';
import { buildLocalFixes } from '../lib/fix-engine.js';

export const shipCommand = new Command('ship')
  .description('Analyze, fix, and deploy in one command')
  .option('-d, --dir <path>', 'Directory to analyze', '.')
  .option('--platform <platform>', 'Deployment platform (railway, vercel)')
  .option('--yes', 'Skip all confirmation prompts')
  .action(async (options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    const projectRoot = resolve(process.cwd(), options.dir);

    console.log(chalk.bold('\n🚀 LastMile Ship\n'));

    // Step 1: Analyze
    let spinner = ora('Collecting files...').start();
    const files = await collectFiles(projectRoot, {
      ignorePaths: config.analysis?.ignorePaths ?? [],
    });
    spinner.text = `Analyzing ${files.size} files...`;

    const analysis = await api.analyze({
      files: Object.fromEntries(files),
    });

    spinner.succeed('Analysis complete');

    const criticalGaps = analysis.gaps.filter(g => g.severity === 'critical');
    const warningGaps = analysis.gaps.filter(g => g.severity === 'warning');

    if (analysis.gaps.length > 0) {
      console.log(formatGaps(analysis.gaps, 'warning'));
    }
    console.log(chalk.bold(`\nFound ${criticalGaps.length} critical, ${warningGaps.length} warnings\n`));

    if (analysis.gaps.length === 0) {
      console.log(chalk.green('✅ No gaps detected! Your project looks production-ready.\n'));
    } else {
      // Step 2: Generate and apply fixes
      const shouldFix = options.yes || await confirm({
        message: 'Generate and apply fixes?',
        default: true,
      });

      if (shouldFix) {
        spinner = ora('Generating local fixes...').start();
        const fixes = buildLocalFixes(projectRoot, files, analysis);
        spinner.succeed(`Generated ${fixes.length} local patch(es)`);

        if (fixes.length === 0) {
          console.log(chalk.dim('\nNo local patches for these gaps yet (e.g. .gitignore).\n'));
        } else {
          for (const fix of fixes) {
            console.log(chalk.cyan(`\n${fix.filePath}`));
            displayDiff(fix.originalContent, fix.newContent);
          }

          const shouldApply = options.yes || await confirm({
            message: 'Apply these fixes?',
            default: true,
          });

          if (shouldApply) {
            spinner = ora('Applying fixes...').start();
            await applyFixes(fixes);
            spinner.succeed('Fixes applied');
          }
        }
      }
    }

    // Step 3: Deploy
    const shouldDeploy = options.yes || await confirm({
      message: 'Deploy to production?',
      default: true,
    });

    if (shouldDeploy) {
      let platform = options.platform || config.deployment?.platform;

      if (!platform) {
        platform = await select({
          message: 'Select deployment platform:',
          choices: [
            { name: 'Railway', value: 'railway' },
            { name: 'Vercel', value: 'vercel' },
          ],
        });
      }

      const tokenKey = platform === 'vercel' ? 'vercelToken' : 'railwayToken';
      const token = config.deployment?.[tokenKey as keyof typeof config.deployment];

      if (!token) {
        console.log(chalk.yellow(`\nNo ${platform} token configured. Skipping deployment.`));
        console.log(chalk.dim(`Add ${tokenKey} to .lastmilerc or run ${chalk.cyan('lastmile init')}\n`));
        return;
      }

      spinner = ora(`Deploying to ${platform}...`).start();

      const deployment = await api.deploy({
        platform,
        token: token as string,
        files: Object.fromEntries(
          await collectFiles(projectRoot, { ignorePaths: config.analysis?.ignorePaths ?? [] })
        ),
      });

      let status = deployment.status;
      while (status === 'pending' || status === 'building') {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const updated = await api.getDeployment(deployment.id);
        status = updated.status;
        spinner.text = `Deploying... (${status})`;
      }

      if (status === 'success') {
        spinner.succeed(chalk.green('Deployed!'));
        console.log(chalk.bold(`\n🎉 Ship complete! Your app is live at:\n`));
        console.log(chalk.cyan(`   ${deployment.url}\n`));
      } else {
        spinner.fail('Deployment failed');
        console.log(chalk.red(`\nError: ${deployment.error}\n`));
      }
    }
  });
