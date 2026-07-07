const DEFAULT_DB_TIMEOUT_MS = 4000;

export async function withDbTimeout<T>(
  task: Promise<T>,
  label = "Database request",
  timeoutMs = DEFAULT_DB_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
