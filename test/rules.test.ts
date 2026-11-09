import test from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/scan/detect.js';
import { RULES } from '../src/scan/rules.js';
import { fake } from './helpers/fake.js';

interface Case {
  id: string;
  pos: string;
  neg: string;
  secret?: string;
}

const p = fake.password();

const cases: Case[] = [
  // command-embedded
  { id: 'pg-password-env', pos: `PGPASSWORD=${p} psql -h db`, neg: 'PGPASSWORD=$PGPASSWORD psql', secret: p },
  { id: 'mysql-pwd-env', pos: `MYSQL_PWD=${p} mysql`, neg: 'MYSQL_PWD=$MYSQL_PWD mysql', secret: p },
  { id: 'mysql-p-flag', pos: `mysql -uroot -p${p} db`, neg: 'mysql -p mydb', secret: p },
  { id: 'sshpass-p', pos: `sshpass -p ${p} ssh host`, neg: 'sshpass -p $PASS ssh host', secret: p },
  { id: 'redis-cli-a', pos: `redis-cli -a ${p} ping`, neg: 'redis-cli -h localhost ping', secret: p },
  { id: 'password-flag', pos: `tool --password=${p}`, neg: 'tool --password', secret: p },
  { id: 'curl-user', pos: `curl -u admin:${p} https://example.invalid`, neg: 'curl -u admin: https://example.invalid', secret: p },
  { id: 'auth-header', pos: `Authorization: Bearer ${fake.bearer()}`, neg: 'Authorization: Bearer $TOKEN', secret: fake.bearer() },
  { id: 'api-key-header', pos: `x-api-key: ${fake.bearer()}`, neg: 'x-api-key: <key>', secret: fake.bearer() },
  { id: 'url-credentials', pos: `postgres://user:${p}@db.example.invalid/app`, neg: 'postgres://user@db.example.invalid/app', secret: p },

  // known formats
  { id: 'anthropic-key', pos: fake.anthropic(), neg: 'sk-ant-short', secret: fake.anthropic() },
  { id: 'openai-key', pos: fake.openai(), neg: 'sk-short', secret: fake.openai() },
  { id: 'github-pat', pos: fake.github(), neg: 'ghp_short', secret: fake.github() },
  { id: 'github-fine-grained', pos: fake.githubFineGrained(), neg: fake.github(), secret: fake.githubFineGrained() },
  { id: 'aws-access-key-id', pos: fake.aws(), neg: 'AKIA123', secret: fake.aws() },
  { id: 'aws-secret-key', pos: `aws_secret_access_key = ${fake.awsSecret()}`, neg: 'aws_secret_access_key = $AWS_SECRET_ACCESS_KEY', secret: fake.awsSecret() },
  { id: 'stripe-key', pos: fake.stripe(), neg: 'sk_live_short', secret: fake.stripe() },
  { id: 'slack-token', pos: fake.slack(), neg: 'xoxb-short', secret: fake.slack() },
  { id: 'slack-webhook', pos: fake.slackWebhook(), neg: 'https://hooks.slack.com/services/foo', secret: fake.slackWebhook() },
  { id: 'google-api-key', pos: fake.google(), neg: 'AIzaShort', secret: fake.google() },
  { id: 'gitlab-pat', pos: fake.gitlab(), neg: 'glpat-short', secret: fake.gitlab() },
  { id: 'npm-token', pos: fake.npm(), neg: 'npm_short', secret: fake.npm() },
  { id: 'huggingface-token', pos: fake.huggingface(), neg: 'hf_short', secret: fake.huggingface() },
  { id: 'private-key-block', pos: fake.privateKey(), neg: '-----BEGIN CERTIFICATE-----', secret: fake.privateKey() },
  { id: 'jwt', pos: fake.jwt('authenticated'), neg: fake.jwt('anon'), secret: fake.jwt('authenticated') },

  // generic
  { id: 'secret-named-assignment', pos: 'MY_API_TOKEN=QzAbCdEf123456', neg: 'MY_API_TOKEN=$API_TOKEN', secret: 'QzAbCdEf123456' },
];

