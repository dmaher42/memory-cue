# Memory Cue reminder scheduler

## Current status

The scheduler is deployed in the account hosting Memory Cue and is running
every minute. On 13 September 2026, the authenticated Cloudflare dashboard
showed deployment `e88c461e-86fb-46aa-877a-c6a424b98953` and successful scheduled
runs with no execution errors in the reviewed hour. The inspected run found
zero qualifying reminders and attempted zero deliveries. This confirms a
working timer and query, not delivery to a phone or parity with every feature
in the current local implementation.

Read-only checks on 13 September 2026 found the public VAPID configuration on
the live site. An empty request to the existing push-sync endpoint reached
payload validation rather than the missing-configuration response. This shows
configuration is present; it does not prove credential validity or delivery.
The saved Wrangler login accesses a different account with no Pages projects.
The correct account was verified through the owner's signed-in browser. Do not
create a duplicate scheduler based on a missing-Worker result in the other
account. Verify the account hosting `memory-cue.pages.dev` before CLI deployment.
The owner reports Android device registration; a locked-phone delivery test is
still required before claiming end-to-end reliability.

This is a separate Cloudflare Worker because the main `wrangler.jsonc` describes
a Cloudflare Pages project. Pages Functions handle web requests, but the reliable
one-minute clock must be a Worker Cron Trigger with a `scheduled()` handler.
Keep the two Wrangler configurations separate.

## What it does

Every minute the Worker:

1. Reads unfinished, timed urgent reminders from the existing Firestore
   `users/{userId}/reminders` collections.
2. Uses the app's canonical `src/reminders/reminderUrgency.js` logic.
3. Applies the same T-15, T-5, T-1, due, and every-five-minutes-overdue stages.
4. Honours Seen for the current stage, Snooze until its expiry, Start/Join as a
   stop to future interruptions, and Done as the final clear.
5. Reads registered devices from `users/{userId}/pushDevices`.
6. Collapses duplicate device records that contain the same normalized FCM
   token, preferring the record with the newest `updatedAt` value.
7. Claims one deterministic delivery per reminder due-time, stage, and device.
8. Sends a short-lived, high-urgency FCM data push that the existing service
   worker turns into the persistent Memory Cue notification and badge.

The reminder itself remains the source of truth. The top-level
`_memoryCueUrgentDeliveries` collection is only an idempotency ledger. Its
document IDs are SHA-256 hashes and do not expose user IDs, reminder IDs, device
IDs, or push tokens.

Claims use a two-minute lease. A successful delivery is never claimed again. A
crashed invocation can be retried after its lease expires. Temporary FCM errors
honour `Retry-After` and use jittered bounded exponential backoff. Invalid,
unregistered, and wrong-sender tokens are permanent failures; rejected device
records are removed so later overdue stages do not keep sending to dead tokens.
Push messages use a per-reminder Web Push `Topic` and a four-minute TTL so stale
appointment stages do not stack while a phone is offline. Untrusted reminder
text is byte-bounded and the complete FCM data payload is checked against the
4,096-byte limit before sending.

Ledger records contain a Firestore timestamp named `expireAt`, set seven days in
the future. Production still needs a Firestore TTL policy on that field; without
the policy, Firestore will not remove the records automatically. Raw user,
reminder, and device IDs are not stored in ledger fields, but due times and stage
metadata still require rules that deny all client access to the collection.

The Firestore claim is an at-least-once server-side guard, not a transactional
exactly-once guarantee across FCM. If FCM accepts a message but Firestore cannot
record completion, the Worker must retry after the lease expires rather than
risk losing an alert. The phone service worker must therefore persist processed
`deliveryId` values and ignore a repeated ID. The outgoing payload includes
`deliveryId` and `deliveryStageKey`. The matching client-side safeguard must be
included in the Pages release and pass its regression test before deployment.

## Local verification

No packages or credentials are needed for the unit tests:

```powershell
Set-Location workers/reminder-scheduler
npm test
```

The tests load the actual app urgency module and cover:

- every required urgency stage;
- Seen, Snooze, Started, and Done;
- one claim per stage per device;
- duplicate-token device records are collapsed to one physical-device send;
- partial-device retry without resending successful deliveries;
- expired leases and retry backoff;
- FCM payload bounds, permanent/transient failures, and `Retry-After`;
- dead-token retirement and an explicit 100-device-record safety cap;
- per-run delivery and external-subrequest safety budgets;
- rotation across constrained runs so later reminders, users, and devices are
  not permanently starved;
- Firestore query shape and field decoding;
- deterministic privacy-safe delivery IDs; and
- the FCM payload, urgency, collapse topic, and expiry.

## Production settings required later

The following requirements must be checked against the existing deployment.
Do not assume they are missing or recreate existing resources. Changes to
production permissions, secrets or billing require owner approval.

### Firebase

- Confirm or create the Web Push certificate and public VAPID key.
- Enable the FCM Registration API and FCM HTTP v1 API if they are not already
  enabled.
