import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { loadProjectConfig } from './init.js';
import { collectFiles } from '../lib/file-collector.js';
import * as ui from '../lib/ui.js';

interface AgentProgress {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
  gapCount?: number;
  iterations?: number;
  tokensUsed?: number;
}

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

    // Interactive mode
    ui.intro('LastMile Analysis');

    try {
      // Collect files
      const s = ui.spinner();
      s.start('Collecting files...');
      const files = await collectFiles(targetDir);
      s.stop(`Found ${files.size} files`);

      // Track agent progress
      const agents = new Map<string, AgentProgress>();
      const taskList = new ui.TaskList('Running analyzer agents...');

      // Stream analysis
      const stream = api.analyzeStream({
        files: Object.fromEntries(files),
        projectId,
      });

      let analysis: any = null;
      let stackDetected = false;

      for await (const event of stream) {
        if (event.type === 'start') {
          // Analysis started
        } else if (event.type === 'phase') {
          if (event.phase === 'project-analysis') {
            s.start('Detecting stack...');
          } else if (event.phase === 'analyzers') {
            if (!stackDetected) {
              s.stop('Stack detected');
              stackDetected = true;
            }

            // Initialize agents
            if (event.data) {
              const data = event.data as { analyzers: Array<{ id: string; name: string }> };
              for (const analyzer of data.analyzers) {
                agents.set(analyzer.id, {
                  id: analyzer.id,
                  name: analyzer.name,
                  status: 'pending',
                });
                taskList.addAgent(analyzer.id, analyzer.name);
              }
              taskList.start();
            }
          }
        } else if (event.type === 'project-analysis') {
          // Stack detection update
          if (event.message) {
            s.message(event.message);
          }
        } else if (event.type === 'analyzer-start') {
          if (event.data) {
            const data = event.data as { analyzerId: string };
            taskList.updateAgent(data.analyzerId, { status: 'running' });
          }
        } else if (event.type === 'analyzer-progress') {
          if (event.data) {
            const data = event.data as { analyzerId: string; message?: string };
            // Extract tool name from message like "[testing] [0] listFiles"
            const match = event.message?.match(/\[\d+\]\s+(\w+)/);
            const toolName = match ? match[1] : undefined;
            taskList.updateAgent(data.analyzerId, {
              status: 'running',
              message: toolName,
            });
          }
        } else if (event.type === 'analyzer-complete') {
          if (event.data) {
            const data = event.data as {
              analyzerId: string;
              gapCount: number;
              iterations?: number;
              tokensUsed?: number;
              error?: string;
            };
            if (data.error) {
              taskList.updateAgent(data.analyzerId, {
                status: 'error',
                message: data.error,
              });
            } else {
              taskList.updateAgent(data.analyzerId, {
                status: 'done',
                gapCount: data.gapCount,
                iterations: data.iterations,
                tokensUsed: data.tokensUsed,
              });
            }
          }
        } else if (event.type === 'gap') {
          // Collect gaps
          if (!analysis) analysis = { gaps: [] };
          analysis.gaps.push(event.data);
        } else if (event.type === 'complete') {
          taskList.stop();

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
          taskList.stop();
          throw new Error(event.message || 'Analysis failed');
        }
      }

      if (!analysis) {
        throw new Error('Analysis failed: no response received');
      }

      // Display results
      ui.displayResults(analysis);

      // Outro
      const fixable = analysis.gaps.filter((g: any) => g.autoFixable).length;
      if (fixable > 0) {
        ui.outro(`Run 'lastmile fix' to auto-fix ${fixable} issue(s)`);
      } else if (analysis.gaps.length === 0) {
        ui.outro('Your project looks production-ready!');
      } else {
        ui.outro('Analysis complete');
      }

    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          ui.log.error('Could not connect to LastMile API');
          ui.log.info('Make sure the backend is running: cd backend && pnpm dev');
        } else {
          ui.log.error(error.message);
        }
      } else {
        ui.log.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });
