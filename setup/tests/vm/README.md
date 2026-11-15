# Clean-Windows scenarios for the setup window

`run-vm-tests.ps1` installs, updates and uninstalls IWAE with the new setup exe and the old
v0.2.6 NSIS installer, and writes `results.json` (`[{ name, status, passed, detail }]`).

It downloads nothing. You pass it:

- `-NewSetup <path>`: the built `IWAE_<v>_x64-setup.exe`
- `-OldSetup <path>`: `IWAE_0.2.6_x64-setup.exe` from the v0.2.6 GitHub release
- `-Results <path>`: output file (default `.\results.json`)
- `-TimeoutSec <n>`: per-step timeout (default 300)
- `-ExpectedVersion <x.y.z>`: version scenario 3 expects in `DisplayVersion` (default: parsed from
  the `IWAE_x.y.z_` file name)

Scenarios: silent fresh install, silent install to a custom path with Korean characters, 0.2.6 then
update (the old app is stopped first, as the real updater does, and a new app.exe with a different
PID must appear), 0.2.6 then update with the old app left open (3b: setup waits 10 s, NSIS closes
the app, and a new app.exe with a different PID must appear within 90 s of starting the update),
self-update, synchronous uninstall, reinstall, uninstall UI window, killed mid-install then rerun,
Defender scan. The file must stay UTF-8 with BOM (Windows PowerShell 5.1 reads the Korean window
title literal from it).

Scenario 5 runs `uninstall-ui.exe --uninstall /S _?=<dir>`, the exact form an old NSIS wizard
uses (`<UninstallString> /S _?=<dir>`, and UninstallString ends in `--uninstall`). Any `_?=` makes
it the synchronous pass-through, which only runs `uninstall.exe /S _?=<dir>`. It asserts app.exe
and the `HKCU ...\Uninstall\IWAE` key are gone and that `uninstall.exe` / `uninstall-ui.exe`
remain (expected with `_?=`). Scenario 6 uses the form without `--uninstall`. The windowed
uninstall (`--uninstall-from-temp`, needs a click) is covered by the lead's demo audit, not by this
script; scenario 7 only checks that the uninstall window appears.

Scenarios 3, 3b, 4 and 7 need an interactive desktop session (they start GUI apps and read window
titles). If the session is not interactive they are recorded with status `skip`. GitHub Actions
Windows runners usually report an interactive session, so these may run there, or may be skipped,
or may need a desktop session with WebView2 to work at all. Use Windows Sandbox as the primary
environment. Results are `{ name, status, passed, detail }` with `status` of `pass`, `fail` or
`skip` (`passed` is true only for `pass`). The script exits 0 only when nothing failed and nothing
was skipped; pass `-AllowSkip` to accept skips. Scenario 8 is recorded as failed with detail
`inconclusive` if the inner NSIS process never appears before the outer one is killed.

## Safety: never run this on a real PC

The script installs and removes IWAE under `%LOCALAPPDATA%\IWAE`, kills `app.exe` processes under the
install dirs, and deletes `HKCU\Software\iwae`. It refuses to start (exit 2) unless **all** hold:

- `IWAE_VM_TESTS=1`
- a sandbox signal: `USERNAME` is `WDAGUtilityAccount` (Windows Sandbox) or `CI=true` (GitHub Actions)
- `%LOCALAPPDATA%\IWAE\app.exe`, `HKCU\...\Uninstall\IWAE` and `HKCU\Software\iwae\IWAE` do not exist
  (any of them means a real install)

Set the variable **inside the VM only**, never in your own profile or system environment.

Exit codes: 0 no failures and no skips (skips allowed with `-AllowSkip`), 1 a scenario failed or was skipped, 2 refused to run.

## Windows Sandbox

Windows Sandbox is a clean, disposable Windows. Save a `.wsb` like this (adjust host paths), put the
installers in `C:\vm\in` and create `C:\vm\out`, then open it:

```xml
<Configuration>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>D:\iwae-vm\in</HostFolder>
      <SandboxFolder>C:\vm\in</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>D:\iwae-vm\out</HostFolder>
      <SandboxFolder>C:\vm\out</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:IWAE_VM_TESTS='1'; &amp; 'C:\vm\in\run-vm-tests.ps1' -NewSetup 'C:\vm\in\IWAE_new_x64-setup.exe' -OldSetup 'C:\vm\in\IWAE_0.2.6_x64-setup.exe' -Results 'C:\vm\out\results.json' -AllowSkip *&gt; 'C:\vm\out\run.log'"</Command>
  </LogonCommand>
</Configuration>
```

Copy `run-vm-tests.ps1` into the input folder too. `results.json` and `run.log` appear in the output
folder on the host. The command passes `-AllowSkip` because Defender is usually unavailable in the
sandbox, so scenario 9 records `skipped: <reason>`; without the flag every sandbox run would end
with exit 1 even when nothing failed. Skips still show in `results.json` and in the last line of
`run.log`, so read them there.

## GitHub Actions

```yaml
jobs:
  vm-tests:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      # fetch IWAE_0.2.6_x64-setup.exe and the new setup exe into .\in (artifact or release download)
      - name: Run scenarios
        shell: powershell
        env:
          IWAE_VM_TESTS: '1'
        run: >
          .\setup\tests\vm\run-vm-tests.ps1
          -NewSetup .\in\IWAE_new_x64-setup.exe
          -OldSetup .\in\IWAE_0.2.6_x64-setup.exe
          -Results .\results.json
          -AllowSkip
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: vm-results
          path: results.json
```

The runner is discarded after the job, so setting `IWAE_VM_TESTS` there is safe. `-AllowSkip` is
there because the GUI scenarios (3, 3b, 4, 7) skip when the runner session is not interactive;
the job then fails only on a real failure, and the skips stay visible in the uploaded
`results.json`.
