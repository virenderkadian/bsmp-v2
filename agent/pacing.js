// Pure pacing policy for the sender agent. No I/O, no clock of its own — every
// function takes the time as an argument so it can be tested without waiting.
//
// This is the part that protects the WhatsApp number. Sending 2000 bills as
// fast as the API allows is the single most reliable way to get banned; sending
// them slowly, during waking hours, with a cap and a ramp, is what makes the
// same volume unremarkable. All of that policy lives here so it can be tuned
// (and reasoned about) without touching how messages are queued or delivered.

/**
 * Minutes since midnight, in the configured timezone offset.
 * Kept as a plain offset rather than a timezone database lookup so the agent
 * has zero dependencies and runs on a bare Node install.
 */
export function minutesIntoDay(now, utcOffsetMinutes) {
  const shifted = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * Business hours only. Messages arriving at 3am read as machine-generated and
 * annoy people into blocking — and a block is a far stronger ban signal than
 * volume ever is.
 */
export function isWithinSendingWindow(now, { startHour, endHour, utcOffsetMinutes }) {
  const minutes = minutesIntoDay(now, utcOffsetMinutes);
  return minutes >= startHour * 60 && minutes < endHour * 60;
}

/**
 * Milliseconds until the window next opens. Used to sleep until morning rather
 * than waking every minute through the night to ask again.
 */
export function msUntilWindowOpens(now, { startHour, endHour, utcOffsetMinutes }) {
  if (isWithinSendingWindow(now, { startHour, endHour, utcOffsetMinutes })) {
    return 0;
  }

  const minutes = minutesIntoDay(now, utcOffsetMinutes);
  const startMinutes = startHour * 60;
  const minutesToWait = minutes < startMinutes ? startMinutes - minutes : 24 * 60 - minutes + startMinutes;

  return minutesToWait * 60_000;
}

/**
 * Delay before the next message: a random value in [minSeconds, maxSeconds].
 *
 * Randomised rather than fixed on purpose. A message every exactly 20.000
 * seconds is a signature no human produces; jitter makes the same throughput
 * look like someone typing.
 */
export function nextDelayMs({ minSeconds, maxSeconds }, random = Math.random) {
  const low = Math.min(minSeconds, maxSeconds);
  const high = Math.max(minSeconds, maxSeconds);
  return Math.round((low + random() * (high - low)) * 1000);
}

/**
 * How many more may be sent today.
 *
 * `warmupCap` exists because a number's history matters as much as its rate. A
 * brand-new number that sends 2000 messages in its first week looks like a
 * spammer regardless of pacing; the same number sending 200/day for a fortnight
 * first does not. Raise it deliberately, month by month.
 */
export function remainingToday({ dailyCap, warmupCap, sentToday }) {
  const effectiveCap = Math.min(dailyCap, warmupCap ?? dailyCap);
  return Math.max(0, effectiveCap - sentToday);
}

/**
 * Circuit breaker.
 *
 * Counts only failures the provider reported — a socket error reaching our own
 * API is a network problem, not a WhatsApp problem, and must not trip this.
 * Consecutive send failures are the earliest visible sign that a number is
 * being restricted, and continuing at that point turns a warning into a ban.
 */
export function shouldTripBreaker({ consecutiveFailures, threshold }) {
  return consecutiveFailures >= threshold;
}
