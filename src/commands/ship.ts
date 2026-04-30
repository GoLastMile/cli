import { Command } from 'commander';
import { resolve, dirname } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';
import type { AnalyzeResponse, Gap } from '../lib/api-client.js';
import * as ui from '../lib/ui.js';

export const shipCommand = new Command('ship')
  .description('Analyze, fix, and deploy in one command')
  .option('-d, --dir <path>', 'Directory to analyze', '.')
  .option('--platform <platform>', 'Deployment platform (railway, vercel)')
  .option('--yes', 'Skip all confirmation prompts')
  .action(async (options) => {
    const config = await loadConfig();
    const api = createApiClient(config);
    const projectRoot = resolve(process.cwd(), options.dir);

    ui.intro('LastMile Ship');

    try {
      // Step 1: Analyze using streaming to avoid timeout
      const s = ui.spinner();
      s.start('Collecting files...');
      const files = await collectFiles(projectRoot, {
        ignorePaths: config.analysis?.ignorePaths ?? [],
      });
      s.message(`Analyzing ${files.size} files via streaming...`);

      let analysis: AnalyzeResponse | undefined;

      for await (const event of api.analyzeStream({ files: Object.fromEntries(files) })) {
        switch (event.type) {
          case 'phase':
            s.message(event.message || event.phase || 'Analyzing...');
            break;
          case 'analyzer-start':
            s.message(`Running ${(event.data as { type?: string })?.type || 'analyzer'} agent...`);
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

      const criticalGaps = analysis.gaps.filter(g => g.severity === 'critical');
      const warningGaps = analysis.gaps.filter(g => g.severity === 'warning');
      const autoFixableGaps = analysis.gaps.filter(g => g.autoFixable);

      ui.log.message(`Found ${criticalGaps.length} critical, ${warningGaps.length} warnings`);

      if (analysis.gaps.length === 0) {
        ui.log.success('No gaps detected! Your project looks production-ready.');
      } else {
        // Step 2: Fix
        const shouldFix = options.yes || await ui.confirm('Fix issues before deploying?', true);

        if (shouldFix && autoFixableGaps.length > 0) {
          const taskList = new ui.TaskList('Fixing gaps...');
          for (const gap of autoFixableGaps) {
            taskList.addAgent(gap.id, gap.title);
          }
          taskList.start();

          let fixedCount = 0;

          for (const gap of autoFixableGaps) {
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

              if (result.success && result.filesWritten) {
                for (const [filePath, content] of Object.entries(result.filesWritten)) {
                  const fullPath = resolve(projectRoot, filePath);
                  await mkdir(dirname(fullPath), { recursive: true });
                  await writeFile(fullPath, content, 'utf-8');
                }
                fixedCount++;
                taskList.updateAgent(gap.id, { status: 'done' });
              } else {
                taskList.updateAgent(gap.id, {
                  status: 'error',
                  message: result.error || 'Failed',
                });
              }
            } catch (error) {
              taskList.updateAgent(gap.id, {
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }

          taskList.stop();

          if (fixedCount > 0) {
            ui.log.success(`Applied ${fixedCount} fix(es)`);
          }
        }
      }

      // Step 3: Deploy
      const shouldDeploy = options.yes || await ui.confirm('Deploy to production?', true);

      if (shouldDeploy) {
        let platform = options.platform || config.deployment?.platform;

        if (!platform) {
          platform = await ui.select('Select deployment platform:', [
            { value: 'railway', label: 'Railway' },
            { value: 'vercel', label: 'Vercel' },
          ]);
        }

        const tokenKey = platform === 'vercel' ? 'vercelToken' : 'railwayToken';
        const token = config.deployment?.[tokenKey as keyof typeof config.deployment];

        if (!token) {
          ui.log.warning(`No ${platform} token configured. Skipping deployment.`);
          ui.log.info(`Add ${tokenKey} to .lastmilerc or run 'lastmile init'`);
          return;
        }

        const s = ui.spinner();
        s.start(`Deploying to ${platform}...`);

        const deployment = await api.deploy({
          platform,
          token: token as string,
          files: Object.fromEntries(
            await collectFiles(projectRoot, { ignorePaths: config.analysis?.ignorePaths ?? [] })
          ),
        });

        let status = deployment.status;
        while (status === 'pending' || status === 'building') {
          await new Promise(resolve => setTimeout(resolve, 3000));
          const updated = await api.getDeployment(deployment.id);
          status = updated.status;
          s.message(`Deploying... (${status})`);
        }

        if (status === 'success') {
          s.stop('Deployed!');
          ui.log.success(`Your app is live at: ${deployment.url}`);
        } else {
          s.stop('Deployment failed');
          ui.log.error(deployment.error || 'Unknown error');
        }
      }

      ui.outro('Ship complete');

    } catch (error) {
      if (error instanceof Error) {
        ui.log.error(error.message);
      } else {
        ui.log.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });
