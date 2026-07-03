@echo off
setlocal

REM 检查参数
if "%~1"=="" (
    echo Usage:
    echo     md2pdf.bat input.md output.pdf
    exit /b 1
)

if "%~2"=="" (
    echo Usage:
    echo     md2pdf.bat input.md output.pdf
    exit /b 1
)

set INPUT=%~1
set OUTPUT=%~2

pandoc "%INPUT%" ^
-o "%OUTPUT%" ^
--pdf-engine=xelatex ^
-V mainfont="Segoe UI" ^
-V CJKmainfont="Microsoft YaHei"

if %ERRORLEVEL% neq 0 (
    echo.
    echo Convert failed!
    exit /b %ERRORLEVEL%
)

echo.
echo Convert success!
echo Output: %OUTPUT%

endlocal