function createUserDisplayNameUtils({
  normalizeDisplayName,
  getFirebaseAdminFirestore,
  firestoreBatchGetMax = 100,
}) {
  function resolveDisplayNameFromFirestoreDoc(data) {
    if (!data || typeof data !== 'object') return '';

    const directCandidates = [
      data.display_name,
      data.displayName,
      data.name,
      data.full_name,
      data.fullName,
    ];
    for (const candidate of directCandidates) {
      const normalized = normalizeDisplayName(candidate);
      if (normalized) return normalized;
    }

    const firstName = normalizeDisplayName(data.first_name || data.firstName);
    const lastName = normalizeDisplayName(data.last_name || data.lastName);
    return normalizeDisplayName(`${firstName} ${lastName}`);
  }

  async function getFirestoreUserDisplayNameMap(firebaseUids) {
    const uniqueUids = Array.from(
      new Set(
        (Array.isArray(firebaseUids) ? firebaseUids : [])
          .map((uid) => String(uid || '').trim())
          .filter(Boolean),
      ),
    );
    const namesByUid = new Map();
    if (uniqueUids.length === 0) return namesByUid;

    let firestore;
    try {
      firestore = getFirebaseAdminFirestore();
    } catch (error) {
      console.warn(`Firestore name lookup skipped: ${error.message}`);
      return namesByUid;
    }

    for (let start = 0; start < uniqueUids.length; start += firestoreBatchGetMax) {
      const uidBatch = uniqueUids.slice(start, start + firestoreBatchGetMax);
      const docRefs = uidBatch.map((uid) => firestore.collection('users').doc(uid));

      try {
        const snapshots = await firestore.getAll(...docRefs);
        snapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) return;
          const name = resolveDisplayNameFromFirestoreDoc(snapshot.data());
          if (name) {
            namesByUid.set(uidBatch[index], name);
          }
        });
      } catch (error) {
        console.warn(`Firestore name lookup batch failed: ${error.message}`);
      }
    }

    return namesByUid;
  }

  async function hydrateDriverOrderCustomerNames(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const missingNameUids = [];
    for (const row of rows) {
      const sqlName = normalizeDisplayName(row.customer_name);
      if (sqlName) {
        row.customer_name = sqlName;
        continue;
      }
      const uid = String(row.customer_firebase_uid || '').trim();
      if (uid) missingNameUids.push(uid);
    }

    const firestoreNames = await getFirestoreUserDisplayNameMap(missingNameUids);
    for (const row of rows) {
      if (normalizeDisplayName(row.customer_name)) continue;
      const uid = String(row.customer_firebase_uid || '').trim();
      const firestoreName = uid ? normalizeDisplayName(firestoreNames.get(uid)) : '';
      row.customer_name = firestoreName || 'Customer';
    }
  }

  return {
    resolveDisplayNameFromFirestoreDoc,
    getFirestoreUserDisplayNameMap,
    hydrateDriverOrderCustomerNames,
  };
}

module.exports = { createUserDisplayNameUtils };
