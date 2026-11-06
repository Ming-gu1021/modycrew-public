!include "LogicLib.nsh"

# The public download is always ModyCrew.exe, which is also the app image name.
# Older uninstallers fall back to taskkill /IM ModyCrew.exe when PowerShell is
# restricted. Run setup under a distinct name before invoking those uninstallers.
# This runs before the installer mutex is acquired and preserves all arguments.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ${GetParameters} $R1
    ${If} $EXEFILE == "${APP_EXECUTABLE_FILENAME}"
      # The copy is the whole installer (about 400MB) and cannot delete itself while it runs. Give its folder a
      # recognizable name so the installed app removes it after setup ends (stale-temp-cleanup.mjs
      # cleanupLeftoverInstallerCopies). GetTempFileName names (nsXXXX.tmp) are shared with other NSIS installers.
      System::Call 'kernel32::GetCurrentProcessId() i.r2'
      System::Call 'kernel32::GetTickCount() i.r3'
      IntFmt $3 "%u" $3
      StrCpy $R0 "$TEMP\ModyCrew-Setup-$2-$3"
      CreateDirectory "$R0"
      ClearErrors
      CopyFiles /SILENT "$EXEPATH" "$R0\ModyCrew-Setup.exe"
      ${If} ${Errors}
        MessageBox MB_ICONSTOP "설치 준비 파일을 복사하지 못했습니다. 임시 폴더 공간과 권한을 확인해 주세요."
        SetErrorLevel 2
        Quit
      ${EndIf}
      ClearErrors
      Exec '"$R0\ModyCrew-Setup.exe" --mody-setup-parent=$2 $R1'
      ${If} ${Errors}
        MessageBox MB_ICONSTOP "설치 프로그램을 시작하지 못했습니다. 다시 실행해 주세요."
        SetErrorLevel 2
      ${Else}
        SetErrorLevel 0
      ${EndIf}
      Quit
    ${Else}
      ClearErrors
      ${GetOptions} "$R1" "--mody-setup-parent=" $R2
      ${IfNot} ${Errors}
        # Do not let an old uninstaller see the public launcher still running.
        System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i $R2) p.r3'
        ${If} $3 != 0
          System::Call 'kernel32::WaitForSingleObject(p r3, i 10000) i.r4'
          System::Call 'kernel32::CloseHandle(p r3)'
          ${If} $4 != 0
            SetErrorLevel 2
            Quit
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !endif
!macroend

# electron-builder creates the standard links before customInstall runs.
# Refresh only links that already exist so a user-deleted desktop shortcut stays deleted.
!macro customInstall
  ${If} ${FileExists} "$appExe"
    ${If} ${FileExists} "$newStartMenuLink"
      Delete "$newStartMenuLink"
      ClearErrors
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}

    ${If} ${FileExists} "$newDesktopLink"
      Delete "$newDesktopLink"
      ClearErrors
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${EndIf}

    # Let Explorer reload the refreshed ModyCrew.exe,0 shell icon binding.
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
