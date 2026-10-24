Unicode True
!include "MUI2.nsh"
Name "nightwire"
OutFile "${OUTDIR}/nightwire-${VERSION}-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\nightwire"
InstallDirRegKey HKCU "Software\nightwire" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "${ASSETS}/icon.ico"
UninstallIcon "${ASSETS}/icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "nightwire"
!define MUI_WELCOMEPAGE_TEXT "your connection, after hours.$\r$\n$\r$\nthis installs nightwire for your windows account. administrator approval is requested when you connect, so the tunnel can route this entire device."
!define MUI_FINISHPAGE_RUN "$INSTDIR\nightwire.exe"
!define MUI_FINISHPAGE_RUN_TEXT "open nightwire"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "nightwire"
 SetOutPath "$INSTDIR"
 File /r "${APPDIR}\*"
 WriteRegStr HKCU "Software\nightwire" "InstallDir" "$INSTDIR"
 WriteUninstaller "$INSTDIR\uninstall.exe"
 CreateDirectory "$SMPROGRAMS\nightwire"
 CreateShortcut "$SMPROGRAMS\nightwire\nightwire.lnk" "$INSTDIR\nightwire.exe"
 CreateShortcut "$SMPROGRAMS\nightwire\uninstall nightwire.lnk" "$INSTDIR\uninstall.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\nightwire" "DisplayName" "nightwire"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\nightwire" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\nightwire" "Publisher" "nightwire contributors"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\nightwire" "UninstallString" '"$INSTDIR\uninstall.exe"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\nightwire" "DisplayIcon" "$INSTDIR\nightwire.exe"
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\nightwire" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\nightwire" "NoRepair" 1
SectionEnd
Section "Uninstall"
 Delete "$SMPROGRAMS\nightwire\nightwire.lnk"
 Delete "$SMPROGRAMS\nightwire\uninstall nightwire.lnk"
 RMDir "$SMPROGRAMS\nightwire"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\nightwire"
 DeleteRegKey HKCU "Software\nightwire"
 RMDir /r "$INSTDIR"
SectionEnd
