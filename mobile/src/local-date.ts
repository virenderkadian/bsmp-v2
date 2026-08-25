// The driver's own calendar day, in device local time.
//
// Deliberately NOT toISOString(), which is UTC. India runs at UTC+5:30, so a
// UTC date rolls over at 05:30 local: anything recorded between midnight and
// 05:30 was filed under the previous day and then appeared to vanish the
// moment the UTC date caught up. This value picks the route sheet's date, the
// round-completion flag and the cash sale session, so all three have to mean
// "today" the way the person holding the phone means it.
//
// It lives on its own, away from anything that talks to the network, so the
// local stores (cash sale, completion, offline queue) can use it without
// pulling the API layer in behind it.

export function localDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayStr(date: Date = new Date()): string {
  return localDateStr(date);
}
