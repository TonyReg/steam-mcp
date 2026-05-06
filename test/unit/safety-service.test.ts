import assert from 'node:assert/strict';
import test from 'node:test';

import { SafetyService } from '../../packages/steam-core/src/safety/index.js';

type ExecInvocation = {
  file: string;
  args: string[];
};

type MockExecResult = {
  stdout: string;
  stderr: string;
};

class TestSafetyService extends SafetyService {
  public readonly invocations: ExecInvocation[] = [];

  constructor(private readonly execPlan: Array<MockExecResult | Error>) {
    super();
  }

  override isWindowsOrchestrationSupported(): boolean {
    return true;
  }

  protected override async runExecFile(file: string, args: string[]): Promise<MockExecResult> {
    this.invocations.push({ file, args });
    const next = this.execPlan.shift();
    assert.ok(next, `unexpected execFile call for ${file}`);
    if (next instanceof Error) {
      throw next;
    }

    return next;
  }
}

function execError(message: string, stderr = '', stdout = ''): Error & { stderr: string; stdout: string } {
  return Object.assign(new Error(message), { stderr, stdout });
}

test('safety service treats csv tasklist output without exact steam.exe row as not running', async () => {
  const service = new TestSafetyService([
    {
      stdout: 'INFO: No tasks are running which match the specified criteria.\r\n',
      stderr: ''
    }
  ]);

  const running = await service.isSteamRunning();

  assert.equal(running, false);
  assert.equal(service.describeLastSteamShutdownAttempt(), null);
  assert.deepEqual(service.invocations, [{
    file: 'tasklist',
    args: ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq steam.exe']
  }]);
});

test('safety service stops after graceful taskkill when steam disappears', async () => {
  const service = new TestSafetyService([
    { stdout: '"steam.exe","4242","Console","1","128,000 K"\r\n', stderr: '' },
    { stdout: 'SUCCESS: Sent termination signal to process "steam.exe".\r\n', stderr: '' },
    { stdout: 'INFO: No tasks are running which match the specified criteria.\r\n', stderr: '' }
  ]);

  const stopped = await service.stopSteamBestEffort();

  assert.equal(stopped, true);
  assert.match(
    service.describeLastSteamShutdownAttempt() ?? '',
    /graceful taskkill succeeded; forced taskkill attempted: no; last detector output: steam\.exe absent/
  );
  assert.deepEqual(service.invocations, [
    { file: 'tasklist', args: ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq steam.exe'] },
    { file: 'taskkill', args: ['/IM', 'steam.exe', '/T'] },
    { file: 'tasklist', args: ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq steam.exe'] }
  ]);
});

test('safety service records graceful failure and forced fallback success when stopping Steam', async () => {
  const service = new TestSafetyService([
    { stdout: '"steam.exe","4242","Console","1","128,000 K"\r\n', stderr: '' },
    execError('graceful failed', 'access denied'),
    { stdout: '"steam.exe","4242","Console","1","128,000 K"\r\n', stderr: '' },
    { stdout: 'SUCCESS: The process "steam.exe" with PID 4242 has been terminated.\r\n', stderr: '' },
    { stdout: 'INFO: No tasks are running which match the specified criteria.\r\n', stderr: '' }
  ]);

  const stopped = await service.stopSteamBestEffort();

  assert.equal(stopped, true);
  assert.match(
    service.describeLastSteamShutdownAttempt() ?? '',
    /graceful taskkill failed: access denied; forced taskkill attempted: yes \(succeeded\); last detector output: steam\.exe absent/
  );
  assert.deepEqual(service.invocations, [
    { file: 'tasklist', args: ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq steam.exe'] },
    { file: 'taskkill', args: ['/IM', 'steam.exe', '/T'] },
    { file: 'tasklist', args: ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq steam.exe'] },
    { file: 'taskkill', args: ['/IM', 'steam.exe', '/T', '/F'] },
    { file: 'tasklist', args: ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq steam.exe'] }
  ]);
});

test('safety service reports useful diagnostics when Steam still appears running after shutdown attempts', async () => {
  const service = new TestSafetyService([
    { stdout: '"steam.exe","4242","Console","1","128,000 K"\r\n', stderr: '' },
    execError('graceful failed', 'access denied'),
    { stdout: '"steam.exe","4242","Console","1","128,000 K"\r\n', stderr: '' },
    execError('forced failed', 'termination refused'),
    { stdout: '"steam.exe","4242","Console","1","128,000 K"\r\n', stderr: '' }
  ]);

  const stopped = await service.stopSteamBestEffort();

  assert.equal(stopped, false);
  assert.match(
    service.describeLastSteamShutdownAttempt() ?? '',
    /graceful taskkill failed: access denied; forced taskkill attempted: yes \(failed: termination refused\); last detector output: steam\.exe still present/
  );
});
