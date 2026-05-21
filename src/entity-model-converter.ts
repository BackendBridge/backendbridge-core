import path from "node:path";
import fs from "node:fs";
import { parsePhpClasses } from "./php-class-parser.js";

function mapPhpTypeToLaravel(type?: string): string {
  if (!type) return "string";
  const t = type.toLowerCase();
  if (t.includes('int') || t === 'integer') return 'integer';
  if (t.includes('bool')) return 'boolean';
  if (t.includes('float') || t.includes('double') || t.includes('decimal')) return 'float';
  if (t.includes('datetime') || t.includes('date')) return 'datetime';
  return 'string';
}

export function generateLaravelModelFromPhpClass(parsed: { file: string; class: string; properties: Array<{ name: string; type?: string, relation?: any }> }, outDir: string, allParsed?: Array<{ file: string; class: string; properties: Array<{ name: string; type?: string, relation?: any }> }>): string {
  const className = parsed.class.split('\\').pop() || 'GeneratedModel';
  const modelName = className.replace(/Entity$/, '');
  const props = parsed.properties.filter(p => p.name !== 'id');
  const fillable = props.map(p => `'${p.name}'`).join(', ');
  // generate relation methods
  let relationsCode = '';
    for (const p of parsed.properties) {
      if (p.relation && p.relation.type) {
        const rel = p.relation.type.toLowerCase();
        const target = p.relation.target ? p.relation.target.split('\\').pop() : null;
        // method name heuristics
        let methodName = p.name.replace(/_id$/, '');
        if (rel.includes('many')) {
          if (target) methodName = target.toLowerCase() + 's'; else methodName = p.name;
        }
        if (rel === 'manytoone') {
          relationsCode += `    public function ${methodName}() {\n        return $this->belongsTo(${target}::class);\n    }\n\n`;
        } else if (rel === 'onetomany') {
          relationsCode += `    public function ${methodName}() {\n        return $this->hasMany(${target}::class);\n    }\n\n`;
        } else if (rel === 'onetoone') {
          relationsCode += `    public function ${methodName}() {\n        return $this->hasOne(${target}::class);\n    }\n\n`;
        } else if (rel === 'manytomany') {
          // determine pivot name
          const src = modelName.toLowerCase().replace(/s$/,'');
          const tgt = target ? target.toLowerCase().replace(/s$/,'') : p.name.replace(/s$/,'');
          const pivot = [src, tgt].sort().join('_');
          relationsCode += `    public function ${methodName}() {\n        return $this->belongsToMany(${target}::class, '${pivot}')->withTimestamps();\n    }\n\n`;
        }
      }
    }

  // build inverse relations by scanning other parsed classes
  let inverseRelationsCode = '';
  if (allParsed && Array.isArray(allParsed)) {
    const currentClassSimple = parsed.class.split('\\').pop();
    for (const other of allParsed) {
      if (other.class === parsed.class) continue;
      for (const op of other.properties) {
        if (!op.relation || !op.relation.type || !op.relation.target) continue;
        const targetSimple = op.relation.target.split('\\').pop();
        if (targetSimple !== currentClassSimple) continue;
        const rel = op.relation.type.toLowerCase();
        const otherModel = other.class.split('\\').pop()?.replace(/Entity$/, '') || 'Related';
        if (rel === 'manytoone') {
          const method = otherModel.toLowerCase() + 's';
          inverseRelationsCode += `    public function ${method}() {\n        return $this->hasMany(${otherModel}::class);\n    }\n\n`;
        } else if (rel === 'onetomany') {
          const method = otherModel.toLowerCase();
          inverseRelationsCode += `    public function ${method}() {\n        return $this->belongsTo(${otherModel}::class);\n    }\n\n`;
        } else if (rel === 'manytomany') {
          const src = modelName.toLowerCase().replace(/s$/,'');
          const tgt = otherModel.toLowerCase().replace(/s$/,'');
          const pivot = [src, tgt].sort().join('_');
          const method = otherModel.toLowerCase() + 's';
          inverseRelationsCode += `    public function ${method}() {\n        return $this->belongsToMany(${otherModel}::class, '${pivot}')->withTimestamps();\n    }\n\n`;
        }
      }
    }
  }

  const content = `<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ${modelName} extends Model
{
    protected $fillable = [${fillable}];

${relationsCode}
${inverseRelationsCode}
}
`;
  const outPath = path.join(outDir, `${modelName}.php`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, content, 'utf8');
  return outPath;
}

export function generateSymfonyEntityFromPhpClass(parsed: { file: string; class: string; properties: Array<{ name: string; type?: string, relation?: any }> }, outDir: string, allParsed?: Array<{ file: string; class: string; properties: Array<{ name: string; type?: string, relation?: any }> }>): string {
  const fqcn = parsed.class;
  const className = fqcn.split('\\').pop() || 'GeneratedEntity';
  const nsParts = fqcn.split('\\');
  nsParts.pop();
  const namespace = nsParts.join('\\') || 'App\\Entity';

  let propsCode = '';
  let relationsCode = '';
  const uses: string[] = ['Doctrine\\ORM\\Mapping as ORM'];
  let needsArrayCollection = false;
  for (const p of parsed.properties) {
    const type = p.type ? p.type : 'string';
    if (p.relation && p.relation.type) {
      const relType = p.relation.type;
      const target = p.relation.target ? p.relation.target.replace('\\\\', '\\') : p.relation.target;
      // choose attribute-based mapping
      if (relType.toLowerCase() === 'manytoone') {
        propsCode += `    #[ORM\\ManyToOne(targetEntity: ${target}::class, inversedBy: null)]\n    private $${p.name};\n\n`;
      } else if (relType.toLowerCase() === 'onetomany') {
        needsArrayCollection = true;
        propsCode += `    #[ORM\\OneToMany(targetEntity: ${target}::class, mappedBy: '${p.relation.mappedBy ?? ''}')]\n    private $${p.name};\n\n`;
      } else if (relType.toLowerCase() === 'manytomany') {
        needsArrayCollection = true;
        propsCode += `    #[ORM\\ManyToMany(targetEntity: ${target}::class)]\n    private $${p.name};\n\n`;
      } else if (relType.toLowerCase() === 'onetoone') {
        propsCode += `    #[ORM\\OneToOne(targetEntity: ${target}::class)]\n    private $${p.name};\n\n`;
      } else {
        propsCode += `    private $${p.name};\n\n`;
      }
    } else {
      // primitive column
      let colType = 'string';
      if (type) {
        const t = type.toLowerCase();
        if (t.includes('int')) colType = 'integer';
        else if (t.includes('bool')) colType = 'boolean';
        else if (t.includes('float') || t.includes('double') || t.includes('decimal')) colType = 'float';
        else if (t.includes('datetime') || t.includes('date')) colType = 'datetime';
      }
      propsCode += `    #[ORM\\Column(type: '${colType}')]\n    private $${p.name};\n\n`;
    }
  }

  // inverse relations: scan other classes referencing this one
  if (allParsed && Array.isArray(allParsed)) {
    const currentSimple = parsed.class.split('\\').pop();
    for (const other of allParsed) {
      if (other.class === parsed.class) continue;
      for (const op of other.properties) {
        if (!op.relation || !op.relation.type || !op.relation.target) continue;
        const targetSimple = op.relation.target.split('\\').pop();
        if (targetSimple !== currentSimple) continue;
        const rel = op.relation.type;
        const otherSimple = other.class.split('\\').pop();
        if (rel === 'ManyToOne') {
          propsCode += `    /**\n     * @ORM\\OneToMany(targetEntity=\\"${otherSimple}\\", mappedBy=\\"${op.name}\\")\n     */\n    private $${otherSimple.toLowerCase()}s;\n\n`;
        } else if (rel === 'OneToMany') {
          propsCode += `    /**\n     * @ORM\\ManyToOne(targetEntity=\\"${otherSimple}\\", inversedBy=\\"${op.name}\\")\n     */\n    private $${otherSimple.toLowerCase()};\n\n`;
        } else if (rel === 'ManyToMany') {
          propsCode += `    /**\n     * @ORM\\ManyToMany(targetEntity=\\"${otherSimple}\\")\n     */\n    private $${otherSimple.toLowerCase()}s;\n\n`;
        }
      }
    }
  }

  const content = `<?php
namespace ${namespace};

use ${uses.join('\\nuse ')};
${needsArrayCollection ? "use Doctrine\\Common\\Collections\\ArrayCollection;\nuse Doctrine\\Common\\Collections\\Collection;\n" : ''}

#[ORM\\Entity]
class ${className}
{
${propsCode}

    public function __construct()
    {
${needsArrayCollection ? parsed.properties.filter(p=>p.relation && (p.relation.type.toLowerCase()==='onetomany' || p.relation.type.toLowerCase()==='manytomany')).map(p=>`        $this->${p.name} = new ArrayCollection();`).join('\n') : ''}
    }

${generateSymfonyGettersSetters(parsed.properties)}
}
`;
  const outPath = path.join(outDir, `${className}.php`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, content, 'utf8');
  return outPath;
}

