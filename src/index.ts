import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { analyzeCommand } from './commands/analyze.js';
import { fixCommand } from './commands/fix.js';
import { deployCommand } from './commands/deploy.js';
import { shipCommand } from './commands/ship.js';

const program = new Command();

program
  .name('lastmile')
  .description('Ship your vibe-coded projects to production')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(analyzeCommand);
program.addCommand(fixCommand);
program.addCommand(deployCommand);
program.addCommand(shipCommand);

program.parse();
