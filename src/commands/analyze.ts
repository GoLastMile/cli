import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';
import {
  printHeader,
  printScore,
  formatGaps,
  printFooter,
  getAnalysisSteps,
} from '../lib/output.js';

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const analyzeCommand = new Command('analyze')
  .description('Analyze your project for production gaps')
  .option('-d, --dir <path>', 'Directory to analyze', '.')
  .option('--json', 'Output as JSON')
  .option('--no-banner', 'Skip the banner')
  .option('-v, --verbose', 'Show detailed analysis steps')
  .action(async (options) => {
    const config = await loadConfig();
    const api = createApiClient(config);

    // For JSON mode, skip all fancy output
    if (options.json) {
      const spinner = ora('Analyzing...').start();
      try {
        const files = await collectFiles(options.dir);
        const analysis = await api.analyze({
          files: Object.fromEntries(files),
        });
        spinner.stop();
        console.log(JSON.stringify(analysis, null, 2));
      } catch (error) {
        spinner.stop();
        console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
        process.exit(1);
      }
      return;
    }

    // Interactive mode with nice visuals
    const spinner = ora({
      text: chalk.cyan('Scanning project files...'),
      spinner: 'dots12',
      color: 'magenta',
    }).start();

    try {
      // Step 1: Collect files
      const files = await collectFiles(options.dir);

      if (options.verbose) {
        spinner.text = chalk.cyan(`Found ${files.size} files, analyzing...`);
      }

      // Animated analysis steps
      const steps = getAnalysisSteps();
      for (const step of steps) {
        spinner.text = chalk.cyan(step);
        await sleep(120);
      }

      // Call API
      const analysis = await api.analyze({
        files: Object.fromEntries(files),
      });

      // Stop spinner before printing results
      spinner.stop();

      // Clear line and print everything fresh
      console.clear();

      // Now print the nice output
      if (options.banner !== false) {
        printHeader();
      }

      console.log(chalk.green('✔ Analysis complete!\n'));

      // Print score with progress bar
      printScore(analysis.readinessScore);

      // Print gaps grouped by severity
      if (analysis.gaps.length > 0) {
        console.log(formatGaps(analysis.gaps));
      }

      // Print footer with next steps
      printFooter(analysis.gaps.length);

    } catch (error) {
      spinner.fail(chalk.red('Analysis failed'));
      console.log();

      if (error instanceof Error) {
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          console.log(chalk.red('  Could not connect to LastMile API'));
          console.log(chalk.dim('  Make sure the backend server is running:'));
          console.log(chalk.cyan('  cd backend && pnpm dev'));
        } else {
          console.log(chalk.red(`  ${error.message}`));
        }
      } else {
        console.log(chalk.red('  Unknown error occurred'));
      }

      console.log();
      process.exit(1);
    }
  });
