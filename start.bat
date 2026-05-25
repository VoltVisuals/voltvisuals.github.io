@echo off
chcp 65001 >nul
cd /d "%~dp0server"
echo Установка зависимостей...
call npm install
if errorlevel 1 exit /b 1
echo.
echo Запуск VoltVisuals на http://localhost:3000
echo Открывайте сайт ТОЛЬКО по этому адресу (не через GitHub Pages)
echo Админ: Lynivich / viva2288
echo.
call npm start
