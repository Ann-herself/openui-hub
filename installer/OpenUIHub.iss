#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

#define MyAppName "OpenUI Hub"
#define MyAppPublisher "OpenUI"
#define MyAppExeName "OpenUIHub.exe"
#define MyAppURL "https://github.com/Ann-herself/openui-hub"

[Setup]
AppId={{4B230C6E-B2E1-4C7D-94E4-4E0C65A0F04A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\OpenUI Hub
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\release-dist
OutputBaseFilename=OpenUI-Hub-Setup-v{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
ChangesAssociations=no
ChangesEnvironment=no
AllowNoIcons=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "startup"; Description: "Start OpenUI Hub when I sign in to Windows"; GroupDescription: "Startup options:"; Flags: unchecked

[Files]
Source: "..\release-dist\OpenUIHub\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\THIRD_PARTY_NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\OpenUI Hub"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\OpenUI Hub"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\OpenUI Hub"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch OpenUI Hub"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM OpenUIHub.exe /F >NUL 2>&1"; Flags: runhidden; RunOnceId: "StopOpenUIHub"
