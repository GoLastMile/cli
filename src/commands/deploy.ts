import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { confirm, select } from '@inquirer/prompts';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import { collectFiles } from '../lib/file-collector.js';

export const deployCommand = new Command('deploy')
  .description('Deploy your project to production')
  .option('--platform <platform>', 'Deployment platform (railway, vercel)')
  .option('--yes', 'Skip confirmation prompts')
  .action(async (options) => {
    const config = await loadConfig();
    const api = createApiClient(config);

    let platform = options.platform || config.deployment?.platform;

    if (!platform) {
      platform = await select({
        message: 'Select deployment platform:',
        choices: [
          { name: 'Railway', value: 'railway' },
          { name: 'Vercel', value: 'vercel' },
        ],
      });
    }

    const tokenKey = platform === 'vercel' ? 'vercelToken' : 'railwayToken';
    const token = config.deployment?.[tokenKey as keyof typeof config.deployment] ||
                  process.env[`${platform.toUpperCase()}_TOKEN`];

    if (!token) {
      console.log(chalk.red(`\nNo ${platform} token found.`));
      console.log(chalk.dim(`Set it in .lastmilerc or ${platform.toUpperCase()}_TOKEN env var.\n`));
      process.exit(1);
    }

    const shouldDeploy = options.yes || await confirm({
      message: `Deploy to ${platform}?`,
      default: true,
    });

    if (!shouldDeploy) {
      console.log(chalk.dim('Deployment cancelled.'));
      return;
    }

    const spinner = ora(`Deploying to ${platform}...`).start();

    try {
      const files = await collectFiles('.');

      const deployment = await api.deploy({
        platform,
        token: token as string,
        files: Object.fromEntries(files),
      });

      // Poll for deployment status
      let status = deployment.status;
      while (status === 'pending' || status === 'building') {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const updated = await api.getDeployment(deployment.id);
        status = updated.status;
        spinner.text = `Deploying to ${platform}... (${status})`;
      }

      if (status === 'success') {
        spinner.succeed(chalk.green('Deployed successfully!'));
        console.log(chalk.bold(`\n🚀 Your app is live at: ${chalk.cyan(deployment.url)}\n`));
      } else {
        spinner.fail('Deployment failed');
        console.log(chalk.red(`\nError: ${deployment.error}\n`));
        process.exit(1);
      }
    } catch (error) {
      spinner.fail('Deployment failed');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });
