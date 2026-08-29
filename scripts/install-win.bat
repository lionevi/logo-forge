@echo off
REM Installation de Logo Forge pour Adobe Illustrator - Windows.
REM
REM A lancer depuis le dossier du projet : le dossier dist\ doit etre a cote.
REM Les droits administrateur ne sont pas necessaires : l'extension va dans le
REM dossier de l'utilisateur, que Illustrator lit aussi bien.

setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo === Installation de Logo Forge ===
echo.

set "EXT=%APPDATA%\Adobe\CEP\extensions\com.lionevi.logoforge"

REM --- 1. Ce qu'on installe doit exister -----------------------------------
if not exist "dist\index.html" goto :nodist
if not exist "dist\jsx\main.jsx" goto :nodist

REM --- 2. Illustrator doit etre ferme ---------------------------------------
tasklist /FI "IMAGENAME eq Illustrator.exe" 2>nul | find /I "Illustrator.exe" >nul
if not errorlevel 1 (
  echo ARRET  Illustrator est ouvert.
  echo        Fermez-le puis relancez : il garde en memoire l'ancienne
  echo        extension, et l'installation passerait inapercue.
  exit /b 1
)

REM --- 3. Extensions non signees --------------------------------------------
echo Autorisation des extensions non signees...
for %%V in (9 10 11 12 13) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)

REM --- 4. Copie --------------------------------------------------------------
REM Le dossier est remplace, pas complete : un fichier perime qui subsiste
REM ferait croire a une regression. /H emporte les fichiers caches, dont
REM .debug, sans lequel une extension non signee ne se charge pas.
echo Installation vers : %EXT%
if exist "%EXT%" rmdir /S /Q "%EXT%"
mkdir "%EXT%" 2>nul
xcopy /E /I /Y /H /Q "dist\*" "%EXT%\" >nul
if errorlevel 1 (
  echo ECHEC  la copie a echoue.
  exit /b 1
)

REM --- 5. Verification -------------------------------------------------------
echo.
echo Verification...
set FAILED=0
for %%F in ("index.html" "jsx\main.jsx" "js\export-engine.js" "CSXS\manifest.xml" ".debug") do (
  if exist "%EXT%\%%~F" (
    for %%A in ("%EXT%\%%~F") do set "HERE=%%~zA"
    for %%B in ("dist\%%~F") do set "THERE=%%~zB"
    if "!HERE!"=="!THERE!" (
      echo    OK      %%~F  !HERE! octets
    ) else (
      echo    ECART   %%~F  !HERE! octets sur place, !THERE! attendus
      set FAILED=1
    )
  ) else (
    echo    ABSENT  %%~F
    set FAILED=1
  )
)

echo.
if "%FAILED%"=="1" (
  echo === ECHEC : l'installation est incomplete ===
  exit /b 1
)

echo === Installation terminee ===
echo.
echo Lancez Illustrator, puis Fenetre ^> Extensions ^> Logo Forge.
echo Si le panneau reste vide : Reglages ^> Diagnostics ^> Verifier jsx/main.jsx.
pause
exit /b 0

:nodist
echo ARRET  dist\ est absent ou incomplet.
echo        Depuis les sources : npm ci ^&^& npm run build
exit /b 1
