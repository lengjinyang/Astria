!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
Var AstriaCreateDesktopShortcut
Var AstriaDesktopShortcutCheckbox
!endif

!macro customInit
  StrCpy $AstriaCreateDesktopShortcut ${BST_CHECKED}
!macroend

!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Page custom AstriaShortcutOptionsPage AstriaShortcutOptionsLeave
  !macroend

Function AstriaShortcutOptionsPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "安装选项"
  Pop $1
  CreateFont $2 "$(^Font)" "11" "700"
  SendMessage $1 ${WM_SETFONT} $2 1

  ${NSD_CreateLabel} 0 30u 100% 28u "选择是否在桌面创建 Astria 快捷方式。"
  Pop $1

  ${NSD_CreateCheckbox} 0 68u 100% 18u "在桌面创建快捷方式"
  Pop $AstriaDesktopShortcutCheckbox
  ${NSD_Check} $AstriaDesktopShortcutCheckbox

  nsDialogs::Show
FunctionEnd

Function AstriaShortcutOptionsLeave
  ${NSD_GetState} $AstriaDesktopShortcutCheckbox $AstriaCreateDesktopShortcut
FunctionEnd
!endif

!macro customInstall
  Delete "$DESKTOP\Astria.lnk"
  Delete "$DESKTOP\VFX Player.lnk"
  ${If} $AstriaCreateDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\Astria.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Astria.lnk"
!macroend
