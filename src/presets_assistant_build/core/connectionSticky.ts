import type { ConnectionSnapshot } from '../types';

function slashQuote(input: string): string {
  return `"${input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function runSlashSafe(command: string): Promise<string> {
  try {
    const result = await triggerSlash(command);
    return typeof result === 'string' ? result.trim() : '';
  } catch (error) {
    console.warn('[PresetAssistant] slash failed:', command, error);
    return '';
  }
}

export async function captureCurrentConnectionSnapshot(): Promise<ConnectionSnapshot> {
  const [api_source, profile_name, model_name, api_url] = await Promise.all([
    runSlashSafe('/api quiet=true'),
    runSlashSafe('/profile'),
    runSlashSafe('/model quiet=true'),
    runSlashSafe('/api-url connect=false quiet=true'),
  ]);

  return {
    api_source,
    profile_name,
    model_name,
    api_url,
  };
}

export async function applyConnectionSnapshot(snapshot: ConnectionSnapshot): Promise<void> {
  const tasks: Array<() => Promise<void>> = [];

  if (snapshot.api_source) {
    tasks.push(async () => {
      await runSlashSafe(`/api quiet=true ${slashQuote(snapshot.api_source)}`);
    });
  }
  if (snapshot.profile_name) {
    tasks.push(async () => {
      await runSlashSafe(`/profile ${slashQuote(snapshot.profile_name)}`);
    });
  }
  if (snapshot.model_name) {
    tasks.push(async () => {
      await runSlashSafe(`/model quiet=true ${slashQuote(snapshot.model_name)}`);
    });
  }
  if (snapshot.api_url) {
    tasks.push(async () => {
      await runSlashSafe(`/api-url connect=true ${slashQuote(snapshot.api_url)}`);
    });
  }

  for (const task of tasks) {
    await task();
  }
}
