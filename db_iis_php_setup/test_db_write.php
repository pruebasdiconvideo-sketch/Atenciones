<?php
/**
 * PRUEBA DE FUEGO - Script de Validación de Escritura Directa en SQL Server
 * 
 * Coloque este archivo en el directorio raíz de su servidor IIS (ej: C:\inetpub\wwwroot\test_db_write.php)
 * y ejecútelo desde su navegador (ej: http://localhost:806/test_db_write.php o usando la IP privada).
 */

header("Content-Type: text/plain; charset=UTF-8");

echo "=== PRUEBA DE FUEGO: CONEXIÓN Y ESCRITURA EN SQL SERVER ===\n\n";

// 1. CARGA DE CONFIGURACIÓN
$configFile = __DIR__ . '/db_config.json';
$serverName = "192.168.1.100,1433"; // Reemplace por la IP privada de su servidor SQL Server y puerto
$dbName = "MonosyncERP";
$dbUser = "sa"; // Se recomienda usar un usuario con privilegios acotados
$dbPass = "123";

if (file_exists($configFile)) {
    echo "[INFO] Cargando configuración activa de db_config.json...\n";
    $configData = json_decode(file_get_contents($configFile), true);
    if ($configData) {
        $serverName = isset($configData['serverName']) ? $configData['serverName'] : $serverName;
        $dbName = isset($configData['Database']) ? $configData['Database'] : $dbName;
        $dbUser = isset($configData['UID']) ? $configData['UID'] : $dbUser;
        $dbPass = isset($configData['PWD']) ? $configData['PWD'] : $dbPass;
    }
} else {
    echo "[WARN] No se encontró db_config.json. Usando valores por defecto de prueba.\n";
}

echo "Intentando conectar al Servidor: $serverName\n";
echo "Base de Datos: $dbName\n";
echo "Usuario DB: $dbUser\n\n";

// 2. CONFIGURACIÓN DEL ENLACE SQLSRV
$connectionInfo = array(
    "Database" => $dbName,
    "UID" => $dbUser,
    "PWD" => $dbPass,
    "CharacterSet" => "UTF-8",
    "ReturnDatesAsStrings" => true,
    "LoginTimeout" => 5 // Tiempo de espera rápido para descartar problemas de red
);

// 3. INTENTO DE CONEXIÓN
$conn = sqlsrv_connect($serverName, $connectionInfo);

if (!$conn) {
    echo "[❌ ERROR DE CONEXIÓN] No se pudo establecer enlace con SQL Server.\n";
    echo "Detalles del error (sqlsrv_errors):\n";
    $errors = sqlsrv_errors();
    if ($errors != null) {
        foreach ($errors as $error) {
            echo "  SQLSTATE: " . $error['SQLSTATE'] . "\n";
            echo "  Código de Error: " . $error['code'] . "\n";
            echo "  Mensaje: " . $error['message'] . "\n\n";
        }
    } else {
        echo "  No se pudieron recuperar detalles de sqlsrv_errors().\n";
    }
    echo "Sugerencias:\n";
    echo "1. Verifique que el servicio de SQL Server Express esté en ejecución.\n";
    echo "2. Valide que TCP/IP esté habilitado en SQL Server Configuration Manager.\n";
    echo "3. Confirme que el puerto 1433 esté abierto en el Firewall del servidor de Base de Datos.\n";
    exit;
}

echo "[✔ CONEXIÓN EXITOSA] Se enlazó correctamente con SQL Server.\n\n";

// 4. PRUEBA DE ESCRITURA (INSERT)
echo "Ejecutando prueba de escritura en la tabla 'ticket'...\n";

// Buscamos una empresa válida para la prueba para evitar violaciones de clave foránea
$checkEmpSql = "SELECT TOP 1 id_empresa, razon_social FROM empresa";
$checkEmpQuery = sqlsrv_query($conn, $checkEmpSql);
if ($checkEmpQuery === false || !sqlsrv_has_rows($checkEmpQuery)) {
    echo "[❌ ERROR] No se encontraron empresas registradas en la tabla 'empresa'. La inserción de ticket requiere un id_empresa válido.\n";
    sqlsrv_close($conn);
    exit;
}
$empresa = sqlsrv_fetch_array($checkEmpQuery, SQLSRV_FETCH_ASSOC);
$id_empresa = $empresa['id_empresa'];
echo "-> Usando Empresa vinculada para la prueba: '{$empresa['razon_social']}' (ID: $id_empresa)\n";

// Buscamos un contacto corporativo válido
$checkContSql = "SELECT TOP 1 id_empresa_contacto FROM empresa_contacto WHERE id_empresa = ?";
$checkContQuery = sqlsrv_query($conn, $checkContSql, array($id_empresa));
if ($checkContQuery === false || !sqlsrv_has_rows($checkContQuery)) {
    echo "[❌ ERROR] No se encontró un contacto corporativo (empresa_contacto) válido para la empresa ID: $id_empresa.\n";
    sqlsrv_close($conn);
    exit;
}
$contacto = sqlsrv_fetch_array($checkContQuery, SQLSRV_FETCH_ASSOC);
$id_contacto = $contacto['id_empresa_contacto'];
echo "-> Usando Contacto para la prueba (ID: $id_contacto)\n";

// Insertar un ticket de diagnóstico temporal
$ticketNum = "TEST-" . rand(1000, 9999);
$insertSql = "INSERT INTO ticket (nro_ticket, fecha_registro, hora_registro, detalle_reporte, prioridad, estado, medio_contacto, id_empresa, id_empresa_contacto, id_usuario)
              VALUES (?, CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME), ?, 'MEDIA', 'ABIERTO', 'SISTEMA', ?, ?, 1)";

$params = array(
    $ticketNum,
    "Ticket de prueba automática de escritura del servidor IIS. Generado a las " . date('Y-m-d H:i:s'),
    $id_empresa,
    $id_contacto
);

$stmt = sqlsrv_query($conn, $insertSql, $params);

if ($stmt === false) {
    echo "[❌ ERROR DE ESCRITURA] Falló la inserción en la tabla 'ticket'.\n";
    echo "Detalles del error (sqlsrv_errors):\n";
    $errors = sqlsrv_errors();
    foreach ($errors as $error) {
        echo "  SQLSTATE: " . $error['SQLSTATE'] . "\n";
        echo "  Código: " . $error['code'] . "\n";
        echo "  Mensaje: " . $error['message'] . "\n\n";
    }
    echo "Sugerencias:\n";
    echo "1. Verifique que el usuario '$dbUser' tenga permisos de INSERT y SELECT sobre la tabla 'ticket'.\n";
    echo "2. Valide que las claves foráneas (FK) y constraints de la tabla se cumplan correctamente.\n";
} else {
    echo "[✔ ESCRITURA EXITOSA] ¡Se guardó el ticket de prueba correctamente!\n";
    echo "Número de Ticket generado: $ticketNum\n";
    
    // Opcional: Eliminar el ticket de prueba para mantener limpia la base de datos
    $deleteSql = "DELETE FROM ticket WHERE nro_ticket = ?";
    sqlsrv_query($conn, $deleteSql, array($ticketNum));
    echo "[INFO] Registro de prueba eliminado de la base de datos para mantener la consistencia.\n";
}

// 5. CERRAR CONEXIÓN
sqlsrv_close($conn);
echo "\n=== FIN DE LA PRUEBA DE DIAGNÓSTICO ===";
