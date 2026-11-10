import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../groups.js';

const { Groups } = globalThis;

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

test('latest: when responses arrive out of order, only the newest call is accepted', async () => {
  const guard = Groups.latest();
  const older = deferred();
  const newer = deferred();
  const first = guard.run(() => older.promise);
  const second = guard.run(() => newer.promise);
  newer.resolve('new');
  older.resolve('old');
  assert.deepEqual(await second, { stale: false, value: 'new' });
  assert.deepEqual(await first, { stale: true });
});

test('latest: an error from a superseded call is ignored, an error from the newest still throws', async () => {
  const guard = Groups.latest();
  const older = deferred();
  const first = guard.run(() => older.promise);
  const second = guard.run(() => Promise.resolve('ok'));
  older.reject(new Error('network'));
  assert.deepEqual(await first, { stale: true });
  assert.deepEqual(await second, { stale: false, value: 'ok' });
  await assert.rejects(
    guard.run(() => Promise.reject(new Error('boom'))),
    /boom/,
  );
});

test('latest: starting a new call aborts the older in-flight work', async () => {
  const guard = Groups.latest();
  let olderSignal;
  const first = guard.run((signal) => {
    olderSignal = signal;
    return new Promise(() => {});
  });
  assert.equal(olderSignal.aborted, false);
  const second = guard.run(() => Promise.resolve(1));
  assert.equal(olderSignal.aborted, true);
  assert.deepEqual(await second, { stale: false, value: 1 });
  void first;
});

test('latest: invalidate() drops work already in flight, so a late result is discarded', async () => {
  const guard = Groups.latest();
  const pending = deferred();
  let signal;
  const call = guard.run((s) => {
    signal = s;
    return pending.promise;
  });
  guard.invalidate();
  pending.resolve('late');
  assert.deepEqual(await call, { stale: true });
  assert.equal(signal.aborted, true);
});

test('latest: a token is current until the next token or invalidate()', () => {
  const guard = Groups.latest();
  const a = guard.token();
  assert.equal(a.current(), true);
  const b = guard.token();
  assert.equal(a.current(), false);
  assert.equal(b.current(), true);
  guard.invalidate();
  assert.equal(b.current(), false);
});
