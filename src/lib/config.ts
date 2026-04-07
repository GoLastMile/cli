import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';

export const CONFIG_FILENAME = '.lastmilerc';

const ConfigSchema = z.object({
  apiKey: z.string().optional(),
  deployment: z.object({
    platform: z.enum(['railway', 'vercel']).nullable().optional(),
    vercelToken: z.string().nullable().optional(),
    railwayToken: z.string().nullable().optional(),
  }).optional(),
  analysis: z.object({
    ignorePaths: z.array(z.string()).optional(),
    severityThreshold: z.enum(['critical', 'warning', 'info']).optional(),
  }).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(): Promise<Config> {
  let config: Config = {};

  // Load global config (~/.lastmilerc)
  try {
    const globalPath = join(homedir(), CONFIG_FILENAME);
    const content = await readFile(globalPath, 'utf-8');
    config = ConfigSchema.parse(JSON.parse(content));
  } catch {
    // File doesn't exist or is invalid - this is expected for new users
  }

  // Load project config (./.lastmilerc) - overrides global
  try {
    const content = await readFile(`./${CONFIG_FILENAME}`, 'utf-8');
    const projectConfig = ConfigSchema.parse(JSON.parse(content));
    config = {
      ...config,
      ...projectConfig,
      deployment: { ...config.deployment, ...projectConfig.deployment },
      analysis: { ...config.analysis, ...projectConfig.analysis },
    };
  } catch {
    // File doesn't exist or is invalid - this is expected
  }

  // Override with environment variables
  if (process.env.LASTMILE_API_KEY) {
    config.apiKey = process.env.LASTMILE_API_KEY;
  }
  if (process.env.VERCEL_TOKEN) {
    config.deployment = { ...config.deployment, vercelToken: process.env.VERCEL_TOKEN };
  }
  if (process.env.RAILWAY_TOKEN) {
    config.deployment = { ...config.deployment, railwayToken: process.env.RAILWAY_TOKEN };
  }

  return config;
}
