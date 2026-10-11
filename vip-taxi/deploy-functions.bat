@echo off
chcp 65001 >nul
echo === ติดตั้งแพ็กเกจของ Cloud Functions ===
cd functions
call npm install --no-audit --no-fund
cd ..
echo === อัปโหลด Cloud Functions + กฎฐานข้อมูล ===
call firebase deploy --only functions,firestore:rules
echo.
echo ถ้าขึ้นข้อความให้อัปเกรดเป็นแผน Blaze ให้อัปเกรดในหน้า Firebase Console ก่อน แล้วรันไฟล์นี้ใหม่
pause
