import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { loadProjectConfig } from './init.js';
import { collectFiles } from '../lib/file-collector.js';
import * as ui from '../lib/ui.js';

export const analyzeCommand = new Command('analyze')
  .description('Analyze your project for production gaps')
  .argument('[path]', 'Directory to analyze', '.')
  .option('-d, --dir <path>', 'Directory to analyze (alternative to positional argument)')
  .option('--json', 'Output as JSON')
  .action(async (pathArg, options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    const targetDir = pathArg !== '.' ? pathArg : (options.dir || '.');
    const projectRoot = resolve(process.cwd(), targetDir);

    const projectConfig = await loadProjectConfig();
    const projectId = projectConfig?.projectId;

    // JSON mode - no fancy output
    if (options.json) {
      const s = ui.spinner();
      s.start('Analyzing...');
      try {
        const files = await collectFiles(targetDir);
        const analysis = await api.analyze({
          files: Object.fromEntries(files),
          projectId,
        });
        s.stop('Done');
        console.log(JSON.stringify(analysis, null, 2));
      } catch (error) {
        s.stop('Failed');
        console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
        process.exit(1);
      }
      return;
    }

    // Premium UI mode
    ui.header();

    try {
      // Collect files
      const s = ui.spinner();
      s.start('Collecting files...');
      const files = await collectFiles(targetDir);
      s.stop(`${files.size} files`);

      // Set up analyzer display
      const display = new ui.AnalyzerDisplay();
      display.add('stack', 'Stack');
      display.add('security', 'Security');
      display.add('testing', 'Testing');
      display.add('error-handling', 'Error Handling');
      display.add('database', 'Database');
      display.add('boilerplate', 'Production');

      // Stream analysis
      const stream = api.analyzeStream({
        files: Object.fromEntries(files),
        projectId,
      });

      let analysis: {
        readinessScore: number;
        gaps: Array<{
          id: string;
          category: string;
          severity: 'critical' | 'warning' | 'info';
          title: string;
          description?: string;
          filePath?: string;
          autoFixable?: boolean;
          suggestedFix?: string;
        }>;
        stack: {
          language: string | null;
          framework: string | null;
          database: string | null;
          orm?: string | null;
        };
        projectAnalysis?: {
          framework?: { name: string };
          architecture?: { type: string };
          database?: { type: string };
        };
      } | null = null;

      const collectedGaps: typeof analysis['gaps'] = [];
      let displayStarted = false;

      for await (const event of stream) {
        switch (event.type) {
          case 'phase':
            if (event.phase === 'project-analysis') {
              display.update('stack', { status: 'running', message: 'detecting...' });
              if (!displayStarted) {
                display.start();
                displayStarted = true;
              }
            } else if (event.phase === 'analyzers') {
              // Mark all analyzer agents as pending (they'll start soon)
            }
            break;

          case 'project-analysis-progress':
            display.update('stack', { status: 'running', message: event.message });
            break;

          case 'project-analysis':
            const paData = event.data as { framework?: { name: string } };
            display.update('stack', {
              status: 'done',
              message: paData?.framework?.name || 'detected',
            });
            break;

          case 'analyzer-start':
            const startData = event.data as { analyzerId: string };
            if (startData?.analyzerId) {
              display.update(startData.analyzerId, { status: 'running', message: 'starting...' });
            }
            break;

          case 'analyzer-progress':
            const progressData = event.data as { analyzerId: string };
            if (progressData?.analyzerId && event.message) {
              display.update(progressData.analyzerId, {
                status: 'running',
                message: event.message,
              });
            }
            break;

          case 'analyzer-complete':
            const completeData = event.data as {
              analyzerId: string;
              gapCount: number;
              error?: string;
            };
            if (completeData?.analyzerId) {
              if (completeData.error) {
                display.update(completeData.analyzerId, {
                  status: 'error',
                  message: completeData.error,
                });
              } else {
                display.update(completeData.analyzerId, {
                  status: 'done',
                  issueCount: completeData.gapCount,
                });
              }
            }
            break;

          case 'gap':
            if (event.data) {
              collectedGaps.push(event.data as typeof collectedGaps[0]);
            }
            break;

          case 'complete':
            display.stop();
            const data = event.data as {
              readinessScore: number;
              stack: typeof analysis['stack'];
              projectAnalysis?: typeof analysis['projectAnalysis'];
            };
            analysis = {
              readinessScore: data.readinessScore,
              gaps: collectedGaps,
              stack: data.stack,
              projectAnalysis: data.projectAnalysis,
            };
            break;

          case 'error':
            display.stop();
            throw new Error(event.message || 'Analysis failed');
        }
      }

      if (!analysis) {
        throw new Error('Analysis failed: no response received');
      }

      // Show stack
      ui.stack({
        framework: analysis.projectAnalysis?.framework?.name || analysis.stack.framework,
        language: analysis.stack.language,
        database: analysis.stack.database,
        orm: analysis.stack.orm,
      });

      // Show results
      ui.displayResults(analysis);

      // Call to action
      const fixable = analysis.gaps.filter(g => g.autoFixable).length;
      if (fixable > 0) {
        ui.cta(`Auto-fix ${fixable} issues`, 'lastmile fix');
      } else if (analysis.gaps.length === 0) {
        ui.success('Your project looks production-ready!');
        console.log();
      }

    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          ui.error('Could not connect to LastMile API');
          ui.info('Make sure the backend is running: cd backend && pnpm dev');
        } else {
          ui.error(error.message);
        }
      } else {
        ui.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });
