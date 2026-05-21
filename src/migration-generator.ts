import fs from "node:fs";
import path from "node:path";
import { parsePhpClasses } from "./php-class-parser.js";

function mapTypeToSql(type?: string): string {
  if (!type) return 'VARCHAR(255)';
  const t = type.toLowerCase();
  if (t.includes('int')) return 'INT';
  if (t.includes('bool')) return 'BOOLEAN';
  if (t.includes('float') || t.includes('double') || t.includes('decimal')) return 'DOUBLE';
  if (t.includes('datetime') || t.includes('date')) return 'DATETIME';
  return 'VARCHAR(255)';
}

function mapTypeToLaravelColumn(type?: string): string {
  if (!type) return 'string';
  const t = type.toLowerCase();
  if (t.includes('int')) return 'integer';
  if (t.includes('bool')) return 'boolean';
  if (t.includes('float') || t.includes('double') || t.includes('decimal')) return 'double';
  if (t.includes('datetime') || t.includes('date')) return 'dateTime';
  return 'string';
}

export function generateLaravelMigrationFromClasses(sourcePath: string, outDir: string, tablePrefix = ''): string[] {
  const parsed = parsePhpClasses(sourcePath);
  const generated: string[] = [];
  for (const cls of parsed) {
    const className = cls.class.split('\\').pop() || 'Generated';
    const tableName = (tablePrefix + className).toLowerCase();
    const fkLines: string[] = [];
      const indexLines: string[] = [];
    const migration = `<?php
use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('${tableName}', function (Blueprint $table) {
            $table->id();
${cls.properties.filter(p=>p.name!=='id').map(p=>{
      // ManyToOne relation creates FK column
      if (p.relation && p.relation.type && p.relation.type.toLowerCase() === 'manytoone') {
        const target = p.relation.target ? p.relation.target.split('\\').pop().toLowerCase() : p.name.replace(/_id$/, '');
        const jc = p.relation && p.relation.joinColumn ? p.relation.joinColumn : {};
        const colName = jc.name || (p.name.endsWith('_id') ? p.name : `${target}_id`);
        // build fk with optional joinColumn actions
        const referenced = jc.referencedColumnName || 'id';
        let fk = `            $table->foreign('${colName}')->references('${referenced}')->on('${target}s')`;
        if (jc.onDelete) fk += `->onDelete('${jc.onDelete}')`;
        if (jc.onUpdate) fk += `->onUpdate('${jc.onUpdate}')`;
        fk += ';';
        fkLines.push(fk);
        return `            $table->unsignedBigInteger('${colName}');`;
      }

      // if joinColumn options exist, append ->onDelete()/->onUpdate() to foreign key later
      const jc = p.relation && p.relation.joinColumn ? p.relation.joinColumn : null;
      if (jc) {
        let fk = `            $table->foreign('${p.name.endsWith('_id') ? p.name : `${(p.relation.target||p.name).split('\\').pop().toLowerCase()}_id`}')->references('id')->on('${(p.relation.target||p.name).split('\\').pop().toLowerCase()}s')`;
        if (jc.onDelete) fk += `->onDelete('${jc.onDelete}')`;
        if (jc.onUpdate) fk += `->onUpdate('${jc.onUpdate}')`;
        fk += ';';
        fkLines.push(fk);
      }

      // column metadata from php doc / attributes
      const col = p.column || {};
      const colType = (col.type || p.type || 'string').toLowerCase();
      if (colType.includes('int')) {
        let line = `            $table->integer('${p.name}')`;
        if (col.nullable) line += '->nullable()';
        if (col.default !== null && col.default !== undefined) line += `->default(${JSON.stringify(col.default)})`;
        if (col.unique) line += '->unique()';
        line += ';';
        if (col.index) fkLines.push(`            $table->index('${p.name}');`);
        return line;
      }
      if (colType === 'boolean' || colType === 'bool') {
        let line = `            $table->boolean('${p.name}')`;
        if (col.nullable) line += '->nullable()';
        if (col.default !== null && col.default !== undefined) line += `->default(${JSON.stringify(col.default)})`;
        if (col.unique) line += '->unique()';
        line += ';';
        if (col.index) fkLines.push(`            $table->index('${p.name}');`);
        return line;
      }
      if (colType === 'datetime' || colType === 'date') {
        let line = `            $table->dateTime('${p.name}')`;
        if (col.nullable) line += '->nullable()';
        if (col.default !== null && col.default !== undefined) line += `->default(${JSON.stringify(col.default)})`;
        if (col.unique) line += '->unique()';
        line += ';';
        if (col.index) fkLines.push(`            $table->index('${p.name}');`);
        return line;
      }
      // string / text / default
      const length = col.length ? `, ${col.length}` : '';
      let line = `            $table->string('${p.name}'${length})`;
      if (col.nullable) line += '->nullable()';
      if (col.default !== null && col.default !== undefined) line += `->default(${JSON.stringify(col.default)})`;
      if (col.unique) line += '->unique()';
      line += ';';
      if (col.index) fkLines.push(`            $table->index('${p.name}');`);
      return line;
    }).join("\n")}
  ${cls.indexes && cls.indexes.length ? '\n' + cls.indexes.map(idx=>{
      const cols = (idx.columns||[]).map(c=>`'${c}'`).join(', ');
      if (idx.unique) return `            $table->unique([${cols}], '${idx.name || `uniq_${tableName}_${(idx.columns||[]).join('_')}`}');`;
      return `            $table->index([${cols}], '${idx.name || `idx_${tableName}_${(idx.columns||[]).join('_')}`}');`;
    }).join('\n') : ''}
  ${fkLines.join('\n') ? '\n' + fkLines.join('\n') : ''}
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('${tableName}');
    }
};
`;
    const outFile = path.join(outDir, `${Date.now()}_create_${tableName}_table.php`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, migration, 'utf8');
    generated.push(outFile);
    // generate pivot tables for ManyToMany relations
    for (const p of cls.properties) {
      if (p.relation && p.relation.type && p.relation.type.toLowerCase() === 'manytomany') {
      const source = className.toLowerCase();
      const target = p.relation.target ? p.relation.target.split('\\').pop().toLowerCase() : p.name.replace(/s$/, '');
      const pivotOptions = p.relation.pivot || {};
      const extraCols = pivotOptions.columns || [];
      const timestamps = pivotOptions.timestamps !== false; // default true
      // pivot table name: alphabetical join of singulars
      const pivotParts = [source, target].map(s => s.replace(/s$/,''));
      const pivot = pivotParts.slice().sort().join('_');
      const pivotColsDef = [`        $table->unsignedBigInteger('${source}_id');`, `        $table->unsignedBigInteger('${target}_id');`];
      for (const c of extraCols) {
        const len = c.length ? `, ${c.length}` : '';
        const nullable = c.nullable ? '->nullable()' : '';
        const method = mapTypeToLaravelColumn(c.type);
        let line = `        $table->${method}('${c.name}'${len})${nullable}`;
        if (c.default !== undefined) line += `->default(${JSON.stringify(c.default)})`;
        line += ';';
        pivotColsDef.push(line);
      }
      const pivotFKs: string[] = [];
      pivotFKs.push(`        $table->primary(['${source}_id','${target}_id']);`);
      // pivot foreign keys with optional actions
      const pivotOnDelete = pivotOptions.onDelete;
      const pivotOnUpdate = pivotOptions.onUpdate;
      let fk1 = `        $table->foreign('${source}_id')->references('id')->on('${source}s')`;
      let fk2 = `        $table->foreign('${target}_id')->references('id')->on('${target}s')`;
      if (pivotOnDelete) { fk1 += `->onDelete('${pivotOnDelete}')`; fk2 += `->onDelete('${pivotOnDelete}')`; }
      if (pivotOnUpdate) { fk1 += `->onUpdate('${pivotOnUpdate}')`; fk2 += `->onUpdate('${pivotOnUpdate}')`; }
      fk1 += ';'; fk2 += ';';
      pivotFKs.push(fk1, fk2);
      if (timestamps) pivotColsDef.push('        $table->timestamps();');
      const pivotMigration = `<?php
  use Illuminate\Database\Migrations\Migration;
  use Illuminate\Database\Schema\Blueprint;
  use Illuminate\Support\Facades\Schema;

  return new class extends Migration
  {
    public function up(): void
    {
      Schema::create('${pivot}', function (Blueprint $table) {
${pivotColsDef.join('\n')}
${pivotFKs.join('\n')}
      });
    }

    public function down(): void
    {
      Schema::dropIfExists('${pivot}');
    }
  };
  `;
      const outPivot = path.join(outDir, `${Date.now()}_create_${pivot}_pivot_table.php`);
      fs.writeFileSync(outPivot, pivotMigration, 'utf8');
      generated.push(outPivot);
      }
    }
  }
  return generated;
}

