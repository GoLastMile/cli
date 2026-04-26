import { Command } from 'commander';
import chalk from 'chalk';
import { clearAuthSession, getAuthSession } from '../lib/auth.js';

export const logoutCommand = new Command('logout')
  .description('Log out of LastMile')
  .action(async () => {
    const session = await getAuthSession();

    if (!session) {
      console.log(chalk.dim('\nNot logged in.\n'));
      return;
    }

    await clearAuthSession();
    console.log(chalk.green('\n✓ Logged out successfully.\n'));
  });
