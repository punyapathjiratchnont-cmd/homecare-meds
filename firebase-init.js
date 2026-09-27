import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    arrayUnion,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================================
// Firebase Config (รวม Analytics measurementId)
// ============================================================
import { firebaseConfig } from './firebase-config.js';

// ============================================================
// Initialize Firebase Services
// ============================================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Analytics (ทำงานได้เฉพาะผ่าน HTTP/HTTPS ไม่ใช่ file://)
let analytics = null;
try {
    if (window.location.protocol !== 'file:') {
        analytics = getAnalytics(app);
        console.info('[Firebase] Analytics initialized ✅');
    }
} catch (e) {
    console.warn('[Firebase] Analytics skipped:', e.message);
}

console.info('[Firebase] Connected to project:', firebaseConfig.projectId, '✅');

// ============================================================
// AUTH — Email & Password
// ============================================================

/** สมัครบัญชีใหม่ด้วยอีเมล */
async function signup(email, password, displayName = '') {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName && cred.user) {
        try {
            await updateProfile(cred.user, { displayName });
        } catch (e) {
            console.warn('[Auth] updateProfile error:', e);
        }
    }
    if (analytics) logEvent(analytics, 'sign_up', { method: 'email' });
    return cred.user;
}

/** เข้าสู่ระบบด้วยอีเมล */
async function login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (analytics) logEvent(analytics, 'login', { method: 'email' });
    return cred.user;
}

/** ออกจากระบบ */
async function logout() {
    await signOut(auth);
}

/** ติดตามสถานะการล็อกอิน */
function watchAuthState(onLogin, onLogout) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            onLogin(user);
        } else {
            onLogout();
        }
    });
}

// ============================================================
// FIRESTORE — Households (บ้าน/ครัวเรือน)
// ============================================================

/** สร้างบ้านใหม่ใน Firestore */
async function createHousehold(householdData) {
    const batch = writeBatch(db);
    
    // 1. สร้าง Household Doc
    const householdRef = doc(collection(db, 'households'));
    batch.set(householdRef, {
        ...householdData,
        createdAt: serverTimestamp(),
        escalationMinutes: householdData.escalationMinutes || 20,
        repeatMinutes: householdData.repeatMinutes || 40,
        memberIds: [householdData.adminId],
        members: [{
            id: householdData.adminId,
            name: householdData.adminName || 'แอดมิน',
            role: 'แอดมินบ้าน',
            joinedAt: new Date().toISOString()
        }]
    });
    
    // 2. สร้าง Invite Code Doc (ถ้ามี)
    if (householdData.inviteCode) {
        const inviteRef = doc(db, 'inviteCodes', householdData.inviteCode.toUpperCase());
        batch.set(inviteRef, { householdId: householdRef.id, householdName: householdData.name });
    }

    // 3. ยืนยันการเขียนทั้งคู่พร้อมกัน (Atomic)
    await batch.commit();

    return householdRef.id;
}

/** โหลดข้อมูลบ้านด้วย ID */
async function getHousehold(householdId) {
    const snap = await getDoc(doc(db, 'households', householdId));
    if (snap.exists()) return { id: snap.id, ...snap.data() };
    return null;
}

/** ค้นหาบ้านด้วยรหัสเชิญ */
async function findHouseholdByInviteCode(inviteCode) {
    const code = inviteCode.toUpperCase().trim();
    const snap = await getDoc(doc(db, 'inviteCodes', code));
    if (!snap.exists()) return null;
    return { id: snap.data().householdId, inviteCode: code, name: snap.data().householdName };
}

/** เข้าร่วมบ้านโดยเพิ่มสมาชิก */
async function joinHousehold(householdId, memberData, inviteCode) {
    const ref = doc(db, 'households', householdId);
    await updateDoc(ref, {
        memberIds: arrayUnion(memberData.id),
        members: arrayUnion({
            ...memberData,
            role: memberData.role || 'สมาชิก',
            joinedAt: new Date().toISOString()
        }),
        joinCode: inviteCode // For Firestore rules validation
    });
}

/** อัปเดตการตั้งค่าบ้าน */
async function updateHousehold(householdId, updates) {
    const ref = doc(db, 'households', householdId);
    await updateDoc(ref, updates);
}

