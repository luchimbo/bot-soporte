param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$SessionId = "ps-flow-test"
)

$ErrorActionPreference = "Stop"

function Invoke-BotStep {
  param(
    [string]$Text
  )

  $body = @{
    sessionId = $SessionId
    text = $Text
  } | ConvertTo-Json

  $response = Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/simulate" `
    -ContentType "application/json" `
    -Body $body

  [PSCustomObject]@{
    input = $Text
    mode = $response.mode
    reply = $response.reply
    activeProduct = $response.activeProduct
    reportedProblem = $response.reportedProblem
    invoiceNumber = $response.invoiceNumber
    supportFlow = $response.supportFlow
    humanActive = $response.humanActive
  }
}

function Show-BotStep {
  param(
    [string]$Label,
    [string]$Text
  )

  Write-Host ""
  Write-Host "=== $Label ===" -ForegroundColor Cyan
  Write-Host "Input: $Text" -ForegroundColor Yellow

  $result = Invoke-BotStep -Text $Text
  $result | ConvertTo-Json -Depth 10
}

Write-Host "Testing bot flow against $BaseUrl with session '$SessionId'" -ForegroundColor Green

Show-BotStep -Label "Reset" -Text "/nuevo"
Show-BotStep -Label "Product + Problem" -Text "Arturia MiniFuse 2 no se escucha por auriculares"
Show-BotStep -Label "Invoice" -Text "FAC-12345"
Show-BotStep -Label "Resolution Yes" -Text "si"

Show-BotStep -Label "Reset Again" -Text "/nuevo"
Show-BotStep -Label "Single Message Full Case" -Text "Arturia MiniFuse 2 no se escucha por auriculares factura FAC-12345"
Show-BotStep -Label "Resolution No" -Text "no"
