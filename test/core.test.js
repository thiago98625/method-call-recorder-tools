import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MethodCallRecorder, getAsyncMethods } from '../src/index.js';

test('synchronous method calls are recorded in order', () => {
  const calc = {
    add(a, b) { return a + b; },
    mul(a, b) { return a * b; },
  };
  const rec = MethodCallRecorder(calc);
  const { proxy } = rec;

  assert.equal(proxy.add(1, 2), 3);
  assert.equal(proxy.mul(3, 4), 12);

  const log = rec.getLog();
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], { method: 'add', args: [1, 2], kind: 'sync', result: 3 });
  assert.deepEqual(log[1], { method: 'mul', args: [3, 4], kind: 'sync', result: 12 });
});

test('property reads that are not methods pass through untouched', () => {
  const obj = { value: 42, fn() { return 'ok'; } };
  const rec = MethodCallRecorder(obj);
  const { proxy } = rec;

  assert.equal(proxy.value, 42);
  assert.equal(proxy.fn(), 'ok');
  assert.equal(rec.getLog().length, 1);
});

test('thrown synchronous errors are recorded before rethrowing', () => {
 const obj = {
    fail() { throw new TypeError('nope'); },
  };
  const rec = MethodCallRecorder(obj);
  const { proxy } = rec;

  assert.throws(() => proxy.fail(), TypeError);

  const log = rec.getLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].method, 'fail');
  assert.equal(log[0].kind, 'sync-thrown');
  assert.equal(log[0].result.message, 'nope');
});

test('async resolved promises update the record in place', async () => {
  const obj = {
    async resolveLater(x) { return x * 2; },
  };
  const rec = MethodCallRecorder(obj);
  const { proxy } = rec;

  const ret = proxy.resolveLater(5);
  assert.ok(ret instanceof Promise);

  const awaited = await ret;
  assert.equal(awaited, 10);

  const log = rec.getLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, 'async-resolved');
  assert.equal(log[0].result, 10);
});

test('async rejected promises update the record in place', async () => {
  const obj = {
    async rejectLater() { throw new Error('boom'); },
  };
  const rec = MethodCallRecorder(obj);
  const { proxy } = rec;

  await assert.rejects(proxy.rejectLater(), /boom/);

  const log = rec.getLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, 'async-rejected');
  assert.equal(log[0].result.message, 'boom');
});

test('the proxy preserves the value of `this` inside methods', () => {
  const counter = {
    count: 0,
    increment() { this.count += 1; return this.count; },
  };
  const rec = MethodCallRecorder(counter);
  const { proxy } = rec;

  assert.equal(proxy.increment(), 1);
  assert.equal(proxy.increment(), 2);
  assert.equal(proxy.count, 2);
});

test('arguments are cloned so later mutations do not rewrite history', () => {
  const obj = {
    echo(arr) { return arr.length; },
  };
  const rec = MethodCallRecorder(obj);
  const { proxy } = rec;

  const arr = [1, 2, 3];
  proxy.echo(arr);
  arr.push(4);

  const log = rec.getLog();
  assert.deepEqual(log[0].args, [[1, 2, 3]]);
});

test('snapshot returns a deep copy of the log', () => {
  const obj = { id(x) { return { id: x }; } };
  const rec = MethodCallRecorder(obj);
  const { proxy } = rec;

  proxy.id(7);
  const snap = rec.snapshot();
  snap[0].result.id = 999;

  assert.deepEqual(rec.getLog()[0].result, { id: 7 });
});

test('clear empties the log', () => {
  const obj = { ping() { return 'pong'; } };
  const rec = MethodCallRecorder(obj);
  const { proxy } = rec;

  proxy.ping();
  assert.equal(rec.getLog().length, 1);
  rec.clear();
  assert.equal(rec.getLog().length, 0);
});

test('getAsyncMethods finds no-argument methods that return Promises', async () => {
  const obj = {
    syncMethod() { return 1; },
    async asyncMethod() { return 2; },
  };

  const names = getAsyncMethods(obj);
  assert.deepEqual(names, ['asyncMethod']);
});

test('calling on a non-object throws a TypeError', () => {
  assert.throws(() => MethodCallRecorder(null), TypeError);
  assert.throws(() => MethodCallRecorder(42), TypeError);
});

test('inherited prototype methods are wrapped', () => {
  class Base {
    greet(name) { return `hello ${name}`; }
  }
  class Derived extends Base {}

  const rec = MethodCallRecorder(new Derived());
  const { proxy } = rec;

  assert.equal(proxy.greet('world'), 'hello world');
  assert.equal(rec.getLog()[0].method, 'greet');
});
