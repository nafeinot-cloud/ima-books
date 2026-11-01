$parts = @("data_part1.json", "data_part2.json", "data_part3.json", "data_part4.json")
$allBoxes = @()

foreach ($part in $parts) {
    if (Test-Path $part) {
        $content = Get-Content $part -Raw -Encoding UTF8
        try {
            $json = $content | ConvertFrom-Json
            $allBoxes += $json
            Write-Output "Loaded $part with $($json.Count) boxes"
        } catch {
            Write-Warning "Failed to parse $part : $_"
        }
    } else {
        Write-Warning "Missing $part"
    }
}

$allBoxes = $allBoxes | Sort-Object { [int]$_.box_id }
$totalBooks = 0
foreach ($box in $allBoxes) {
    $totalBooks += $box.books.Count
}

$jsContent = "const BOOKS_DATA = " + ($allBoxes | ConvertTo-Json -Depth 10) + ";"
[System.IO.File]::WriteAllText("$pwd\books_data.js", $jsContent, [System.Text.Encoding]::UTF8)

Write-Output "Successfully generated books_data.js with $($allBoxes.Count) boxes and $totalBooks books!"
