# SQL Connection Credential Key Rotation

This runbook covers rotation of `PROJECT_SOURCE_SECRET_KEY` — the master key used to encrypt the per-org SQL connection passwords stored in `org_sql_connection.password_ciphertext`.

> **Why this exists.** The original AES-GCM helper accepted a single key and stored ciphertext in an unversioned wire format. Rotating the master key was a one-way door: every stored credential became undecryptable in the moment the new key was rolled out. C3a + C3b added a versioned wire format (`v1:` prefix) and a dual-key decrypt path; this runbook is the operational playbook that ties them together.

---

## Overview

The rotation flow is **dual-key with lazy upgrade-on-read**. You never need a batch migration script; rows naturally rewrite themselves under the new key as the chat agent reads them.

```
Phase A: pre-rotation        — PROJECT_SOURCE_SECRET_KEY = K_old
Phase B: rotation window     — PROJECT_SOURCE_SECRET_KEY = K_new
                               PROJECT_SOURCE_SECRET_KEY_PREVIOUS = K_old
                               Rows rewrite themselves as they're read.
Phase C: window closed       — PROJECT_SOURCE_SECRET_KEY = K_new
                               PROJECT_SOURCE_SECRET_KEY_PREVIOUS unset.
```

You're in Phase B for as long as you have any rows still encrypted under `K_old`. Once monitoring confirms zero rows remain under `K_old`, you can unset `PROJECT_SOURCE_SECRET_KEY_PREVIOUS` (Phase C).

---

## Step-by-step

### 1. Generate the new key

```bash
openssl rand -base64 32
# Example output: 9LWp6rB3SrV0V4xKqOpQ2bM+Fy7uXmTcZsO1nKlT8eM=
```

This must be a 32-byte (256-bit) key, base64-encoded. The boot-time validator (`assertValidBase64Key`) refuses any other length.

### 2. Deploy with both keys set (enter Phase B)

In your secrets store (Vault / 1Password / cloud KMS / whatever you use):

```
PROJECT_SOURCE_SECRET_KEY=<K_new — the new key from step 1>
PROJECT_SOURCE_SECRET_KEY_PREVIOUS=<K_old — the old key>
```

Restart api-velocity. The boot validator confirms both keys are well-formed; if `PROJECT_SOURCE_SECRET_KEY_PREVIOUS` is malformed, the service refuses to start (this is on purpose — a typo during rotation must be caught before any traffic).

### 3. Verify

- New encrypts (creating or updating a SQL connection) use `K_new` and write v1 wire format. Existing rows continue to decrypt: the helper tries `K_new` first, falls back to `K_old`, succeeds.
- On every successful decrypt under `K_old` or against a v0 (legacy, unprefixed) row, you should see a log line like:
  ```
  [SqlConnectionsService] lazy-upgraded sql_connection <id> ciphertext to v1
  ```
- Confirm via the database that newly-written rows have `password_ciphertext LIKE 'v1:%'`.

### 4. Wait for traffic to upgrade rows

How long? As long as it takes for every row to be read at least once. For chat-to-SQL this happens whenever a user queries against a connection. If you have low-traffic connections that may never be read, you can force the upgrade by listing them via the admin UI (which decrypts them as part of the response).

**Watch for:**
- A SQL like `SELECT COUNT(*) FROM org_sql_connection WHERE password_ciphertext NOT LIKE 'v1:%';` should fall to 0.
- The volume of "lazy-upgraded" log lines should taper to zero.

### 5. Close the rotation window (enter Phase C)

When confident every row is under `K_new`:

```
PROJECT_SOURCE_SECRET_KEY=<K_new>
# remove or comment out:
# PROJECT_SOURCE_SECRET_KEY_PREVIOUS=<K_old>
```

Restart api-velocity. From this point on, any row still encrypted under `K_old` (i.e. one that somehow escaped step 4) will fail decryption with the canonical "internal_error" message — the chat agent's query will fail cleanly and the operator can re-investigate.

### 6. Destroy the old key

After Phase C is stable (a few days), destroy `K_old` from your secrets store. You no longer need it.

> ⚠️ **Pre-destruction gate (operator must verify).** Destroying `K_old` while any row still carries v0 wire format permanently bricks those rows. Before destroying, run:
>
> ```sql
> SELECT COUNT(*) FROM org_sql_connection
>  WHERE password_ciphertext NOT LIKE 'v1:%';
> ```
>
> Wait until the count is **zero** across all environments (and stays zero for a full traffic cycle — typically one business day) before retiring `K_old`. If the count is non-zero, either trigger a read of each remaining row through the admin UI (which decrypts and lazy-upgrades it) or extend Phase B until traffic catches up.
>
> This is the only failure mode of the rotation flow that's unrecoverable, and the only one that depends on operator timing rather than on the code. Treat it as a checklist item, not a default.

---

## Rollback

If something goes wrong during Phase B:

- **Both keys are still good:** swap the values (`PREVIOUS` becomes the new current, current goes back to PREVIOUS). Lazy upgrades will reverse direction. No data is lost.
- **You haven't yet entered Phase B:** revert the deployment. `K_old` is still the only key in use.

If something goes wrong during Phase C (e.g. a row was missed):

- **Re-enter Phase B**: set `PROJECT_SOURCE_SECRET_KEY_PREVIOUS=<K_old>` again, redeploy. The missed row will decrypt and lazy-upgrade on next read.
- **Worst case** (`K_old` already destroyed): the row's credential is unrecoverable. The owning org must re-enter the password via the admin UI. This is the failure mode rotation is designed to avoid; treat it as a P1 incident if you reach it.

---

## What's NOT in scope of this rotation

- **Per-org keys.** Today every org's connection passwords are encrypted with the same `PROJECT_SOURCE_SECRET_KEY`. Per-org keys would let an org rotate without affecting others. Tracked as a future ADR.
- **Key escrow / HSM.** The key lives in your secrets-store env var, not in an HSM. Migrating to KMS-managed keys is a separate work item.
- **Re-keying entries other than SQL connection passwords.** The helper is currently only used by `sql-connections.service.ts`. If a future feature stores encrypted data through the same helper, it benefits from this rotation automatically.

---

## Related references

- `src/shared/crypto/aes-gcm.ts` — versioned encrypt + dual-key decrypt + upgrade hint
- `src/modules/sql-connections/application/services/sql-connections.service.ts` — `scheduleCiphertextUpgrade` is the lazy-upgrade hook
- `src/shared/config/config.service.ts` — boot-time validation of both keys
- `.env.example` — env-var documentation block
