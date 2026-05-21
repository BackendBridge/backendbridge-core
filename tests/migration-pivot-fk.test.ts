import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../src/php-class-parser.js', () => ({
  parsePhpClasses: () => [
    {
      class: 'App\\Entity\\Post',
      properties: [
        { name: 'id', type: 'int' },
        { name: 'categories', relation: { type: 'ManyToMany', target: 'App\\Entity\\Category', pivot: { onDelete: 'cascade', onUpdate: 'restrict', columns: [] } } }
      ]
    }
  ]
}));

import { generateLaravelMigrationFromClasses } from '../src/migration-generator.js';

describe('pivot FK actions', () => {
  it('generates pivot migration with FK onDelete/onUpdate when configured', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pivot-fk-'));
    const phpFiles = generateLaravelMigrationFromClasses('irrelevant', tmp);
    const pivot = phpFiles.find(f => f.endsWith('_pivot_table.php'));
    expect(pivot).toBeTruthy();
    if (pivot) {
      const content = fs.readFileSync(pivot, 'utf8');
      expect(content).toContain("->onDelete('cascade')");
      expect(content).toContain("->onUpdate('restrict')");
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
