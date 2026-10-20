# start-demo.ps1 — levanta ChainIDentity + EHR en local (Windows + Docker Desktop) para pruebas y demos.
#
#   powershell -ExecutionPolicy Bypass -File electronicHealthRecord\start-demo.ps1         # arrancar
#   powershell -ExecutionPolicy Bypass -File electronicHealthRecord\start-demo.ps1 -Stop   # detener contenedores
#
# Por qué un script: los contenedores de ChainIDentity NO tienen IP fija; Docker se la da según el orden en
# que arrancan, y la configuración (gateway.config.yml, app.js de los microservicios, frontends) espera
# tokphy-mysql=.2, ganache=.3, apigateway=.4, birthcertificate=.5 ... scholarcurriculum=.8. Además las apps
# no arrancan solas: hay que correr `startApp` dentro de cada contenedor. Este script hace todo en orden.
#
# El microservicio EHR (:5505) y el frontend ECE (:5514) corren en tu máquina, cada uno en su ventana de
# PowerShell (para ver sus logs; cerrar la ventana = detenerlo).
param([switch]$Stop)

# 'Continue': en PowerShell 5.1 lo que docker escribe en stderr cuenta como error; con 'Stop' abortaría.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot

# Orden = IP: el primero en arrancar toma 172.18.1.2, el segundo .3, etc.
$backends = @(
  @{ name = 'tokphy-mysql';      ip = '172.18.1.2' },
  @{ name = 'ganache';           ip = '172.18.1.3' },
  @{ name = 'apigateway';        ip = '172.18.1.4' },
  @{ name = 'birthcertificate';  ip = '172.18.1.5' },
  @{ name = 'digitalidentity';   ip = '172.18.1.6' },
  @{ name = 'users';             ip = '172.18.1.7' },
  @{ name = 'scholarcurriculum'; ip = '172.18.1.8' }
)
# Contenedor del frontend -> carpeta de la app dentro del contenedor
$frontends = [ordered]@{
  frontendusersinterface    = 'frontendUsersApp'
  frontendbirthcertificate  = 'frontendBirthCertificateApp'
  frontendidentitydigital   = 'frontendDigitalApp'
  frontendscholarcurriculum = 'frontendScholarCurriculumApp'
}
$allContainers = @($frontends.Keys) + @($backends | ForEach-Object { $_.name }) + @('tokphy-mysql-ehr')

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

function Wait-Until($label, $seconds, [scriptblock]$test) {
  for ($i = 0; $i -lt $seconds; $i += 2) {
    try { if (& $test) { Write-Host "   $label listo"; return } } catch { }
    Start-Sleep 2
  }
  Write-Warning "$label no respondió en $seconds s (revisa su log)"
}

if ($Stop) {
  Step 'Deteniendo contenedores'
  docker stop -t 3 $allContainers | Out-Null
  Write-Host 'Listo. Cierra también las ventanas del EHR y del frontend ECE.'
  Write-Host 'Si usas MariaDB para otra cosa: Start-Service MariaDB (PowerShell como administrador).'
  return
}

# 0. MariaDB de Windows ocupa el puerto 3306 y "tapa" al MySQL de ChainIDentity.
$maria = Get-Service MariaDB -ErrorAction SilentlyContinue
if ($maria -and $maria.Status -eq 'Running') {
  Write-Host 'MariaDB está ocupando el puerto 3306. Detenlo en PowerShell como administrador:' -ForegroundColor Yellow
  Write-Host '   Stop-Service MariaDB'
  Write-Host 'y vuelve a correr este script.'
  exit 1
}

# 1. Detener todo para que las IPs se asignen en el orden correcto
Step 'Reiniciando contenedores en orden'
docker stop -t 3 $allContainers 2>$null | Out-Null
foreach ($b in $backends) {
  docker start $b.name | Out-Null
  Start-Sleep -Milliseconds 800
}
foreach ($f in $frontends.Keys) { docker start $f | Out-Null }
docker start tokphy-mysql-ehr | Out-Null

foreach ($b in $backends) {
  $ip = docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $b.name
  if ($ip -ne $b.ip) { Write-Warning "$($b.name) quedó en $ip (se esperaba $($b.ip)). Vuelve a correr el script." }
  else { Write-Host "   $($b.name) -> $ip" }
}

# 2. Apps dentro de los contenedores. Ganache primero: los microservicios se conectan a él al recibir peticiones.
Step 'Arrancando Ganache, Gateway, microservicios y frontends de ChainIDentity'
docker exec -d ganache bash -c 'cd /tokPhyApp/ganache && ./startApp > /tmp/app.log 2>&1'
Start-Sleep 5
foreach ($b in $backends | Where-Object { $_.name -notin @('tokphy-mysql', 'ganache') }) {
  docker exec -d $b.name bash -c "cd /$($b.name) && ./startApp > /tmp/app.log 2>&1"
}
foreach ($f in $frontends.Keys) {
  docker exec -d $f bash -c "cd /$f/$($frontends[$f]) && ./startApp > /tmp/app.log 2>&1"
}

# 3. EHR: espera su MySQL (crea las tablas al arrancar) y abre su ventana
Step 'Arrancando EHR (microservicio :5505 y frontend ECE :5514)'
Wait-Until 'MySQL del EHR' 60 { docker exec tokphy-mysql-ehr mysqladmin ping --silent 2>$null; $LASTEXITCODE -eq 0 }
# Si ya hay algo escuchando en el puerto (ventana de una corrida anterior), no se abre otra.
$isListening = { param($port) [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
if (& $isListening 5505) { Write-Host '   El EHR ya estaba corriendo en :5505' }
else { Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle = 'EHR microservicio :5505'; cd '$repo\electronicHealthRecord\electronicHealthRecordApp'; node bin/www" }
if (& $isListening 5514) { Write-Host '   El frontend ECE ya estaba corriendo en :5514' }
else { Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle = 'Frontend ECE :5514'; cd '$repo\frontendElectronicHealthRecord\frontendElectronicHealthRecordApp'; node server.js" }

# 4. Comprobaciones: el Gateway tarda ~15 s en arrancar
Step 'Comprobando'
Wait-Until 'Gateway -> birthCertificate' 90 { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://localhost:5500/proof').StatusCode -eq 200 }
Wait-Until 'Gateway -> EHR' 60 { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://localhost:5500/pacientes').StatusCode -eq 200 }
# Calentamiento: la PRIMERA lectura de un acta tarda más de 8 s (birthCertificate abre su conexión a Ganache)
# y el EHR la cortaría por tiempo. Una búsqueda por CURP lee todas las actas y las deja en la caché del EHR.
Write-Host '   Calentando la lectura de actas...'
foreach ($try in 1..3) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 90 'http://localhost:5505/chainIdentity?curp=XEXX010101HNEXXXA4' | Out-Null } catch { }
}
foreach ($port in 5510, 5511, 5512, 5513, 5514) {
  Wait-Until "Frontend :$port" 40 { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://localhost:$port/").StatusCode -eq 200 }
}

Write-Host "`nTodo arriba:" -ForegroundColor Green
Write-Host '   ChainIDentity  Users  http://localhost:5512   Acta  http://localhost:5510'
Write-Host '                  Identidad http://localhost:5511   Currículum  http://localhost:5513'
Write-Host '   EHR            ECE    http://localhost:5514'
