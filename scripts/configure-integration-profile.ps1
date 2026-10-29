[CmdletBinding()]
param([switch]$Configure, [switch]$Check, [switch]$ProvisionRuntime, [switch]$ProvisionUsers, [switch]$ConfigureAccounts, [switch]$ConfigureStorage)

$ErrorActionPreference = 'Stop'
$taskExitCode = 2
$taskProcess = $null
$taskSecureValues = @()
$taskPayload = $null
$taskCredentials = $null
$taskResult = $null

function Convert-IntegrationSecureValue([Security.SecureString]$Value) {
    $taskPointer = [IntPtr]::Zero
    try {
        $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
    } finally {
        if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
    }
}

try {
    if (@(@($Configure, $Check, $ProvisionRuntime, $ProvisionUsers, $ConfigureAccounts, $ConfigureStorage) | Where-Object { $_.IsPresent }).Count -gt 1) { throw 'CONFIGURATION_ARGUMENT_INVALID' }
    if ($env:VERCEL) { throw 'LOCAL_CONFIGURATION_ONLY' }
    $taskPortableNode = 'C:/Users/hessa/Documents/Codex/.tools/node-security/node-v24.22.1-win-x64/node.exe'
    if (Test-Path -LiteralPath $taskPortableNode -PathType Leaf) { $taskNode = $taskPortableNode }
    else { $taskNode = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
    $taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $taskScript = Join-Path $PSScriptRoot 'configure-integration-profile.mjs'
    $taskMode = '--check'
    if ($Configure) {
        Write-Host 'Local configuration only. Use the existing hessara-test runtime role and two existing test accounts.'
        Write-Host 'Input is hidden. Credentials are sent to Node through standard input, never command arguments.'
        foreach ($taskPrompt in @('Database runtime password', 'Test account A email', 'Test account A password', 'Test account B email', 'Test account B password')) {
            $taskSecureValues += Read-Host -Prompt $taskPrompt -AsSecureString
        }
        $taskCredentials = [ordered]@{
            databasePassword = Convert-IntegrationSecureValue $taskSecureValues[0]
            emailA = Convert-IntegrationSecureValue $taskSecureValues[1]
            passwordA = Convert-IntegrationSecureValue $taskSecureValues[2]
            emailB = Convert-IntegrationSecureValue $taskSecureValues[3]
            passwordB = Convert-IntegrationSecureValue $taskSecureValues[4]
        }
        $taskPayload = ConvertTo-Json -InputObject $taskCredentials -Compress
        $taskMode = '--configure'
    }
    if ($ConfigureAccounts) {
        Write-Host 'Local configuration only. Use two existing, confirmed, dedicated hessara-test accounts.'
        Write-Host 'This does not create accounts or verify sign-in. Input is hidden and sent only through standard input.'
        foreach ($taskPrompt in @('Existing test account A email', 'Existing test account A password', 'Existing test account B email', 'Existing test account B password')) {
            $taskSecureValues += Read-Host -Prompt $taskPrompt -AsSecureString
        }
        $taskCredentials = [ordered]@{
            emailA = Convert-IntegrationSecureValue $taskSecureValues[0]
            passwordA = Convert-IntegrationSecureValue $taskSecureValues[1]
            emailB = Convert-IntegrationSecureValue $taskSecureValues[2]
            passwordB = Convert-IntegrationSecureValue $taskSecureValues[3]
        }
        $taskPayload = ConvertTo-Json -InputObject $taskCredentials -Compress
        $taskMode = '--configure-accounts'
    }
    if ($ProvisionRuntime) {
        Write-Host 'Explicit test runtime provisioning. Only the approved hessara-test database role may change.'
        Write-Host 'Use the test project administrator password, never a production credential.'
        $taskSecureValues += Read-Host -Prompt 'Test project postgres administrator password' -AsSecureString
        $taskCredentials = [ordered]@{ administratorPassword = Convert-IntegrationSecureValue $taskSecureValues[0] }
        $taskPayload = ConvertTo-Json -InputObject $taskCredentials -Compress
        $taskScript = Join-Path $PSScriptRoot 'provision-integration-runtime.mjs'
        $taskMode = '--apply'
    }
    if ($ProvisionUsers) {
        Write-Host 'Create two dedicated confirmed test accounts in hessara-test only.'
        Write-Host 'Use only this test project secret API key. It is sent through hidden input and is not saved.'
        Write-Host 'Copy the complete value from Secret keys, then paste at the hidden prompt. Outer whitespace is ignored.'
        $taskSecureValues += Read-Host -Prompt 'hessara-test secret API key' -AsSecureString
        $taskCredentials = [ordered]@{ adminKey = Convert-IntegrationSecureValue $taskSecureValues[0] }
        $taskPayload = ConvertTo-Json -InputObject $taskCredentials -Compress
        $taskScript = Join-Path $PSScriptRoot 'provision-integration-users.mjs'
        $taskMode = '--apply'
    }
    if ($ConfigureStorage) {
        Write-Host 'Configure private artifact Storage in hessara-test only. Input is hidden and sent through standard input.'
        Write-Host 'The Secret key WILL be saved server-only in the private local test profile after the private bucket is verified.'
        Write-Host 'Use the complete hessara-test Secret key, never a production or Publishable key. Do not send the value in chat.'
        $taskSecureValues += Read-Host -Prompt 'hessara-test Secret API key for private Storage' -AsSecureString
        $taskCredentials = [ordered]@{ adminKey = Convert-IntegrationSecureValue $taskSecureValues[0] }
        $taskPayload = ConvertTo-Json -InputObject $taskCredentials -Compress
        $taskScript = Join-Path $PSScriptRoot 'provision-integration-storage.mjs'
        $taskMode = '--apply'
    }
    $taskStart = New-Object Diagnostics.ProcessStartInfo
    $taskStart.FileName = $taskNode
    $taskStart.Arguments = '"' + $taskScript + '" ' + $taskMode
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
    if (-not $taskProcess.Start()) { throw 'CONFIGURATION_HELPER_START_FAILED' }
    if ($Configure -or $ConfigureAccounts -or $ProvisionRuntime -or $ProvisionUsers -or $ConfigureStorage) { $taskProcess.StandardInput.Write($taskPayload) }
    $taskProcess.StandardInput.Close()
    $taskOutput = $taskProcess.StandardOutput.ReadToEnd()
    $taskIgnoredError = $taskProcess.StandardError.ReadToEnd()
    $taskProcess.WaitForExit()
    # Never relay child stderr or arbitrary output: even failures expose only allowlisted metadata.
    $taskResult = ConvertFrom-Json -InputObject $taskOutput
    if ($taskResult.status -notin @('configured', 'accounts_configured', 'needs_configuration', 'blocked', 'verified', 'failed')) { throw 'CONFIGURATION_HELPER_FAILED' }
    if ($ConfigureAccounts) {
        if ($taskResult.status -notin @('accounts_configured', 'blocked')) { throw 'CONFIGURATION_HELPER_FAILED' }
        if ($taskResult.status -eq 'accounts_configured' -and ($taskResult.configurationOnly -ne $true -or $taskResult.configured -ne $true -or $taskResult.verified -ne $false -or $taskResult.networkTested -ne $false)) { throw 'CONFIGURATION_HELPER_FAILED' }
    }
    if ($ConfigureStorage) {
        if ($taskResult.status -cnotin @('verified', 'blocked', 'failed')) { throw 'CONFIGURATION_HELPER_FAILED' }
        if ($taskResult.status -ceq 'verified') {
            if ($taskProcess.ExitCode -ne 0 -or $taskResult.verified -isnot [bool] -or $taskResult.verified -ne $true `
                -or $taskResult.storageVerified -isnot [bool] -or $taskResult.storageVerified -ne $true `
                -or $taskResult.keySavedServerOnly -isnot [bool] -or $taskResult.keySavedServerOnly -ne $true `
                -or $taskResult.profileCommit -cne 'committed' -or $taskResult.projectRef -cne 'lmhnyqtcfvgrcygsgqjg' `
                -or $taskResult.bucket.id -cne 'hessara-re-artifacts' -or $taskResult.bucket.public -isnot [bool] -or $taskResult.bucket.public -ne $false) { throw 'CONFIGURATION_HELPER_FAILED' }
            $taskStorageLimit = $taskResult.bucket.fileSizeLimit
            if (($taskStorageLimit -isnot [int] -and $taskStorageLimit -isnot [long]) -or $taskStorageLimit -lt 1 -or $taskStorageLimit -gt 52428800) { throw 'CONFIGURATION_HELPER_FAILED' }
        } elseif ($taskResult.verified -eq $true -or $taskResult.storageVerified -eq $true -or $taskResult.keySavedServerOnly -eq $true) { throw 'CONFIGURATION_HELPER_FAILED' }
    }
    if ($taskResult.error -and $taskResult.error -notmatch '^[A-Z_]{1,80}$') { throw 'CONFIGURATION_HELPER_FAILED' }
    Write-Host ('Configuration status: ' + $taskResult.status)
    if ($taskResult.error) {
        Write-Host ('Reason: ' + $taskResult.error)
        if ($ProvisionUsers -or $ConfigureStorage) {
            switch ($taskResult.error) {
                'ADMIN_KEY_INPUT_REQUIRED' { Write-Host 'Next step: no key was received. Copy the full Secret key value and paste at the hidden prompt before pressing Enter.' }
                'ADMIN_KEY_PUBLIC_NOT_ALLOWED' { Write-Host 'Next step: use Secret keys, not Publishable key. No request was sent.' }
                'ADMIN_KEY_MASKED_INPUT' { Write-Host 'Next step: use the copy button for the complete Secret key, not its masked or shortened display.' }
                'ADMIN_KEY_WRAPPED_INPUT' { Write-Host 'Next step: paste only the key value, without quotes, Bearer, or a label.' }
                'ADMIN_KEY_PROJECT_MISMATCH' { Write-Host 'Next step: use the existing service_role key from hessara-test only. No request was sent.' }
                'ADMIN_KEY_NOT_ADMINISTRATIVE' { Write-Host 'Next step: a user session token is not an administrative key. Copy the project Secret key.' }
                'ADMIN_KEY_FORMAT_INVALID' { Write-Host 'Next step: the copied value does not match a supported key format. Do not send it in chat; report this reason only.' }
                'ADMIN_KEY_INPUT_TOO_LARGE' { Write-Host 'Next step: copy only the key value, not a page, configuration block, or command.' }
            }
        }
    }
    foreach ($taskIssue in @($taskResult.issues)) {
        if ($taskIssue -match '^[A-Z_]{1,80}$') { Write-Host ('Requirement: ' + $taskIssue) }
    }
    foreach ($taskField in @($taskResult.missingFields)) {
        if ($taskField -match '^[A-Z_]{1,80}$') { Write-Host ('Missing: ' + $taskField) }
    }
    if ($taskResult.status -eq 'configured') { Write-Host 'No connection or integration test was performed. Credentials remain in the private local profile.' }
    if ($taskResult.status -eq 'accounts_configured') { Write-Host 'Existing account credentials were saved locally only. No sign-in, confirmation or integration test was performed.' }
    if ($taskResult.status -eq 'verified' -and $taskResult.verified -eq $true) {
        if ($ConfigureStorage) { Write-Host 'The private test bucket was verified. The Secret key was saved server-only in the private local test profile.' }
        elseif ($ProvisionUsers) { Write-Host 'Both dedicated Auth accounts were verified and signed out. The secret API key was not saved.' }
        else { Write-Host 'The isolated runtime identity and schema read were verified. The administrator password was not saved.' }
    }
    $taskExitCode = $taskProcess.ExitCode
} catch {
    # Exception text may contain paths, process details or malformed input. Never display it.
    Write-Host 'INTEGRATION_CONFIGURATION_FAILED'
    $taskExitCode = 2
} finally {
    foreach ($taskSecureValue in $taskSecureValues) { if ($null -ne $taskSecureValue) { $taskSecureValue.Dispose() } }
    if ($null -ne $taskCredentials) { $taskCredentials.Clear() }
    $taskPayload = $null
    $taskCredentials = $null
    $taskSecureValues = $null
    $taskOutput = $null
    $taskIgnoredError = $null
    $taskResult = $null
    if ($null -ne $taskProcess) { $taskProcess.Dispose() }
}
exit $taskExitCode
