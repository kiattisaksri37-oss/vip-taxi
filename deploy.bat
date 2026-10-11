@echo off
chcp 65001 >nul
echo === เตรียมไฟล์เว็บ ===
if exist public rmdir /s /q public
mkdir public\driver
copy /y admin\index.html public\index.html >nul
copy /y driver\www\index.html public\driver\index.html >nul
copy /y firebase-config.js public\firebase-config.js >nul
copy /y firebase-config.js public\driver\firebase-config.js >nul
echo === อัปโหลดขึ้น Firebase ===
call firebase deploy --only hosting,firestore:rules
echo.
echo เสร็จแล้ว เปิดระบบหลังบ้านที่ https://taxi-vip-rental.web.app/
echo แอปคนขับเวอร์ชันเว็บที่ https://taxi-vip-rental.web.app/driver/
pause