- Create a least-privilege service account able to query/update Firestore and
  send FCM messages.
- Create the required Firestore collection-group composite indexes:
  - collection group: `reminders`
  - `urgentAlert`: ascending
  - `hasExplicitTime`: ascending
  - `done`: ascending
  - one index with `due` ascending for imminent appointments
  - one index with `due` descending for the overdue backlog
- Add a Firestore TTL policy for `_memoryCueUrgentDeliveries.expireAt` and
  account for the resulting delete operations.
- Explicitly deny client reads and writes to `_memoryCueUrgentDeliveries` in
  Firestore Security Rules. Only the service account should access it.
- Review Firestore rules separately. Server service-account access bypasses
  client rules, while phone token registration still uses the signed-in client.

The Worker needs these encrypted settings:

- `FIREBASE_SERVICE_ACCOUNT_JSON`, containing `project_id`,
  `client_email`, and `private_key`; or
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
  `FIREBASE_PRIVATE_KEY` as separate settings.

Never put the service-account private key in `vars`, source code, a committed
file, or the client runtime environment.

The Cloudflare Pages project also needs:

- public `FIREBASE_WEB_PUSH_VAPID_KEY` so the phone can register;
- server-only Firebase service-account credentials so the existing
  `/api/push-reminder-sync` route can immediately propagate Done, Seen, Snooze,
  Start/Join, and reminder edits between devices.

The public site has a VAPID key and passes the endpoint's configuration-presence
check. Verify actual Firebase access and device delivery before treating those
settings as working. The scheduler requires its own encrypted settings; do not
copy private credentials into client configuration or logs.

### Cloudflare

- Review the account's Workers plan and limits.
- Add the Worker secrets through the Cloudflare secret store.
- Deploy using this folder's `wrangler.jsonc`.
- Approve the `* * * * *` Cron Trigger.
- Inspect the first Cron Event logs before relying on it.

`SCHEDULER_QUERY_LIMIT` is an optional positive integer capped at 1000. The
default is 250 reminders per run. The current/future 15-minute window is queried
first, then overdue reminders newest-first, so a backlog of old unfinished items
cannot hide an imminent appointment. Reaching the limit emits a warning rather
than silently claiming that the full query was processed.

The default `SCHEDULER_DELIVERY_BUDGET` is six device attempts per run. Users,
reminders, and devices rotate between constrained runs, so an already-processed
record cannot permanently hide a later one. `SCHEDULER_MAX_SUBREQUESTS` defaults
to 45 and hard-stops outbound requests before the Workers Free limit; it can be
raised only as high as 900. Device lookup intentionally fails rather than
silently truncating if a user has more than 100 registration records.

These conservative defaults protect a Free-plan deployment, but more than six
simultaneous device deliveries can be deferred to a later minute. Exact
target-minute delivery at larger fan-out therefore requires owner approval for
a paid Workers plan, followed by deliberate increases to both budgets and an
observed load test. One run per minute is 1,440 invocations per day. Actual
Cloudflare and Firebase pricing, quotas, and current account plans must be
reviewed before deployment; this document does not promise zero cost.

## Delivery limits

### Android acceptance test

After confirming the correct deployment, cron events, credentials and indexes:

1. Open Memory Cue on Android, sign in to the same account as the laptop, and
   allow notifications. In a reminder's **More options > Reminder alerts**,
   use **Reconnect alerts** if needed. Device registration alone is not a pass.
2. Save a clearly named test appointment with an explicit future time through
   the normal reminder form. Verify it has synced before closing the app.
3. Close Memory Cue on both devices, lock the phone and let the laptop sleep.
   Check the scheduled warning, due alert and overdue repeat on the phone.
4. Check Seen, Snooze, and Done. Snooze must pause then resume alerts; Done must
   stop repeats. Reopen the app and confirm the same reminder reflects the action.
5. Repeat after temporary loss of internet and after restarting the phone.
   Record actual delivery times and Android notification settings. Do not call
   the closed-app path verified until these device tests have passed.

The app retries unsuccessful registration with bounded backoff while running,
and can recover on return to the app or restoration of connectivity. Retries
do not replace the server scheduler and cannot wake a closed app.

The Worker supplies a reliable server clock, but phones still control final
delivery. An alert can arrive roughly within the target minute plus network and
operating-system delay; it cannot be guaranteed to the exact second. Focus, Do
Not Disturb, notification permission, lock-screen settings, battery controls,
and offline state can delay or hide it.

On iPhone, Memory Cue must be installed as a Home Screen web app on iOS 16.4 or
later and notification permission must be granted from a user action. Android
also requires notification permission. The real phone must pass an end-to-end
test before this is treated as dependable.

## Explicit approval boundary

Local code and tests are safe to review. Do not run Wrangler deployment or
secret commands, generate or rotate credentials, alter IAM, enable APIs or
billing, create the Firestore index, or publish Pages changes without the
owner's approval.
