@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo ============================================
echo Cordova Android APK Build Script v31
echo ============================================
echo.

REM ===== Set environment variables =====
set "JAVA_HOME=C:\jdk17\jdk-17.0.13+11"
set "ANDROID_HOME=C:\Android\Sdk"
set "ANDROID_SDK_ROOT=C:\Android\Sdk"

REM Node/npm paths (from TRAE installation)
set "NODE_DIR=C:\Users\36108\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\cmdline-tools\latest\bin;%NODE_DIR%;%PATH%"

REM ===== Change to project directory =====
REM Use %%~dp0 to get the directory of this .bat file (avoids Chinese chars in script)
cd /d "%~dp0tcg_app"
if errorlevel 1 (
    echo ERROR: Cannot change to project directory
    exit /b 1
)
echo Current directory: %CD%
echo.

REM ===== Verify environment =====
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

echo Checking Android SDK...
if not exist "%ANDROID_HOME%\platforms\android-36" (
    echo WARNING: Android SDK platform 36 not found!
    echo Available platforms:
    dir "%ANDROID_HOME%\platforms" /b
) else (
    echo Android SDK platform 36 found.
)
echo.

REM ===== Install cordova CLI if not present =====
if not exist "node_modules\.bin\cordova.cmd" (
    echo Cordova CLI not found in node_modules. Installing cordova CLI...
    echo.
    call npm install cordova --no-save
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to install cordova CLI via npm.
        echo Trying npx approach instead...
    ) else (
        echo.
        echo Cordova CLI installed successfully.
    )
) else (
    echo Cordova CLI found in node_modules.
)
echo.

REM ===== Setup Gradle Wrapper (if not present) =====
REM The cordova-android builder expects gradlew in platforms/android/tools/
REM Without a system gradle, we need to manually set up the wrapper files.
set "PLATFORM_DIR=platforms\android"
set "TOOLS_DIR=%PLATFORM_DIR%\tools"
set "WRAPPER_DIR=%TOOLS_DIR%\gradle\wrapper"

echo Checking for Gradle wrapper...
if exist "%TOOLS_DIR%\gradlew.bat" (
    if exist "%WRAPPER_DIR%\gradle-wrapper.jar" (
        echo Gradle wrapper already exists. Skipping setup.
        goto :patch_builder
    )
)

echo Gradle wrapper not found. Setting up wrapper files...

REM Create wrapper directory
if not exist "%WRAPPER_DIR%" mkdir "%WRAPPER_DIR%"

REM Download gradle-wrapper.jar from GitHub
echo Downloading gradle-wrapper.jar...
set "WRAPPER_JAR_URL=https://raw.githubusercontent.com/gradle/gradle/v8.14.2/gradle/wrapper/gradle-wrapper.jar"
curl.exe -L -o "%WRAPPER_DIR%\gradle-wrapper.jar" "%WRAPPER_JAR_URL%" 2>nul
if not exist "%WRAPPER_DIR%\gradle-wrapper.jar" (
    echo ERROR: Failed to download gradle-wrapper.jar
    echo Please manually download from: %WRAPPER_JAR_URL%
    exit /b 1
)
echo gradle-wrapper.jar downloaded.

REM Create gradle-wrapper.properties
echo Creating gradle-wrapper.properties...
(
    echo distributionBase=GRADLE_USER_HOME
    echo distributionPath=wrapper/dists
    echo distributionUrl=https\://services.gradle.org/distributions/gradle-8.14.2-bin.zip
    echo networkTimeout=10000
    echo validateDistributionUrl=true
    echo zipStoreBase=GRADLE_USER_HOME
    echo zipStorePath=wrapper/dists
) > "%WRAPPER_DIR%\gradle-wrapper.properties"

REM Create gradlew.bat for tools directory
echo Creating gradlew.bat...
(
    echo @rem Gradle startup script for Windows
    echo @if "%%DEBUG%%"=="" @echo off
    echo if "%%OS%%"=="Windows_NT" setlocal
    echo set DIRNAME=%%~dp0
    echo if "%%DIRNAME%%"=="" set DIRNAME=.
    echo set APP_BASE_NAME=%%~n0
    echo set APP_HOME=%%DIRNAME%%
    echo set APP_HOME=%%APP_HOME:"=%%
    echo set DEFAULT_JVM_OPTS="-Xmx64m" "-Xms64m"
    echo if defined JAVA_HOME goto findJavaFromJavaHome
    echo set JAVA_EXE=java.exe
    echo %%JAVA_EXE%% -version >NUL 2>&1
    echo if %%ERRORLEVEL%% equ 0 goto execute
    echo echo ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.
    echo goto fail
    echo :findJavaFromJavaHome
    echo set JAVA_HOME=%%JAVA_HOME:"=%%
    echo set JAVA_EXE=%%JAVA_HOME%%/bin/java.exe
    echo if exist "%%JAVA_EXE%%" goto execute
    echo echo ERROR: JAVA_HOME is set to an invalid directory: %%JAVA_HOME%%
    echo goto fail
    echo :execute
    echo set CLASSPATH=%%APP_HOME%%\gradle\wrapper\gradle-wrapper.jar
    echo "%%JAVA_EXE%%" %%DEFAULT_JVM_OPTS%% %%JAVA_OPTS%% %%GRADLE_OPTS%% "-Dorg.gradle.appname=%%APP_BASE_NAME%%" -classpath "%%CLASSPATH%%" org.gradle.wrapper.GradleWrapperMain %%*
    echo :end
    echo if %%ERRORLEVEL%% equ 0 goto mainEnd
    echo :fail
    echo set EXIT_CODE=%%ERRORLEVEL%%
    echo if %%EXIT_CODE%% equ 0 set EXIT_CODE=1
    echo if not ""=="%%GRADLE_EXIT_CONSOLE%%" exit %%EXIT_CODE%%
    echo exit /b %%EXIT_CODE%%
    echo :mainEnd
    echo if "%%OS%%"=="Windows_NT" endlocal
    echo :omega
) > "%TOOLS_DIR%\gradlew.bat"

