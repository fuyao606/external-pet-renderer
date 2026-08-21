const { execFile } = require("child_process");

const HARNESS_WINDOW_PATTERN = /deepseek harness/i;

function isHarnessWindowTitle(title) {
  return typeof title === "string" && HARNESS_WINDOW_PATTERN.test(title);
}

function focusHarnessWindow({ execFileImpl = execFile } = {}) {
  if (process.platform !== "win32") {
    return Promise.resolve({ found: false, focused: false });
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -Namespace ExternalPet -Name Native -MemberDefinition '[UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern int GetWindowTextLength(IntPtr hWnd); [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int maxCount); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"kernel32.dll\")] public static extern uint GetCurrentThreadId(); [DllImport(\"user32.dll\")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach); [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'",
    "$browserIds = @(Get-Process chrome,msedge -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)",
    "$harnessWindow = [IntPtr]::Zero",
    "$callback = [ExternalPet.Native+EnumWindowsProc] { param([IntPtr]$hWnd, [IntPtr]$lParam); $length = [ExternalPet.Native]::GetWindowTextLength($hWnd); if ($length -eq 0) { return $true }; $title = [Text.StringBuilder]::new($length + 1); [void][ExternalPet.Native]::GetWindowText($hWnd, $title, $title.Capacity); if ($title.ToString() -notmatch 'DeepSeek Harness') { return $true }; [uint32]$processId = 0; [void][ExternalPet.Native]::GetWindowThreadProcessId($hWnd, [ref]$processId); if ($browserIds -contains [int]$processId) { $script:harnessWindow = $hWnd; return $false }; return $true }",
    "[void][ExternalPet.Native]::EnumWindows($callback, [IntPtr]::Zero)",
    "if ($harnessWindow -eq [IntPtr]::Zero) { exit 1 }",
    "$foreground = [ExternalPet.Native]::GetForegroundWindow()",
    "[uint32]$foregroundProcessId = 0",
    "$foregroundThread = [ExternalPet.Native]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcessId)",
    "$currentThread = [ExternalPet.Native]::GetCurrentThreadId()",
    "if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) { [ExternalPet.Native]::AttachThreadInput($currentThread, $foregroundThread, $true) | Out-Null }",
    "[ExternalPet.Native]::ShowWindowAsync($harnessWindow, 9) | Out-Null",
    "[ExternalPet.Native]::BringWindowToTop($harnessWindow) | Out-Null",
    "$focused = [ExternalPet.Native]::SetForegroundWindow($harnessWindow)",
    "if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) { [ExternalPet.Native]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null }",
    "if ($focused) { exit 0 }",
    "exit 2",
  ].join("; ");

  return new Promise((resolve) => {
    execFileImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], (error) => {
      if (!error) {
        resolve({ found: true, focused: true });
      } else if (error.code === 2) {
        resolve({ found: true, focused: false });
      } else {
        resolve({ found: false, focused: false });
      }
    });
  });
}

module.exports = {
  focusHarnessWindow,
  isHarnessWindowTitle,
};
