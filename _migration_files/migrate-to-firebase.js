/**
 * MindPA (mind-pa-emodul) — Supabase -> Firebase Firestore data migration
 * ---------------------------------------------------------------------
 * WHAT THIS DOES
 *   Reads firestore_import_data.json (already extracted + transformed from
 *   the live Supabase project "mind-pa-emodul") and writes every document
 *   into Firestore using batched writes (max 500 ops/batch, Firestore limit).
 *
 * BEFORE RUNNING
 *   1. npm install firebase-admin
 *   2. In Firebase Console -> Project Settings -> Service accounts ->
 *      "Generate new private key". Save the downloaded JSON as
 *      ./serviceAccountKey.json in this same folder.
 *      (Do NOT commit this file anywhere public — it's a full admin credential.)
 *   3. Confirm firestore_import_data.json sits next to this script.
 *
 * RUN
 *   node migrate-to-firebase.js
 *
 * This script is ADDITIVE ONLY — it uses .set() with merge:true, so running
 * it twice will not duplicate documents (same doc ID = overwrite, not a new row).
 * It does NOT touch or delete anything on the Supabase side.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const dataPath = path.join(__dirname, 'firestore_import_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

const FIRESTORE_TIMESTAMP_FIELDS = ['created_at', 'updated_at'];

function toFirestoreValue(value, key) {
  if (FIRESTORE_TIMESTAMP_FIELDS.includes(key) && typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return value;
}

function convertDoc(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = toFirestoreValue(v, k);
  }
  return out;
}

async function migrateCollection(collectionName, docs) {
  const entries = Object.entries(docs);
  console.log(`\n-> ${collectionName}: ${entries.length} documents`);

  const CHUNK = 450; // stay under Firestore's 500-write batch limit
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = db.batch();
    const chunk = entries.slice(i, i + CHUNK);
    for (const [docId, fields] of chunk) {
      const ref = db.collection(collectionName).doc(docId);
      batch.set(ref, convertDoc(fields), { merge: true });
    }
    await batch.commit();
    console.log(`   committed ${Math.min(i + CHUNK, entries.length)}/${entries.length}`);
  }
}

async function main() {
  console.log('=== MindPA Supabase -> Firestore migration ===');
  for (const collectionName of Object.keys(data)) {
    await migrateCollection(collectionName, data[collectionName]);
  }
  console.log('\n✅ Done. Verify counts in the Firebase Console before touching Supabase.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
