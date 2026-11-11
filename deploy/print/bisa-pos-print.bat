@echo off
rem Buka Bisa POS di Chrome/Edge dengan cetak otomatis (tanpa dialog).
rem Set printer thermal sebagai DEFAULT di Windows.
rem Pakai: bisa-pos-print.bat [URL]
rem Tanpa argumen, default ke alamat LAN server. Ganti IP di baris URL bila berubah.
rem Contoh LAN: bisa-pos-print.bat http://192.168.18.253:3000/app/pos
setlocal
set "URL=%~1"
if "%URL%"=="" set "URL=http://192.168.18.253:3000/app/pos"

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not defined BROWSER (
  echo Chrome atau Edge tidak ditemukan. Pasang Chrome/Edge dahulu.
  pause
  exit /b 1
)

start "" "%BROWSER%" --kiosk-printing --user-data-dir="%LocalAppData%\BisaPosPrint" --no-first-run --disable-pinch --overscroll-history-navigation=0 --app="%URL%"
