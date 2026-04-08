import { Command } from 'commander';
import { resolve, dirname } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from '../lib/config.js';
import { createApiClient, type GeneratedFix } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';
import {
  printHeader,
  printScore,
  printClassification,
  formatGaps,
  printSummary,
  printStats,
  AnalysisProgress,
} from '../lib/output.js';
import { displayDiff } from '../lib/diff.js';
import { buildLocalFixes, type LocalFix } from '../lib/fix-engine.js';
import type { FixRisk } from '../lib/types.js';

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extended local fix with risk info
 */
interface LocalFixWithRisk extends LocalFix {
  risk: FixRisk;
  canAutoApply: boolean;
}

/**
 * Convert backend fix to local fix format
 */
function convertToLocalFixes(
  projectRoot: string,
  backendFixes: GeneratedFix[],
  gaps: Array<{ id: string; title: string }>
): LocalFixWithRisk[] {
  const fixes: LocalFixWithRisk[] = [];
  const gapMap = new Map(gaps.map((g) => [g.id, g]));

  for (const fix of backendFixes) {
    const gap = gapMap.get(fix.gapId);

    for (const change of fix.changes) {
      const absolutePath = resolve(projectRoot, change.filePath);
      fixes.push({
        id: `backend-${fix.gapId}-${change.filePath}`,
        gapId: fix.gapId,
        gapTitle: gap?.title || 'Unknown gap',
        filePath: absolutePath,
        originalContent: change.originalContent,
        newContent: change.newContent,
        description: change.description,
        risk: fix.risk || 'review',
        canAutoApply: fix.canAutoApply ?? false,
      });
    }
  }

  return fixes;
}

/**
 * Apply fixes by writing files to disk
 */
