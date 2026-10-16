<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);
header("Content-Type: text/html; charset=UTF-8");

echo "<h1>Test sync_light</h1>";

$configFile = __DIR__ . '/db_config.php';
echo "<p>Config: " . (file_exists($configFile) ? 'OK' : 'NO EXISTE') . "</p>";

$dbConfig = require $configFile;
echo "<p>Server: " . htmlspecialchars($dbConfig['serverName']) . "</p>";

$conn = @sqlsrv_connect($dbConfig['serverName'], $dbConfig['connectionInfo']);
if (!$conn) {
    echo "<p style='color:red'>Error conexion: " . print_r(sqlsrv_errors(), true) . "</p>";
    exit;
}
echo "<p style='color:green'>Conexion OK</p>";

// Probar cada tabla individualmente
$tablas = array(
    'pais' => "SELECT TOP 1 id_pais, nombre FROM pais",
    'empresa' => "SELECT TOP 1 id_empresa, razon_social FROM empresa WHERE activo = 1",
    'ticket' => "SELECT TOP 1 id_ticket, nro_ticket FROM ticket ORDER BY id_ticket DESC",
    'atencion' => "SELECT TOP 1 id_atencion FROM atencion ORDER BY id_atencion DESC",
    'auditoria_operacion' => "SELECT TOP 1 id_auditoria, usuario FROM auditoria_operacion ORDER BY id_auditoria DESC",
    'persona' => "SELECT TOP 1 id_persona, nombres FROM persona WHERE estado = 1",
    'empresa_sucursal' => "SELECT TOP 1 id_sucursal, nombre FROM empresa_sucursal WHERE activo = 1",
    'empresa_contacto' => "SELECT TOP 1 id_empresa_contacto FROM empresa_contacto WHERE activo = 1",
    'motivo_contacto' => "SELECT TOP 1 id_motivo, nombre FROM motivo_contacto",
    'persona_rol' => "SELECT TOP 1 id_rol, nombre FROM persona_rol",
    'persona_rol_asignacion' => "SELECT TOP 1 id_persona, id_rol FROM persona_rol_asignacion",
    'role_permissions' => "SELECT TOP 1 id_rol, modulo FROM role_permissions",
    'grupo_empresarial' => "SELECT TOP 1 id_grupo, nombre FROM grupo_empresarial",
    'rubro' => "SELECT TOP 1 id_rubro, nombre FROM rubro",
    'ubicacion' => "SELECT TOP 1 id_ubicacion FROM ubicacion",
    'division_geografica' => "SELECT TOP 1 id_division, nombre FROM division_geografica",
    'ticket_historial_estado' => "SELECT TOP 1 id_historial FROM ticket_historial_estado",
    'acceso_auditoria' => "SELECT TOP 1 id_acceso FROM acceso_auditoria",
    'bajas_registro' => "SELECT TOP 1 id_baja FROM bajas_registro",
    'atencion_tiempo' => "SELECT TOP 1 id_atencion FROM atencion_tiempo",
);

echo "<table border='1' cellpadding='5' style='border-collapse:collapse;font-family:monospace;'>";
echo "<tr style='background:#333;color:white;'><th>Tabla</th><th>Estado</th><th>Error</th></tr>";

foreach ($tablas as $nombre => $sql) {
    $stmt = @sqlsrv_query($conn, $sql);
    if ($stmt === false) {
        $errs = sqlsrv_errors();
        $errMsg = '';
        foreach ($errs as $e) {
            $errMsg .= $e['SQLSTATE'] . ': ' . $e['message'] . ' ';
        }
        echo "<tr><td><strong>$nombre</strong></td><td style='color:red'>ERROR</td><td style='color:red;font-size:10px;'>" . htmlspecialchars($errMsg) . "</td></tr>";
    } else {
        $count = 0;
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
            $count++;
        }
        echo "<tr><td><strong>$nombre</strong></td><td style='color:green'>OK ($count)</td><td>—</td></tr>";
    }
}
echo "</table>";

// Probar log_operacion_auto
echo "<h2>Test log_operacion_auto</h2>";
echo "<p>Intentando insertar en auditoria_operacion...</p>";

// Verificar columnas
$cols = @sqlsrv_query($conn, "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='auditoria_operacion'");
$colList = array();
if ($cols !== false) {
    while ($c = sqlsrv_fetch_array($cols, SQLSRV_FETCH_ASSOC)) {
        $colList[] = $c['COLUMN_NAME'];
    }
}
echo "<p>Columnas: " . implode(', ', $colList) . "</p>";

// Intentar INSERT directo
$testSql = "INSERT INTO auditoria_operacion (usuario, fecha_hora, modulo, operacion, detalles) VALUES (?, GETDATE(), ?, ?, ?)";
$testParams = array('Test Diagnostico', 'TEST', 'CREACION', 'Prueba de insercion');
$testStmt = @sqlsrv_query($conn, $testSql, $testParams);
if ($testStmt === false) {
    $errs = sqlsrv_errors();
    echo "<p style='color:red'>ERROR al insertar: " . print_r($errs, true) . "</p>";
} else {
    echo "<p style='color:green'>INSERT OK — la bitacora funciona</p>";
    // Limpiar
    @sqlsrv_query($conn, "DELETE FROM auditoria_operacion WHERE usuario = 'Test Diagnostico'");
}

sqlsrv_close($conn);
echo "<p>Done.</p>";
