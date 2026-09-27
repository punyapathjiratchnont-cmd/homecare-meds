import { 
    collection, 
    getDocs, 
    doc, 
    updateDoc, 
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';

/**
 * ตรวจสอบและแสดงรายการบ้านเก่าที่ไม่มี memberIds (Dry Run)
 * ไม่มีการเขียนข้อมูลลงฐานข้อมูลจริง
 */
export async function dryRunMigration() {
    console.log("🔍 [DRY RUN] เริ่มต้นค้นหาบ้านเก่าที่ต้องการ Migration...");
    
    try {
        const ref = collection(db, 'households');
        const snap = await getDocs(ref);
        
        const targets = [];
        let skipCount = 0;

        snap.forEach((docSnap) => {
            const data = docSnap.data();
            
            // ข้ามบ้านที่มี memberIds อยู่แล้ว (ป้องกัน Overwrite)
            if (data.memberIds && Array.isArray(data.memberIds) && data.memberIds.length > 0) {
                skipCount++;
                return;
            }

            // ต้องมีอาร์เรย์ members ให้สกัดข้อมูล
            if (!data.members || !Array.isArray(data.members)) {
                console.warn(`⚠️ บ้าน ${docSnap.id} ข้าม: ไม่มีโครงสร้าง members แบบ Array`);
                return;
            }

            // สกัด ID ออกมา
            const extractedIds = data.members.map(m => m.id).filter(id => id); // ป้องกันค่า null
            
            targets.push({
                id: docSnap.id,
                name: data.name,
                oldMembersCount: data.members.length,
                newMemberIds: extractedIds
            });
        });

        console.log(`✅ พบเป้าหมายที่ต้องอัปเดต: ${targets.length} รายการ (ข้ามบ้านที่มี memberIds แล้ว: ${skipCount} รายการ)`);
        if (targets.length > 0) {
            console.table(targets);
            console.log("💡 หากต้องการอัปเดตจริง ให้รันฟังก์ชัน executeMigration()");
        }
        
        return targets;
    } catch (e) {
        console.error("❌ เกิดข้อผิดพลาดในการดึงข้อมูล:", e);
    }
}

/**
 * ดำเนินการอัปเดต memberIds ลงฐานข้อมูลจริง
 * แนะนำให้รัน dryRunMigration() ก่อนเพื่อเช็คความถูกต้อง
 */
export async function executeMigration() {
    const targets = await dryRunMigration(); // ดึงข้อมูลชุดเดิมมาทำสอบอีกรอบ
    if (!targets || targets.length === 0) {
        console.log("ℹ️ ไม่มีบ้านที่ต้องการอัปเดต ยกเลิกการทำงาน");
        return;
    }

    console.log(`⚠️ [EXECUTE] กำลังเริ่มเขียนข้อมูล ${targets.length} รายการ...`);
    const batch = writeBatch(db);
    let updateCount = 0;

    // จำกัด Batch ที่ 500 รายการตามลิมิตของ Firestore (ถ้าเกินต้องแบ่งทีละ chunk)
    const MAX_BATCH = 500;
    
    for (const target of targets) {
        if (updateCount >= MAX_BATCH) {
            console.warn(`⏳ ทำรายการถึงขีดจำกัด Batch (${MAX_BATCH}) แล้ว หากมีมากกว่านี้ ต้องรันสคริปต์ซ้ำ`);
            break;
        }
        
        // เช็คขั้นสุดท้ายว่ามีข้อมูลครบถ้วน และไม่เขียนทับข้อมูลสำคัญอื่นๆ
        if (target.newMemberIds.length > 0) {
            const docRef = doc(db, 'households', target.id);
            // อัปเดตเฉพาะ memberIds
            batch.update(docRef, {
                memberIds: target.newMemberIds
            });
            updateCount++;
        }
    }

    try {
        await batch.commit();
        console.log(`🎉 [SUCCESS] อัปเดตบ้านเก่าจำนวน ${updateCount} รายการ สำเร็จ!`);
        console.log("💡 ตรวจสอบผลลัพธ์อีกครั้งโดยการรัน dryRunMigration()");
    } catch (e) {
        console.error("❌ [ERROR] เกิดข้อผิดพลาดขณะเขียนข้อมูลลงฐานข้อมูล:", e);
    }
}

// เอาฟังก์ชันใส่ Window object ให้เรียกผ่าน Browser Console ได้เลย
window.dryRunMigration = dryRunMigration;
window.executeMigration = executeMigration;
