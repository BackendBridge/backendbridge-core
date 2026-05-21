import fs from 'node:fs';
import path from 'node:path';
import { loadMappingFile } from './mapping.js';

export async function runMappingEditor(mappingPath: string): Promise<void> {
  const { prompt } = await import('enquirer');
  const abs = path.resolve(mappingPath);
  if (!fs.existsSync(abs)) throw new Error(`Mapping file not found: ${abs}`);
  const mapping = loadMappingFile(abs);

  const keys = Object.keys(mapping.rules ?? {});
  const choices = keys.slice(0, 100).map((k) => ({ name: k, message: k }));
  choices.push({ name: '__save__', message: 'Save & Exit' });
  choices.push({ name: '__quit__', message: 'Quit without saving' });

  while (true) {
    const sel = await prompt([
      {
        type: 'select',
        name: 'choice',
        message: 'Select rule to edit',
        choices,
      },
    ]) as { choice: string };

    const choice = sel.choice;
    if (choice === '__quit__') return;
    if (choice === '__save__') {
      fs.writeFileSync(abs, JSON.stringify(mapping, null, 2) + '\n', 'utf8');
      console.log(`Saved ${abs}`);
      return;
    }

    const rule = mapping.rules[choice];
    console.log(`Editing: ${choice}`);
    const edits = await prompt([
      {
        type: 'input',
        name: 'dto',
        message: 'DTO (path or class) [empty to keep]',
        initial: rule.dto ?? '',
      },
      {
        type: 'input',
        name: 'notes',
        message: 'Notes',
        initial: rule.notes ?? '',
      },
    ]) as { dto: string; notes: string };

    if (edits.dto !== undefined) rule.dto = edits.dto || undefined;
    if (edits.notes !== undefined) rule.notes = edits.notes || undefined;
    mapping.rules[choice] = rule;
    console.log('Updated.');
  }
}

export default runMappingEditor;
