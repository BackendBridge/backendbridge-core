import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../src/php-class-parser.js', () => ({
  parsePhpClasses: () => [
    {
      class: 'App\\Entity\\Sample',
      namespace: 'App\\Entity',
      properties: [
        { name: 'id', type: 'int' },
        { name: 'name', type: 'string', column: { type: 'string' } },
        { name: 'items', relation: { type: 'OneToMany', target: 'App\\Entity\\Item' } }
      ]
    }
  ]
}));

import { generateDoctrineEntities } from '../src/doctrine-entity-generator.js';

describe('doctrine entity generator', () => {
  it('creates entity file with attributes and getters/setters', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-doctrine-'));
    const files = generateDoctrineEntities('irrelevant', tmp);
    expect(files.length).toBeGreaterThan(0);
    const content = fs.readFileSync(files[0], 'utf8');
    expect(content).toContain('#[ORM\\Entity]');
    expect(content).toContain('class Sample');
    expect(content).toContain('getName');
    expect(content).toContain('setName');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
