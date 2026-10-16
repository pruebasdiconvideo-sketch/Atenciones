<?php
/**
 * ERP SOPORTE — Diagnóstico de Conexión
 * v2.84.1
 *
 * Sube este archivo a: C:\inetpub\wwwroot\HelpDesk2\backend\diagnostico.php
 * (o a la carpeta donde esté api_tickets.php)
 * Luego abre en el navegador: http://localhost/backend/diagnostico.php
 *
 * Este script muestra:
 *  - Versión de PHP y extensiones cargadas
 *  - Versión del driver sqlsrv
 *  - Estado de la conexión a SQL Server
 *  - Mensaje de error exacto si falla
 *  - Permisos de escritura en carpeta temporal
 *  - Configuración actual de db_config.php
 */

header("Content-Type: text/html; charset=UTF-8");
error_reporting(E_ALL);
ini_set('display_errors', 1);

function check($label, $condition, $okMsg = 'OK', $errMsg = 'FALLO') {
    $color = $condition ? '#16a34a' : '#dc2626';
    $msg = $condition ? $okMsg : $errMsg;
    echo "<tr><td style='padding:6px;border:1px solid #ddd;font-weight:bold;'>" . htmlspecialchars($label) . "</td>";
    echo "<td style='padding:6px;border:1px solid #ddd;color:$color;font-weight:bold;'>$msg</td></tr>";
    return $condition;
}

echo "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Diagnóstico ERP SOPORTE</title>";
echo "<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:900px;margin:20px auto;padding:20px;background:#f5f5f5;}";
echo "h1{color:#141414;border-bottom:3px solid #141414;padding-bottom:10px;}";
echo "h2{color:#141414;margin-top:30px;}";
echo "table{width:100%;border-collapse:collapse;background:white;}";
echo "th{background:#141414;color:white;padding:8px;text-align:left;}";
echo ".ok{color:#16a34a;font-weight:bold;}.err{color:#dc2626;font-weight:bold;}";
echo ".box{background:white;padding:15px;border-left:4px solid #141414;margin:10px 0;}";
echo ".error-box{background:#fee;border:1px solid #f88;padding:15px;margin:10px 0;white-space:pre-wrap;font-family:monospace;}";
echo "</style></head><body>";

echo "<h1>🔧 Diagnóstico ERP SOPORTE v2.84.1</h1>";
echo "<p>Fecha: " . date('Y-m-d H:i:s') . "</p>";

// ====== 1. PHP INFO ======
echo "<h2>1. Información de PHP</h2>";
echo "<table>";
echo "<tr><th>Verificación</th><th>Resultado</th></tr>";
check("Versión de PHP", PHP_VERSION, PHP_VERSION, PHP_VERSION . " (se requiere 8.1+)");
check("Extensión sqlsrv cargada", extension_loaded('sqlsrv'), 'Cargada ✓', 'NO cargada ✗');
check("Extensión pdo_sqlsrv cargada", extension_loaded('pdo_sqlsrv'), 'Cargada ✓', 'NO cargada (opcional)');

check("json_encode disponible", function_exists('json_encode'), 'Sí', 'No (crítico)');
check("file_get_contents disponible", function_exists('file_get_contents'), 'Sí', 'No');
check("file_put_contents disponible", function_exists('file_put_contents'), 'Sí', 'No');
check("mkdir disponible", function_exists('mkdir'), 'Sí', 'No');
check("sys_get_temp_dir disponible", function_exists('sys_get_temp_dir'), 'Sí', 'No');
echo "</table>";

// ====== 2. CARPETA TEMPORAL ======
echo "<h2>2. Carpeta Temporal (para caché)</h2>";
echo "<div class='box'>";
$tempDir = sys_get_temp_dir();
echo "<strong>sys_get_temp_dir():</strong> " . htmlspecialchars($tempDir) . "<br>";
$cacheDir = $tempDir . '/erp_soporte_cache';
echo "<strong>Cache dir:</strong> " . htmlspecialchars($cacheDir) . "<br>";
if (!is_dir($cacheDir)) {
    $created = @mkdir($cacheDir, 0775, true);
    echo "<strong>Crear carpeta:</strong> " . ($created ? '✓ Creada' : '✗ No se pudo crear (revisar permisos IIS)') . "<br>";
}
if (is_dir($cacheDir)) {
    $writable = is_writable($cacheDir);
    echo "<strong>Permisos de escritura:</strong> " . ($writable ? '✓ Writable' : '✗ No writable') . "<br>";
    if ($writable) {
        $testFile = $cacheDir . '/test_' . time() . '.txt';
        $written = @file_put_contents($testFile, 'test');
        echo "<strong>Test escritura archivo:</strong> " . ($written !== false ? '✓ OK' : '✗ Falló') . "<br>";
        if (file_exists($testFile)) @unlink($testFile);
    }
}
echo "</div>";

