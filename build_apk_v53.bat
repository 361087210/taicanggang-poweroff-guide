@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo ============================================
echo Cordova Android APK Build Script V5.3
echo (原生HTTP插件 + 数据分仓 + 签名Release包)
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
echo Syncing V5.3 files to Cordova www...
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
echo [OK] Copied config.xml (含 advanced-http 插件声明)

if exist "%~dp0vehicles_data.js" (
    copy /Y "%~dp0vehicles_data.js" "%~dp0tcg_app\www\js\vehicles_data.js" >nul
    echo [OK] Copied vehicles_data.js
)

if exist "%~dp0vendor" (
    xcopy /E /I /Y "%~dp0vendor" "%~dp0tcg_app\www\vendor" >nul
    echo [OK] Copied vendor/ (本地化依赖库, 零CDN外链)
)

if exist "%~dp0vehicle_images" (
    xcopy /E /I /Y "%~dp0vehicle_images" "%~dp0tcg_app\www\vehicle_images" >nul
    echo [OK] Copied vehicle_images/
)

if exist "%~dp0images" (
    xcopy /E /I /Y "%~dp0images" "%~dp0tcg_app\www\images" >nul
    echo [OK] Copied images/ (兼容旧路径引用)
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

REM ===== Ensure plugins (V5.3: advanced-http 新增) =====
echo Checking plugins...
if not exist "plugins\cordova-plugin-advanced-http" (
    echo Adding cordova-plugin-advanced-http...
    call node_modules\.bin\cordova.cmd plugin add cordova-plugin-advanced-http --variable ANDROID_BLACKLIST_SECURE_PROTOCOL=false
    if errorlevel 1 (
        echo WARNING: advanced-http plugin add failed - retry via config.xml prepare
    )
)
echo.

REM ===== V5.3 Release 签名配置 =====
REM keystore 由首次发布时生成, 放在项目根目录 release\keystore\ 下
REM 若无 keystore 则回退 debug 构建(仅限本地调试, 禁止对外分发debug包)
set "KS_DIR=%~dp0release\keystore"
set "KS_FILE=%KS_DIR%\tcg_release.keystore"

if exist "%KS_FILE%" (
    echo [OK] Found release keystore.
    if not exist "platforms\android\release-signing.properties" (
        echo storeFile=%KS_FILE%> "platforms\android\release-signing.properties"
        echo storeType=jks>> "platforms\android\release-signing.properties"
        echo storePassword=Tcg@2026Release>> "platforms\android\release-signing.properties"
        echo keyAlias=tcg_release>> "platforms\android\release-signing.properties"
        echo keyPassword=Tcg@2026Release>> "platforms\android\release-signing.properties"
        echo [OK] Generated release-signing.properties
    )
    set "BUILD_MODE=release"
) else (
    echo WARNING: keystore not found at %KS_FILE%
    echo Falling back to DEBUG build - DO NOT DISTRIBUTE debug APK externally!
    set "BUILD_MODE=debug"
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
echo.

REM ===== Patch ProjectBuilder.js (use local gradle wrapper if present) =====
if exist "%~dp0scripts\patch_projectbuilder.js" (
    node "%~dp0scripts\patch_projectbuilder.js"
    echo.
)

REM ===== Build APK =====
echo ============================================
echo Building V5.3 APK (mode: %BUILD_MODE%)...
echo ============================================
echo.

if "%BUILD_MODE%"=="release" (
    call node_modules\.bin\cordova.cmd build android --release
) else (
    call node_modules\.bin\cordova.cmd build android --debug
)

if errorlevel 1 (
    echo.
    echo ============================================
    echo ERROR: Cordova build failed!
    echo ============================================
    exit /b 1
)

REM ===== Verify and copy APK =====
if "%BUILD_MODE%"=="release" (
    set "APK_PATH=%PLATFORM_DIR%\app\build\outputs\apk\release\app-release.apk"
) else (
    set "APK_PATH=%PLATFORM_DIR%\app\build\outputs\apk\debug\app-debug.apk"
)

if exist "%APK_PATH%" (
    echo.
    echo ============================================
    echo BUILD SUCCESSFUL! (mode: %BUILD_MODE%)
    echo ============================================
    for %%I in ("%APK_PATH%") do echo APK size: %%~zI bytes

    if not exist "%~dp0release" mkdir "%~dp0release"
    copy /Y "%APK_PATH%" "%~dp0release\太仓港断电指导V5.3.apk" >nul
    echo APK saved as: release\太仓港断电指导V5.3.apk

    REM 签名校验 (需要build-tools中的apksigner)
    echo.
    echo Verifying signature...
    call "%ANDROID_HOME%\build-tools\34.0.0\apksigner.bat" verify --print-certs "%~dp0release\太仓港断电指导V5.3.apk" 2>nul
    if errorlevel 1 (
        echo WARNING: apksigner verify failed or not available
    ) else (
        echo [OK] Signature verified (V1+V2)
    )
) else (
    echo.
    echo ERROR: APK not found at expected location: %APK_PATH%
    exit /b 1
)

echo.
echo V5.3 Build process complete.
