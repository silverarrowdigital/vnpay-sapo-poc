#!/usr/bin/env node
/**
 * Create (or confirm) the QStash schedule that runs the sweep every five minutes (T14 PR 6).
 *
 *   node --env-file=<file with QSTASH_URL and QSTASH_TOKEN> scripts/qstash-schedule.mjs <https://host> [--delete]
 *
 * Idempotent: the schedule has a fixed id, so asking twice — or with a host written differently —
 * cannot create two, and an existing one is left alone. `--delete` removes it.
 *
 * Only production is swept. A preview shares the production database today, so any other host is
 * refused unless `--allow-other-host` is given.
 */
const PRODUCTION = "https://vnpay-sapo-poc.vercel.app";
const SCHEDULE_ID = "vnpay-sapo-sweep-production";

const args = process.argv.slice(2);
const host = args.find((a) => !a.startsWith("--"));
const doDelete = args.includes("--delete");
const allowOther = args.includes("--allow-other-host");
const base = process.env.QSTASH_URL;
const token = process.env.QSTASH_TOKEN;
if (!host || !base || !token) {
  console.error("usage: qstash-schedule.mjs <https://host> [--delete] [--allow-other-host]   (needs QSTASH_URL and QSTASH_TOKEN)");
  process.exit(1);
}
const cleanHost = host.replace(/\/+$/, "");
if (cleanHost !== PRODUCTION && !allowOther) {
  console.error(`refusing ${cleanHost}: only ${PRODUCTION} is swept (a preview shares the production database)`);
  process.exit(1);
}
const destination = `${cleanHost}/api/jobs/sweep`;
const auth = { Authorization: `Bearer ${token}` };

const listRes = await fetch(`${base}/v2/schedules`, { headers: auth });
const list = await listRes.json();
if (!listRes.ok || !Array.isArray(list)) {
  console.error(`could not list schedules (HTTP ${listRes.status}); not creating anything`);
  process.exit(1);
}
const existing = list.filter((s) => s.scheduleId === SCHEDULE_ID || s.destination === destination);

if (doDelete) {
  for (const s of existing) {
    const res = await fetch(`${base}/v2/schedules/${s.scheduleId}`, { method: "DELETE", headers: auth });
    console.log(`deleted ${s.scheduleId}: HTTP ${res.status}`);
  }
  process.exit(0);
}
if (existing.length > 0) {
  console.log(`already scheduled: ${existing.map((s) => `${s.scheduleId} (${s.cron})`).join(", ")}`);
  process.exit(0);
}
const res = await fetch(`${base}/v2/schedules/${destination}`, {
  method: "POST",
  headers: {
    ...auth,
    "Upstash-Cron": "*/5 * * * *",
    "Upstash-Method": "POST",
    "Upstash-Schedule-Id": SCHEDULE_ID,
    "Content-Type": "application/json",
  },
  body: "{}",
});
console.log(`created: HTTP ${res.status}`, await res.text());
