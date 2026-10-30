# method-call-recorder-tools

Proxies an object so that every method call, its arguments, and its synchronous or asynchronous return are appended to a replayable log.

```js
import { MethodCallRecorder, getAsyncMethods } from 'method-call-recorder-tools';

const api = {
  async fetchUser(id) { return { id, name: 'Alice' }; },
  refresh() {},
};

const recorder = MethodCallRecorder(api);
const { proxy } = recorder;

await proxy.fetchUser(123);
proxy.refresh();

const log = recorder.getLog();
// [ { method: 'fetchUser', args: [123], kind: 'async-resolved', result: { id: 123, name: 'Alice' } },
//   { method: 'refresh', args: [], kind: 'sync', result: undefined } ]

const asyncMethods = getAsyncMethods(api);
```

The library exists to make test assertions on objects with side effects. Instead of setting up spies on every method by hand, you wrap the object once and inspect a flat log after the fact. The trade-off is that only top-level methods are wrapped: nested properties and getter chains are observed, not logged. Thrown errors are recorded before rethrowing, so a failing method still appears in the log.

The awkward edge is async ordering. Each log entry is appended at call time; entries are not reordered when promises settle. Synchronous results are final when pushed; async entries are mutated in place to their settled kind (`async-resolved` / `async-rejected`) when the promise resolves. If a test inspects an async entry before awaiting the return value, the entry will still read `async-pending`.

`MethodCallRecorder(target)` returns `{ proxy, getLog, snapshot, clear }`. `getAsyncMethods(target)` returns the names of no-argument methods that return Promises.