REM Create empty gradlew (Unix script placeholder) for copy operation
echo. > "%TOOLS_DIR%\gradlew"

echo Gradle wrapper setup complete.
echo.

:patch_builder
REM ===== Patch ProjectBuilder.js to skip gradle check when wrapper exists =====
REM Without a system gradle installation, the cordova-android builder fails
REM because it tries to run 'gradle wrapper' to install the wrapper.
REM This patch makes it skip that step if the wrapper files already exist.
set "BUILDER_JS=%PLATFORM_DIR%\..\node_modules\cordova-android\lib\builders\ProjectBuilder.js"
if not exist "%BUILDER_JS%" set "BUILDER_JS=node_modules\cordova-android\lib\builders\ProjectBuilder.js"

echo Checking ProjectBuilder.js patch...
findstr /C:"wrapperExists" "%BUILDER_JS%" >nul 2>&1
if not errorlevel 1 (
    echo ProjectBuilder.js already patched. Skipping.
    goto :build
)

echo Patching ProjectBuilder.js to support pre-existing gradle wrapper...
node -e "const fs=require('fs');const f='%BUILDER_JS%'.replace(/\\\\/g,'/');let c=fs.readFileSync(f,'utf8');const old=\"        return check_reqs.check_gradle()\n            .then(function () {\n                events.emit('verbose', `Using Gradle: ${config.GRADLE_VERSION}`);\n                return self.installGradleWrapper(config.GRADLE_VERSION);\n            }).then(async function () {\";const replacement=\"        const wrapperBatPath = path.join(self.root, 'tools', 'gradlew.bat');\n        const wrapperJarPath = path.join(self.root, 'tools', 'gradle', 'wrapper', 'gradle-wrapper.jar');\n        const wrapperExists = fs.existsSync(wrapperBatPath) && fs.existsSync(wrapperJarPath);\n        const gradleSetupPromise = wrapperExists\n            ? Promise.resolve()\n            : check_reqs.check_gradle()\n                .then(function () {\n                    events.emit('verbose', `Using Gradle: ${config.GRADLE_VERSION}`);\n                    return self.installGradleWrapper(config.GRADLE_VERSION);\n                });\n        return gradleSetupPromise\n            .then(async function () {\";if(c.includes(old)){c=c.replace(old,replacement);fs.writeFileSync(f,c,'utf8');console.log('Patch applied successfully.');}else{console.log('Patch target not found - may already be patched or code changed.');}"
if errorlevel 1 (
    echo WARNING: Failed to patch ProjectBuilder.js
    echo The build may fail if system gradle is not installed.
) else (
    echo Patch applied.
)
echo.

:build
REM ===== Sync www files =====
echo Syncing www files to platform...
echo Updated index.html is at: %CD%\www\index.html
echo.

REM ===== Build APK =====
echo ============================================
echo Building APK...
echo ============================================
echo.

REM Try using locally installed cordova first, fall back to npx
if exist "node_modules\.bin\cordova.cmd" (
    echo Using local cordova CLI...
    call node_modules\.bin\cordova.cmd build android --debug
) else (
    echo Using npx cordova...
    call npx cordova build android --debug
)

if errorlevel 1 (
    echo.
    echo ============================================
    echo ERROR: Cordova build failed!
    echo ============================================
    exit /b 1
)

REM ===== Verify APK =====
set "APK_PATH=%PLATFORM_DIR%\app\build\outputs\apk\debug\app-debug.apk"
if exist "%APK_PATH%" (
    echo.
    echo ============================================
    echo BUILD SUCCESSFUL!
    echo ============================================
    echo APK location: %CD%\%APK_PATH%
    for %%I in ("%APK_PATH%") do echo APK size: %%~zI bytes
    echo.
    dir "%APK_PATH%"
) else (
    echo.
    echo ============================================
    echo ERROR: APK not found at expected location!
    echo Expected: %CD%\%APK_PATH%
    echo ============================================
    exit /b 1
)

echo.
echo Build process complete.
