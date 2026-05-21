import fs from 'node:fs';
import path from 'node:path';
import { parsePhpClasses } from './php-class-parser.js';

function ucFirst(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function shortClass(fqcn?: string) {
  if (!fqcn) return 'mixed';
  return fqcn.split('\\').pop() || fqcn;
}

export function generateDoctrineEntities(sourcePath: string, outDir: string): string[] {
  const parsed = parsePhpClasses(sourcePath);
  const generated: string[] = [];
  // helper map: short class name -> parsed class
  const classByShort = new Map(parsed.map(c => [shortClass(c.class), c] as const));
  for (const cls of parsed) {
    const className = cls.class.split('\\').pop() || 'Generated';
    const nsParts = cls.class.split('\\').slice(0, -1);
    const ns = cls.namespace ?? (nsParts.length ? nsParts.join('\\') : 'App\\Entity');
    const lines: string[] = [];
    lines.push('<?php');
    lines.push('declare(strict_types=1);');
    lines.push('');
    lines.push(`namespace ${ns};`);
    lines.push('');
    lines.push('use Doctrine\\ORM\\Mapping as ORM;');
    lines.push('use Doctrine\\Common\\Collections\\ArrayCollection;');
    lines.push('use Doctrine\\Common\\Collections\\Collection;');
    lines.push('');
    lines.push('#[ORM\\Entity]');
    lines.push(`class ${className}` + ' {');

    // properties
    for (const p of cls.properties) {
      const propName = p.name;
      if (propName === 'id') {
        lines.push('    #[ORM\\Id]');
        lines.push('    #[ORM\\GeneratedValue]');
        lines.push("    #[ORM\\Column(type: 'integer')]");
        lines.push(`    private ?int $id = null;`);
        lines.push('');
        continue;
      }

      if (p.relation && p.relation.type) {
        const rel = (p.relation.type || '').toLowerCase();
        const targetShort = shortClass(p.relation.target);
        // resolve mappedBy/inversedBy: prefer explicit parser values, else try to infer from target class
        let computedMappedBy: string | null = p.relation.mappedBy || null;
        let computedInversedBy: string | null = p.relation.inversedBy || null;
        const targetClass = classByShort.get(targetShort);
        if (targetClass) {
          const back = targetClass.properties.find(q => q.relation && shortClass(q.relation.target) === shortClass(cls.class));
          if (back && back.relation && back.relation.type) {
            const backRel = back.relation.type.toLowerCase();
            if (rel.includes('manytoone') && backRel.includes('onetomany')) {
              computedInversedBy = computedInversedBy || back.name;
            } else if (rel.includes('onetomany') && backRel.includes('manytoone')) {
              computedMappedBy = computedMappedBy || back.name;
            } else if (rel.includes('manytomany') && backRel.includes('manytomany')) {
              // choose a sensible default: mark current side as owning (inversedBy) referencing back property
              computedInversedBy = computedInversedBy || back.name;
            } else if (rel.includes('oneToOne'.toLowerCase()) && backRel.includes('oneToOne'.toLowerCase())) {
              // for one-to-one, prefer inversedBy on owning side if available
              computedInversedBy = computedInversedBy || back.name;
            }
          }
        }
        const mappedBy = computedMappedBy ? `, mappedBy: '${computedMappedBy}'` : '';
        const inversedBy = computedInversedBy ? `, inversedBy: '${computedInversedBy}'` : '';
        const cascade = (p.relation && (p.relation as any).cascade && (p.relation as any).cascade.length) ? `, cascade: [${(p.relation as any).cascade.map((c: string)=>`'${c}'`).join(', ')}]` : '';
        const orphanRemoval = (p.relation && (p.relation as any).orphanRemoval) ? `, orphanRemoval: true` : '';
        if (rel === 'manytoone') {
          lines.push(`    #[ORM\\ManyToOne(targetEntity: '${targetShort}'${inversedBy})]`);
          if (p.relation.joinColumn) {
            const jc = p.relation.joinColumn;
            const name = jc.name ? `name: '${jc.name}', ` : '';
            const ref = jc.referencedColumnName ? `referencedColumnName: '${jc.referencedColumnName}', ` : '';
            const onDelete = jc.onDelete ? `, options: ['onDelete' => '${jc.onDelete}']` : '';
            const isNullable = jc.nullable !== false;
            lines.push(`    #[ORM\\JoinColumn(${name}${ref}nullable: ${isNullable ? 'true' : 'false'}${onDelete})]`);
          }
          lines.push(`    private ?${targetShort} $${propName} = null;`);
          lines.push('');
          continue;
        }
        if (rel.includes('onetomany')) {
          lines.push(`    #[ORM\\OneToMany(mappedBy: '${computedMappedBy || ''}', targetEntity: '${targetShort}'${cascade}${orphanRemoval})]`);
          lines.push(`    private Collection $${propName};`);
          lines.push('');
          continue;
        }
        if (rel === 'manytomany') {
          const join = (p.relation as any).joinTable ? `, joinTable: '${(p.relation as any).joinTable}'` : '';
          lines.push(`    #[ORM\\ManyToMany(targetEntity: '${targetShort}'${mappedBy}${inversedBy}${cascade}${join})]`);
          lines.push(`    private Collection $${propName};`);
          lines.push('');
          continue;
        }
      }

      const col = p.column || {};
      const type = col.type || p.type || 'string';
      lines.push(`    #[ORM\\Column(type: '${type}')]`);
      lines.push(`    private ${type === 'int' ? '?int' : '?string'} $${propName} = null;`);
      lines.push('');
    }

    // constructor for collections
    const collections = cls.properties.filter(p => p.relation && p.relation.type && p.relation.type.toLowerCase().includes('many'));
    if (collections.length) {
      lines.push('    public function __construct() {');
      for (const c of collections) {
        lines.push(`        $this->${c.name} = new ArrayCollection();`);
      }
      lines.push('    }');
      lines.push('');
    }

    // getters/setters and add/remove for collections
    for (const p of cls.properties) {
      if (p.name === 'id') {
        lines.push('    public function getId(): ?int { return $this->id; }');
        lines.push('');
        continue;
      }
      const propName = p.name;
      const method = ucFirst(propName);
      if (p.relation && p.relation.type && p.relation.type.toLowerCase().includes('many')) {
        const targetShort = shortClass(p.relation.target);
        lines.push(`    /** @return Collection<int, ${targetShort}> */`);
        lines.push(`    public function get${method}(): Collection { return $this->${propName}; }`);
        lines.push(`    public function add${ucFirst(targetShort)}(${targetShort} $item): void { if (!$this->${propName}->contains($item)) { $this->${propName}->add($item); } }`);
        lines.push(`    public function remove${ucFirst(targetShort)}(${targetShort} $item): void { $this->${propName}->removeElement($item); }`);
        lines.push('');
        continue;
      }
      const type = p.column && p.column.type ? p.column.type : p.type || 'string';
      lines.push(`    public function get${method}(): ${type === 'int' ? '?int' : '?string'} { return $this->${propName}; }`);
      lines.push(`    public function set${method}(${type === 'int' ? '?int' : '?string'} $v): void { $this->${propName} = $v; }`);
      lines.push('');
    }

    lines.push('}');
    const content = lines.join('\n');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${className}.php`);
    fs.writeFileSync(file, content, 'utf8');
    generated.push(file);
  }
  return generated;
}
