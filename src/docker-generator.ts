import fs from "node:fs";
import path from "node:path";
import type { SupportedFramework } from "./types.js";
import { ensureDir } from "./utils.js";

export interface DockerGenerateResult {
  files: string[];
}

export function generateDockerFiles(
  framework: SupportedFramework,
  outPath: string,
): DockerGenerateResult {
  ensureDir(outPath);
  const files: string[] = [];

  const dockerfile = framework === "laravel" ? laravelDockerfile() : symfonyDockerfile();
  const compose = framework === "laravel" ? laravelCompose() : symfonyCompose();
  const ignore = dockerignore(framework);

  const write = (name: string, content: string) => {
    const p = path.join(outPath, name);
    fs.writeFileSync(p, content, "utf8");
    files.push(p);
  };

  write("Dockerfile", dockerfile);
  write("docker-compose.yml", compose);
  write(".dockerignore", ignore);

  return { files };
}

// ─── Laravel ─────────────────────────────────────────────────────────────────

function laravelDockerfile(): string {
  return `FROM php:8.2-cli AS base

RUN apt-get update && apt-get install -y \\
        git curl unzip libpng-dev libonig-dev libxml2-dev libzip-dev \\
    && docker-php-ext-install pdo pdo_mysql mbstring exif pcntl bcmath gd zip \\
    && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html

COPY composer.json composer.lock ./
RUN composer install --no-scripts --no-interaction --prefer-dist

COPY . .

RUN php artisan key:generate --no-interaction \\
    && php artisan config:cache \\
    && php artisan route:cache \\
    && php artisan view:cache

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
`;
}

function laravelCompose(): string {
  return `services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "8000:8000"
    env_file: .env
    environment:
      DB_HOST: db
      DB_PORT: 3306
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - storage_data:/var/www/html/storage/app

  db:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: \${DB_DATABASE:-laravel}
      MYSQL_USER: \${DB_USERNAME:-laravel}
      MYSQL_PASSWORD: \${DB_PASSWORD:-secret}
      MYSQL_ROOT_PASSWORD: root_secret
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  mysql_data:
  storage_data:
`;
}

// ─── Symfony ─────────────────────────────────────────────────────────────────

function symfonyDockerfile(): string {
  return `FROM php:8.2-cli AS base

RUN apt-get update && apt-get install -y \\
        git curl unzip libpq-dev libpng-dev libonig-dev libxml2-dev libzip-dev \\
    && docker-php-ext-install pdo pdo_pgsql pdo_mysql mbstring zip \\
    && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html

COPY composer.json composer.lock ./
RUN composer install --no-scripts --no-interaction --prefer-dist

COPY . .

RUN php bin/console cache:warmup --env=prod --no-debug

EXPOSE 8000

CMD ["php", "-S", "0.0.0.0:8000", "-t", "public"]
`;
}

function symfonyCompose(): string {
  return `services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      APP_ENV: prod
      APP_SECRET: \${APP_SECRET:-change_me_in_production}
      DATABASE_URL: postgresql://symfony:secret@db:5432/symfony?serverVersion=15&charset=utf8
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:15
    restart: unless-stopped
    environment:
      POSTGRES_DB: symfony
      POSTGRES_USER: symfony
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U symfony"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres_data:
`;
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function dockerignore(framework: SupportedFramework): string {
  const common = `.git
.github
node_modules
*.log
.env.local
.env.*.local
`;
  const laravelExtra = `bootstrap/cache
storage/logs
public/hot
`;
  const symfonyExtra = `var/cache
var/log
var/sessions
`;
  return common + (framework === "laravel" ? laravelExtra : symfonyExtra);
}
