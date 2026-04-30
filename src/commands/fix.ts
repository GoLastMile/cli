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
  .option('--yes', 'Auto-approve and apply all fixes')
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

      // Confirm
      if (!options.yes) {
        const proceed = await ui.confirm(`Fix ${gapsToFix.length} issues?`, true);
        if (!proceed) {
          ui.cancel('Cancelled');
          return;
        }
      }

      console.log();

      // Fix each gap
      const progress = new ui.FixProgress(gapsToFix.length);
      const results: Array<{
        gap: Gap;
        success: boolean;
        filesWritten?: Record<string, string>;
        error?: string;
      }> = [];

      for (const gap of gapsToFix) {
        progress.start(gap.title);

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
            progress.done(Object.keys(result.filesWritten || {}).length);
            results.push({ gap, success: true, filesWritten: result.filesWritten });
          } else {
            progress.fail(result.error);
            results.push({ gap, success: false, error: result.error });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          progress.fail(message);
          results.push({ gap, success: false, error: message });
        }
      }

      console.log();

      // Collect files to write
      const successfulFixes = results.filter(r => r.success && r.filesWritten);
      if (successfulFixes.length === 0) {
        ui.warning('No fixes were generated');
        console.log();
        return;
      }

      const allFilesToWrite = new Map<string, string>();
      for (const { filesWritten } of successfulFixes) {
        if (filesWritten) {
          for (const [path, content] of Object.entries(filesWritten)) {
            allFilesToWrite.set(path, content);
          }
        }
      }

      // Show files to write
      ui.divider();
      console.log();
      console.log(`  ${allFilesToWrite.size} file${allFilesToWrite.size !== 1 ? 's' : ''} to write:`);
      console.log();

      for (const [filePath, content] of allFilesToWrite) {
        console.log(`  \x1b[32m+\x1b[0m ${filePath}`);
        const fullPath = resolve(projectRoot, filePath);
        try {
          const original = await readFile(fullPath, 'utf-8');
          displayDiff(original, content);
        } catch {
          const lines = content.split('\n').length;
          console.log(`    \x1b[90m(new file, ${lines} lines)\x1b[0m`);
        }
      }

      console.log();
      ui.divider();
      console.log();

      // Apply
      const shouldApply = options.yes || await ui.confirm('Apply changes?', true);

      if (shouldApply) {
        const applySpinner = ui.spinner();
        applySpinner.start('Applying...');

        for (const [filePath, content] of allFilesToWrite) {
          const fullPath = resolve(projectRoot, filePath);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, content, 'utf-8');
        }

        applySpinner.stop('Done');
        console.log();
        ui.success(`Applied ${allFilesToWrite.size} file${allFilesToWrite.size !== 1 ? 's' : ''}`);
      } else {
        ui.info('Changes not applied');
      }

      // Summary
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        console.log();
        ui.warning(`${failed.length} fix${failed.length !== 1 ? 'es' : ''} failed`);
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
