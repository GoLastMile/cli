/**
 * Project utilities for the LastMile CLI
 *
 * Handles project detection, naming, and database/ORM detection.
 */

import fs from 'fs';
import path from 'path';

export interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface DatabaseInfo {
  detected: boolean;
  orm?: 'drizzle' | 'prisma' | 'typeorm' | 'sequelize' | 'knex' | 'raw';
  hasMigrations: boolean;
  migrationsDir?: string;
  migrateCommand?: string;
}

/**
 * Read and parse package.json from a directory
 */
export function readPackageJson(dir: string): PackageJson | null {
  const packageJsonPath = path.join(dir, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Detect project name from package.json or directory name
 */
export function detectProjectName(dir: string): string {
  const pkg = readPackageJson(dir);

  if (pkg?.name && !pkg.name.startsWith('@')) {
    return pkg.name;
  }

  return path.basename(path.resolve(dir));
}

/**
 * Check if a directory exists
 */
export function directoryExists(dir: string): boolean {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

/**
 * Detect database and ORM information from the project
 */
export function detectDatabaseInfo(dir: string): DatabaseInfo {
  const pkg = readPackageJson(dir);
  const result: DatabaseInfo = { detected: false, hasMigrations: false };

  if (!pkg) {
    return result;
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts || {};

  // Drizzle
  if (deps['drizzle-orm']) {
    result.detected = true;
    result.orm = 'drizzle';

    if (fs.existsSync(path.join(dir, 'drizzle'))) {
      result.hasMigrations = true;
      result.migrationsDir = 'drizzle';
    } else if (fs.existsSync(path.join(dir, 'migrations'))) {
      result.hasMigrations = true;
      result.migrationsDir = 'migrations';
    }

    if (scripts['db:migrate'] || scripts['migrate']) {
      result.migrateCommand = scripts['db:migrate'] ? 'npm run db:migrate' : 'npm run migrate';
    } else if (deps['drizzle-kit']) {
      result.migrateCommand = 'npx drizzle-kit migrate';
    }
    return result;
  }

  // Prisma
  if (deps['prisma'] || deps['@prisma/client']) {
    result.detected = true;
    result.orm = 'prisma';

    if (fs.existsSync(path.join(dir, 'prisma', 'migrations'))) {
      result.hasMigrations = true;
      result.migrationsDir = 'prisma/migrations';
    }

    result.migrateCommand = 'npx prisma migrate deploy';
    return result;
  }

  // TypeORM
  if (deps['typeorm']) {
    result.detected = true;
    result.orm = 'typeorm';

    if (fs.existsSync(path.join(dir, 'migrations')) ||
        fs.existsSync(path.join(dir, 'src', 'migrations'))) {
      result.hasMigrations = true;
    }

    result.migrateCommand = 'npx typeorm migration:run';
    return result;
  }

  // Sequelize
  if (deps['sequelize']) {
    result.detected = true;
    result.orm = 'sequelize';

    if (fs.existsSync(path.join(dir, 'migrations'))) {
      result.hasMigrations = true;
    }

    result.migrateCommand = 'npx sequelize-cli db:migrate';
    return result;
  }

  // Knex
  if (deps['knex']) {
    result.detected = true;
    result.orm = 'knex';

    if (fs.existsSync(path.join(dir, 'migrations'))) {
      result.hasMigrations = true;
    }

    result.migrateCommand = 'npx knex migrate:latest';
    return result;
  }

  // Raw database clients
  if (deps['pg'] || deps['mysql2'] || deps['mongoose']) {
    result.detected = true;
    result.orm = 'raw';
    return result;
  }

  return result;
}

/**
 * Check if the project needs a database based on detected info
 */
export function needsDatabase(dir: string): boolean {
  const dbInfo = detectDatabaseInfo(dir);
  return dbInfo.detected;
}
