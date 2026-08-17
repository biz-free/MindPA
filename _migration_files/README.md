# MindPA (mind-pa-emodul) — Supabase → Firebase Migration Pack

Extracted live from Supabase project `mind-pa-emodul` (trrbzocntfrzsbmurbpn) on 17 Aug 2026.
All 5 tables, 158 rows total — nothing filtered or dropped.

## Files
| File | What it is |
|---|---|
| `raw_export.json` | Exact 1:1 copy of the Supabase data (backup, independent of Firestore) |
| `transform.py` | Script that reshaped the raw export into Firestore's doc-map format |
| `firestore_import_data.json` | Ready-to-import data, one map per collection |
| `migrate-to-firebase.js` | Node script that writes it into Firestore |
| `firestore.rules` | Security rules translated from the original RLS policies |

## Steps to run
1. `npm install firebase-admin`
2. Firebase Console → Project Settings → Service accounts → **Generate new private key** → save as `serviceAccountKey.json` in this folder (keep it private, it's a full admin credential)
3. `node migrate-to-firebase.js`
4. Check the Firebase Console → Firestore to confirm: students (52), activity_config (14), activity_responses (90), admin_config (1), contact_submissions (1)
5. Deploy `firestore.rules` via Firebase Console or `firebase deploy --only firestore:rules`

Script uses `.set(..., {merge:true})`, so re-running it is safe — won't create duplicates.

## Things worth knowing before you go further

**1. 13 matrik numbers have more than one registration** (e.g. `03DEM26F1001` has 7, `03DEM26F1027` has 5) — looks like double-submits from testing/no debounce on the form. All preserved as-is since you asked for full migration; happy to write a dedupe pass separately if you want one.

**2. `admin_config.password_hash` is bcrypt** — technically compatible with Firebase Auth's `importUsers()` if you ever want to move to real Firebase Auth. Right now it's migrated as a plain Firestore doc (`admin_config/main`) matching how it worked in Supabase — a single shared password, not per-user auth.

**3. `activity_config` had a fully-open "anon can update" policy** (any caller could edit any row, no restriction) — carried over as-is in `firestore.rules` since that's how it worked before, but flagged there in a comment. Worth a second look.

**4. This migrates the DATA only.** The actual MindPA app (the frontend that reads/writes `students`, `activity_responses`, etc.) still calls the Supabase client SDK — that code needs to be rewired to Firebase SDK calls before the app itself will work on Firebase. I don't have that app's source in this chat — share it if you want help with that part.

**5. Don't pause/delete the Supabase project yet.** Keep it live until you've confirmed the Firebase side works end-to-end. I don't have a "delete project" tool anyway (only pause, which is reversible) — deletion itself would need to be done by you in the Supabase dashboard once you're confident.