// ====== 3. CONFIGURACIÓN DB ======
echo "<h2>3. Configuración de Base de Datos</h2>";
echo "<div class='box'>";
$configFile = __DIR__ . '/db_config.php';
if (file_exists($configFile)) {
    echo "<strong>db_config.php:</strong> Encontrado ✓<br>";
    try {
        $dbConfig = require $configFile;
        if (is_array($dbConfig)) {
            echo "<strong>serverName:</strong> " . htmlspecialchars($dbConfig['serverName'] ?? 'NO DEFINIDO') . "<br>";
            echo "<strong>connectionInfo keys:</strong> " . implode(', ', array_keys($dbConfig['connectionInfo'] ?? [])) . "<br>";
            echo "<strong>Database:</strong> " . htmlspecialchars($dbConfig['connectionInfo']['Database'] ?? 'NO DEFINIDO') . "<br>";
            echo "<strong>UID:</strong> " . htmlspecialchars($dbConfig['connectionInfo']['UID'] ?? 'NO DEFINIDO') . "<br>";
            echo "<strong>PWD:</strong> " . (isset($dbConfig['connectionInfo']['PWD']) ? '****** (oculto)' : 'NO DEFINIDO') . "<br>";
        } else {
            echo "<span class='err'>db_config.php no retornó un array válido</span><br>";
        }
    } catch (Exception $e) {
        echo "<span class='err'>Error al leer db_config.php: " . htmlspecialchars($e->getMessage()) . "</span><br>";
    }
} else {
    echo "<span class='err'>db_config.php NO existe en: " . htmlspecialchars($configFile) . "</span><br>";
}
echo "</div>";

// ====== 4. TEST DE CONEXIÓN ======
echo "<h2>4. Test de Conexión a SQL Server</h2>";

if (!extension_loaded('sqlsrv')) {
    echo "<div class='error-box'>❌ La extensión sqlsrv NO está cargada en PHP.
    
Posibles causas:
1. No instalaste el driver Microsoft PHP Drivers for SQL Server
2. La versión del driver no coincide con tu versión de PHP
3. La extensión no está habilitada en php.ini

Solución:
1. Descarga el driver desde: https://learn.microsoft.com/sql/connect/php/download-drivers-php-sql-server
2. Copia el archivo php_sqlsrv.dll y php_pdo_sqlsrv.dll a la carpeta ext de PHP
3. Edita php.ini y agrega:
   extension=php_sqlsrv.dll
   extension=php_pdo_sqlsrv.dll
4. Reinicia IIS: iisreset</div>";
} else {
    // Intentar conectar con configuración mínima (sin parámetros nuevos)
    echo "<div class='box'>";
    echo "<strong>Intentando conexión con configuración MÍNIMA (compatible con cualquier driver)...</strong><br><br>";

    if (file_exists($configFile) && isset($dbConfig)) {
        $serverName = $dbConfig['serverName'];
        $minimalConnInfo = array(
            "Database" => $dbConfig['connectionInfo']['Database'],
            "UID" => $dbConfig['connectionInfo']['UID'],
            "PWD" => $dbConfig['connectionInfo']['PWD'],
            "CharacterSet" => "UTF-8",
            "TrustServerCertificate" => true,
            "LoginTimeout" => 15
        );

        echo "<strong>Server:</strong> " . htmlspecialchars($serverName) . "<br>";
        echo "<strong>Intentando sqlsrv_connect()...</strong><br>";

        $conn = @sqlsrv_connect($serverName, $minimalConnInfo);

        if ($conn) {
            echo "<span class='ok'>✓ Conexión EXITOSA con configuración mínima</span><br>";
            $sqlsrvVersion = sqlsrv_client_info($conn);
            if ($sqlsrvVersion) {
                echo "<strong>Driver sqlsrv:</strong> " . htmlspecialchars($sqlsrvVersion['DriverVer'] ?? 'desconocido') . " / ODBC: " . htmlspecialchars($sqlsrvVersion['DriverODBCVer'] ?? 'desconocido') . "<br>";
            }

            // Test de query
            $stmt = sqlsrv_query($conn, "SELECT GETDATE() AS ahora, @@VERSION AS version");
            if ($stmt) {
                $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
                $now = $row['ahora'] instanceof DateTimeInterface ? $row['ahora']->format('Y-m-d H:i:s') : (string)$row['ahora'];
                echo "<strong>GETDATE():</strong> " . htmlspecialchars($now) . "<br>";
                echo "<strong>Versión SQL Server:</strong> " . substr($row['version'], 0, 80) . "...<br>";
            }
            sqlsrv_close($conn);

            // Ahora intentar con configuración completa de v2.84
            echo "<br><strong>Probando configuración COMPLETA de v2.84...</strong><br>";
            $fullConnInfo = $dbConfig['connectionInfo'];
            $conn2 = @sqlsrv_connect($serverName, $fullConnInfo);
            if ($conn2) {
                echo "<span class='ok'>✓ Conexión exitosa con configuración completa</span><br>";
                sqlsrv_close($conn2);
            } else {
                $errors = sqlsrv_errors();
                echo "<span class='err'>✗ Falló la conexión con configuración completa</span><br>";
                echo "<div class='error-box'>ERRORES:<br>";
                foreach ($errors as $e) {
                    echo "SQLSTATE: " . $e['SQLSTATE'] . "<br>";
                    echo "Code: " . $e['code'] . "<br>";
                    echo "Message: " . $e['message'] . "<br>";
                    echo "---<br>";
                }
                echo "</div>";
                echo "<div class='box'>💡 <strong>SOLUCIÓN:</strong> Usa el archivo db_config.php de v2.84.1 (configuración conservadora sin los parámetros nuevos).</div>";
            }
        } else {
            $errors = sqlsrv_errors();
            echo "<span class='err'>✗ Conexión FALLÓ incluso con configuración mínima</span><br>";
            echo "<div class='error-box'>ERRORES DE CONEXIÓN:<br>";
            foreach ($errors as $e) {
                echo "SQLSTATE: " . $e['SQLSTATE'] . "<br>";
                echo "Code: " . $e['code'] . "<br>";
                echo "Message: " . $e['message'] . "<br>";
                echo "---<br>";
            }
            echo "</div>";

            echo "<div class='box'>
💡 <strong>Posibles causas:</strong><br>
1. <strong>SQL Server no está corriendo</strong> → Abre 'services.msc' y verifica que 'SQL Server (SQL2025)' esté iniciado<br>
2. <strong>Nombre del servidor incorrecto</strong> → Verifica con 'SELECT @@SERVERNAME' en SSMS<br>
3. <strong>Puerto bloqueado por firewall</strong> → Habilita el puerto 1433 en Windows Firewall<br>
4. <strong>Credenciales incorrectas</strong> → Verifica usuario 'sa' y contraseña<br>
5. <strong>SQL Server no acepta conexiones TCP/IP</strong> → En SQL Server Configuration Manager, habilita TCP/IP en Protocolos<br>
6. <strong>Browser service detenido</strong> → Inicia el servicio 'SQL Server Browser'<br>
</div>";
        }
    } else {
        echo "<span class='err'>No se pudo cargar db_config.php</span>";
    }
    echo "</div>";
}

