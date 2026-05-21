import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../src/php-class-parser.js', () => ({
  parsePhpClasses: () => [
    {
      class: 'App\\Entity\\Article',
      properties: [
        { name: 'id', type: 'int' },
        { name: 'title', type: 'string', column: { type: 'string' } },
        { name: 'tags', relation: { type: 'ManyToMany', target: 'App\\Entity\\Tag', pivot: { timestamps: true, columns: [ { name: 'position', type: 'int', nullable: false, default: 0 } ] } } }
      ]
    }
  ]
}));

import { generateLaravelMigrationFromClasses } from '../src/migration-generator.js';

describe('pivot generation advanced', () => {
  it('generates pivot migration with extra columns and timestamps', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pivot-'));
    const phpFiles = generateLaravelMigrationFromClasses('irrelevant', tmp);
    // find pivot file
    const pivot = phpFiles.find(f => f.endsWith('_pivot_table.php'));
    expect(pivot).toBeTruthy();
    if (pivot) {
      const content = fs.readFileSync(pivot, 'utf8');
      expect(content).toContain("$table->unsignedBigInteger('article_id')");
      expect(content).toContain("$table->unsignedBigInteger('tag_id')");
      expect(content).toMatch(/\$table->integer\('position'\)/);

      expect(content).toContain('$table->timestamps()');
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
