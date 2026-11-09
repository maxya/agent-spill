import type { Rule } from '../types.js';
import { isSecretKeyName, isStructuredValue } from './placeholder.js';

/** Optionally-quoted bare value. Named group `q` + `secret`. */
const V = String.raw`(?<q>['"]?)(?<secret>[^\s'"\\;|&]+)\k<q>`;

export const RULES: Rule[] = [
  // ── command-embedded ───────────────────────────────────────────────
  {
    id: 'pg-password-env',
    title: 'PGPASSWORD in command',
    confidence: 'high',
    advice: 'rotate-db-password',
    re: new RegExp(String.raw`\bPGPASSWORD=${V}`, 'g'),
  },
  {
    id: 'mysql-pwd-env',
    title: 'MYSQL_PWD in command',
    confidence: 'high',
    advice: 'rotate-db-password',
    re: new RegExp(String.raw`\bMYSQL_PWD=${V}`, 'g'),
  },
  {
    id: 'mysql-p-flag',
    title: 'mysql -p<password>',
    confidence: 'high',
    advice: 'rotate-db-password',
    // -p attached only; "-p " prompts for a password and must not match.
    re: new RegExp(
      String.raw`\b(?:mysql|mysqldump|mariadb|mysqladmin|mariadb-dump)\b[^\n;|&]*?\s-p${V}`,
      'g',
    ),
  },
  {
    id: 'sshpass-p',
    title: 'sshpass -p',
    confidence: 'high',
    advice: 'rotate-db-password',
    re: new RegExp(String.raw`\bsshpass\s+-p\s*${V}`, 'g'),
  },
  {
    id: 'redis-cli-a',
    title: 'redis-cli -a',
    confidence: 'high',
    advice: 'rotate-db-password',
    re: new RegExp(
      String.raw`\bredis-cli\b[^\n;|&]*?\s(?:-a|--pass)\s+${V}`,
      'g',
    ),
  },
  {
    id: 'password-flag',
    title: '--password flag',
    confidence: 'medium',
    advice: 'rotate-generic',
    re: new RegExp(
      String.raw`--(?:password|passwd|db-password|admin-password)(?:=|\s+)${V}`,
      'g',
    ),
  },
  {
    id: 'curl-user',
    title: 'curl -u user:password',
    confidence: 'high',
    advice: 'rotate-generic',
    re: /\bcurl\b[^\n;|&]*?\s(?:-u|--user)\s+(?<q>['"]?)[^\s:'"]+:(?<secret>[^\s'"\\]+)\k<q>/g,
  },
  {
    id: 'auth-header',
    title: 'Authorization header',
    confidence: 'high',
    advice: 'rotate-api-key',
    re: /Authorization:\s*(?:Bearer|Basic|Token)\s+(?<secret>[A-Za-z0-9._~+\/=-]{12,})/gi,
  },
  {
    id: 'api-key-header',
    title: 'API key header',
    confidence: 'high',
    advice: 'rotate-api-key',
    re: /\b(?:x-api-key|api-key|x-auth-token|private-token|apikey)\s*:\s*(?<secret>[A-Za-z0-9._~+\/=-]{12,})/gi,
  },
  {
    id: 'url-credentials',
    title: 'Credentials in URL',
    confidence: 'high',
    advice: 'rotate-db-password',
    re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@\/'"]+:(?<secret>[^\s@\/'"]{3,})@[^\s'"]+/gi,
  },

  // ── known formats ──────────────────────────────────────────────────
  {
    id: 'anthropic-key',
    title: 'Anthropic API key',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'sk-ant-',
    re: /\b(?<secret>sk-ant-[a-z0-9]{2,10}-[A-Za-z0-9_-]{40,})/g,
  },
  {
    id: 'openai-key',
    title: 'OpenAI API key',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'sk-',
    re: /\b(?<secret>sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})/g,
  },
  {
    id: 'github-pat',
    title: 'GitHub token',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'gh',
    re: /\b(?<secret>gh[pousr]_[A-Za-z0-9]{36,})\b/g,
  },
  {
    id: 'github-fine-grained',
    title: 'GitHub fine-grained PAT',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'github_pat_',
    re: /\b(?<secret>github_pat_[A-Za-z0-9_]{60,})\b/g,
  },
  {
    id: 'aws-access-key-id',
    title: 'AWS access key ID',
    confidence: 'high',
    advice: 'rotate-cloud-key',
    vendorPrefix: 'AKIA',
    re: /\b(?<secret>(?:AKIA|ASIA)[A-Z0-9]{16})\b/g,
  },
  {
    id: 'aws-secret-key',
    title: 'AWS secret access key',
    confidence: 'high',
    advice: 'rotate-cloud-key',
    re: /aws_secret_access_key\s*[=:]\s*(?<q>['"]?)(?<secret>[A-Za-z0-9\/+=]{40})\k<q>/gi,
  },
  {
    id: 'stripe-key',
    title: 'Stripe secret key',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'sk_',
    re: /\b(?<secret>(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,})\b/g,
  },
  {
    id: 'slack-token',
    title: 'Slack token',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'xox',
    re: /\b(?<secret>xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  },
  {
    id: 'slack-webhook',
    title: 'Slack webhook',
    confidence: 'high',
    advice: 'rotate-webhook',
    // Fixed host/path prefix is public; only the T…/B…/token part is secret.
    vendorPrefix: 'https://hooks.slack.com/services/',
    re: /(?<secret>https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+)/g,
  },
  {
    id: 'google-api-key',
    title: 'Google API key',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'AIza',
    re: /\b(?<secret>AIza[0-9A-Za-z_-]{35})\b/g,
  },
  {
    id: 'gitlab-pat',
    title: 'GitLab PAT',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'glpat-',
    re: /\b(?<secret>glpat-[A-Za-z0-9_-]{20,})\b/g,
  },
  {
    id: 'npm-token',
    title: 'npm token',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'npm_',
    re: /\b(?<secret>npm_[A-Za-z0-9]{36})\b/g,
  },
  {
    id: 'huggingface-token',
    title: 'Hugging Face token',
    confidence: 'high',
    advice: 'rotate-api-key',
    vendorPrefix: 'hf_',
    re: /\b(?<secret>hf_[A-Za-z0-9]{34,})\b/g,
  },
  {
    id: 'private-key-block',
    title: 'Private key block',
    confidence: 'high',
    advice: 'rotate-private-key',
    re: /(?<secret>-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/g,
  },
  {
    id: 'jwt',
    title: 'JWT',
    confidence: 'medium',
    advice: 'rotate-api-key',
    vendorPrefix: 'eyJ',
    re: /\b(?<secret>eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    validate: (s) => {
      try {
        const payload = JSON.parse(
          Buffer.from(s.split('.')[1]!, 'base64url').toString('utf8'),
        );
        if (payload?.role === 'anon') return null; // Supabase anon key: public by design
        if (payload?.role === 'service_role') return 'high'; // full DB access
        return 'medium';
      } catch {
        return null;
      }
    },
  },

  // ── generic (C9) ───────────────────────────────────────────────────
  {
    id: 'secret-named-assignment',
    title: 'Secret-named assignment',
    confidence: 'medium',
    advice: 'rotate-generic',
    generic: true,
    prefilter: /TOKEN|SECRET|PASSWORD|PASSWD|PWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|AUTHORIZATION/i,
    validate: (secret, m) =>
      isSecretKeyName(m.groups?.key ?? '') && !isStructuredValue(secret)
        ? 'medium'
        : null,
    re: /\b(?<key>[A-Za-z0-9_.-]{0,64}(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|AUTHORIZATION)[A-Za-z0-9_.-]{0,64})\s*[=:]\s*(?<q>['"]?)(?<secret>[^\s'"\\;|&]{8,})\k<q>/gi,
  },
];
