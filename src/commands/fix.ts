import { Command } from 'commander';
import { resolve, dirname } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import ora from 'ora';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from '../lib/config.js';
import { createApiClient, type GeneratedFix, type FileChange } from '../lib/api-client.js';
import type { FixRisk } from '../lib/types.js';
import { collectFiles } from '../lib/file-collector.js';
import { displayDiff, applyFixes } from '../lib/diff.js';
import { buildLocalFixes, type LocalFix } from '../lib/fix-engine.js';

/**
 * Extended local fix with risk info
 */
interface LocalFixWithRisk extends LocalFix {
  risk: FixRisk;
  canAutoApply: boolean;
}

/**
 * Convert backend fix to local fix format for unified handling
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
 * Apply fixes that create new files (need to create directories first)
 */
async function applyBackendFixes(fixes: LocalFix[]): Promise<void> {
  for (const fix of fixes) {
    // Ensure directory exists
    const dir = dirname(fix.filePath);
    await mkdir(dir, { recursive: true });

    // Write the file
    await writeFile(fix.filePath, fix.newContent, 'utf-8');
  }
}

export const fixCommand = new Command('fix')
  .description('Generate and apply fixes for detected gaps')
  .option('-d, --dir <path>', 'Project directory', '.')
  .option('--apply', 'Apply fixes directly to files')
  .option('--yes', 'Skip confirmation prompts')
  .option('--local-only', 'Only use local fix engine (skip backend)')
  .action(async (options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    const projectRoot = resolve(process.cwd(), options.dir);

    const spinner = ora('Analyzing project for fixable gaps...').start();

    try {
      // Collect project files
      const files = await collectFiles(projectRoot, {
        ignorePaths: config.analysis?.ignorePaths ?? [],
      });

      // Analyze project
      const analysis = await api.analyze({
        files: Object.fromEntries(files),
      });

      const autoFixableGaps = analysis.gaps.filter((g) => g.autoFixable);

      if (autoFixableGaps.length === 0) {
        spinner.succeed('Analysis complete');
        console.log(chalk.dim('\nNo auto-fixable gaps found. Your project is looking good!\n'));
        return;
      }

      spinner.text = `Found ${autoFixableGaps.length} fixable gap(s). Generating fixes...`;

      let backendFixes: GeneratedFix[] = [];
      let localFixes: LocalFix[] = [];
      const installCommands: string[] = [];
      const notes: string[] = [];

      // Try backend fix generation (stateless - no DB required)
      // Process gaps in batches of 3 to avoid socket timeouts
      const BATCH_SIZE = 3;
      if (!options.localOnly) {
        const gapBatches: typeof autoFixableGaps[] = [];
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
              gaps: batch.map((g) => ({
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

            // Collect install commands and notes
            for (const fix of result.fixes) {
              installCommands.push(...fix.installCommands);
              if (fix.notes) {
                notes.push(...fix.notes);
              }
            }
          }

          // Find gaps not covered by backend
          const coveredGapIds = new Set(backendFixes.map((f) => f.gapId));
          const uncoveredGaps = autoFixableGaps.filter((g) => !coveredGapIds.has(g.id));

          // Use local fixes for uncovered gaps (like .gitignore)
          if (uncoveredGaps.length > 0) {
            const localAnalysis = {
              ...analysis,
              gaps: uncoveredGaps,
            };
            localFixes = buildLocalFixes(projectRoot, files, localAnalysis);
          }
        } catch (error) {
          // Backend fix generation failed, fall back to local only
          console.log(
            chalk.dim('\n(Backend fix generation unavailable, using local fixes only)')
          );
          localFixes = buildLocalFixes(projectRoot, files, analysis);
        }
      } else {
        // Local-only mode
        localFixes = buildLocalFixes(projectRoot, files, analysis);
      }

      // Convert backend fixes to local fix format
      const backendAsLocalFixes = convertToLocalFixes(
        projectRoot,
        backendFixes,
        autoFixableGaps
      );

      // Convert local fixes to include risk (local fixes are always 'safe')
      const localFixesWithRisk: LocalFixWithRisk[] = localFixes.map(fix => ({
        ...fix,
        risk: 'safe' as FixRisk,
        canAutoApply: true,
      }));

      // Combine all fixes
      const allFixes = [...backendAsLocalFixes, ...localFixesWithRisk];

      // Deduplicate by file path (prefer backend fixes)
      const seenPaths = new Set<string>();
      const dedupedFixes: LocalFixWithRisk[] = [];
      for (const fix of allFixes) {
        if (!seenPaths.has(fix.filePath)) {
          seenPaths.add(fix.filePath);
          dedupedFixes.push(fix);
        }
      }

      // Group fixes by risk level
      const safeFixes = dedupedFixes.filter(f => f.risk === 'safe');
      const reviewFixes = dedupedFixes.filter(f => f.risk === 'review');
      const carefulFixes = dedupedFixes.filter(f => f.risk === 'careful');

      const totalFixed = dedupedFixes.length;
      const notFixable = autoFixableGaps.length - backendFixes.length - localFixes.length;

      spinner.succeed(
        totalFixed > 0
          ? `Generated ${totalFixed} fix(es): ${safeFixes.length} safe, ${reviewFixes.length} need review, ${carefulFixes.length} need careful review`
          : 'Analysis complete'
      );

      if (totalFixed === 0) {
        console.log(
          chalk.yellow(
            `\n${autoFixableGaps.length} gap(s) are marked as fixable but no fixes could be generated yet.\n`
          )
        );
        return;
      }

      // Display safe fixes (minimal output)
      if (safeFixes.length > 0) {
        console.log(chalk.bold.green('\n✓ Safe Fixes (auto-applicable)\n'));
        for (const fix of safeFixes) {
          console.log(chalk.green(`  + ${fix.filePath.replace(projectRoot + '/', '')}`));
          console.log(chalk.dim(`    ${fix.description}`));
        }
      }

      // Display review fixes (show diffs)
      if (reviewFixes.length > 0) {
        console.log(chalk.bold.yellow('\n⚠ Fixes Needing Review\n'));
        for (const fix of reviewFixes) {
          console.log(chalk.yellow(`${fix.filePath.replace(projectRoot + '/', '')}`));
          console.log(chalk.dim(fix.description));
          displayDiff(fix.originalContent, fix.newContent);
          console.log();
        }
      }

      // Display careful fixes (show diffs with warnings)
      if (carefulFixes.length > 0) {
        console.log(chalk.bold.red('\n⚠ Security-Sensitive Fixes (review carefully)\n'));
        for (const fix of carefulFixes) {
          console.log(chalk.red(`${fix.filePath.replace(projectRoot + '/', '')}`));
          console.log(chalk.dim(fix.description));
          displayDiff(fix.originalContent, fix.newContent);
          console.log();
        }
      }

      // Show install commands
      const uniqueInstallCommands = [...new Set(installCommands)];
      if (uniqueInstallCommands.length > 0) {
        console.log(chalk.bold.blue('\n--- Install Commands ---\n'));
        for (const cmd of uniqueInstallCommands) {
          console.log(chalk.cyan(`  ${cmd}`));
        }
        console.log();
      }

      // Show notes
      if (notes.length > 0) {
        console.log(chalk.bold.blue('\n--- Notes ---\n'));
        for (const note of notes) {
          console.log(chalk.dim(`  - ${note}`));
        }
        console.log();
      }

      if (notFixable > 0) {
        console.log(
          chalk.dim(
            `(${notFixable} other auto-fixable gap(s) need a future release.)\n`
          )
        );
      }

      // Apply fixes based on risk level
      if (options.apply) {
        const fixesToApply: LocalFixWithRisk[] = [];

        // Auto-apply safe fixes if --yes is set
        if (options.yes && safeFixes.length > 0) {
          fixesToApply.push(...safeFixes);
          console.log(chalk.green(`\n✓ Auto-applying ${safeFixes.length} safe fix(es)...`));
        } else if (safeFixes.length > 0) {
          const applySafe = await confirm({
            message: `Apply ${safeFixes.length} safe fix(es)?`,
            default: true,
          });
          if (applySafe) {
            fixesToApply.push(...safeFixes);
          }
        }

        // Ask about review fixes
        if (reviewFixes.length > 0) {
          const applyReview = await confirm({
            message: `Apply ${reviewFixes.length} fix(es) that need review?`,
            default: false,
          });
          if (applyReview) {
            fixesToApply.push(...reviewFixes);
          }
        }

        // Ask about careful fixes with warning
        if (carefulFixes.length > 0) {
          console.log(chalk.red.bold('\n⚠️  Security Warning'));
          console.log(chalk.red('The following fixes affect authentication, authorization, or data access.'));
          console.log(chalk.red('Please review them carefully before applying.\n'));

          const applyCareful = await confirm({
            message: `Apply ${carefulFixes.length} security-sensitive fix(es)?`,
            default: false,
          });
          if (applyCareful) {
            fixesToApply.push(...carefulFixes);
          }
        }

        if (fixesToApply.length > 0) {
          await applyBackendFixes(fixesToApply);
          console.log(chalk.green(`\n✓ Applied ${fixesToApply.length} fix(es)!`));

          // Remind about install commands
          if (uniqueInstallCommands.length > 0) {
            console.log(chalk.yellow('\nDon\'t forget to run the install commands:'));
            for (const cmd of uniqueInstallCommands) {
              console.log(chalk.cyan(`  ${cmd}`));
            }
          }

          const skipped = dedupedFixes.length - fixesToApply.length;
          if (skipped > 0) {
            console.log(chalk.dim(`\n(${skipped} fix(es) were skipped)`));
          }

          console.log(
            chalk.dim(
              `\nRun ${chalk.cyan('lastmile analyze')} to verify, then ship when ready.\n`
            )
          );
        } else {
          console.log(chalk.dim('\nNo fixes were applied.\n'));
        }
      } else {
        console.log(
          chalk.dim(
            `Run ${chalk.cyan('lastmile fix --apply')} to write these changes.\n`
          )
        );
      }
    } catch (error) {
      spinner.fail('Fix generation failed');
      console.error(
        chalk.red(error instanceof Error ? error.message : 'Unknown error')
      );
      process.exit(1);
    }
  });
