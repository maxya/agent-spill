#!/usr/bin/env node
import { parseCli, UsageError, USAGE } from './args.js';
import { run } from './run.js';
import { renderText } from './report/text.js';
import { renderJson } from './report/json.js';
import { meetsThreshold } from './grade.js';
import { VERSION } from './version.js';

async function main(): Promise<number> {
  let opts;
  try {
    opts = parseCli(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof UsageError ? err.message : (err as Error).message;
    process.stderr.write(`agent-spill: ${message}\n\n${USAGE}`);
    return 1;
  }

  if (opts.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const result = await run(opts);
  const exitCode = result.findings.some((f) => meetsThreshold(f.grade, opts.failOn))
    ? 2
    : 0;

  if (opts.json) {
    process.stdout.write(renderJson(result, opts.failOn, exitCode) + '\n');
  } else {
    process.stdout.write(renderText(result, opts, exitCode));
  }
  return exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    // No stack trace: it can contain file paths and data. Message only.
    process.stderr.write(`agent-spill: ${(err as Error)?.message ?? String(err)}\n`);
    process.exitCode = 1;
  },
);
