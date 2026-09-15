@echo off
rem Runs the terminal client without tripping PowerShell script policy.
rem PowerShell blocks npm.ps1 when execution policy is Restricted; npm.cmd is unaffected.
setlocal
cd /d "%~dp0"
call npm.cmd run play -- %*
