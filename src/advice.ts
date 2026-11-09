import type { AdviceKey } from './types.js';

const ADVICE: Record<AdviceKey, string[]> = {
  'rotate-db-password': [
    'ROTATE the database password at the server now; deleting the file does not un-leak it.',
    'Remove the literal from the agent rule: use a prefix rule like Bash(psql:*) and pass the password via an environment variable or secret store.',
    'If it was committed or pushed, purge history with git filter-repo --path <file> --invert-paths (or BFG) and force-push; forks, clones and caches keep old copies, so rotation is the real fix.',
  ],
  'rotate-api-key': [
    'ROTATE the API key at the provider now; deleting the file does not un-leak it.',
    'Remove the literal from the agent settings or config and load it from an environment variable or secret store.',
    'If it was committed or pushed, purge history with git filter-repo --path <file> --invert-paths (or BFG) and force-push; forks, clones and caches keep old copies, so rotation is the real fix.',
  ],
  'rotate-cloud-key': [
    'ROTATE/deactivate the cloud access key in the provider console now; deleting the file does not un-leak it.',
    'Remove the literal from the agent settings or config and use short-lived credentials or a secret store.',
    'If it was committed or pushed, purge history with git filter-repo --path <file> --invert-paths (or BFG) and force-push; rotation is the real fix.',
  ],
  'rotate-private-key': [
    'ROTATE the key pair now: generate a new key, deploy the public half, and revoke the old one.',
    'Remove the private key material from the file and keep it only in a dedicated key store.',
    'If it was committed or pushed, purge history and force-push, but assume the old key is compromised.',
  ],
  'rotate-generic': [
    'ROTATE the credential at the provider now; deleting the file does not un-leak it.',
    'Remove the literal from the agent settings, command, or transcript source and use an environment variable or secret store.',
    'If it was committed or pushed, purge history with git filter-repo --path <file> --invert-paths (or BFG) and force-push; rotation is the real fix.',
  ],
  'rotate-webhook': [
    'REVOKE and recreate the webhook URL now; deleting the file does not un-leak it.',
    'Remove the literal from the agent settings or config and load it from an environment variable or secret store.',
    'If it was committed or pushed, purge history with git filter-repo --path <file> --invert-paths (or BFG) and force-push.',
  ],
};

export function adviceText(key: AdviceKey): string[] {
  return ADVICE[key];
}
