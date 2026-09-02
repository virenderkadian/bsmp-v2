@echo off
REM Double-click this to start sending queued messages to customers.
REM
REM Deliberately separate from "START WHATSAPP.bat". That one only brings the
REM WhatsApp connection up, which is safe to do any time — to check it, or to
REM rescan a QR. THIS one sends real messages to real customers, so it gets its
REM own click rather than riding along with the connection.
REM
REM Requires: OpenWA already running (use START WHATSAPP.bat first) and
REM agent\.env filled in. The agent refuses to start if the WhatsApp session
REM is not linked, rather than failing every message.
REM
REM Leave this window open while it sends. Closing it stops sending; anything
REM not yet sent stays queued and resumes next time.

cd /d "%~dp0.."

if not exist ".env" (
  echo.
  echo   No .env file found in %CD%
  echo   Copy .env.example to .env and fill it in first.
  echo.
  pause
  exit /b 1
)

node index.js

echo.
echo   Sending has stopped. Anything unsent is still queued.
pause
