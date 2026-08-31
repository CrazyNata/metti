export function assert(
  condition: unknown,
  message = "Expected condition to be truthy.",
): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals<T>(
  actual: T,
  expected: T,
  message?: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(actual)} to equal ${
          JSON.stringify(expected)
        }.`,
    );
  }
}

export async function assertRejects(
  operation: () => Promise<unknown>,
  predicate: (error: unknown) => boolean,
  message = "Expected operation to reject with the expected error.",
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (predicate(error)) return;
    throw new Error(message);
  }
  throw new Error(message);
}
