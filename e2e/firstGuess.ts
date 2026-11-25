// The test server's time for a live first guess, in seconds (Dev Plan item
// 19k): e2e/worker.ts sets it as FIRST_GUESS_SECONDS, so the cancelled live
// game test waits this long rather than the real 2 minutes. Real games,
// staging and production keep 2 minutes (`FIRST_GUESS_MS`).
export const TEST_FIRST_GUESS_SECONDS = 30;