// ====== 5. TEST DE API ======
echo "<h2>5. Test del Endpoint api_tickets.php</h2>";
echo "<div class='box'>";
echo "<strong>Verificando api_tickets.php...</strong><br>";
$apiFile = __DIR__ . '/api_tickets.php';
if (file_exists($apiFile)) {
    echo "✓ api_tickets.php encontrado<br>";
    echo "<strong>Tamaño:</strong> " . number_format(filesize($apiFile)) . " bytes<br>";

    // Verificar sintaxis PHP
    $output = [];
    $returnVar = 0;
    $phpPath = "php"; // Ajusta si es necesario
    exec("$phpPath -l " . escapeshellarg($apiFile) . " 2>&1", $output, $returnVar);
    echo "<strong>Verificación de sintaxis PHP:</strong><br>";
    echo "<pre style='background:#f0f0f0;padding:10px;'>" . htmlspecialchars(implode("\n", $output)) . "</pre>";
} else {
    echo "<span class='err'>api_tickets.php NO existe en: " . htmlspecialchars($apiFile) . "</span>";
}
echo "</div>";

// ====== 6. RESUMEN ======
echo "<h2>6. Resumen y Próximos Pasos</h2>";
echo "<div class='box'>";
echo "<strong>Si la conexión mínima funcionó pero la completa falló:</strong><br>";
echo "1. Reemplaza db_config.php con la versión conservadora de v2.84.1<br>";
echo "2. Reemplaza api_tickets.php con la versión de v2.84.1 (caché deshabilitado por defecto)<br>";
echo "3. Reinicia IIS: <code>iisreset</code><br><br>";

echo "<strong>Si la conexión mínima falló:</strong><br>";
echo "1. Verifica que SQL Server esté corriendo (services.msc)<br>";
echo "2. Verifica TCP/IP habilitado (SQL Server Configuration Manager)<br>";
echo "3. Verifica credenciales en db_config.php<br>";
echo "4. Verifica firewall permita puerto 1433<br><br>";

echo "<strong>Para activar el caché nuevamente (después de confirmar que funciona):</strong><br>";
echo "Edita api_tickets.php y busca la línea:<br>";
echo "<code>define('ERP_CACHE_ENABLED', false);</code><br>";
echo "Cámbiala a:<br>";
echo "<code>define('ERP_CACHE_ENABLED', true);</code><br>";
echo "</div>";

echo "</body></html>";
