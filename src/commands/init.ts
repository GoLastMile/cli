import { Command } from 'commander';
import { password } from '@inquirer/prompts';
import chalk from 'chalk';
import { writeFile } from 'fs/promises';

export const initCommand = new Command('init')
  .description('Initialize LastMile configuration')
  .action(async () => {
    console.log(chalk.bold('\n🚀 LastMile Setup\n'));

    const apiKey = await password({
      message: 'Enter your LastMile API key:',
      mask: '*',
    });

    const config = {
      apiKey,
      deployment: {
        platform: null,
        vercelToken: null,
        railwayToken: null,
      },
    };

    await writeFile('.lastmilerc', JSON.stringify(config, null, 2));
    console.log(chalk.green('\n✓ Configuration saved to .lastmilerc'));
    console.log(chalk.dim('Run `lastmile analyze` to analyze your project.\n'));
  });
