import { Command } from 'commander';
import { resolve, dirname } from 'path';
import { writeFile, mkdir, unlink, access } from 'fs/promises';
import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import logUpdate from 'log-update';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from '../lib/config.js';
import { createApiClient, type GeneratedFix } from '../lib/api-client.js';
import { loadProjectConfig } from './init.js';
import { collectFiles } from '../lib/file-collector.js';
import {
  printHeader as printLegacyHeader,
  printScore as printLegacyScore,
  printProjectAnalysis,
  formatGaps,
  printSummary,
  printStats as printLegacyStats,
} from '../lib/output.js';
import * as premium from '../lib/premium-output.js';
import { displayDiff } from '../lib/diff.js';
import { buildLocalFixes, type LocalFix } from '../lib/fix-engine.js';
import type { FixRisk } from '../lib/types.js';

/**
 * Get the install command for a package manager
 */
function getInstallCommand(packageManager: string | null | undefined): { cmd: string; devFlag: string } {
  switch (packageManager?.toLowerCase()) {
    case 'pnpm':
      return { cmd: 'pnpm', devFlag: '-D' };
    case 'yarn':
      return { cmd: 'yarn', devFlag: '--dev' };
    case 'bun':
      return { cmd: 'bun', devFlag: '-d' };
    case 'pip':
    case 'poetry':
      return { cmd: packageManager, devFlag: '--dev' };
    case 'npm':
    default:
      return { cmd: 'npm', devFlag: '--save-dev' };
  }
}

/**
 * Run a shell command and return a promise
 */
function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: 'inherit', shell: true });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Extended local fix with risk info
 */
interface LocalFixWithRisk extends LocalFix {
  risk: FixRisk;
  canAutoApply: boolean;
  operation?: 'create' | 'modify' | 'append' | 'delete';
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
        operation: change.operation,
        risk: fix.risk || 'review',
        canAutoApply: fix.canAutoApply ?? false,
      });
    }
  }

  return fixes;
}

/**
 * Apply fixes by writing or deleting files on disk
 */
async function applyFixes(fixes: LocalFix[], projectRoot: string): Promise<{ deleted: string[] }> {
  const deleted: string[] = [];

  for (const fix of fixes) {
    if (fix.operation === 'delete') {
      // Delete the file
      try {
        await access(fix.filePath);
        await unlink(fix.filePath);
        deleted.push(fix.filePath.replace(projectRoot + '/', ''));
      } catch {
        // File doesn't exist, that's fine
      }
    } else {
      // Create or modify
      const dir = dirname(fix.filePath);
      await mkdir(dir, { recursive: true });
      await writeFile(fix.filePath, fix.newContent, 'utf-8');
    }
  }

  return { deleted };
}

interface AnalyzerStatus {
  name: string;
  status: 'pending' | 'running' | 'done';
  gapCount: number;
  batchIndex: number;
  totalBatches: number;
  filesProcessed: number;
  totalFiles: number;
}


