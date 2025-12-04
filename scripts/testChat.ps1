$body = @{
  message = "toi muon dat phong"
} | ConvertTo-Json

try {
  $response = Invoke-WebRequest `
    -Uri "http://localhost:5000/api/chat" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body

  Write-Host "Status:" $response.StatusCode
  Write-Host "Content:"
  Write-Host $response.Content
} catch {
  Write-Host "Request failed:"
  Write-Host $_
}