export function generateSqlFromClasses(sourcePath: string, outDir: string): string[] {
  const parsed = parsePhpClasses(sourcePath);
  const generated: string[] = [];
  for (const cls of parsed) {
    const className = cls.class.split('\\').pop() || 'Generated';
    const tableName = className.toLowerCase();
    const cols: string[] = ['id INT AUTO_INCREMENT PRIMARY KEY'];
    const fks: string[] = [];
    const indexes: string[] = [];
    for (const p of cls.properties) {
      if (p.name === 'id') continue;
      if (p.relation && p.relation.type && p.relation.type.toLowerCase() === 'manytoone') {
        const target = p.relation.target ? p.relation.target.split('\\').pop().toLowerCase() : p.name.replace(/_id$/, '');
        const colName = p.name.endsWith('_id') ? p.name : `${target}_id`;
        cols.push(`${colName} INT`);
        // support joinColumn options if present
        const jc = p.relation.joinColumn || {};
        let fkSql = `ALTER TABLE ${tableName} ADD CONSTRAINT fk_${tableName}_${colName} FOREIGN KEY (${colName}) REFERENCES ${target}s(id)`;
        if (jc.onDelete) fkSql += ` ON DELETE ${jc.onDelete.toUpperCase()}`;
        if (jc.onUpdate) fkSql += ` ON UPDATE ${jc.onUpdate.toUpperCase()}`;
        fkSql += ';';
        fks.push(fkSql);
        continue;
      }
      const col = p.column || {};
      const colType = (col.type || p.type || 'string').toLowerCase();
      const nullable = col.nullable ? 'NULL' : 'NOT NULL';
      const defaultVal = (col.default !== null && col.default !== undefined) ? ` DEFAULT '${col.default}'` : '';
      const sqlType = mapTypeToSql(col.type || p.type);
      cols.push(`${p.name} ${sqlType} ${nullable}${defaultVal}`);
      if (col.index) indexes.push(`CREATE INDEX idx_${tableName}_${p.name} ON ${tableName}(${p.name});`);
      if (col.unique) indexes.push(`CREATE UNIQUE INDEX uniq_${tableName}_${p.name} ON ${tableName}(${p.name});`);
    }
    // class-level composite indexes
    const classIndexes = cls.indexes || [];
    for (const idx of classIndexes) {
      const colsList = (idx.columns || []).join(', ');
      if (idx.unique) {
        indexes.push(`CREATE UNIQUE INDEX ${idx.name || `uniq_${tableName}_${(idx.columns||[]).join('_')}`} ON ${tableName}(${colsList});`);
      } else {
        indexes.push(`CREATE INDEX ${idx.name || `idx_${tableName}_${(idx.columns||[]).join('_')}`} ON ${tableName}(${colsList});`);
      }
    }

    const sql = `CREATE TABLE ${tableName} (${cols.join(', ')});\n${fks.join('\n')}\n${indexes.join('\n')}`;
    const outFile = path.join(outDir, `${tableName}.sql`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, sql, 'utf8');
    generated.push(outFile);
    // pivot tables for many-to-many
    for (const p of cls.properties) {
      if (p.relation && p.relation.type && p.relation.type.toLowerCase() === 'manytomany') {
        const source = className.toLowerCase();
        const target = p.relation.target ? p.relation.target.split('\\').pop().toLowerCase() : p.name.replace(/s$/, '');
        const pivot = [source, target].sort().join('_');
        const pivotSql = `CREATE TABLE ${pivot} (${source}_id INT, ${target}_id INT, FOREIGN KEY (${source}_id) REFERENCES ${source}s(id), FOREIGN KEY (${target}_id) REFERENCES ${target}s(id));`;
        const outPivot = path.join(outDir, `${pivot}.sql`);
        fs.writeFileSync(outPivot, pivotSql, 'utf8');
        generated.push(outPivot);
      }
    }
  }
  return generated;
}
