/**
 * lastmile api-key
 *
 * Manage API keys for CI/CD authentication.
 */

import { Command } from 'commander';
import { input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';

export const apiKeyCommand = new Command('api-key')
  .description('Manage API keys for CI/CD');

/**
 * Create a new API key
 */
apiKeyCommand
  .command('create')
  .description('Create a new API key')
  .option('--name <name>', 'Name for the key (e.g., "GitHub Actions")')
  .action(async (options) => {
    console.log(chalk.bold('\n  Create API Key\n'));

    const config = await loadConfig();
    if (!config.apiKey) {
      console.log(chalk.red('  Not logged in. Run `lastmile login` first.\n'));
      process.exit(1);
    }

    const api = createApiClient(config);

    // Get key name
    let name = options.name;
    if (!name) {
      name = await input({
        message: 'Key name (e.g., "GitHub Actions"):',
        default: 'CI/CD',
      });
    }

    try {
      const result = await api.createApiKey({ name });

      console.log(chalk.green('\n  API key created!\n'));
      console.log(chalk.bold('  Your API key:'));
      console.log(chalk.cyan(`  ${result.key}\n`));
      console.log(chalk.yellow('  Save this key - it will not be shown again.\n'));
      console.log(chalk.dim('  Add to GitHub Secrets:'));
      console.log(chalk.dim('  Settings > Secrets > Actions > New repository secret'));
      console.log(chalk.dim('  Name: LASTMILE_API_KEY'));
      console.log(chalk.dim(`  Value: ${result.key}\n`));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.log(chalk.red(`\n  Failed to create API key: ${message}\n`));
      process.exit(1);
    }
  });

/**
 * List API keys
 */
apiKeyCommand
  .command('list')
  .description('List your API keys')
  .action(async () => {
    const config = await loadConfig();
    if (!config.apiKey) {
      console.log(chalk.red('  Not logged in. Run `lastmile login` first.\n'));
      process.exit(1);
    }

    const api = createApiClient(config);

    try {
      const { keys } = await api.listApiKeys();

      if (keys.length === 0) {
        console.log(chalk.dim('\n  No API keys found.\n'));
        console.log(chalk.dim('  Run `lastmile api-key create` to create one.\n'));
        return;
      }

      console.log(chalk.bold('\n  Your API Keys\n'));
      for (const key of keys) {
        const lastUsed = key.lastUsedAt
          ? `Last used: ${new Date(key.lastUsedAt).toLocaleDateString()}`
          : 'Never used';
        console.log(`  ${chalk.cyan(key.keyPrefix)}...  ${key.name}`);
        console.log(chalk.dim(`    ${lastUsed}`));
      }
      console.log();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.log(chalk.red(`\n  Failed to list API keys: ${message}\n`));
      process.exit(1);
    }
  });

/**
 * Revoke an API key
 */
apiKeyCommand
  .command('revoke <key-prefix>')
  .description('Revoke an API key by its prefix')
  .action(async (keyPrefix) => {
    const config = await loadConfig();
    if (!config.apiKey) {
      console.log(chalk.red('  Not logged in. Run `lastmile login` first.\n'));
      process.exit(1);
    }

    const api = createApiClient(config);

    try {
      // Find key by prefix
      const { keys } = await api.listApiKeys();
      const key = keys.find(k => k.keyPrefix.includes(keyPrefix));

      if (!key) {
        console.log(chalk.red(`\n  No key found matching "${keyPrefix}"\n`));
        process.exit(1);
      }

      const shouldRevoke = await confirm({
        message: `Revoke key "${key.name}" (${key.keyPrefix}...)?`,
        default: false,
      });

      if (!shouldRevoke) {
        console.log(chalk.dim('\n  Cancelled.\n'));
        return;
      }

      await api.revokeApiKey(key.id);
      console.log(chalk.green(`\n  Key revoked: ${key.name}\n`));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.log(chalk.red(`\n  Failed to revoke API key: ${message}\n`));
      process.exit(1);
    }
  });
