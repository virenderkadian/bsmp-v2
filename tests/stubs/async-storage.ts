// In-memory stand-in for @react-native-async-storage/async-storage, so the
// driver app's local stores can be tested off-device.
//
// Reads and writes resolve on a later tick rather than synchronously. That is
// the point: the real thing is asynchronous, and the bug these tests guard
// against was two overlapping read-modify-write cycles losing a record. A
// synchronous fake could never reproduce it.

const store = new Map<string, string>();

// Bumped by a test that wants a wider window between a read and its write.
let delayMs = 0;

function wait(): Promise<void> {
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
}

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    await wait();
    return store.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await wait();
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await wait();
    store.delete(key);
  },
  async clear(): Promise<void> {
    store.clear();
  },
};

export function __reset(): void {
  store.clear();
  delayMs = 0;
}

export function __setDelay(ms: number): void {
  delayMs = ms;
}

export default AsyncStorage;