async function applyFixes(fixes: LocalFix[]): Promise<void> {
  for (const fix of fixes) {
    const dir = dirname(fix.filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(fix.filePath, fix.newContent, 'utf-8');
  }
}

export const analyzeCommand = new Command('analyze')
  .description('Analyze your project for production gaps')
  .option('-d, --dir <path>', 'Directory to analyze', '.')
  .option('--json', 'Output as JSON')
  .option('--no-banner', 'Skip the banner')
  .option('-v, --verbose', 'Show detailed analysis steps and all info items')
  .option('--fix', 'Automatically fix all issues without prompting')
  .option('--no-fix', 'Skip fix prompt after analysis')
  .action(async (options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    const projectRoot = resolve(process.cwd(), options.dir);

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

      // Start progress display with file count (returns start time)
      progress.start(files.size);

      // Start stepping through the analysis phases
      await progress.nextPhase(); // Scanning project structure

      // Call API (this runs while we show progress)
      const analysisPromise = api.analyze({
        files: Object.fromEntries(files),
      });

      // Continue showing progress phases while API works
      await progress.nextPhase(); // Analyzing security & auth
      await progress.nextPhase(); // Checking code quality

      // Wait for API response
      const analysis = await analysisPromise;

      // Quickly finish remaining phases
      await progress.finishRemaining();

      // Small pause for visual satisfaction
      await sleep(150);

      // Stop and get duration
      const durationMs = progress.stop();

      // Print success message
      console.log(chalk.green('✓ Analysis complete!\n'));

      // Print score with progress bar
      printScore(analysis.readinessScore);

      // Print classification if available
      if (analysis.classification) {
        printClassification(analysis.classification);
      }

      // Calculate stats
      const fixableCount = analysis.gaps.filter((g: any) => g.autoFixable).length;

      // Print stats summary line
      printStats({
        fileCount: files.size,
        durationMs,
        gapCount: analysis.gaps.length,
        fixableCount,
      });

      // Print quick summary of findings by category
      if (analysis.gaps.length > 0) {
        printSummary(analysis.gaps);
        console.log(formatGaps(analysis.gaps, { verbose: options.verbose }));
      }

      // Check for fixable gaps
      const autoFixableGaps = analysis.gaps.filter((g: any) => g.autoFixable);

      // Skip fix flow if no fixable gaps, JSON mode, or --no-fix
      if (autoFixableGaps.length === 0 || options.json || options.fix === false) {
        if (analysis.gaps.length > 0 && autoFixableGaps.length > 0) {
          console.log(chalk.dim(`\nRun ${chalk.cyan('lastmile analyze --fix')} to auto-fix issues.\n`));
        }
        return;
      }

      // Ask user if they want to fix (unless --fix flag is set)
      let shouldFix = options.fix === true;
      if (!shouldFix) {
        console.log(); // spacing
        shouldFix = await confirm({
          message: `Fix ${autoFixableGaps.length} issue(s) now?`,
          default: true,
        });
      }

      if (!shouldFix) {
        console.log(chalk.dim(`\nRun ${chalk.cyan('lastmile analyze --fix')} anytime to fix.\n`));
        return;
      }

      // Generate and apply fixes
      const fixSpinner = ora('Generating fixes...').start();

      try {
        let backendFixes: GeneratedFix[] = [];
        let localFixes: LocalFix[] = [];
        const installCommands: string[] = [];
        const notes: string[] = [];

        // Try backend fix generation (stateless - no DB required)
        // Process gaps in batches of 3 to avoid socket timeouts
        const BATCH_SIZE = 3;
        const gapBatches: any[][] = [];
        for (let i = 0; i < autoFixableGaps.length; i += BATCH_SIZE) {
          gapBatches.push(autoFixableGaps.slice(i, i + BATCH_SIZE));
        }

        try {
          for (let i = 0; i < gapBatches.length; i++) {
            const batch = gapBatches[i];
            if (process.env.DEBUG) {
              console.log(`Processing batch ${i + 1}/${gapBatches.length} (${batch.length} gaps)`);
            }

            const result = await api.generateStatelessFixes({
              gaps: batch.map((g: any) => ({
                id: g.id,
                category: g.category,
                severity: g.severity,
                title: g.title,
                description: g.description || '',
                filePath: g.filePath,
                lineNumber: g.lineNumber || g.line,
                autoFixable: g.autoFixable ?? true,
                suggestedFix: g.suggestedFix,
              })),
              stack: {
                language: analysis.stack.language,
                framework: analysis.stack.framework || null,
                database: analysis.stack.database || null,
                orm: analysis.stack.orm || null,
              },
              files: Object.fromEntries(files),
            });

            backendFixes.push(...result.fixes);

            for (const fix of result.fixes) {
              installCommands.push(...fix.installCommands);
              if (fix.notes) {
                notes.push(...fix.notes);
              }
            }
          }

          // Use local fixes for gaps not covered by backend
          const coveredGapIds = new Set(backendFixes.map((f) => f.gapId));
          const uncoveredGaps = autoFixableGaps.filter((g: any) => !coveredGapIds.has(g.id));

          if (uncoveredGaps.length > 0) {
            const localAnalysis = { ...analysis, gaps: uncoveredGaps };
            localFixes = buildLocalFixes(projectRoot, files, localAnalysis);
          }
        } catch (error) {
          // Backend failed, use local fixes only
          if (process.env.DEBUG) {
            console.error('Backend fix generation failed:', error);
          }
          localFixes = buildLocalFixes(projectRoot, files, analysis);
        }

        // Convert and combine all fixes
        const backendAsLocalFixes = convertToLocalFixes(projectRoot, backendFixes, autoFixableGaps);
        const localFixesWithRisk: LocalFixWithRisk[] = localFixes.map(fix => ({
          ...fix,
          risk: 'safe' as FixRisk,
          canAutoApply: true,
        }));

        const allFixes = [...backendAsLocalFixes, ...localFixesWithRisk];

        // Deduplicate by file path
        const seenPaths = new Set<string>();
        const dedupedFixes: LocalFixWithRisk[] = [];
        for (const fix of allFixes) {
          if (!seenPaths.has(fix.filePath)) {
            seenPaths.add(fix.filePath);
            dedupedFixes.push(fix);
          }
        }

        // Group by risk
        const safeFixes = dedupedFixes.filter(f => f.risk === 'safe');
        const reviewFixes = dedupedFixes.filter(f => f.risk === 'review');
        const carefulFixes = dedupedFixes.filter(f => f.risk === 'careful');

        fixSpinner.succeed(`Generated ${dedupedFixes.length} fix(es)`);

        if (dedupedFixes.length === 0) {
          console.log(chalk.yellow('\nNo fixes could be generated for these gaps yet.\n'));
          return;
        }

        // Track what we'll apply
        const fixesToApply: LocalFixWithRisk[] = [];

        // Safe fixes - auto-apply
        if (safeFixes.length > 0) {
          console.log(chalk.green(`\n✓ Applying ${safeFixes.length} safe fix(es)...`));
          for (const fix of safeFixes) {
            console.log(chalk.green(`  + ${fix.filePath.replace(projectRoot + '/', '')}`));
          }
          fixesToApply.push(...safeFixes);
        }

        // Review fixes - show diff and ask
        if (reviewFixes.length > 0) {
          console.log(chalk.yellow(`\n⚠ ${reviewFixes.length} fix(es) need review:\n`));
          for (const fix of reviewFixes) {
            console.log(chalk.yellow(`${fix.filePath.replace(projectRoot + '/', '')}`));
            console.log(chalk.dim(fix.description));
            displayDiff(fix.originalContent, fix.newContent);
            console.log();
          }

          const applyReview = await confirm({
            message: `Apply these ${reviewFixes.length} fix(es)?`,
            default: true,
          });
          if (applyReview) {
            fixesToApply.push(...reviewFixes);
          }
        }

        // Careful fixes - show warning and ask
        if (carefulFixes.length > 0) {
          console.log(chalk.red.bold('\n⚠️  Security-Sensitive Fixes'));
          console.log(chalk.red('These affect auth, security, or data access. Review carefully.\n'));

          for (const fix of carefulFixes) {
            console.log(chalk.red(`${fix.filePath.replace(projectRoot + '/', '')}`));
            console.log(chalk.dim(fix.description));
            displayDiff(fix.originalContent, fix.newContent);
            console.log();
          }

          const applyCareful = await confirm({
            message: `Apply these ${carefulFixes.length} security-sensitive fix(es)?`,
            default: false,
          });
          if (applyCareful) {
            fixesToApply.push(...carefulFixes);
          }
        }

        // Apply the fixes
        if (fixesToApply.length > 0) {
          await applyFixes(fixesToApply);
          console.log(chalk.green(`\n✓ Applied ${fixesToApply.length} fix(es)!`));

          // Show install commands
          const uniqueInstallCommands = [...new Set(installCommands)];
          if (uniqueInstallCommands.length > 0) {
            console.log(chalk.yellow('\nRun these commands to install dependencies:'));
            for (const cmd of uniqueInstallCommands) {
              console.log(chalk.cyan(`  ${cmd}`));
            }
          }

          // Show notes
          if (notes.length > 0) {
            console.log(chalk.blue('\nNotes:'));
            for (const note of notes) {
              console.log(chalk.dim(`  - ${note}`));
            }
          }

          const skipped = dedupedFixes.length - fixesToApply.length;
          if (skipped > 0) {
            console.log(chalk.dim(`\n(${skipped} fix(es) were skipped)`));
          }

          console.log(chalk.dim(`\nRun ${chalk.cyan('lastmile analyze')} again to verify.\n`));
        } else {
          console.log(chalk.dim('\nNo fixes were applied.\n'));
        }

      } catch (fixError) {
        fixSpinner.fail('Fix generation failed');
        console.error(chalk.red(fixError instanceof Error ? fixError.message : 'Unknown error'));
      }

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
