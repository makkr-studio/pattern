/**
 * Pattern — Web Streams helpers.
 *
 * Built on `ReadableStream` / `TransformStream` + async iterators (§12). These
 * are the small adapters the engine and stream ops share. They are intentionally
 * runtime-neutral (Web standards only).
 */

/** A `ReadableStream` that yields each element of an array/iterable, then closes. */
export function iterableToStream<T>(
  source: Iterable<T> | AsyncIterable<T>,
): ReadableStream<T> {
  if (Symbol.asyncIterator in (source as any)) {
    const it = (source as AsyncIterable<T>)[Symbol.asyncIterator]();
    return new ReadableStream<T>({
      async pull(controller) {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      async cancel(reason) {
        await it.return?.(reason);
      },
    });
  }
  const it = (source as Iterable<T>)[Symbol.iterator]();
  return new ReadableStream<T>({
    pull(controller) {
      const { done, value } = it.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      it.return?.(reason);
    },
  });
}

/** A stream that immediately closes with no elements. */
export function emptyStream<T = unknown>(): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      controller.close();
    },
  });
}

/** A stream of a single value. */
export function singletonStream<T>(value: T): ReadableStream<T> {
  return iterableToStream([value]);
}

/** Drain a stream into an array (a barrier; used by `accumulate`). */
export async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return out;
}

/** Async-iterate a stream (works regardless of Symbol.asyncIterator support). */
export async function* streamToIterable<T>(stream: ReadableStream<T>): AsyncGenerator<T> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Fully read & discard a stream (drains a producer with no consumer). */
export async function drainStream(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
