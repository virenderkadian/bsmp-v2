@echo off
REM Double-click this to bring the WhatsApp gateway up.
REM
REM It starts OpenWA, waits for it, starts the WhatsApp session, and opens the
REM dashboard. If the number is already linked there is nothing to do; if it
REM is not, the dashboard shows a QR to scan.
REM
REM Edit OPENWA_PATH below if OpenWA is not at C:\openwa.

set OPENWA_PATH=C:\openwa

node "%~dp0start.js"

REM Keeps this window open so any error stays readable rather than flashing past.
echo.
pause
