[CmdletBinding()]
param([switch]$Configure, [switch]$Check)
$ErrorActionPreference = 'Stop'
$taskExitCode = 2
$taskSecure = $null
$taskProcess = $null
$taskCredentials = $null
try {
    if ($Configure -and $Check) { throw 'ARGUMENT_INVALID' }
    if ($env:VERCEL) { throw 'LOCAL_ONLY' }
    $taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $taskNode = 'C:/Users/hessa/Documents/Codex/.tools/node-security/node-v24.22.1-win-x64/node.exe'
    if (-not (Test-Path -LiteralPath $taskNode -PathType Leaf)) { $taskNode = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
    $taskMode = '--check'
    if ($Configure) {
        Write-Host 'OpenAI setup for isolated hessara-test only. No provider request or charge is made by this setup command.'
        Write-Host 'The API key WILL be saved server-only in the private local test profile.'
        Write-Host 'This saves a dedicated model key for the isolated test profile; setup does not check availability or make a provider request.'
        Write-Host 'Later real inference calls are billable. Use a dedicated OpenAI project API key with provider-side limits, not Supabase, an Admin key or a ChatGPT session.'
        $taskSecure = Read-Host -Prompt 'OpenAI project API key (hidden)' -AsSecureString
        $taskModel = Read-Host -Prompt 'Exact OpenAI API model ID available to this project'
        $taskPointer = [IntPtr]::Zero
        try {
            $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
            $taskCredentials = @{ apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer); model = $taskModel }
            $taskPayload = ConvertTo-Json -InputObject $taskCredentials -Compress
        } finally { if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) } }
        $taskMode = '--configure'
    }
    $taskStart = New-Object Diagnostics.ProcessStartInfo
    $taskStart.FileName = $taskNode
    $taskStart.Arguments = '"' + (Join-Path $PSScriptRoot 'configure-openai-integration.mjs') + '" ' + $taskMode
    $taskStart.WorkingDirectory = $taskRoot
    $taskStart.UseShellExecute = $false
    $taskStart.CreateNoWindow = $true
    $taskStart.RedirectStandardInput = $true
    $taskStart.RedirectStandardOutput = $true
    $taskStart.RedirectStandardError = $true
    $taskUtf8 = New-Object Text.UTF8Encoding($false)
    $taskStart.StandardInputEncoding = $taskUtf8
    $taskStart.StandardOutputEncoding = $taskUtf8
    $taskProcess = New-Object Diagnostics.Process
    $taskProcess.StartInfo = $taskStart
    if (-not $taskProcess.Start()) { throw 'HELPER_START_FAILED' }
    $taskOut = $taskProcess.StandardOutput.ReadToEndAsync()
    $taskErr = $taskProcess.StandardError.ReadToEndAsync()
    if ($Configure) { $taskProcess.StandardInput.Write($taskPayload) }
    $taskProcess.StandardInput.Close()
    if (-not $taskProcess.WaitForExit(30000)) { $taskProcess.Kill(); throw 'HELPER_TIMEOUT' }
    $taskResult = ConvertFrom-Json -InputObject $taskOut.GetAwaiter().GetResult()
    $taskDiscarded = $taskErr.GetAwaiter().GetResult()
    if ($taskResult.status -cnotin @('configured', 'needs_configuration', 'blocked')) { throw 'HELPER_RESULT_INVALID' }
    if ($taskResult.configurationOnly -isnot [bool] -or -not $taskResult.configurationOnly -or $taskResult.verified -isnot [bool] -or $taskResult.verified -ne $false -or $taskResult.networkTested -isnot [bool] -or $taskResult.networkTested -ne $false -or $taskResult.projectRef -cne 'lmhnyqtcfvgrcygsgqjg') { throw 'HELPER_RESULT_INVALID' }
    if ($taskResult.status -ceq 'configured') {
        if ($taskProcess.ExitCode -ne 0 -or $taskResult.configured -isnot [bool] -or -not $taskResult.configured) { throw 'HELPER_RESULT_INVALID' }
        if ($Configure -and ($taskResult.keySavedServerOnly -isnot [bool] -or -not $taskResult.keySavedServerOnly -or (@($taskResult.changedFields) -join ',') -cne 'OPENAI_API_KEY,OPENAI_MODEL')) { throw 'HELPER_RESULT_INVALID' }
    } elseif ($taskProcess.ExitCode -eq 0 -or $taskResult.configured -ne $false) { throw 'HELPER_RESULT_INVALID' }
    if ($taskResult.error -and $taskResult.error -notmatch '^[A-Z_]{1,80}$') { throw 'HELPER_RESULT_INVALID' }
    Write-Host ('OpenAI configuration status: ' + $taskResult.status)
    if ($taskResult.error) {
        Write-Host ('Reason: ' + $taskResult.error)
        switch ($taskResult.error) {
            'OPENAI_KEY_PREFIX_INVALID' { Write-Host 'Next step: copy the complete secret value from the new OpenAI key dialog, not its name, key ID or a table entry. Report this reason only.' }
            'OPENAI_KEY_INTERNAL_WHITESPACE' { Write-Host 'Next step: use the Copy button for the complete secret value. Internal whitespace is refused; do not join or edit the key manually.' }
            'OPENAI_KEY_UNSAFE_CHARACTERS' { Write-Host 'Next step: the key body contains non-printing or non-ASCII characters. Use the Copy button; never send the value in chat.' }
            'OPENAI_KEY_TOO_SHORT' { Write-Host 'Next step: the received value is too short for this input policy. Copy the complete secret, not a name or shortened display.' }
            'OPENAI_KEY_FORMAT_INVALID' { Write-Host 'Next step: the received value does not fit bounded bearer-token syntax. Report this reason only, never the value.' }
            'OPENAI_KEY_PROVIDER_MISMATCH' { Write-Host 'Next step: use an OpenAI project API key. This value identifies a different provider.' }
            'OPENAI_KEY_MASKED' { Write-Host 'Next step: copy the full secret, not a masked or abbreviated display.' }
            'OPENAI_KEY_WRAPPED' { Write-Host 'Next step: paste the key value alone, without quotes, Bearer or a label.' }
            'OPENAI_KEY_REQUIRED' { Write-Host 'Next step: no key was received. Paste at the hidden prompt before pressing Enter.' }
        }
    }
    foreach ($taskField in @($taskResult.missingFields)) { if ($taskField -cin @('OPENAI_API_KEY', 'OPENAI_MODEL')) { Write-Host ('Missing: ' + $taskField) } }
    if ($Configure -and $taskResult.status -ceq 'configured') { Write-Host 'Saved locally only. No model availability, API billing, streaming or real response was verified. Do not send the API key in chat.' }
    $taskExitCode = $taskProcess.ExitCode
} catch {
    Write-Host 'OPENAI_CONFIGURATION_FAILED'
    $taskExitCode = 2
} finally {
    if ($null -ne $taskSecure) { $taskSecure.Dispose() }
    if ($null -ne $taskCredentials) { $taskCredentials.Clear() }
    $taskPayload = $null
    $taskCredentials = $null
    $taskResult = $null
    $taskDiscarded = $null
    if ($null -ne $taskProcess) { $taskProcess.Dispose() }
}
exit $taskExitCode
