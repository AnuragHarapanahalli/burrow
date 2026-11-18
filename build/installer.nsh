; Extra steps for Burrow's one-click installer (electron-builder includes this file).
; Registers Burrow as a web browser for this user, so Windows lists it under
; Settings > Apps > Default apps. Windows still asks you to pick it there yourself.

!macro customInstall
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow" "" "Burrow"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow\DefaultIcon" "" "$INSTDIR\Burrow.exe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow\shell\open\command" "" '"$INSTDIR\Burrow.exe"'
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow\Capabilities" "ApplicationName" "Burrow"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow\Capabilities" "ApplicationDescription" "A calm browser with Mochi the companion"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow\Capabilities" "ApplicationIcon" "$INSTDIR\Burrow.exe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow\Capabilities\URLAssociations" "http" "BurrowURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow\Capabilities\URLAssociations" "https" "BurrowURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow\Capabilities\FileAssociations" ".htm" "BurrowHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Burrow\Capabilities\FileAssociations" ".html" "BurrowHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "Burrow" "Software\Clients\StartMenuInternet\Burrow\Capabilities"
  WriteRegStr HKCU "Software\Classes\BurrowURL" "" "Burrow web address"
  WriteRegStr HKCU "Software\Classes\BurrowURL\DefaultIcon" "" "$INSTDIR\Burrow.exe,0"
  WriteRegStr HKCU "Software\Classes\BurrowURL\shell\open\command" "" '"$INSTDIR\Burrow.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\BurrowHTML" "" "Burrow web page"
  WriteRegStr HKCU "Software\Classes\BurrowHTML\DefaultIcon" "" "$INSTDIR\Burrow.exe,0"
  WriteRegStr HKCU "Software\Classes\BurrowHTML\shell\open\command" "" '"$INSTDIR\Burrow.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Burrow"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Burrow"
  DeleteRegKey HKCU "Software\Classes\BurrowURL"
  DeleteRegKey HKCU "Software\Classes\BurrowHTML"
!macroend