test('every rule has a positive and negative case', () => {
  const covered = new Set(cases.map((c) => c.id));
  assert.deepEqual(
    RULES.map((r) => r.id).filter((id) => !covered.has(id)),
    [],
    'a rule is missing from the test table',
  );
});

for (const c of cases) {
  test(`rule ${c.id}: positive and negative`, () => {
    const pos = detect(c.pos, 'low').filter((h) => h.rule.id === c.id);
    assert.equal(pos.length, 1, `${c.id} should match ${JSON.stringify(c.pos)}`);
    if (c.secret !== undefined) assert.equal(pos[0]!.secret, c.secret);
    const neg = detect(c.neg, 'low').filter((h) => h.rule.id === c.id);
    assert.equal(neg.length, 0, `${c.id} should not match ${JSON.stringify(c.neg)}`);
  });
}

test('AS-5 specific cases', () => {
  assert.deepEqual(detect('PGPASSWORD=$PGPASSWORD psql', 'low'), []);
  assert.equal(
    detect('mysql -p mydb', 'low').filter((h) => h.rule.id === 'mysql-p-flag').length,
    0,
  );
  assert.equal(
    detect('mysql -uroot -pS3cretPass db', 'low').filter((h) => h.rule.id === 'mysql-p-flag').length,
    1,
  );

  assert.deepEqual(detect(fake.jwt('anon'), 'low'), []);
  const service = detect(fake.jwt('service_role'), 'low').filter((h) => h.rule.id === 'jwt');
  assert.equal(service.length, 1);
  assert.equal(service[0]!.confidence, 'high');

  const anth = fake.anthropic();
  const hits = detect(anth, 'low');
  assert.ok(hits.some((h) => h.rule.id === 'anthropic-key'));
  assert.ok(!hits.some((h) => h.rule.id === 'openai-key'));
});

test('generic assignment is case-insensitive and drops low entropy', () => {
  assert.equal(
    detect('api_key=QzAbCdEf123456', 'low').filter((h) => h.rule.id === 'secret-named-assignment').length,
    1,
  );
  assert.equal(
    detect('MY_API_TOKEN=aaaaaaaaaaaa', 'low').filter((h) => h.rule.id === 'secret-named-assignment').length,
    0,
  );
});

test('generic assignment requires a real secret segment in the key', () => {
  const genericHits = (text: string) =>
    detect(text, 'low').filter((h) => h.rule.id === 'secret-named-assignment').length;

  for (const pos of [
    'COOKIE_SECRET=QzAbCdEf123456',
    'REDIS_PASSWORD=QzAbCdEf123456',
    'BETTER_AUTH_SECRET=QzAbCdEf123456',
    'token=QzAbCdEf123456',
    'myToken=QzAbCdEf123456',
    'client_secret=QzAbCdEf123456',
    'access_key=QzAbCdEf123456',
    'private_key=QzAbCdEf123456',
    'authorization=QzAbCdEf123456',
  ]) {
    assert.equal(genericHits(pos), 1, pos);
  }

  for (const neg of [
    'author=QzAbCdEf123456',
    'authors=QzAbCdEf123456',
    'maximumTokens=QzAbCdEf123456',
    'max_output_tokens=QzAbCdEf123456',
    'PageToken=QzAbCdEf123456',
    'next_page_token=QzAbCdEf123456',
    'token_count=QzAbCdEf123456',
    'token_key_version=QzAbCdEf123456',
    'password.mjs=QzAbCdEf123456',
    'TOKEN=1234567890123456',
    'SECRET=00000000-0000-0000-0000-000000000000',
    'PASSWORD={"a":1}',
    'TOKEN=foo(barBaz123)',
    'ERR_INVALID_PASSWORD=InvalidPassword(12)',
    'ORBIT_WORKER_TOKEN_FILE=/run/secrets/token',
    'client_secret=client_secret',
    'S3_SECRET_KEY=access_token',
    'XSRF_TOKEN_HEADER_NAME=X-XSRF-TOKEN',
    'token_type=BearerToken',
    'secretLikeVars=secretLikeVars',
    'accessToken=h.accessToken',
    'SECRET_FIELDS=access_token,refresh_token',
  ]) {
    assert.equal(genericHits(neg), 0, neg);
  }
});
