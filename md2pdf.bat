@echo off
setlocal

if "%~1"=="" (
    echo Usage:
    echo md2pdf input.md [output.pdf]
    exit /b 1
)

set INPUT=%~1

if "%~2"=="" (
    set OUTPUT=%~dpn1.pdf
) else (
    set OUTPUT=%~2
)

set TEMP=%TEMP%\pandoc_preprocessed.md

python preprocess_md.py "%INPUT%" "%TEMP%"

if errorlevel 1 exit /b 1

pandoc "%TEMP%" ^
-o "%OUTPUT%" ^
--pdf-engine=xelatex ^
-V mainfont="Times New Roman" ^
-V CJKmainfont="Microsoft YaHei"

del "%TEMP%"

endlocal