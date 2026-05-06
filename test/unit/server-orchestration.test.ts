import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureWindowsSteamStartup } from '../../packages/steam-mcp/src/server.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';

function createContext(options: {
  enabled: boolean;
  supported: boolean;
  running: boolean;
  startResult?: boolean;
  startThrows?: boolean;
}) {
  const calls = {
    isSteamRunning: 0,
    startSteamBestEffort: 0
  };
  const stderr: string[] = [];

  const context = {
    configService: {
      resolve: () => ({ windowsOrchestrationEnabled: options.enabled })
    },
    safetyService: {
      isWindowsOrchestrationSupported: () => options.supported,
      isSteamRunning: async () => {
        calls.isSteamRunning += 1;
        return options.running;
      },
      startSteamBestEffort: async () => {
        calls.startSteamBestEffort += 1;
        if (options.startThrows) {
          throw new Error('boom');
        }

        return options.startResult ?? true;
      }
    }
  } as unknown as SteamMcpContext;

  return {
    context,
    calls,
    stderr,
    writer: {
      write(chunk: string) {
        stderr.push(chunk);
        return true;
      }
    }
  };
}

test('startup orchestration attempts start when enabled, supported, and Steam is not running', async () => {
  const harness = createContext({ enabled: true, supported: true, running: false, startResult: true });

  await ensureWindowsSteamStartup(harness.context, harness.writer);

  assert.equal(harness.calls.isSteamRunning, 1);
  assert.equal(harness.calls.startSteamBestEffort, 1);
  assert.deepEqual(harness.stderr, []);
});

test('startup orchestration is a no-op when Steam is already running', async () => {
  const harness = createContext({ enabled: true, supported: true, running: true });

  await ensureWindowsSteamStartup(harness.context, harness.writer);

  assert.equal(harness.calls.isSteamRunning, 1);
  assert.equal(harness.calls.startSteamBestEffort, 0);
});

test('startup orchestration is a no-op when disabled', async () => {
  const harness = createContext({ enabled: false, supported: true, running: false });

  await ensureWindowsSteamStartup(harness.context, harness.writer);

  assert.equal(harness.calls.isSteamRunning, 0);
  assert.equal(harness.calls.startSteamBestEffort, 0);
});

test('startup orchestration is a no-op when unsupported', async () => {
  const harness = createContext({ enabled: true, supported: false, running: false });

  await ensureWindowsSteamStartup(harness.context, harness.writer);

  assert.equal(harness.calls.isSteamRunning, 0);
  assert.equal(harness.calls.startSteamBestEffort, 0);
  assert.deepEqual(harness.stderr, []);
});

test('startup orchestration failure stays non-fatal', async () => {
  const harness = createContext({ enabled: true, supported: true, running: false, startThrows: true });

  await ensureWindowsSteamStartup(harness.context, harness.writer);

  assert.equal(harness.calls.startSteamBestEffort, 1);
  assert.ok(harness.stderr.some((chunk) => chunk.includes('could not launch Steam')));
});
