; IWAE 설치기 갈고리. 설치기는 영어·한국어 두 언어(시작할 때 고른다).
; 고른 언어는 $INSTDIR\installer-language 에 LCID(1033 영어, 1042 한국어)로 남기고,
; 앱은 처음 켤 때 설정에서 언어를 고르지 않았으면 이 값을 따른다.

!macro NSIS_HOOK_PREINSTALL
  StrCmp $LANGUAGE 1042 0 +3
    DetailPrint "업데이트해도 Vault 와 설정은 그대로 남습니다."
    Goto +2
  DetailPrint "IWAE updates preserve Vaults and settings."
!macroend

!macro NSIS_HOOK_POSTINSTALL
  FileOpen $0 "$INSTDIR\installer-language" w
  FileWrite $0 "$LANGUAGE"
  FileClose $0
  StrCmp $LANGUAGE 1042 0 +3
    DetailPrint "Vault 폴더는 건드리지 않고 IWAE 를 설치했습니다."
    Goto +2
  DetailPrint "IWAE was installed without modifying any Vault folder."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  StrCmp $LANGUAGE 1042 0 +3
    DetailPrint "앱만 지웁니다. Vault 와 설정은 남겨 둡니다."
    Goto +2
  DetailPrint "Uninstalling the application only. Vaults and settings are preserved."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\installer-language"
!macroend
