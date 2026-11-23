@echo off
setlocal
set "entry=%~f1"
rem A running Windows process locks its working directory. Release the plugin cache
rem before starting the server so Codex can update or uninstall this version.
cd /d "%USERPROFILE%" || exit /b 1
"%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "%entry%" & exit /b
