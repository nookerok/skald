# Skald Server Launcher for Windows (WSL Ubuntu)
# This script starts the Skald server from Windows using WSL.

$wslDistro = "Ubuntu-22.04"
$skaldDir = "/home/nook/workspaces/skald"

Write-Host "Starting Skald server in WSL ($wslDistro)..."

wsl -d $wslDistro bash -c "source ~/.nvm/nvm.sh && nvm use 22 && cd $skaldDir && npm run start:server"
