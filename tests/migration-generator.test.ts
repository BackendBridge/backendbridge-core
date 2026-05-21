import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// mock the php-class-parser to return a controlled parsed structure
vi.mock('../src/php-class-parser.js', () => ({
  parsePhpClasses: () => [
    {
      class: 'App\\Entity\\Post',
      properties: [
        { name: 'id', type: 'int' },
        { name: 'title', type: 'string', column: { type: 'string', length: 200, nullable: false, default: null, unique: false, index: true } },
        { name: 'views', type: 'int', column: { type: 'int', nullable: true, default: 0 } },
        { name: 'published', type: 'bool', column: { type: 'bool', nullable: false, default: false } },
        { name: 'createdAt', type: 'datetime', column: { type: 'datetime', nullable: false } },
        { name: 'owner', relation: { type: 'ManyToOne', target: 'App\\Entity\\User' }, name: 'owner' },
        { name: 'tags', relation: { type: 'ManyToMany', target: 'App\\Entity\\Tag' }, name: 'tags' }
      ]
    }
  ]
}));

import { generateSqlFromClasses, generateLaravelMigrationFromClasses } from '../src/migration-generator.js';

describe('migration generator', () => {
  it('generates SQL and Laravel migrations with nullable/default/index metadata', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mig-'));
    const sqlFiles = generateSqlFromClasses('irrelevant', tmp);
    expect(sqlFiles.length).toBeGreaterThan(0);
    const sqlContent = fs.readFileSync(sqlFiles[0], 'utf8');
    expect(sqlContent).toContain("views");
    expect(sqlContent).toMatch(/views\s+INT\s+NULL/);
    expect(sqlContent).toMatch(/title\s+VARCHAR\(255\)/i);
    // generate laravel migrations
    const phpFiles = generateLaravelMigrationFromClasses('irrelevant', tmp);
    expect(phpFiles.length).toBeGreaterThan(0);
    const php = fs.readFileSync(phpFiles.find(f => f.endsWith('.php'))!, 'utf8');
    expect(php).toContain("$table->integer('views')");
    expect(php).toContain("->nullable()");
    // migration uses target name for FK (user -> user_id)
    expect(php).toContain("$table->unsignedBigInteger('user_id')");
    // pivot migration exists (at least one additional php migration for pivot)
    expect(phpFiles.length).toBeGreaterThan(1);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
