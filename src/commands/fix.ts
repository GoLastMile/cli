import { Command } from 'commander';
import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';
import { displayDiff, applyFixes } from '../lib/diff.js';
import { buildLocalFixes } from '../lib/fix-engine.js';

export const fixCommand = new Command('fix')
  .description('Generate fixes for detected gaps (re-analyzes the project, applies local patches where supported)')
  .option('-d, --dir <path>', 'Project directory', '.')
  .option('--apply', 'Apply fixes directly to files')
  .option('--yes', 'Skip confirmation prompts')
  .action(async (options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    const projectRoot = resolve(process.cwd(), options.dir);

    const spinner = ora('Analyzing project for fixable gaps...').start();

    try {
      const files = await collectFiles(projectRoot, {
        ignorePaths: config.analysis?.ignorePaths ?? [],
      });
      const analysis = await api.analyze({
        files: Object.fromEntries(files),
      });

      const fixes = buildLocalFixes(projectRoot, files, analysis);
      const autoFixable = analysis.gaps.filter((g) => g.autoFixable).length;
      const unsupported = autoFixable - fixes.length;

      spinner.succeed(
        fixes.length > 0
          ? `Generated ${fixes.length} local patch(es)`
          : 'Analysis complete'
      );

      if (fixes.length === 0) {
        if (autoFixable > 0 && unsupported > 0) {
          console.log(
            chalk.yellow(
              `\n${unsupported} auto-fixable gap(s) have no local patch yet (only .gitignore fixes are supported for now).\n`
            )
          );
        } else {
          console.log(chalk.dim('\nNo local fixes available for the current gaps.\n'));
        }
        return;
      }

      for (const fix of fixes) {
        console.log(chalk.cyan(`\n${fix.filePath}`));
        console.log(chalk.dim(fix.description));
        displayDiff(fix.originalContent, fix.newContent);
      }

      if (unsupported > 0) {
        console.log(
          chalk.dim(
            `\n(${unsupported} other auto-fixable gap(s) need a future release or API-backed fixes.)\n`
          )
        );
      }

      if (options.apply) {
        const shouldApply =
          options.yes ||
          (await confirm({
            message: `Apply ${fixes.length} fix(es)?`,
            default: false,
          }));

        if (shouldApply) {
          await applyFixes(fixes);
          console.log(chalk.green('\n✓ Fixes applied!'));
          console.log(chalk.dim(`\nRun ${chalk.cyan('lastmile analyze')} to verify, then ship when ready.\n`));
        } else {
          console.log(chalk.dim('\nFixes not applied.\n'));
        }
      } else {
        console.log(chalk.dim(`\nRun ${chalk.cyan('lastmile fix --apply')} to write these changes.\n`));
      }
    } catch (error) {
      spinner.fail('Fix generation failed');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });
