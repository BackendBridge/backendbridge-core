import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

interface SymfonyFirewall {
  provider?: string;
  [key: string]: unknown;
}

interface SymfonyEntityProvider {
  entity?: {
    class?: string;
  };
}

interface SymfonySecurity {
  firewalls?: Record<string, SymfonyFirewall>;
  providers?: Record<string, SymfonyEntityProvider | Record<string, unknown>>;
}

function phpArray(obj: Record<string, unknown>, indent = 2): string {
  const pad = ' '.repeat(indent);
  const inner = Object.entries(obj)
    .map(([k, v]) => {
      const val = typeof v === 'object' && v !== null
        ? phpArray(v as Record<string, unknown>, indent + 2)
        : `'${v}'`;
      return `${pad}  '${k}' => ${val}`;
    })
    .join(',\n');
  return `[\n${inner},\n${pad}]`;
}

export function convertSecurityConfig(inputPath: string, outPath: string, from: 'symfony' | 'laravel' = 'symfony'): string {
  const absIn = path.resolve(inputPath);
  if (!fs.existsSync(absIn)) throw new Error(`Input not found: ${absIn}`);
  const content = fs.readFileSync(absIn, 'utf8');

  if (from === 'symfony') {
    const doc = yaml.load(content) as Record<string, unknown>;
    const security = (doc['security'] ?? doc) as SymfonySecurity;

    const guards: Record<string, Record<string, string>> = {};
    const providers: Record<string, Record<string, string>> = {};

    if (security.firewalls) {
      for (const [name, fw] of Object.entries(security.firewalls)) {
        const defaultProvider = Object.keys(security.providers ?? {})[0] ?? 'users';
        guards[name] = { driver: 'session', provider: fw.provider ?? defaultProvider };
      }
    }

    if (security.providers) {
      for (const [k, v] of Object.entries(security.providers)) {
        const provider = v as SymfonyEntityProvider;
        if (provider.entity) {
          const clazz = provider.entity.class ?? 'App\\\\Models\\\\User';
          providers[k] = { driver: 'eloquent', model: clazz };
        } else {
          providers[k] = { driver: 'database', table: 'users' };
        }
      }
    }

    const guardsPhp = phpArray(guards as unknown as Record<string, unknown>);
    const providersPhp = phpArray(providers as unknown as Record<string, unknown>);

    const php = [
      '<?php',
      '',
      'return [',
      `  'guards' => ${guardsPhp},`,
      `  'providers' => ${providersPhp},`,
      `  'passwords' => [`,
      `    'users' => ['provider' => 'users', 'table' => 'password_resets'],`,
      `  ],`,
      '];',
      '',
    ].join('\n');

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, php, 'utf8');
    return outPath;
  }

  throw new Error('Only symfony->laravel conversion implemented in this minimal converter');
}

export default convertSecurityConfig;
