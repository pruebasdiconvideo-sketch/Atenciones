<?php
/**
 * Database Configuration - ERP SOPORTE
 * v2.84.2 — Configuración PERSONALIZADA para el cliente
 *
 * Servidor:  WIN-F31EASNBOTC\SQL2025
 * Base datos: MonosyncERP
 * Usuario:    sa
 * Contraseña: WEB$VITEL1
 *
 * Esta versión es CONSERVADORA (sin parámetros nuevos que causan HTTP 500).
 * El caché server-side está DESHABILITADO por defecto en api_tickets.php.
 *
 * Este archivo debe estar en la misma carpeta que api_tickets.php:
 *   C:\inetpub\wwwroot\HelpDesk2\backend\db_config.php
 */

// Cargar desde variables de entorno si están disponibles
$serverName = getenv('DB_SERVER');
$database = getenv('DB_NAME');
$uid = getenv('DB_USER');
$pwd = getenv('DB_PASSWORD');

// Alternativa: cargar desde db_config.json
if (!$serverName || !$database || !$uid || !$pwd) {
    $configFile = __DIR__ . '/db_config.json';
    if (file_exists($configFile)) {
        $config = json_decode(file_get_contents($configFile), true);
        if ($config) {
            $serverName = $config['serverName'] ?? null;
            $database = $config['Database'] ?? null;
            $uid = $config['UID'] ?? null;
            $pwd = $config['PWD'] ?? null;
        }
    }
}

// Fallback: configuración directa con los datos del cliente
// FIX v2.84.2 — Valores correctos para el entorno del cliente.
if (!$serverName) $serverName = "WIN-F31EASNBOTC\\SQL2025";
if (!$database) $database = "MonosyncERP";
if (!$uid) $uid = "sa";
// FIX v2.84.3 — Contraseña correcta con $ (sin escapar, comillas simples)
if (!$pwd) $pwd = 'WEB$VITEL1';

return [
    'serverName' => $serverName,
    'connectionInfo' => [
        "Database" => $database,
        "UID" => $uid,
        "PWD" => $pwd,
        "CharacterSet" => "UTF-8",
        "TrustServerCertificate" => true,
        "LoginTimeout" => 15
        // NOTA: NO se incluyen ConnectionPooling, MultipleActiveResultSets,
        // ConnectRetryCount, ClientBufferMaxKBSize porque algunos drivers
        // sqlsrv antiguos los rechazan causando HTTP 500.
    ]
];
