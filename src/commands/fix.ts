import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { displayDiff, applyFixes } from '../lib/diff.js';

export const fixCommand = new Command('fix')
  .description('Generate fixes for detected gaps')
  .option('--apply', 'Apply fixes directly to files')
  .option('--yes', 'Skip confirmation prompts')
  .action(async (options) => {
    const config = await loadConfig();
    const api = createApiClient(config);

    const spinner = ora('Generating fixes...').start();

    try {
      const fixes = await api.generateFixes({ analysisId: 'current' });

      spinner.succeed(`Generated ${fixes.length} fixes`);

      if (fixes.length === 0) {
        console.log(chalk.dim('\nNo fixes needed.\n'));
        return;
      }

      for (const fix of fixes) {
        console.log(chalk.cyan(`\n${fix.filePath}`));
        displayDiff(fix.originalContent, fix.newContent);
      }

      if (options.apply) {
        const shouldApply = options.yes || await confirm({
          message: `Apply ${fixes.length} fixes?`,
          default: false,
        });

        if (shouldApply) {
          await applyFixes(fixes);
          console.log(chalk.green('\n✓ Fixes applied!'));
          console.log(chalk.dim(`\nRun ${chalk.cyan('lastmile deploy')} to deploy your changes.\n`));
        } else {
          console.log(chalk.dim('\nFixes not applied.\n'));
        }
      } else {
        console.log(chalk.dim(`\nRun ${chalk.cyan('lastmile fix --apply')} to apply these changes.\n`));
      }
    } catch (error) {
      spinner.fail('Fix generation failed');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });
