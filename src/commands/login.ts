import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import { exec } from 'child_process';
import {
  getAuthSession,
  saveAuthSession,
  startAuthCallbackServer,
} from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import { loadConfig } from '../lib/config.js';

const SUPABASE_URL = process.env.LASTMILE_SUPABASE_URL || 'https://qciymnwjsxtmpeqgogws.supabase.co';
const CALLBACK_PORT = 9876;

export const loginCommand = new Command('login')
  .description('Log in to LastMile')
  .option('--provider <provider>', 'Auth provider (github, google, email)')
  .action(async (options) => {
    console.log(chalk.bold('\n🔐 LastMile Login\n'));

    // Check if already logged in
    const existingSession = await getAuthSession();
    if (existingSession) {
      console.log(chalk.green(`Already logged in as ${existingSession.user.email}`));
      console.log(chalk.dim('Run `lastmile logout` to sign out.\n'));
      return;
    }

    // Select provider
    let provider = options.provider;
    if (!provider) {
      provider = await select({
        message: 'How would you like to sign in?',
        choices: [
          { name: 'GitHub', value: 'github' },
          { name: 'Google', value: 'google' },
          { name: 'Email (magic link)', value: 'email' },
        ],
      });
    }

    if (provider === 'email') {
      await handleEmailLogin();
      return;
    }

    // OAuth flow (GitHub or Google)
    const spinner = ora('Starting authentication...').start();

    try {
      // Start local callback server
      const callbackPromise = startAuthCallbackServer(CALLBACK_PORT);

      // Build auth URL
      const redirectUri = `http://localhost:${CALLBACK_PORT}/auth`;
      const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectUri)}`;

      spinner.text = 'Opening browser...';

      // Open browser
      openBrowser(authUrl);

      console.log(chalk.dim(`\nIf browser doesn't open, visit:`));
      console.log(chalk.cyan(authUrl));
      console.log();

      spinner.text = 'Waiting for authentication...';

      // Wait for callback
      const { code, close } = await callbackPromise;

      spinner.text = 'Completing login...';

      // Parse tokens from callback
      let tokens;
      try {
        tokens = JSON.parse(code);
      } catch {
        throw new Error('Invalid authentication response');
      }

      if (!tokens.access_token) {
        throw new Error('No access token received');
      }

      // Get user info from our API
      const config = await loadConfig();
      const api = createApiClient({
        ...config,
        apiKey: tokens.access_token,
      });

      let user;
      try {
        const response = await api.getMe();
        user = response.user;
      } catch {
        // API might not have /me endpoint yet, use token info
        user = {
          id: 'unknown',
          email: 'user@lastmile.sh',
        };
      }

      // Calculate expiry
      const expiresIn = parseInt(tokens.expires_in) || 3600;
      const expiresAt = Date.now() + expiresIn * 1000;

      // Save session
      await saveAuthSession({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });

      close();
      spinner.succeed(chalk.green('Logged in successfully!'));
      console.log(chalk.dim(`\nWelcome, ${user.name || user.email}!\n`));
    } catch (error) {
      spinner.fail('Login failed');
      console.log(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      console.log(chalk.dim('\nTry again or use a different provider.\n'));
      process.exit(1);
    }
  });

/**
 * Handle email magic link login
 */
async function handleEmailLogin() {
  const { input } = await import('@inquirer/prompts');

  const email = await input({
    message: 'Enter your email:',
    validate: (value) => {
      if (!value.includes('@')) return 'Please enter a valid email';
      return true;
    },
  });

  const spinner = ora('Sending magic link...').start();

  try {
    // Call Supabase to send magic link
    const response = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.LASTMILE_SUPABASE_ANON_KEY || '',
      },
      body: JSON.stringify({
        email,
        options: {
          emailRedirectTo: `http://localhost:${CALLBACK_PORT}/auth`,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to send magic link');
    }

    spinner.succeed('Magic link sent!');
    console.log(chalk.dim(`\nCheck your email (${email}) and click the link.`));
    console.log(chalk.dim('Waiting for you to click the link...\n'));

    // Wait for callback
    const { code, close } = await startAuthCallbackServer(CALLBACK_PORT);

    const tokens = JSON.parse(code);

    if (!tokens.access_token) {
      throw new Error('No access token received');
    }

    const expiresIn = parseInt(tokens.expires_in) || 3600;

    await saveAuthSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + expiresIn * 1000,
      user: {
        id: 'unknown',
        email,
      },
    });

    close();
    console.log(chalk.green('\n✓ Logged in successfully!\n'));
  } catch (error) {
    spinner.fail('Login failed');
    console.log(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

/**
 * Open URL in default browser
 */
function openBrowser(url: string) {
  const platform = process.platform;
  let command: string;

  switch (platform) {
    case 'darwin':
      command = `open "${url}"`;
      break;
    case 'win32':
      command = `start "" "${url}"`;
      break;
    default:
      command = `xdg-open "${url}"`;
  }

  exec(command, (error) => {
    if (error) {
      // Browser didn't open, user will need to copy URL manually
    }
  });
}
