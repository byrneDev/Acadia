// Distributed as source in each PMIS handoff. Acadia never executes this script.
export const PLANNER_IMPORTER = String.raw`#requires -Version 7.0
param(
  [Parameter(Mandatory=$true)][string]$Path,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$PlanId,
  [switch]$Apply,
  [string]$ReceiptPath
)
$ErrorActionPreference = 'Stop'
$payload = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
if ($payload.format -ne 'acadia-planner-v1' -or -not $payload.tasks.Count) { throw 'Not an Acadia Planner export with work packages.' }
$seen = @{}
foreach ($task in $payload.tasks) {
  if (-not $task.externalId -or $seen.ContainsKey($task.externalId)) { throw 'Missing or duplicate external task ID.' }
  $seen[$task.externalId] = $true
  if (-not $task.title.Trim() -or $task.title.Length -gt 255 -or $task.bucket.Length -gt 255 -or $task.description.Length -gt 4000) {
    throw 'A task exceeds Planner title/bucket (255) or description (4000) limits. Edit work packages in Acadia and export again; nothing has been sent.'
  }
}
$payload.tasks | Select-Object @{n='Task';e={$_.title}}, @{n='Bucket';e={$_.bucket}}, @{n='Due';e={$_.dueDateTime}} | Format-Table
if (-not $Apply) { Write-Host 'Preview only. To import, rerun with -Apply. No connection has been made.'; return }
if (-not (Get-Module -ListAvailable Microsoft.Graph.Authentication)) { throw 'Install Microsoft.Graph.Authentication in PowerShell before importing.' }
Import-Module Microsoft.Graph.Authentication
Connect-MgGraph -Scopes 'Tasks.ReadWrite' -ContextScope Process -NoWelcome
$account = (Get-MgContext).Account
$tenant = (Get-MgContext).TenantId
if (-not $ReceiptPath) { $ReceiptPath = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $Path)) ('planner-receipt-' + $PlanId + '.json') }
$digest = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
$receipt = @{ version=1; planId=$PlanId; account=$account; tenant=$tenant; digest=$digest; buckets=@{}; tasks=@{} }
if (Test-Path -LiteralPath $ReceiptPath) {
  $receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json -AsHashtable
  if ($receipt.planId -ne $PlanId -or $receipt.account -ne $account -or $receipt.tenant -ne $tenant -or $receipt.digest -ne $digest) {
    throw 'Receipt belongs to a different account, plan or export. Do not overwrite it; inspect the existing import first.'
  }
}
function Save-Receipt {
  $temp = $ReceiptPath + '.tmp'
  $receipt | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $temp -Encoding utf8
  Move-Item -LiteralPath $temp -Destination $ReceiptPath -Force
}
function Graph-Json([string]$Method, [string]$Uri, $Body, $Headers=@{}) {
  $params = @{ Method=$Method; Uri=$Uri; Headers=$Headers }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 15); $params.ContentType = 'application/json' }
  Invoke-MgGraphRequest @params
}
$baseUri = 'https://graph.microsoft.com/v1.0'
# Validate the existing target before making any writes.
$null = Graph-Json 'GET' ($baseUri + '/planner/plans/' + $PlanId) $null
foreach ($task in $payload.tasks) {
  $bucketName = [string]$task.bucket
  if (-not $receipt.buckets.ContainsKey($bucketName)) {
    $receipt.buckets[$bucketName] = @{ pending=$true }; Save-Receipt
    $bucket = Graph-Json 'POST' ($baseUri + '/planner/buckets') @{ name=$bucketName; planId=$PlanId; orderHint=' !' }
    $receipt.buckets[$bucketName] = @{ id=$bucket.id; pending=$false }; Save-Receipt
  }
  if ($receipt.buckets[$bucketName].pending) { throw 'An interrupted bucket creation needs inspection in Planner. Reconcile the pending receipt before retrying to avoid duplicates.' }
  $key = [string]$task.externalId
  if (-not $receipt.tasks.ContainsKey($key)) {
    $receipt.tasks[$key] = @{ pending=$true; detailsWritten=$false }; Save-Receipt
    $body = @{ planId=$PlanId; bucketId=$receipt.buckets[$bucketName].id; title=$task.title; percentComplete=$task.percentComplete }
    if ($task.dueDateTime) { $body.dueDateTime = $task.dueDateTime }
    $created = Graph-Json 'POST' ($baseUri + '/planner/tasks') $body
    $receipt.tasks[$key] = @{ id=$created.id; pending=$false; detailsWritten=$false }; Save-Receipt
  }
  $entry = $receipt.tasks[$key]
  if ($entry.pending) { throw 'An interrupted task creation needs inspection in Planner. Reconcile the pending receipt before retrying to avoid duplicates.' }
  if (-not $entry.detailsWritten) {
    $detailsUri = $baseUri + '/planner/tasks/' + $entry.id + '/details'
    $details = Graph-Json 'GET' $detailsUri $null
    $null = Graph-Json 'PATCH' $detailsUri @{ description=$task.description; previewType='description' } @{ 'If-Match'=$details.'@odata.etag' }
    $entry.detailsWritten = $true; Save-Receipt
  }
  Write-Host ('Imported: ' + $task.title)
}
Write-Host ('Completed. Keep the receipt: ' + $ReceiptPath)
Disconnect-MgGraph | Out-Null
`;
