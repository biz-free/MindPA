import json

with open('raw_export.json') as f:
    raw = json.load(f)

firestore_data = {}

# students -> doc id = original uuid
firestore_data['students'] = {
    row['id']: {
        'nama': row['nama'],
        'no_ic': row['no_ic'],
        'no_tel': row['no_tel'],
        'no_matrik': row['no_matrik'],
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }
    for row in raw['students']
}

# activity_config -> doc id = activity_key (natural key, matches Postgres PK)
firestore_data['activity_config'] = {
    row['activity_key']: {
        'label': row['label'],
        'domain': row['domain'],
        'sort_order': row['sort_order'],
        'is_active': row['is_active'],
        'updated_at': row['updated_at'],
    }
    for row in raw['activity_config']
}

# activity_responses -> doc id = "resp_<original bigint id>" (keeps it stable & traceable)
firestore_data['activity_responses'] = {
    f"resp_{row['id']}": {
        'student_id': row['student_id'],
        'activity_key': row['activity_key'],
        'payload': row['payload'],
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }
    for row in raw['activity_responses']
}

# admin_config -> single doc, id "main"
firestore_data['admin_config'] = {
    'main': {
        'password_hash': raw['admin_config'][0]['password_hash'],
    }
}

# contact_submissions -> doc id = original uuid
firestore_data['contact_submissions'] = {
    row['id']: {
        'name': row['name'],
        'jabatan': row['jabatan'],
        'phone': row['phone'],
        'created_at': row['created_at'],
    }
    for row in raw['contact_submissions']
}

with open('firestore_import_data.json', 'w', encoding='utf-8') as f:
    json.dump(firestore_data, f, ensure_ascii=False, indent=2)

# quick summary + duplicate detection (informational only, nothing is dropped)
print("=== Document counts per collection ===")
for k, v in firestore_data.items():
    print(f"  {k}: {len(v)} docs")

print("\n=== Duplicate student registrations detected (by no_matrik) ===")
seen = {}
for row in raw['students']:
    seen.setdefault(row['no_matrik'], []).append(row['nama'])
dupe_count = 0
for matrik, names in seen.items():
    if len(names) > 1:
        dupe_count += 1
        print(f"  {matrik} ({names[0]}) -> {len(names)} entries")
print(f"\nTotal matrik numbers with >1 registration: {dupe_count} (all preserved as-is in export)")
