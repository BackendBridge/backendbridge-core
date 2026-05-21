import fs from "node:fs";
import path from "node:path";
import type { ApiContract, SchemaProperty } from "./types.js";
import { toStudly, ensureDir } from "./utils.js";

// ─── Faker helpers ────────────────────────────────────────────────────────────

function fakerForField(name: string, prop: SchemaProperty): string {
  const n = name.toLowerCase();

  // Name-based inference first
  if (/^(email|mail)$/.test(n)) return "fake()->unique()->safeEmail()";
  if (/password|secret/.test(n)) return "fake()->password(12)";
  if (/(first_?name|firstname|given_?name)/.test(n)) return "fake()->firstName()";
  if (/(last_?name|lastname|surname|family_?name)/.test(n)) return "fake()->lastName()";
  if (/^name$|full_?name/.test(n)) return "fake()->name()";
  if (/phone|mobile|tel/.test(n)) return "fake()->phoneNumber()";
  if (/address|street/.test(n)) return "fake()->streetAddress()";
  if (/city/.test(n)) return "fake()->city()";
  if (/country/.test(n)) return "fake()->country()";
  if (/zip|postal/.test(n)) return "fake()->postcode()";
  if (/url|website|link/.test(n)) return "fake()->url()";
  if (/slug/.test(n)) return "fake()->slug()";
  if (/title/.test(n)) return "fake()->sentence(3)";
  if (/description|content|body|text|bio/.test(n)) return "fake()->paragraph()";
  if (/avatar|photo|image|picture|thumbnail/.test(n)) return "fake()->imageUrl()";
  if (/price|amount|cost|salary/.test(n)) return "fake()->randomFloat(2, 1, 9999)";
  if (/quantity|count|stock/.test(n)) return "fake()->numberBetween(0, 100)";
  if (/(created|updated|deleted)_at/.test(n)) return "fake()->dateTimeBetween('-1 year', 'now')";
  if (/date|at$/.test(n)) return "fake()->dateTimeBetween('-1 year', 'now')";
  if (/(is_|has_|can_|enabled|active|verified|status)/.test(n)) return "fake()->boolean()";
  if (/color|colour/.test(n)) return "fake()->hexColor()";
  if (/uuid|guid/.test(n)) return "fake()->uuid()";
  if (/ip/.test(n)) return "fake()->ipv4()";
  if (/token|key|secret/.test(n)) return "fake()->sha256()";

  // Format-based inference
  if (prop.format === "email") return "fake()->unique()->safeEmail()";
  if (prop.format === "uri") return "fake()->url()";
  if (prop.format === "uuid") return "fake()->uuid()";
  if (prop.format === "date") return "fake()->date()";
  if (prop.format === "date-time") return "fake()->dateTime()->format('Y-m-d H:i:s')";
  if (prop.format === "binary") return "null // file upload — handle separately";

  // Type-based fallback
  if (prop.type === "integer") return prop.enum?.length ? `fake()->randomElement([${prop.enum.map((e) => `'${e}'`).join(", ")}])` : "fake()->randomNumber()";
  if (prop.type === "number") return "fake()->randomFloat(2)";
  if (prop.type === "boolean") return "fake()->boolean()";
  if (prop.type === "array") return "[]";
  if (prop.enum?.length) return `fake()->randomElement([${prop.enum.map((e) => `'${e}'`).join(", ")}])`;

  return "fake()->word()";
}

function symfonyFakerForField(name: string, prop: SchemaProperty): string {
  const n = name.toLowerCase();
  if (/^(email|mail)$/.test(n)) return "$faker->unique()->safeEmail()";
  if (/password|secret/.test(n)) return "$faker->password(12)";
  if (/(first_?name|firstname)/.test(n)) return "$faker->firstName()";
  if (/(last_?name|lastname|surname)/.test(n)) return "$faker->lastName()";
  if (/^name$|full_?name/.test(n)) return "$faker->name()";
  if (/phone|mobile|tel/.test(n)) return "$faker->phoneNumber()";
  if (/address|street/.test(n)) return "$faker->streetAddress()";
  if (/city/.test(n)) return "$faker->city()";
  if (/url|website/.test(n)) return "$faker->url()";
  if (/title/.test(n)) return "$faker->sentence(3)";
  if (/description|content|body|text/.test(n)) return "$faker->paragraph()";
  if (/price|amount|cost/.test(n)) return "(string) $faker->randomFloat(2, 1, 9999)";
  if (/(is_|has_|enabled|active|verified)/.test(n)) return "$faker->boolean()";
  if (/uuid/.test(n)) return "$faker->uuid()";
  if (prop.format === "email") return "$faker->unique()->safeEmail()";
  if (prop.format === "uri") return "$faker->url()";
  if (prop.format === "uuid") return "$faker->uuid()";
  if (prop.format === "date") return "$faker->date()";
  if (prop.format === "binary") return "null // file upload";
  if (prop.type === "integer") return "$faker->randomNumber()";
  if (prop.type === "number") return "(string) $faker->randomFloat(2)";
  if (prop.type === "boolean") return "$faker->boolean()";
  if (prop.enum?.length) return `$faker->randomElement([${prop.enum.map((e) => `'${e}'`).join(", ")}])`;
  return "$faker->word()";
}

// ─── Resource inference from contract ────────────────────────────────────────

interface Resource {
  name: string;           // singular StudlyCase, e.g. User
  fields: Record<string, SchemaProperty>;
  required: string[];
}

