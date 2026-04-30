import { Command } from 'commander';
import { resolve, dirname } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';
import { displayDiff } from '../lib/diff.js';
import * as ui from '../lib/ui.js';

interface Gap {
  id: string;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description?: string;
  filePath?: string;
  autoFixable?: boolean;
  suggestedFix?: string;
}

interface AnalyzeResponse {
  stack: {
    language: string | null;
    framework: string | null;
    database: string | null;
    orm?: string | null;
  };
}

export const fixCommand = new Command('fix')
  .description('Fix detected gaps using AI agents')
  .argument('[path]', 'Project directory', '.')
  .option('-d, --dir <path>', 'Project directory (alternative to positional argument)')
  .option('--dry-run', 'Preview fixes without applying them')
  .option('--all', 'Fix all issues (critical + warnings, skip info)')
  .option('--critical', 'Fix critical issues only')
  .option('-n, --count <number>', 'Number of issues to fix', '5')
  .action(async (pathArg, options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    const targetDir = pathArg !== '.' ? pathArg : (options.dir || '.');
    const projectRoot = resolve(process.cwd(), targetDir);

    ui.header();

    try {
      // Collect and analyze
      const s = ui.spinner();
      s.start('Scanning project...');
      const files = await collectFiles(projectRoot, {
        ignorePaths: config.analysis?.ignorePaths ?? [],
      });

      const gaps: Gap[] = [];
      let analysis: AnalyzeResponse | undefined;

      s.message('Analyzing...');

      for await (const event of api.analyzeStream({ files: Object.fromEntries(files) })) {
        switch (event.type) {
          case 'project-analysis-progress':
          case 'analyzer-progress':
            if (event.message) s.message(event.message);
            break;
          case 'gap':
            if (event.data) gaps.push(event.data as Gap);
            break;
          case 'complete':
            analysis = event.data as AnalyzeResponse;
            break;
          case 'error':
            throw new Error(event.message || 'Analysis failed');
        }
      }

      if (!analysis) throw new Error('Analysis did not complete');
      s.stop('Analysis complete');

      // Filter to auto-fixable
      const fixable = gaps.filter(g => g.autoFixable);
      if (fixable.length === 0) {
        console.log();
        ui.success('No fixable issues found');
        console.log();
        return;
      }

      // Count by severity
      const critical = fixable.filter(g => g.severity === 'critical');
      const warnings = fixable.filter(g => g.severity === 'warning');
      const info = fixable.filter(g => g.severity === 'info');

      // Show summary
      console.log();
      ui.divider();
      console.log();
      console.log(`  Found ${fixable.length} fixable issues:`);
      console.log();
      if (critical.length > 0) console.log(`    \x1b[31m●\x1b[0m ${critical.length} critical`);
      if (warnings.length > 0) console.log(`    \x1b[33m●\x1b[0m ${warnings.length} warnings`);
      if (info.length > 0) console.log(`    \x1b[90m●\x1b[0m ${info.length} info`);
      console.log();

      // Determine what to fix based on flags
      let gapsToFix: Gap[];
      const maxCount = parseInt(options.count) || 5;

      if (options.all) {
        // All critical + warnings (skip info)
        gapsToFix = [...critical, ...warnings];
      } else if (options.critical) {
        // Critical only
        gapsToFix = critical;
      } else {
        // Default: top N by severity (critical first, then warnings)
        gapsToFix = [...critical, ...warnings].slice(0, maxCount);
      }

      if (gapsToFix.length === 0) {
        ui.info('No issues to fix with current filters');
        console.log();
        return;
      }

      // Show what we'll fix
      console.log(`  Fixing ${gapsToFix.length} issues:`);
      console.log();
      for (const gap of gapsToFix.slice(0, 10)) {
        const icon = gap.severity === 'critical' ? '\x1b[31m●\x1b[0m' :
                     gap.severity === 'warning' ? '\x1b[33m●\x1b[0m' : '\x1b[90m●\x1b[0m';
        const title = gap.title.length > 55 ? gap.title.slice(0, 52) + '...' : gap.title;
        console.log(`    ${icon} ${title}`);
      }
      if (gapsToFix.length > 10) {
        console.log(`    \x1b[90m... and ${gapsToFix.length - 10} more\x1b[0m`);
      }
      console.log();

      ui.divider();
      console.log();

      console.log();

      // Fix each gap and apply immediately
      const progress = new ui.FixProgress(gapsToFix.length);
      let successCount = 0;
      let failCount = 0;
      let totalFilesWritten = 0;

      for (const gap of gapsToFix) {
        progress.start(gap.title);

        try {
          let result: { success?: boolean; filesWritten?: Record<string, string>; error?: string } = {};

          // Use streaming endpoint for real-time progress
          for await (const event of api.agentFixStream({
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
          })) {
            switch (event.type) {
              case 'progress':
                if (event.message) {
                  progress.update(event.message);
                }
                break;
              case 'complete':
                result = {
                  success: event.success,
                  filesWritten: event.filesWritten,
                  error: event.error,
                };
                break;
              case 'error':
                result = { success: false, error: event.message || event.error };
                break;
            }
          }

          if (result.success && result.filesWritten) {
            const fileCount = Object.keys(result.filesWritten).length;

            // Apply immediately unless --dry-run
            if (!options.dryRun) {
              for (const [filePath, content] of Object.entries(result.filesWritten)) {
                const fullPath = resolve(projectRoot, filePath);
                await mkdir(dirname(fullPath), { recursive: true });
                await writeFile(fullPath, content, 'utf-8');
                // Update in-memory files for subsequent fixes
                files.set(filePath, content);
              }
            }

            progress.done(fileCount);
            successCount++;
            totalFilesWritten += fileCount;
          } else {
            progress.fail(result.error);
            failCount++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          progress.fail(message);
          failCount++;
        }
      }

      console.log();

      // Summary
      if (successCount > 0) {
        if (options.dryRun) {
          ui.info(`Dry run: ${successCount} fixes would write ${totalFilesWritten} files`);
        } else {
          ui.success(`Applied ${successCount} fixes (${totalFilesWritten} files)`);
        }
      }

      if (failCount > 0) {
        ui.warning(`${failCount} fix${failCount !== 1 ? 'es' : ''} failed`);
      }

      // Remaining issues
      const remaining = fixable.length - gapsToFix.length;
      if (remaining > 0) {
        console.log();
        ui.info(`${remaining} more issues remaining`);
        ui.cta('Fix more with', 'lastmile fix --all');
      } else {
        console.log();
        ui.cta('Verify fixes', 'lastmile analyze');
      }

    } catch (error) {
      if (error instanceof Error) {
        ui.error(error.message);
      } else {
        ui.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });
