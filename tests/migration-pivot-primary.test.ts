import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../src/php-class-parser.js', () => ({
  parsePhpClasses: () => [
    {
      class: 'App\\Entity\\Product',
      properties: [
        { name: 'id', type: 'int' },
        { name: 'categories', relation: { type: 'ManyToMany', target: 'App\\Entity\\Category', pivot: { primary: ['product_id','category_id'], indexes: [ { columns: ['position'], unique: false, name: 'idx_prod_cat_pos' } ], columns: [ { name: 'position', type: 'int', default: 0 } ], timestamps: false } } }
      ]
    }
  ]
}));

import { generateLaravelMigrationFromClasses } from '../src/migration-generator.js';

describe('pivot primary and indexes', () => {
  it('generates pivot with custom primary and index', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pivot-pri-'));
    const phpFiles = generateLaravelMigrationFromClasses('irrelevant', tmp);
    const pivot = phpFiles.find(f => f.endsWith('_pivot_table.php'));
    expect(pivot).toBeTruthy();
    if (pivot) {
      const content = fs.readFileSync(pivot, 'utf8');
      expect(content).toContain("$table->primary(['product_id','category_id']");
      expect(content).toContain("$table->index(['position'], 'idx_prod_cat_pos')");
      expect(content).toContain("$table->integer('position'") || expect(content).toContain("$table->integer('position')");
      expect(content).not.toContain('$table->timestamps()');
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