export const analyzeCommand = new Command('analyze')
  .description('Analyze your project for production gaps')
  .argument('[path]', 'Directory to analyze', '.')
  .option('-d, --dir <path>', 'Directory to analyze (alternative to positional argument)')
  .option('--json', 'Output as JSON')
  .option('--no-banner', 'Skip the banner')
  .option('-v, --verbose', 'Show detailed analysis steps and all info items')
  .option('--fix', 'Automatically fix all issues without prompting')
  .option('--no-fix', 'Skip fix prompt after analysis')
  .option('--yes', 'Auto-apply safe fixes without confirmation (use with --fix)')
  .option('--no-orchestration', 'Use legacy single-pass fix generation instead of multi-agent orchestration')
  .action(async (pathArg, options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    // Support both positional argument and -d option (positional takes precedence)
    const targetDir = pathArg !== '.' ? pathArg : (options.dir || '.');
    const projectRoot = resolve(process.cwd(), targetDir);

    // Load project config (optional - analysis works without it)
    const projectConfig = await loadProjectConfig();
    const projectId = projectConfig?.projectId;

    // For JSON mode, skip all fancy output
    if (options.json) {
      // Use stderr for spinner to keep stdout clean for JSON
      const spinner = ora({ text: 'Analyzing...', stream: process.stderr }).start();
      try {
        const files = await collectFiles(targetDir);
        const analysis = await api.analyze({
          files: Object.fromEntries(files),
          projectId,
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
    const startTime = Date.now();

    try {
      // Print header first if enabled
      if (options.banner !== false) {
        premium.printHeader();
      }

      // Step 1: Collect files
      const files = await collectFiles(targetDir);

      // Print file count
      premium.printFileCount(files.size);

      // Use streaming API for real-time progress
      let analysis: any = null;
      let currentSpinner: ReturnType<typeof ora> | null = null;
      let usingLogUpdate = false;
      const analyzerStatus = new Map<string, AnalyzerStatus>();

      // Spinner frames for log-update
      const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let spinnerIndex = 0;
      let spinnerInterval: ReturnType<typeof setInterval> | null = null;

      const updateLogUpdate = () => {
        const frame = chalk.magenta(spinnerFrames[spinnerIndex]);
        spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;

        const statuses = Array.from(analyzerStatus.values());
        const done = statuses.filter(s => s.status === 'done').length;
        const total = statuses.length;

        const header = `${frame} Analyzing ${chalk.dim(`[${done}/${total} complete]`)}`;
        const progressLines = premium.buildAnalyzerDisplay(analyzerStatus);

        logUpdate(`${header}\n${progressLines}`);
      };

      const stream = api.analyzeStream({
        files: Object.fromEntries(files),
        projectId,
      });

      for await (const event of stream) {
        if (event.type === 'start') {
          // Already printed file count
        } else if (event.type === 'phase') {
          if (event.phase === 'project-analysis') {
            // Use ora spinner for project analysis phase
            if (!currentSpinner) {
              currentSpinner = ora({
                text: `${event.message} ${chalk.dim(`[${event.phaseIndex}/${event.totalPhases}]`)}`,
                color: 'magenta',
                spinner: 'dots',
              }).start();
            }
          } else if (event.phase === 'analyzers') {
            // Switch to log-update for analyzers phase
            if (currentSpinner) {
              currentSpinner.stopAndPersist({
                symbol: chalk.green('✓'),
                text: chalk.dim('Stack detected'),
              });
              currentSpinner = null;
            }

            // Initialize analyzer status
            if (event.data) {
              const data = event.data as { analyzers: Array<{ id: string; name: string }> };
              for (const analyzer of data.analyzers) {
                analyzerStatus.set(analyzer.id, {
                  name: analyzer.name,
                  status: 'pending',
                  gapCount: 0,
                  batchIndex: 0,
                  totalBatches: 0,
                  filesProcessed: 0,
                  totalFiles: 0,
                });
              }
            }

            // Start log-update with spinner
            usingLogUpdate = true;
            spinnerInterval = setInterval(updateLogUpdate, 80);
            updateLogUpdate();
          }
        } else if (event.type === 'project-analysis') {
          // Update spinner with detected info
          if (currentSpinner && event.message) {
            currentSpinner.text = `${event.message} ${chalk.dim(`[${event.phaseIndex}/${event.totalPhases}]`)}`;
          }
        } else if (event.type === 'analyzer-start') {
          // Mark analyzer as running
          if (event.data) {
            const data = event.data as { analyzerId: string; analyzerName: string };
            const status = analyzerStatus.get(data.analyzerId);
            if (status) status.status = 'running';
          }
        } else if (event.type === 'analyzer-progress') {
          // Update batch progress for an analyzer
          if (event.data) {
            const data = event.data as {
              analyzerId: string;
              analyzerName: string;
              batchIndex: number;
              totalBatches: number;
              filesProcessed: number;
              totalFiles: number;
              gapsFoundInBatch: number;
            };
            const status = analyzerStatus.get(data.analyzerId);
            if (status) {
              status.batchIndex = data.batchIndex;
              status.totalBatches = data.totalBatches;
              status.filesProcessed = data.filesProcessed;
              status.totalFiles = data.totalFiles;
            }
          }
        } else if (event.type === 'analyzer-complete') {
          // Mark analyzer as done
          if (event.data) {
            const data = event.data as { analyzerId: string; analyzerName: string; gapCount: number };
            const status = analyzerStatus.get(data.analyzerId);
            if (status) {
              status.status = 'done';
              status.gapCount = data.gapCount;
            }
          }
        } else if (event.type === 'gap') {
          // Collect gaps as they arrive
          if (!analysis) analysis = { gaps: [] };
          analysis.gaps.push(event.data);
        } else if (event.type === 'complete') {
          // Stop log-update spinner
          if (spinnerInterval) {
            clearInterval(spinnerInterval);
            spinnerInterval = null;
          }

          // Show final analyzer state with all done
          if (usingLogUpdate) {
            const progressLines = premium.buildAnalyzerDisplay(analyzerStatus);
            logUpdate(`${chalk.green('✓')} Analysis complete\n${progressLines}`);
            logUpdate.done();
            usingLogUpdate = false;
          }

          // Complete ora spinner if still active
          if (currentSpinner) {
            currentSpinner.stopAndPersist({
              symbol: chalk.green('✓'),
              text: chalk.dim('Analysis complete'),
            });
            currentSpinner = null;
          }

          // Build analysis result from complete event, preserving collected gaps
          const data = event.data as any;
          const collectedGaps = analysis?.gaps || [];
          analysis = {
            readinessScore: data.readinessScore,
            gaps: collectedGaps,
            stack: data.stack,
            stackConfidence: data.stackConfidence,
            projectAnalysis: data.projectAnalysis,
          };
        } else if (event.type === 'error') {
          // Cleanup on error
          if (spinnerInterval) {
            clearInterval(spinnerInterval);
            spinnerInterval = null;
          }
          if (usingLogUpdate) {
            logUpdate.clear();
          }
          if (currentSpinner) {
            currentSpinner.fail(event.message || 'Analysis failed');
            currentSpinner = null;
          }
          throw new Error(event.message || 'Analysis failed');
        }
      }

      // Ensure analysis exists
      if (!analysis) {
        throw new Error('Analysis failed: no response received');
      }

      const durationMs = Date.now() - startTime;

      // Print separator and completion
      premium.printSeparator();
      premium.printComplete();

      // Print stack detection if available
      if (analysis.projectAnalysis) {
        premium.printStackDetection(analysis.projectAnalysis);
      }

      // Print score with progress bar
      premium.printScore(analysis.readinessScore);

      // Calculate stats
      const fixableCount = analysis.gaps.filter((g: any) => g.autoFixable).length;

      // Print stats summary line
      premium.printStats(files.size, durationMs, analysis.gaps.length, fixableCount);

      // Print issues summary with tree structure
      if (analysis.gaps.length > 0) {
        premium.printIssuesSummary(analysis.gaps);
      }

      // Print next steps
      if (fixableCount > 0) {
        premium.printNextSteps(fixableCount, analysis.gaps.length);
      }

      // Check for fixable gaps
      const autoFixableGaps = analysis.gaps.filter((g: any) => g.autoFixable);

      // Skip fix flow if no fixable gaps, JSON mode, or --no-fix
      if (autoFixableGaps.length === 0 || options.json || options.fix === false) {
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

      // Generate and apply fixes with streaming progress
      console.log();

      try {
        const installCommands: string[] = [];
        const notes: string[] = [];

        // Use streaming fix generation for real-time progress
        const useOrchestration = options.orchestration !== false;

        // Track applied files to avoid duplicates
        const appliedPaths = new Set<string>();
        let safeAppliedCount = 0;
        let reviewFixes: LocalFixWithRisk[] = [];
        let carefulFixes: LocalFixWithRisk[] = [];

        try {
          if (useOrchestration) {
            // Stream fix generation with progress - apply safe fixes immediately
            let fixProgress = { current: 0, total: autoFixableGaps.length };

            const stream = api.generateFixesStream({
              gaps: autoFixableGaps.map((g: any) => ({
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

            for await (const event of stream) {
              if (event.type === 'start') {
                fixProgress.total = event.total || autoFixableGaps.length;
                logUpdate(`  Generating fixes ${chalk.dim(`[0/${fixProgress.total}]`)}`);
              } else if (event.type === 'progress') {
                fixProgress.current = event.current || 0;
                const eventFix = (event as any).fix as GeneratedFix | undefined;
                const eventFiles = (event as any).files as string[] | undefined;
                const gapTitle = event.gapTitle || 'Unknown';

                if (event.success && eventFix) {
                  // Convert and categorize the fix
                  const localFixes = convertToLocalFixes(projectRoot, [eventFix], autoFixableGaps);

                  for (const fix of localFixes) {
                    if (appliedPaths.has(fix.filePath)) continue;

                    if (fix.risk === 'safe') {
                      // Apply safe fixes immediately
                      try {
                        const dir = dirname(fix.filePath);
                        await mkdir(dir, { recursive: true });
                        await writeFile(fix.filePath, fix.newContent, 'utf-8');
                        appliedPaths.add(fix.filePath);
                        safeAppliedCount++;

                        // Show applied file
                        const relativePath = fix.filePath.replace(projectRoot + '/', '');
                        logUpdate(`  ${chalk.green('✓')} ${chalk.dim(`[${fixProgress.current}/${fixProgress.total}]`)} ${gapTitle}\n      ${chalk.dim('->')} ${chalk.green(relativePath)} ${chalk.dim('(applied)')}`);
                      } catch (err) {
                        logUpdate(`  ${chalk.red('✗')} ${chalk.dim(`[${fixProgress.current}/${fixProgress.total}]`)} ${gapTitle}\n      ${chalk.dim('->')} ${chalk.red('write failed')}`);
                      }
                    } else if (fix.risk === 'review') {
                      reviewFixes.push(fix);
                      logUpdate(`  ${chalk.yellow('○')} ${chalk.dim(`[${fixProgress.current}/${fixProgress.total}]`)} ${gapTitle}\n      ${chalk.dim('->')} ${chalk.yellow(eventFiles?.[0] || 'unknown')} ${chalk.dim('(needs review)')}`);
                    } else {
                      carefulFixes.push(fix);
                      logUpdate(`  ${chalk.red('!')} ${chalk.dim(`[${fixProgress.current}/${fixProgress.total}]`)} ${gapTitle}\n      ${chalk.dim('->')} ${chalk.red(eventFiles?.[0] || 'unknown')} ${chalk.dim('(security-sensitive)')}`);
                    }
                  }

                  // Collect install commands and notes
                  installCommands.push(...eventFix.installCommands);
                  if (eventFix.notes) {
                    notes.push(...eventFix.notes);
                  }
                } else {
                  // Failed or skipped
                  const status = chalk.red('✗');
                  let line = `  ${status} ${chalk.dim(`[${fixProgress.current}/${fixProgress.total}]`)} ${gapTitle}`;
                  if (event.error) {
                    line += `\n      ${chalk.dim('->')} ${chalk.red(event.error)}`;
                  }
                  logUpdate(line);
                }
              } else if (event.type === 'complete') {
                logUpdate.done();
                const totalGenerated = (event.fixes?.length || 0);
                console.log(chalk.green(`\n  ✓ Applied ${safeAppliedCount} safe fix(es)`));
                if (reviewFixes.length > 0 || carefulFixes.length > 0) {
                  console.log(chalk.dim(`    ${reviewFixes.length + carefulFixes.length} fix(es) need review`));
                }
              } else if (event.type === 'error') {
                logUpdate.done();
                throw new Error(event.message || 'Fix generation failed');
              }
            }
          } else {
            // Legacy: process gaps in batches
            const BATCH_SIZE = 3;
            const gapBatches: any[][] = [];
            for (let i = 0; i < autoFixableGaps.length; i += BATCH_SIZE) {
              gapBatches.push(autoFixableGaps.slice(i, i + BATCH_SIZE));
            }

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
          }

        } catch (error) {
          // Backend failed, fall back to local fixes only
          if (process.env.DEBUG) {
            console.error('Backend fix generation failed:', error);
          }
          const localOnlyFixes = buildLocalFixes(projectRoot, files, analysis);
          for (const fix of localOnlyFixes) {
            if (appliedPaths.has(fix.filePath)) continue;
            try {
              const dir = dirname(fix.filePath);
              await mkdir(dir, { recursive: true });
              await writeFile(fix.filePath, fix.newContent, 'utf-8');
              appliedPaths.add(fix.filePath);
              safeAppliedCount++;
            } catch {
              // Ignore write errors in fallback
            }
          }
        }

        // Handle review/careful fixes that were collected during streaming
        const fixesToApply: LocalFixWithRisk[] = [];

        if (safeAppliedCount === 0 && reviewFixes.length === 0 && carefulFixes.length === 0) {
          console.log(chalk.yellow('\nNo fixes could be generated for these gaps yet.\n'));
          return;
        }

        // Review fixes - show diff and ask (skip if --yes)
        if (reviewFixes.length > 0) {
          console.log(chalk.yellow(`\n⚠ ${reviewFixes.length} fix(es) need review:\n`));
          for (const fix of reviewFixes) {
            console.log(chalk.yellow(`${fix.filePath.replace(projectRoot + '/', '')}`));
            console.log(chalk.dim(fix.description));
            displayDiff(fix.originalContent, fix.newContent);
            console.log();
          }

          if (options.yes) {
            // Skip review fixes in --yes mode (only safe fixes are auto-applied)
            console.log(chalk.dim(`(Skipping ${reviewFixes.length} review fix(es) in --yes mode)`));
          } else {
            const applyReview = await confirm({
              message: `Apply these ${reviewFixes.length} fix(es)?`,
              default: true,
            });
            if (applyReview) {
              fixesToApply.push(...reviewFixes);
            }
          }
        }

        // Careful fixes - show warning and ask (skip if --yes)
        if (carefulFixes.length > 0) {
          console.log(chalk.red.bold('\n⚠️  Security-Sensitive Fixes'));
          console.log(chalk.red('These affect auth, security, or data access. Review carefully.\n'));

          for (const fix of carefulFixes) {
            console.log(chalk.red(`${fix.filePath.replace(projectRoot + '/', '')}`));
            console.log(chalk.dim(fix.description));
            displayDiff(fix.originalContent, fix.newContent);
            console.log();
          }

          if (options.yes) {
            // Skip careful fixes in --yes mode (security-sensitive)
            console.log(chalk.dim(`(Skipping ${carefulFixes.length} security-sensitive fix(es) in --yes mode)`));
          } else {
            const applyCareful = await confirm({
              message: `Apply these ${carefulFixes.length} security-sensitive fix(es)?`,
              default: false,
            });
            if (applyCareful) {
              fixesToApply.push(...carefulFixes);
            }
          }
        }

        // Apply review/careful fixes that user approved
        if (fixesToApply.length > 0) {
          const { deleted } = await applyFixes(fixesToApply, projectRoot);
          const writtenCount = fixesToApply.length - deleted.length;
          if (deleted.length > 0) {
            console.log(chalk.green(`\n✓ Applied ${writtenCount} additional fix(es), deleted ${deleted.length} file(s)!`));
          } else {
            console.log(chalk.green(`\n✓ Applied ${fixesToApply.length} additional fix(es)!`));
          }
        }

        // Auto-install dependencies
        const uniqueDeps = [...new Set(installCommands)];
        if (uniqueDeps.length > 0) {
          const { cmd, devFlag } = getInstallCommand(analysis.stack.packageManager);
          const installArgs = cmd === 'npm'
            ? ['install', devFlag, ...uniqueDeps]
            : cmd === 'yarn'
            ? ['add', devFlag, ...uniqueDeps]
            : cmd === 'pnpm'
            ? ['add', devFlag, ...uniqueDeps]
            : cmd === 'bun'
            ? ['add', devFlag, ...uniqueDeps]
            : ['install', ...uniqueDeps]; // pip/poetry fallback

          const fullCommand = `${cmd} ${installArgs.join(' ')}`;
          console.log(chalk.cyan(`\nInstalling dependencies: ${fullCommand}`));

          try {
            await runCommand(cmd, installArgs, projectRoot);
            console.log(chalk.green('✓ Dependencies installed successfully!'));
          } catch (installError) {
            console.log(chalk.yellow(`\nFailed to auto-install. Run manually:`));
            console.log(chalk.cyan(`  ${fullCommand}`));
          }
        }

        // Show notes
        if (notes.length > 0) {
          console.log(chalk.blue('\nNotes:'));
          for (const note of notes) {
            console.log(chalk.dim(`  - ${note}`));
          }
        }

        // Summary
        const totalApplied = safeAppliedCount + fixesToApply.length;
        const totalSkipped = reviewFixes.length + carefulFixes.length - fixesToApply.length;
        if (totalSkipped > 0) {
          console.log(chalk.dim(`\n(${totalSkipped} fix(es) were skipped)`));
        }

        if (totalApplied > 0) {
          console.log(chalk.dim(`\nRun ${chalk.cyan('lastmile analyze')} again to verify.\n`));
        } else {
          console.log(chalk.dim('\nNo fixes were applied.\n'));
        }

      } catch (fixError) {
        console.log(chalk.red('  ✗ Fix generation failed'));
        console.error(chalk.red(fixError instanceof Error ? fixError.message : 'Unknown error'));
      }

    } catch (error) {
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
