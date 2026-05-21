import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../src/php-class-parser.js', () => ({
  parsePhpClasses: () => [
    {
      class: 'App\\Entity\\User',
      namespace: 'App\\Entity',
      properties: [
        { name: 'id', type: 'int' },
        { name: 'posts', relation: { type: 'OneToMany', target: 'App\\Entity\\Post', mappedBy: 'user' } }
      ]
    },
    {
      class: 'App\\Entity\\Post',
      namespace: 'App\\Entity',
      properties: [
        { name: 'id', type: 'int' },
        { name: 'user', relation: { type: 'ManyToOne', target: 'App\\Entity\\User', inversedBy: 'posts', joinColumn: { name: 'user_id', referencedColumnName: 'id', onDelete: 'cascade', nullable: false } } }
      ]
    }
  ]
}));

import { generateDoctrineEntities } from '../src/doctrine-entity-generator.js';

describe('doctrine relations generator', () => {
  it('generates attributes for OneToMany and ManyToOne and collection methods', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-doctrine-rel-'));
    const files = generateDoctrineEntities('irrelevant', tmp);
    expect(files.length).toBeGreaterThanOrEqual(2);
    const user = fs.readFileSync(files.find(f => f.endsWith('User.php'))!, 'utf8');
    const post = fs.readFileSync(files.find(f => f.endsWith('Post.php'))!, 'utf8');
    expect(user).toContain('#[ORM\\OneToMany');
    expect(user).toContain('getPosts');
    expect(post).toContain('#[ORM\\ManyToOne');
    expect(post).toContain("#[ORM\\JoinColumn(name: 'user_id'")
    expect(post).toContain('onDelete');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
