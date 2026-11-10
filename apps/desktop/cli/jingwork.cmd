@echo off
setlocal DisableDelayedExpansion
if not defined USERPROFILE exit /b 1
set "DSH_HOME=%USERPROFILE%\.jingwork"
set "DSH_AGENTS_HOME=%DSH_HOME%\agents"
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\..\..\JingWork.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*
exit /b %errorlevel%