function inferResources(contract: ApiContract): Resource[] {
  const map = new Map<string, Resource>();

  for (const endpoint of contract.endpoints) {
    if (!endpoint.requestBodySchema) continue;
    const tag = endpoint.tags[0];
    if (!tag) continue;
    const name = toStudly(tag.replace(/s$/, "")); // users → User
    if (!map.has(name)) {
      map.set(name, { name, fields: {}, required: [] });
    }
    const res = map.get(name)!;
    Object.assign(res.fields, endpoint.requestBodySchema.properties);
    for (const r of endpoint.requestBodySchema.required ?? []) {
      if (!res.required.includes(r)) res.required.push(r);
    }
  }

  return [...map.values()];
}

// ─── Laravel factories ────────────────────────────────────────────────────────

function laravelFactory(res: Resource): string {
  const lines = Object.entries(res.fields)
    .filter(([, p]) => p.format !== "binary" && !(p.type === "array" && p.items?.format === "binary"))
    .map(([field, prop]) => `            '${field}' => ${fakerForField(field, prop)},`);

  return `<?php

namespace Database\\Factories;

use App\\Models\\${res.name};
use Illuminate\\Database\\Eloquent\\Factories\\Factory;

/**
 * @extends Factory<${res.name}>
 */
class ${res.name}Factory extends Factory
{
    protected $model = ${res.name}::class;

    public function definition(): array
    {
        return [
${lines.join("\n")}
        ];
    }
}
`;
}

// ─── Laravel seeders ─────────────────────────────────────────────────────────

function laravelSeeder(res: Resource): string {
  return `<?php

namespace Database\\Seeders;

use App\\Models\\${res.name};
use Illuminate\\Database\\Seeder;

class ${res.name}Seeder extends Seeder
{
    public function run(): void
    {
        ${res.name}::factory()->count(10)->create();
    }
}
`;
}

function laravelDatabaseSeeder(resources: Resource[]): string {
  const calls = resources.map((r) => `            $this->call(${r.name}Seeder::class);`).join("\n");
  return `<?php

namespace Database\\Seeders;

use Illuminate\\Database\\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
${calls}
    }
}
`;
}

// ─── Symfony Fixtures ─────────────────────────────────────────────────────────

function symfonyFixture(res: Resource): string {
  const setters = Object.entries(res.fields)
    .filter(([, p]) => p.format !== "binary")
    .map(([field, prop]) => {
      const setter = "set" + field.charAt(0).toUpperCase() + field.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      return `            $entity->${setter}(${symfonyFakerForField(field, prop)});`;
    });

  return `<?php

namespace App\\DataFixtures;

use App\\Entity\\${res.name};
use Doctrine\\Bundle\\FixturesBundle\\Fixture;
use Doctrine\\Persistence\\ObjectManager;
use Faker\\Factory;

class ${res.name}Fixtures extends Fixture
{
    public function load(ObjectManager $manager): void
    {
        $faker = Factory::create();

        for ($i = 0; $i < 10; $i++) {
            $entity = new ${res.name}();
${setters.join("\n")}
            $manager->persist($entity);
        }

        $manager->flush();
    }
}
`;
}

function symfonyAppFixtures(resources: Resource[]): string {
  const uses = resources.map((r) => `use App\\DataFixtures\\${r.name}Fixtures;`).join("\n");
  const loads = resources.map((r) => `        $this->container->get(${r.name}Fixtures::class)->load($manager);`).join("\n");
  return `<?php

namespace App\\DataFixtures;

${uses}
use Doctrine\\Bundle\\FixturesBundle\\Fixture;
use Doctrine\\Persistence\\ObjectManager;

class AppFixtures extends Fixture
{
    public function load(ObjectManager $manager): void
    {
        // Load each fixture class
${loads}
    }
}
`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateLaravelSeedersAndFactories(
  contract: ApiContract,
  outPath: string,
): string[] {
  const resources = inferResources(contract);
  if (!resources.length) return [];

  const factoriesDir = path.join(outPath, "database", "factories");
  const seedersDir = path.join(outPath, "database", "seeders");
  ensureDir(factoriesDir);
  ensureDir(seedersDir);

  const files: string[] = [];

  for (const res of resources) {
    const fp = path.join(factoriesDir, `${res.name}Factory.php`);
    fs.writeFileSync(fp, laravelFactory(res), "utf8");
    files.push(fp);

    const sp = path.join(seedersDir, `${res.name}Seeder.php`);
    fs.writeFileSync(sp, laravelSeeder(res), "utf8");
    files.push(sp);
  }

  const dbSp = path.join(seedersDir, "DatabaseSeeder.php");
  fs.writeFileSync(dbSp, laravelDatabaseSeeder(resources), "utf8");
  files.push(dbSp);

  return files;
}

export function generateSymfonyFixtures(
  contract: ApiContract,
  outPath: string,
): string[] {
  const resources = inferResources(contract);
  if (!resources.length) return [];

  const fixturesDir = path.join(outPath, "src", "DataFixtures");
  ensureDir(fixturesDir);

  const files: string[] = [];

  for (const res of resources) {
    const fp = path.join(fixturesDir, `${res.name}Fixtures.php`);
    fs.writeFileSync(fp, symfonyFixture(res), "utf8");
    files.push(fp);
  }

  const app = path.join(fixturesDir, "AppFixtures.php");
  fs.writeFileSync(app, symfonyAppFixtures(resources), "utf8");
  files.push(app);

  return files;
}
