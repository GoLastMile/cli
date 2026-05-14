import { Command } from 'commander';
import { shipCommand } from './commands/ship.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { apiKeyCommand } from './commands/api-key.js';

const program = new Command();

program
  .name('lastmile')
  .description('Ship your vibe-coded projects to production')
  .version('0.1.0');

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(shipCommand);
program.addCommand(apiKeyCommand);

program.parse();
