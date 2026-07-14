// server-only throws when imported outside Next.js's bundler, since it
// relies on a conditional package export Next.js defines and Vitest
// doesn't. Aliased in here as a no-op so lib files that (correctly) guard
// themselves with `import "server-only"` stay testable under Vitest.
export {};
