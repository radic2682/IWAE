# Clean-Windows scenarios for the setup window

`run-vm-tests.ps1` installs, updates and uninstalls IWAE with the new setup exe and the old
v0.2.6 NSIS installer, and writes `results.json` (`[{ name, passed, detail }]`).

It downloads nothing. You pass it:

- `-NewSetup <path>`: the built `IWAE_<v>_x64-setup.exe`
- `-OldSetup <path>`: `IWAE_0.2.6_x64-setup.exe` from the v0.2.6 GitHub release
- `-Results <path>`: output file (default `.\results.json`)
- `-TimeoutSec <n>`: per-step timeout (default 300)

Scenarios: silent fresh install, silent install to a custom path with Korean characters, 0.2.6 then
update, self-update, synchronous uninstall, reinstall, uninstall UI window, killed mid-install then
rerun, Defender scan. The file must stay UTF-8 with BOM (Windows PowerShell 5.1 reads the Korean
window title literal from it).

## Safety: never run this on a real PC

The script installs and removes IWAE under `%LOCALAPPDATA%\IWAE`, kills every `app.exe`, and deletes
`HKCU\Software\iwae`. It refuses to start (exit 2) unless `IWAE_VM_TESTS=1`, and also refuses if
`%LOCALAPPDATA%\IWAE\app.exe` already exists. Set the variable **inside the VM only**, never in your
own profile or system environment.

Exit codes: 0 all passed, 1 some scenario failed, 2 refused to run.

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
    <Command>powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:IWAE_VM_TESTS='1'; &amp; 'C:\vm\in\run-vm-tests.ps1' -NewSetup 'C:\vm\in\IWAE_new_x64-setup.exe' -OldSetup 'C:\vm\in\IWAE_0.2.6_x64-setup.exe' -Results 'C:\vm\out\results.json' *&gt; 'C:\vm\out\run.log'"</Command>
  </LogonCommand>
</Configuration>
```

Copy `run-vm-tests.ps1` into the input folder too. `results.json` and `run.log` appear in the output
folder on the host. Defender may be unavailable in the sandbox; scenario 9 then records
`skipped: <reason>` and still passes.

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
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: vm-results
          path: results.json
```

The runner is discarded after the job, so setting `IWAE_VM_TESTS` there is safe.