/** ฟัง Realtime ข้อมูลบ้าน — คืน unsubscribe function */
function watchHousehold(householdId, callback) {
    const ref = doc(db, 'households', householdId);
    return onSnapshot(ref, (snap) => {
        if (snap.exists()) callback({ id: snap.id, ...snap.data() });
    });
}

// ============================================================
// FIRESTORE — Patients (ผู้ป่วย)
// ============================================================

/** เพิ่มผู้ป่วยในบ้าน */
async function addPatientToHousehold(householdId, patientData) {
    const ref = collection(db, 'households', householdId, 'patients');
    const docRef = await addDoc(ref, {
        ...patientData,
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

/** โหลดผู้ป่วยทั้งหมดในบ้าน */
async function getPatientsInHousehold(householdId) {
    const ref = collection(db, 'households', householdId, 'patients');
    const snap = await getDocs(ref);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** อัปเดตข้อมูลผู้ป่วย */
async function updatePatient(householdId, patientId, updates) {
    const ref = doc(db, 'households', householdId, 'patients', patientId);
    await updateDoc(ref, updates);
}

/** ลบผู้ป่วย */
async function deletePatient(householdId, patientId) {
    const ref = doc(db, 'households', householdId, 'patients', patientId);
    await deleteDoc(ref);
}

// ============================================================
// FIRESTORE — Dose Records (บันทึกการกินยา)
// ============================================================

/** บันทึกว่ากินยาแล้ว */
async function saveDoseRecord(householdId, record) {
    const key = `${record.patientId}_${record.date}_${record.slotId}`;
    const ref = doc(db, 'households', householdId, 'doseRecords', key);
    await setDoc(ref, {
        ...record,
        status: 'taken',
        savedAt: serverTimestamp()
    });
    return key;
}

/** โหลด dose records ทั้งหมด */
async function getDoseRecords(householdId) {
    const ref = collection(db, 'households', householdId, 'doseRecords');
    const snap = await getDocs(ref);
    const result = {};
    snap.docs.forEach(d => { result[d.id] = d.data(); });
    return result;
}

/** ลบ dose record (กรณีกดผิด) */
async function deleteDoseRecord(householdId, recordKey) {
    const ref = doc(db, 'households', householdId, 'doseRecords', recordKey);
    await deleteDoc(ref);
}

/** ฟัง Realtime dose records — คืน unsubscribe function */
function watchDoseRecords(householdId, callback) {
    const ref = collection(db, 'households', householdId, 'doseRecords');
    return onSnapshot(ref, (snap) => {
        const result = {};
        snap.docs.forEach(d => { result[d.id] = d.data(); });
        callback(result);
    });
}

// ============================================================
// FIRESTORE — Activity Log (ประวัติกิจกรรม)
// ============================================================

/** เพิ่ม activity log */
async function addActivityLog(householdId, activity) {
    const ref = collection(db, 'households', householdId, 'activities');
    await addDoc(ref, {
        ...activity,
        createdAt: serverTimestamp()
    });
}

/** โหลด activities ล่าสุด */
async function getRecentActivities(householdId, limitCount = 50) {
    const ref = collection(db, 'households', householdId, 'activities');
    const q = query(ref, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.slice(0, limitCount).map(d => ({ id: d.id, ...d.data() }));
}

// ============================================================
// Legacy (เดิม — ยังรองรับอยู่)
// ============================================================

/** @deprecated ใช้ addPatientToHousehold แทน */
async function addPatient(uid, patientData) {
    const ref = collection(db, 'patients');
    const docRef = await addDoc(ref, {
        ...patientData,
        ownerId: uid,
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

/** @deprecated ใช้ getPatientsInHousehold แทน */
async function getMyPatients(uid) {
    const ref = collection(db, 'patients');
    const q = query(ref, where('ownerId', '==', uid));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ============================================================
// Exports
// ============================================================
export {
    // Auth
    signup, login, logout, watchAuthState,
    // Households
    createHousehold, getHousehold, findHouseholdByInviteCode,
    joinHousehold, updateHousehold, watchHousehold,
    // Patients
    addPatientToHousehold, getPatientsInHousehold, updatePatient, deletePatient,
    // Dose Records
    saveDoseRecord, getDoseRecords, deleteDoseRecord, watchDoseRecords,
    // Activities
    addActivityLog, getRecentActivities,
    // Legacy
    addPatient, getMyPatients,
    // Instances
    auth, db, analytics
};