/**
 * MindPA Cloud Functions — replaces the 5 Postgres RPCs the app used on
 * Supabase (student_login, admin_get_students, admin_get_contacts,
 * get_contact_count, admin_delete_contact). These run with the Admin SDK,
 * which bypasses firestore.rules entirely — that's what lets the rules stay
 * locked down (students/contact_submissions unreadable, admin_config
 * unreadable/unwritable) for direct client access while still allowing
 * these gated server-side reads.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const bcrypt = require('bcryptjs');

initializeApp();
const db = getFirestore();

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  return new Date(ts).getTime();
}

function tsToIso(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  return new Date(ts).toISOString();
}

// Mirrors public.admin_verify(pw): bcrypt-compare pw against
// admin_config.password_hash (was pgcrypto's crypt(), same $2a$ format).
async function verifyAdminPassword(pw) {
  if (!pw) return false;
  const snap = await db.collection('admin_config').doc('main').get();
  if (!snap.exists) return false;
  const hash = snap.data().password_hash;
  if (!hash) return false;
  return bcrypt.compare(pw, hash);
}

function requireAdmin(pw) {
  return verifyAdminPassword(pw).then((ok) => {
    if (!ok) throw new HttpsError('permission-denied', 'Kata laluan admin tidak sah');
  });
}

// Mirrors public.student_login(p_no_matrik, p_no_ic)
exports.studentLogin = onCall(async (request) => {
  const noMatrik = String(request.data?.noMatrik ?? '').trim();
  const noIc = String(request.data?.noIc ?? '').trim();
  if (!noMatrik || !noIc) return [];

  const snap = await db.collection('students')
    .where('no_matrik', '==', noMatrik)
    .where('no_ic', '==', noIc)
    .get();

  if (snap.empty) return [];

  let latest = null;
  snap.forEach((doc) => {
    const d = doc.data();
    if (!latest || toMillis(d.created_at) > toMillis(latest.created_at)) {
      latest = { id: doc.id, ...d };
    }
  });

  return [{
    id: latest.id,
    nama: latest.nama,
    no_matrik: latest.no_matrik,
    no_ic: latest.no_ic,
    no_tel: latest.no_tel,
  }];
});

// Mirrors public.admin_get_students(pw): latest registration per no_matrik,
// left-joined with the latest response per (no_matrik, activity_key) —
// joined by no_matrik (not student id) so responses tied to older duplicate
// registrations still surface under the current record, same as the SQL.
exports.adminGetStudents = onCall(async (request) => {
  await requireAdmin(request.data?.pw);

  const [studentsSnap, responsesSnap] = await Promise.all([
    db.collection('students').get(),
    db.collection('activity_responses').get(),
  ]);

  const allStudents = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const latestByMatrik = new Map();
  for (const s of allStudents) {
    const cur = latestByMatrik.get(s.no_matrik);
    if (!cur || toMillis(s.created_at) > toMillis(cur.created_at)) {
      latestByMatrik.set(s.no_matrik, s);
    }
  }

  const idToMatrik = new Map(allStudents.map((s) => [s.id, s.no_matrik]));

  const latestResponse = new Map();
  responsesSnap.forEach((doc) => {
    const r = doc.data();
    const matrik = idToMatrik.get(r.student_id);
    if (!matrik) return;
    const key = `${matrik}|${r.activity_key}`;
    const cur = latestResponse.get(key);
    if (!cur || toMillis(r.created_at) > toMillis(cur.created_at)) {
      latestResponse.set(key, { ...r, no_matrik: matrik });
    }
  });

  const responsesByMatrik = new Map();
  for (const r of latestResponse.values()) {
    if (!responsesByMatrik.has(r.no_matrik)) responsesByMatrik.set(r.no_matrik, []);
    responsesByMatrik.get(r.no_matrik).push(r);
  }

  const rows = [];
  for (const [matrik, s] of latestByMatrik.entries()) {
    const responses = responsesByMatrik.get(matrik) || [];
    if (responses.length === 0) {
      rows.push({
        no_matrik: matrik, nama: s.nama, no_ic: s.no_ic, no_tel: s.no_tel,
        daftar_terkini: tsToIso(s.created_at),
        activity_key: null, payload: null, jawapan_pada: null,
      });
    } else {
      for (const r of responses) {
        rows.push({
          no_matrik: matrik, nama: s.nama, no_ic: s.no_ic, no_tel: s.no_tel,
          daftar_terkini: tsToIso(s.created_at),
          activity_key: r.activity_key, payload: r.payload, jawapan_pada: tsToIso(r.created_at),
        });
      }
    }
  }
  rows.sort((a, b) => a.nama.localeCompare(b.nama) || String(a.activity_key || '').localeCompare(String(b.activity_key || '')));

  return rows;
});

// Mirrors public.admin_get_contacts(pw)
exports.adminGetContacts = onCall(async (request) => {
  await requireAdmin(request.data?.pw);

  const snap = await db.collection('contact_submissions').orderBy('created_at', 'desc').get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return { id: doc.id, name: d.name, jabatan: d.jabatan, phone: d.phone, created_at: tsToIso(d.created_at) };
  });
});

// Mirrors public.get_contact_count() — no password gate, matches original
exports.getContactCount = onCall(async () => {
  const snap = await db.collection('contact_submissions').count().get();
  return snap.data().count;
});

// Mirrors public.admin_delete_contact(pw, contact_id)
exports.adminDeleteContact = onCall(async (request) => {
  await requireAdmin(request.data?.pw);

  const contactId = request.data?.contactId;
  if (!contactId) throw new HttpsError('invalid-argument', 'contactId diperlukan');

  await db.collection('contact_submissions').doc(contactId).delete();
  return { success: true };
});