export function convertEntitiesToModels(sourcePath: string, outPath: string, target: 'laravel' | 'symfony'): string[] {
  const parsed = parsePhpClasses(sourcePath);
  const generated: string[] = [];
  for (const p of parsed) {
    if (target === 'laravel') {
      const file = generateLaravelModelFromPhpClass(p, path.join(outPath, 'app', 'Models'), parsed);
      generated.push(file);
    } else {
      const file = generateSymfonyEntityFromPhpClass(p, path.join(outPath, 'src', 'Entity'), parsed);
      generated.push(file);
    }
  }
  return generated;
}

function generateSymfonyGettersSetters(properties: Array<{ name: string; type?: string, relation?: any }>): string {
  const lines: string[] = [];
  for (const p of properties) {
    const name = p.name;
    const camel = name.charAt(0).toUpperCase() + name.slice(1);
    const isCollection = p.relation && (p.relation.type && (p.relation.type.toLowerCase() === 'onetomany' || p.relation.type.toLowerCase() === 'manytomany'));
    if (isCollection) {
      const itemType = (p.relation && p.relation.target) ? p.relation.target.split('\\').pop() : 'mixed';
      lines.push(`    /**`);
      lines.push(`     * @return Collection|${itemType}[]`);
      lines.push(`     */`);
      lines.push(`    public function get${camel}(): Collection`);
      lines.push(`    {`);
      lines.push(`        return $this->${name};`);
      lines.push(`    }`);
      lines.push(``);
      lines.push(`    public function add${itemType}(${itemType} $item): self`);
      lines.push(`    {`);
      lines.push(`        if (!$this->${name}->contains($item)) {`);
      lines.push(`            $this->${name}->add($item);`);
      lines.push(`        }`);
      lines.push(`        return $this;`);
      lines.push(`    }`);
      lines.push(``);
      lines.push(`    public function remove${itemType}(${itemType} $item): self`);
      lines.push(`    {`);
      lines.push(`        $this->${name}->removeElement($item);`);
      lines.push(`        return $this;`);
      lines.push(`    }`);
      lines.push(``);
    } else {
      // determine type hint
      let typeHint = '';
      if (p.relation && p.relation.target) {
        typeHint = p.relation.target.split('\\').pop() as string;
      } else if (p.type) {
        const t = p.type.toLowerCase();
        if (t.includes('int')) typeHint = 'int';
        else if (t.includes('bool')) typeHint = 'bool';
        else if (t.includes('float') || t.includes('double') || t.includes('decimal')) typeHint = 'float';
        else if (t.includes('datetime') || t.includes('date')) typeHint = '\\DateTimeInterface';
        else typeHint = 'string';
      } else {
        typeHint = '';
      }

      const retType = typeHint ? `:?${typeHint}`.replace(':?\\','?:\\').replace(':?','?:') : '';
      // simpler: avoid complex formatting, just omit nullable markers for now
      const returnAnnotation = typeHint ? `: ?${typeHint}` : '';
      // getter
      lines.push(`    public function get${camel}()${returnAnnotation}`);
      lines.push(`    {`);
      lines.push(`        return $this->${name};`);
      lines.push(`    }`);
      lines.push(``);
      // setter
      const setterType = typeHint ? `${typeHint} ` : '';
      lines.push(`    public function set${camel}(${setterType}$value): self`);
      lines.push(`    {`);
      lines.push(`        $this->${name} = $value;`);
      lines.push(`        return $this;`);
      lines.push(`    }`);
      lines.push(``);
    }
  }
  return lines.join('\n');
}
