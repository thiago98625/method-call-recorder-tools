/**
 * A MethodCallRecorder wraps an object so that every method call, its
 * arguments, and its return value (synchronous or asynchronous) are appended to
 * a replayable log. The log is a flat array of plain records — it can be
 * serialised to JSON, inspected in tests, or replayed by the consumer.
 *
 * The design decision made here is to wrap only top-level methods, not nested
 * properties. The log records the method name, an array of arguments (JSON
 * clone at call time), the resolution type ('sync', 'async-resolved',
 * 'async-rejected'), and the return value or thrown value. The recorder only
 * observes; it never alters the behaviour of the underlying object.
 */

/**
 * Returns true when the given value behaves like a native Promise.
 *
 * Plain structural checks (thenable detection) would match any object with a
 * `then` method, including ordinary class instances. We want to record
 * genuine async completions, not misclassify methods that happen to return an
 * object with a `then` property. We therefore only accept real Promise
 * instances and objects created via Promise.resolve.
 */
function isPromise(value) {
  return value instanceof Promise;
}

/**
 * Create a recorder for the given target object.
 *
 * @param {object} target - The object whose methods should be recorded.
 */
export function MethodCallRecorder(target) {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('MethodCallRecorder expects a non-null object or function');
  }

  const log = [];

  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      const original = Reflect.get(obj, prop, receiver);

      // Only record calls to methods that are functions on the target.
      // Property reads that resolve to non-functions pass through untouched.
      if (typeof original !== 'function') {
        return original;
      }

      // Return a wrapper that logs the call. The wrapper is a plain function
      // so that the log stays in the order calls were made, rather than the
      // order results settled.
      const wrapper = function (...args) {
        const record = {
          method: String(prop),
          args: cloneArgs(args),
          kind: 'sync',
          result: undefined,
        };

        let outcome;
        try {
          outcome = Reflect.apply(original, obj, args);
        } catch (err) {
          record.kind = 'sync-thrown';
          record.result = toErrorSnapshot(err);
          log.push(record);
          throw err;
        }

        if (isPromise(outcome)) {
          record.kind = 'async-pending';
          // Replace the placeholder record once the promise settles.
          // If the page exits before the promise resolves, the entry stays
          // 'async-pending', which is the most honest representation.
          outcome.then(
            (resolved) => {
              record.kind = 'async-resolved';
              record.result = cloneValue(resolved);
            },
            (rejected) => {
              record.kind = 'async-rejected';
              record.result = toErrorSnapshot(rejected);
            }
          );
        } else {
          record.kind = 'sync';
          record.result = cloneValue(outcome);
        }

        log.push(record);
        return outcome;
      };

      return wrapper;
    },
  });

  return {
    proxy,
    getLog: () => log,
    snapshot: () => cloneValue(log),
    clear: () => { log.length = 0; },
  };
}

/**
 * Returns the names of methods on the recorder target that return Promises.
 *
 * The list is determined by calling the method once with no arguments, which is
 * the limiting case: it only identifies no-argument methods whose return is a
 * Promise. Callers with methods that need arguments to resolve are advised not
 * to rely on this helper.
 */
export function getAsyncMethods(target) {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('getAsyncMethods expects a non-null object or function');
  }
  const names = [];
  const seen = new Set();
  let cursor = target;
  while (cursor !== null && cursor !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(cursor)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const desc = Object.getOwnPropertyDescriptor(cursor, name);
      if (!desc) continue;
      const value = desc.value;
      if (typeof value === 'function') {
        let ret;
        try {
          ret = value.call(target);
        } catch (_) {
          continue;
        }
        if (isPromise(ret)) {
          names.push(name);
        }
      }
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return names;
}

/**
 * Deep-clone an array of arguments so that mutations to the originals after the
 * call cannot change the recorded snapshot.
 */
function cloneArgs(args) {
  return args.map(cloneValue);
}

/**
 * Deep-clone a value for the log. Uses structuredClone when available, falling
 * back to JSON for environments without it. Functions and symbols become null.
 */
function cloneValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'function') return null;
  if (typeof value === 'symbol') return null;
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return toErrorSnapshot(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof Map) {
    const copy = new Map();
    for (const [k, v] of value) copy.set(cloneValue(k), cloneValue(v));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    for (const v of value) copy.add(cloneValue(v));
    return copy;
  }
  if (Array.isArray(value)) return value.map(cloneValue);
  // Plain objects
  const copy = {};
  for (const key of Object.keys(value)) {
    copy[key] = cloneValue(value[key]);
  }
  return copy;
}

/**
 * Convert an error into a serialisable snapshot.
 */
function toErrorSnapshot(err) {
  if (err === null || err === undefined) return err;
  if (err instanceof Error) {
    return {
      __error: true,
      name: err.name,
      message: err.message,
      stack: err.stack,
      cause: err.cause ? toErrorSnapshot(err.cause) : undefined,
    };
  }
  // Non-error throwables (e.g. a thrown string) are returned as-is.
  return cloneValue(err);
}
