import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../src/php-class-parser.js', () => ({
  parsePhpClasses: () => [
    {
      class: 'App\\Entity\\Order',
      properties: [
        { name: 'id', type: 'int' },
        { name: 'a', type: 'string', column: { type: 'string' } },
        { name: 'b', type: 'string', column: { type: 'string' } },
        { name: 'user', relation: { type: 'ManyToOne', target: 'App\\Entity\\User', joinColumn: { onDelete: 'cascade', onUpdate: 'restrict' } }, name: 'user' }
      ],
      indexes: [ { columns: ['a','b'], name: 'idx_order_a_b', unique: false } ]
    }
  ]
}));

import { generateSqlFromClasses, generateLaravelMigrationFromClasses } from '../src/migration-generator.js';

describe('migration joinColumn/indexes', () => {
  it('outputs FK with ON DELETE/ON UPDATE and composite index', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mig-jc-'));
    const sql = generateSqlFromClasses('irrelevant', tmp);
    const content = fs.readFileSync(sql[0], 'utf8');
    expect(content).toContain('ON DELETE CASCADE');
    expect(content).toContain('ON UPDATE RESTRICT');
    expect(content).toContain('CREATE INDEX idx_order_a_b');

    const phpFiles = generateLaravelMigrationFromClasses('irrelevant', tmp);
    const php = fs.readFileSync(phpFiles.find(f => f.endsWith('.php'))!, 'utf8');
    expect(php).toContain("->onDelete('cascade')");
    expect(php).toContain("->onUpdate('restrict')");
    expect(php).toContain("$table->index(['a', 'b']");

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
