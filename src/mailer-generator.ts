import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./utils.js";

// ─── Laravel ─────────────────────────────────────────────────────────────────

function laravelEnvMailBlock(): string {
  return `
# ── Mail configuration ──────────────────────────────────────────────────────
MAIL_MAILER=smtp
MAIL_HOST=smtp.mailtrap.io
MAIL_PORT=2525
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS="hello@example.com"
MAIL_FROM_NAME="\${APP_NAME}"
# For Mailgun: MAIL_MAILER=mailgun + services.php config
# For SES: MAIL_MAILER=ses
# For Postmark: MAIL_MAILER=postmark
`;
}

function laravelWelcomeMailable(): string {
  return `<?php

namespace App\\Mail;

use Illuminate\\Bus\\Queueable;
use Illuminate\\Contracts\\Queue\\ShouldQueue;
use Illuminate\\Mail\\Mailable;
use Illuminate\\Mail\\Mailables\\Content;
use Illuminate\\Mail\\Mailables\\Envelope;
use Illuminate\\Queue\\SerializesModels;

class WelcomeMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $userName,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Welcome to ' . config('app.name'),
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.welcome',
            with: ['userName' => $this->userName],
        );
    }
}
`;
}

function laravelPasswordResetMailable(): string {
  return `<?php

namespace App\\Mail;

use Illuminate\\Bus\\Queueable;
use Illuminate\\Contracts\\Queue\\ShouldQueue;
use Illuminate\\Mail\\Mailable;
use Illuminate\\Mail\\Mailables\\Content;
use Illuminate\\Mail\\Mailables\\Envelope;
use Illuminate\\Queue\\SerializesModels;

class PasswordResetMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $resetUrl,
        public readonly string $userName = '',
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Reset Your Password');
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.password-reset',
            with: ['resetUrl' => $this->resetUrl, 'userName' => $this->userName],
        );
    }
}
`;
}

function laravelMailUsageHint(): string {
  return `<?php

// ─── How to send mail in Laravel ─────────────────────────────────────────────
//
// In a controller or job:
//   use App\\Mail\\WelcomeMail;
//   use Illuminate\\Support\\Facades\\Mail;
//
//   Mail::to($user->email)->send(new WelcomeMail($user->name));
//   Mail::to($user->email)->queue(new WelcomeMail($user->name)); // queued
//
// Password reset:
//   Mail::to($user->email)->send(new PasswordResetMail($resetUrl, $user->name));
//
// Notification (alternative):
//   $user->notify(new \\App\\Notifications\\WelcomeNotification());
`;
}

// ─── Symfony ─────────────────────────────────────────────────────────────────

function symfonyMailerEnv(): string {
  return `# .env additions for Symfony Mailer
# Requires: composer require symfony/mailer

# SMTP (mailtrap for dev):
MAILER_DSN=smtp://user:pass@sandbox.smtp.mailtrap.io:2525

# Gmail:
# MAILER_DSN=gmail://USER:PASSWORD@default
# Sendgrid:
# MAILER_DSN=sendgrid://KEY@default
# Mailgun:
# MAILER_DSN=mailgun://KEY:DOMAIN@default
# Amazon SES:
# MAILER_DSN=ses://ACCESS_KEY:SECRET_KEY@default?region=eu-west-1
`;
}

function symfonyMailerConfig(): string {
  return `# config/packages/mailer.yaml
framework:
    mailer:
        dsn: '%env(MAILER_DSN)%'
        envelope:
            sender: 'noreply@example.com'
`;
}

function symfonyWelcomeEmail(): string {
  return `<?php

namespace App\\Mailer;

use Symfony\\Bridge\\Twig\\Mime\\TemplatedEmail;
use Symfony\\Component\\Mailer\\MailerInterface;
use Symfony\\Component\\Mime\\Address;

/**
 * Usage in a controller or service:
 *   $this->welcomeMailer->sendWelcome($user->getEmail(), $user->getName());
 */
class WelcomeMailer
{
    public function __construct(
        private readonly MailerInterface $mailer,
    ) {}

    public function sendWelcome(string $toEmail, string $userName): void
    {
        $email = (new TemplatedEmail())
            ->from(new Address('noreply@example.com', config('APP_NAME') ?? 'App'))
            ->to(new Address($toEmail))
            ->subject('Welcome!')
            ->htmlTemplate('emails/welcome.html.twig')
            ->context(['userName' => $userName]);

        $this->mailer->send($email);
    }
}
`;
}

function symfonyPasswordResetEmail(): string {
  return `<?php

namespace App\\Mailer;

use Symfony\\Bridge\\Twig\\Mime\\TemplatedEmail;
use Symfony\\Component\\Mailer\\MailerInterface;
use Symfony\\Component\\Mime\\Address;

class PasswordResetMailer
{
    public function __construct(
        private readonly MailerInterface $mailer,
    ) {}

    public function sendReset(string $toEmail, string $resetUrl): void
    {
        $email = (new TemplatedEmail())
            ->from(new Address('noreply@example.com', 'Security'))
            ->to(new Address($toEmail))
            ->subject('Reset Your Password')
            ->htmlTemplate('emails/password_reset.html.twig')
            ->context(['resetUrl' => $resetUrl]);

        $this->mailer->send($email);
    }
}
`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateLaravelMailer(outPath: string): string[] {
  const mailDir = path.join(outPath, "app", "Mail");
  ensureDir(mailDir);

  const files: string[] = [];
  const write = (p: string, content: string) => { fs.writeFileSync(p, content, "utf8"); files.push(p); };

  write(path.join(mailDir, "WelcomeMail.php"), laravelWelcomeMailable());
  write(path.join(mailDir, "PasswordResetMail.php"), laravelPasswordResetMailable());
  write(path.join(mailDir, "_mail-usage.php"), laravelMailUsageHint());
  write(path.join(outPath, ".env.mail.example"), laravelEnvMailBlock());

  return files;
}

export function generateSymfonyMailer(outPath: string): string[] {
  const mailerDir = path.join(outPath, "src", "Mailer");
  const configDir = path.join(outPath, "config", "packages");
  ensureDir(mailerDir);
  ensureDir(configDir);

  const files: string[] = [];
  const write = (p: string, content: string) => { fs.writeFileSync(p, content, "utf8"); files.push(p); };

  write(path.join(mailerDir, "WelcomeMailer.php"), symfonyWelcomeEmail());
  write(path.join(mailerDir, "PasswordResetMailer.php"), symfonyPasswordResetEmail());
  write(path.join(configDir, "mailer.yaml"), symfonyMailerConfig());
  write(path.join(outPath, ".env.mailer.example"), symfonyMailerEnv());

  return files;
}
