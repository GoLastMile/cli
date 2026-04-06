import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';
import {
  printHeader,
  printScore,
  printClassification,
  formatGaps,
  printFooter,
  printSummary,
  AnalysisProgress,
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
      // Use stderr for spinner to keep stdout clean for JSON
      const spinner = ora({ text: 'Analyzing...', stream: process.stderr }).start();
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
    const progress = new AnalysisProgress();

    try {
      // Print header first if enabled
      if (options.banner !== false) {
        printHeader();
      }

      // Step 1: Collect files
      const files = await collectFiles(options.dir);

      // Start progress display with file count
      progress.start(files.size);

      // Start stepping through the analysis phases
      // These are "fake" steps that give visual feedback while API processes
      await progress.nextStep(); // Scanning project structure

      // Call API (this runs while we show progress)
      const analysisPromise = api.analyze({
        files: Object.fromEntries(files),
      });

      // Continue showing progress steps while API works
      await progress.nextStep(); // Analyzing security
      await progress.nextStep(); // Checking auth
      await progress.nextStep(); // Reviewing errors
      await progress.nextStep(); // Inspecting deps

      // Wait for API response
      const analysis = await analysisPromise;

      // Quickly finish remaining steps
      await progress.finishRemaining();

      // Small pause for visual satisfaction
      await sleep(200);

      // Stop and clear progress display
      progress.stop();

      // Print success message
      console.log(chalk.green('✓ Analysis complete!\n'));

      // Print score with progress bar
      printScore(analysis.readinessScore);

      // Print classification if available
      if (analysis.classification) {
        printClassification(analysis.classification);
      }

      // Print quick summary of findings by category
      if (analysis.gaps.length > 0) {
        printSummary(analysis.gaps);
        console.log(formatGaps(analysis.gaps));
      }

      // Print footer with next steps
      printFooter(analysis.gaps.length);

    } catch (error) {
      progress.stop();
      console.log(chalk.red('✗ Analysis failed'));
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
