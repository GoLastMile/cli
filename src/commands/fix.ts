import { Command } from 'commander';
import { resolve, dirname } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';
import { displayDiff } from '../lib/diff.js';
import type { AnalyzeResponse, Gap } from '../lib/api-client.js';
import * as ui from '../lib/ui.js';

export const fixCommand = new Command('fix')
  .description('Fix detected gaps using AI agents')
  .argument('[path]', 'Project directory', '.')
  .option('-d, --dir <path>', 'Project directory (alternative to positional argument)')
  .option('--yes', 'Auto-approve and apply all fixes')
  .option('--gap <id>', 'Fix a specific gap by ID')
  .action(async (pathArg, options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    const targetDir = pathArg !== '.' ? pathArg : (options.dir || '.');
    const projectRoot = resolve(process.cwd(), targetDir);

    ui.intro('LastMile Fix');

    try {
      // Collect files
      const s = ui.spinner();
      s.start('Collecting files...');
      const files = await collectFiles(projectRoot, {
        ignorePaths: config.analysis?.ignorePaths ?? [],
      });
      s.message(`Analyzing ${files.size} files via streaming...`);

      // Use streaming endpoint to avoid timeout
      const gaps: Gap[] = [];
      let analysis: AnalyzeResponse | undefined;

      for await (const event of api.analyzeStream({ files: Object.fromEntries(files) })) {
        switch (event.type) {
          case 'phase':
            s.message(event.message || event.phase || 'Analyzing...');
            break;
          case 'analyzer-start':
            s.message(`Running ${(event.data as { type?: string })?.type || 'analyzer'} agent...`);
            break;
          case 'analyzer-complete':
            // Collect gaps from each analyzer
            const analyzerData = event.data as { gaps?: Gap[] };
            if (analyzerData?.gaps) {
              gaps.push(...analyzerData.gaps);
            }
            break;
          case 'gap':
            // Individual gap events
            if (event.data) {
              gaps.push(event.data as Gap);
            }
            break;
          case 'complete':
            analysis = event.data as AnalyzeResponse;
            break;
          case 'error':
            throw new Error(event.message || 'Analysis failed');
        }
      }

      if (!analysis) {
        throw new Error('Analysis did not complete');
      }

      s.stop('Analysis complete');

      const autoFixableGaps = analysis.gaps.filter((g) => g.autoFixable);

      if (autoFixableGaps.length === 0) {
        s.stop('No fixable gaps found');
        ui.log.success('Your project is looking good!');
        ui.outro('Nothing to fix');
        return;
      }

      // Filter to specific gap if requested
      let gapsToFix = autoFixableGaps;
      if (options.gap) {
        gapsToFix = autoFixableGaps.filter(g =>
          g.id === options.gap || g.id.startsWith(options.gap)
        );
        if (gapsToFix.length === 0) {
          s.stop('Gap not found');
          ui.log.error(`No gap matching: ${options.gap}`);
          process.exit(1);
        }
      }

      s.stop(`Found ${gapsToFix.length} fixable gap(s)`);

      // Show gaps to fix
      ui.log.message('Gaps to fix:');
      for (const gap of gapsToFix) {
        const severity = gap.severity === 'critical' ? '🔴' :
                        gap.severity === 'warning' ? '🟡' : '🔵';
        console.log(`  ${severity} ${gap.title}`);
        if (gap.filePath) {
          console.log(`     ${gap.filePath}`);
        }
      }
      console.log();

      // Confirm
      if (!options.yes) {
        const proceed = await ui.confirm(
          `Start AI agent to fix ${gapsToFix.length} gap(s)?`,
          true
        );
        if (!proceed) {
          ui.cancel('Cancelled');
          return;
        }
      }

      // Fix each gap
      const taskList = new ui.TaskList('Fixing gaps...');
      for (const gap of gapsToFix) {
        taskList.addAgent(gap.id, gap.title);
      }
      taskList.start();

      const results: Array<{
        gap: typeof gapsToFix[0];
        success: boolean;
        filesWritten?: Record<string, string>;
        error?: string;
      }> = [];

      for (const gap of gapsToFix) {
        taskList.updateAgent(gap.id, { status: 'running' });

        try {
          const result = await api.agentFix({
            gap: {
              id: gap.id,
              category: gap.category,
              severity: gap.severity,
              title: gap.title,
              description: gap.description || '',
              filePath: gap.filePath,
              autoFixable: true,
              suggestedFix: gap.suggestedFix,
            },
            stack: {
              language: analysis.stack.language,
              framework: analysis.stack.framework || null,
              database: analysis.stack.database || null,
              orm: analysis.stack.orm || null,
            },
            files: Object.fromEntries(files),
          });

          if (result.success) {
            taskList.updateAgent(gap.id, {
              status: 'done',
              message: `${Object.keys(result.filesWritten || {}).length} files`,
            });
            results.push({ gap, success: true, filesWritten: result.filesWritten });
          } else {
            taskList.updateAgent(gap.id, {
              status: 'error',
              message: result.error || 'Failed',
            });
            results.push({ gap, success: false, error: result.error });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          taskList.updateAgent(gap.id, { status: 'error', message });
          results.push({ gap, success: false, error: message });
        }
      }

      taskList.stop();

      // Show results and apply fixes
      const successfulFixes = results.filter(r => r.success && r.filesWritten);

      if (successfulFixes.length === 0) {
        ui.log.warning('No fixes were generated');
        ui.outro('Try running with --verbose for more details');
        return;
      }

      // Collect all files to write
      const allFilesToWrite = new Map<string, string>();
      for (const { filesWritten } of successfulFixes) {
        if (filesWritten) {
          for (const [path, content] of Object.entries(filesWritten)) {
            allFilesToWrite.set(path, content);
          }
        }
      }

      console.log();
      ui.log.message(`Files to write (${allFilesToWrite.size}):`);

      for (const [filePath, content] of allFilesToWrite) {
        console.log(`  + ${filePath}`);

        // Show diff if file exists
        const fullPath = resolve(projectRoot, filePath);
        try {
          const original = await readFile(fullPath, 'utf-8');
          displayDiff(original, content);
        } catch {
          // New file
          const lines = content.split('\n').length;
          console.log(`    (new file, ${lines} lines)`);
        }
      }

      // Confirm and apply
      const shouldApply = options.yes || await ui.confirm('Apply these changes?', true);

      if (shouldApply) {
        const s = ui.spinner();
        s.start('Applying fixes...');

        for (const [filePath, content] of allFilesToWrite) {
          const fullPath = resolve(projectRoot, filePath);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, content, 'utf-8');
        }

        s.stop(`Applied ${allFilesToWrite.size} file(s)`);
        ui.log.success('Fixes applied successfully');
      } else {
        ui.log.info('Changes not applied');
      }

      // Summary
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        console.log();
        ui.log.warning(`${failed.length} fix(es) failed:`);
        for (const { gap, error } of failed) {
          console.log(`  - ${gap.title}: ${error}`);
        }
      }

      ui.outro(`Run 'lastmile analyze' to verify fixes`);

    } catch (error) {
      if (error instanceof Error) {
        ui.log.error(error.message);
      } else {
        ui.log.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });
