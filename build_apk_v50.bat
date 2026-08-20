@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo ============================================
echo Cordova Android APK Build Script V5.0
echo ============================================
echo.

REM ===== Set environment variables =====
set "JAVA_HOME=C:\jdk17\jdk-17.0.13+11"
set "ANDROID_HOME=C:\Android\Sdk"
set "ANDROID_SDK_ROOT=C:\Android\Sdk"

REM Node/npm paths (from TRAE installation)
set "NODE_DIR=C:\Users\36108\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\cmdline-tools\latest\bin;%NODE_DIR%;%PATH%"

REM ===== Sync files to Cordova www =====
echo Syncing V5.0 files to Cordova www...
echo.

copy /Y "%~dp0demo.html" "%~dp0tcg_app\www\index.html" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy demo.html to www/index.html
    exit /b 1
)
echo [OK] Copied demo.html -^> www/index.html

copy /Y "%~dp0config.xml" "%~dp0tcg_app\config.xml" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy config.xml
    exit /b 1
)
echo [OK] Copied config.xml

if exist "%~dp0vehicles_data.js" (
    copy /Y "%~dp0vehicles_data.js" "%~dp0tcg_app\www\js\vehicles_data.js" >nul
    echo [OK] Copied vehicles_data.js
)

if exist "%~dp0vehicle_images" (
    xcopy /E /I /Y "%~dp0vehicle_images" "%~dp0tcg_app\www\vehicle_images" >nul
    echo [OK] Copied vehicle_images/
)

if exist "%~dp0images" (
    xcopy /E /I /Y "%~dp0images" "%~dp0tcg_app\www\images" >nul
    echo [OK] Copied images/
)

echo.
echo File sync complete.
echo.

REM ===== Change to Cordova project directory =====
cd /d "%~dp0tcg_app"
if errorlevel 1 (
    echo ERROR: Cannot change to tcg_app directory
    exit /b 1
)
echo Current directory: %CD%
echo.

echo Checking Java...
java -version 2>&1
if errorlevel 1 (
    echo ERROR: Java not found. Check JAVA_HOME=%JAVA_HOME%
    exit /b 1
)
echo.

echo Checking Node...
node --version
if errorlevel 1 (
    echo ERROR: Node not found. Check NODE_DIR=%NODE_DIR%
    exit /b 1
)
echo.

REM ===== Check Cordova CLI =====
if exist "node_modules\.bin\cordova.cmd" (
    echo Cordova CLI found in node_modules.
) else (
    echo Installing Cordova CLI...
    call npm install cordova --no-save
)
echo.

REM ===== Setup Gradle Wrapper (if not present) =====
set "PLATFORM_DIR=platforms\android"
set "TOOLS_DIR=%PLATFORM_DIR%\tools"
set "WRAPPER_DIR=%TOOLS_DIR%\gradle\wrapper"

if not exist "%TOOLS_DIR%\gradlew.bat" (
    if not exist "%WRAPPER_DIR%\gradle-wrapper.jar" (
        echo Setting up Gradle wrapper...
        if not exist "%WRAPPER_DIR%" mkdir "%WRAPPER_DIR%"

        set "WRAPPER_JAR_URL=https://raw.githubusercontent.com/gradle/gradle/v8.14.2/gradle/wrapper/gradle-wrapper.jar"
        curl.exe -L -o "%WRAPPER_DIR%\gradle-wrapper.jar" "!WRAPPER_JAR_URL!" 2>nul

        if exist "%WRAPPER_DIR%\gradle-wrapper.jar" (
            echo gradle-wrapper.jar downloaded.
        ) else (
            echo WARNING: Failed to download gradle-wrapper.jar
        )
    )
)

REM ===== Patch ProjectBuilder.js (use local gradle wrapper if present) =====
if exist "%~dp0patch_projectbuilder.js" (
    node "%~dp0patch_projectbuilder.js"
    echo.
) else (
    echo Skipping ProjectBuilder patch (script not found).
    echo.
)

REM ===== Build APK =====
echo ============================================
echo Building V5.0 APK...
echo ============================================
echo.

if exist "node_modules\.bin\cordova.cmd" (
    call node_modules\.bin\cordova.cmd build android --debug
) else (
    call npx cordova build android --debug
)

if errorlevel 1 (
    echo.
    echo ============================================
    echo ERROR: Cordova build failed!
    echo ============================================
    exit /b 1
)

REM ===== Verify and copy APK =====
set "APK_PATH=%PLATFORM_DIR%\app\build\outputs\apk\debug\app-debug.apk"
if exist "%APK_PATH%" (
    echo.
    echo ============================================
    echo BUILD SUCCESSFUL!
    echo ============================================
    for %%I in ("%APK_PATH%") do echo APK size: %%~zI bytes

    copy /Y "%APK_PATH%" "%~dp0???????V5.0.apk" >nul
    echo APK saved as: ???????V5.0.apk
) else (
    echo.
    echo ERROR: APK not found at expected location!
    exit /b 1
)

echo.
echo V5.0 Build process complete.
