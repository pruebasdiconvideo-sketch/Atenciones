<?php
/**
 * ERP SOPORTE — Diagnóstico de Creación de Ticket
 * v2.89
 *
 * Sube este archivo a: C:\inetpub\wwwroot\HelpDesk2\backend\test_create_ticket.php
 * Luego abre en el navegador:
 * http://localhost:806/backend/test_create_ticket.php
 *
 * Este script prueba crear un ticket paso a paso y muestra el error EXACTO
 * de SQL Server si algo falla.
 */

header("Content-Type: text/html; charset=UTF-8");
error_reporting(E_ALL);
ini_set('display_errors', 1);

echo "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Test Crear Ticket</title>";
echo "<style>body{font-family:monospace;max-width:1000px;margin:20px auto;padding:20px;background:#f5f5f5;font-size:12px;}";
echo ".ok{color:#16a34a;font-weight:bold;}.err{color:#dc2626;font-weight:bold;}";
echo ".warn{color:#d97706;font-weight:bold;}.box{background:white;padding:10px;border:1px solid #ccc;margin:10px 0;}";
echo "pre{background:#1e1e1e;color:#d4d4d4;padding:10px;overflow-x:auto;}";
echo "</style></head><body>";

echo "<h1>🧪 Test de Creación de Ticket — v2.89</h1>";
echo "<p>Fecha: " . date('Y-m-d H:i:s') . "</p>";

// Cargar configuración
$configFile = __DIR__ . '/db_config.php';
if (!file_exists($configFile)) {
    die("<p class='err'>❌ No se encuentra db_config.php en: " . htmlspecialchars($configFile) . "</p>");
}

$dbConfig = require $configFile;
$serverName = $dbConfig['serverName'];
$connectionInfo = $dbConfig['connectionInfo'];

echo "<div class='box'>";
echo "<h3>1. Configuración de conexión</h3>";
echo "<strong>Server:</strong> " . htmlspecialchars($serverName) . "<br>";
echo "<strong>Database:</strong> " . htmlspecialchars($connectionInfo['Database'] ?? 'NO DEFINIDO') . "<br>";
echo "<strong>UID:</strong> " . htmlspecialchars($connectionInfo['UID'] ?? 'NO DEFINIDO') . "<br>";
echo "<strong>PWD:</strong> " . (isset($connectionInfo['PWD']) ? '******' : 'NO DEFINIDO') . "<br>";
echo "</div>";

// Conectar
echo "<div class='box'>";
echo "<h3>2. Conexión a SQL Server</h3>";
$conn = @sqlsrv_connect($serverName, $connectionInfo);
if (!$conn) {
    echo "<p class='err'>❌ Error de conexión:</p>";
    echo "<pre>" . print_r(sqlsrv_errors(), true) . "</pre>";
    echo "</div></body></html>";
    exit;
}
echo "<p class='ok'>✓ Conexión exitosa</p>";
echo "</div>";

// Verificar estructura de la tabla ticket
echo "<div class='box'>";
echo "<h3>3. Estructura de la tabla 'ticket'</h3>";
$colsStmt = sqlsrv_query($conn, "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ticket' ORDER BY ORDINAL_POSITION");
if ($colsStmt === false) {
    echo "<p class='err'>❌ Error al obtener columnas: " . print_r(sqlsrv_errors(), true) . "</p>";
} else {
    echo "<table border='1' cellpadding='4' style='border-collapse:collapse;'>";
    echo "<tr style='background:#333;color:white;'><th>Columna</th><th>Tipo</th><th>Nullable</th><th>Default</th></tr>";
    while ($col = sqlsrv_fetch_array($colsStmt, SQLSRV_FETCH_ASSOC)) {
        echo "<tr><td>" . $col['COLUMN_NAME'] . "</td><td>" . $col['DATA_TYPE'] . "</td><td>" . $col['IS_NULLABLE'] . "</td><td>" . htmlspecialchars($col['COLUMN_DEFAULT'] ?? 'NULL') . "</td></tr>";
    }
    echo "</table>";
}
echo "</div>";

// Verificar que existe una empresa válida
echo "<div class='box'>";
echo "<h3>4. Empresa de prueba</h3>";
$empStmt = sqlsrv_query($conn, "SELECT TOP 1 id_empresa, razon_social, ruc FROM empresa WHERE activo = 1");
if ($empStmt === false || !sqlsrv_has_rows($empStmt)) {
    echo "<p class='err'>❌ No hay empresas activas en la BD. Cree una empresa primero.</p>";
    echo "</div></body></html>";
    exit;
}
$emp = sqlsrv_fetch_array($empStmt, SQLSRV_FETCH_ASSOC);
echo "<p class='ok'>✓ Empresa encontrada: ID=" . $emp['id_empresa'] . " - " . htmlspecialchars($emp['razon_social']) . " (RUC: " . $emp['ruc'] . ")</p>";
echo "</div>";

// Verificar que existe un contacto válido
echo "<div class='box'>";
echo "<h3>5. Contacto de prueba</h3>";
$conStmt = sqlsrv_query($conn, "SELECT TOP 1 ec.id_empresa_contacto, p.nombres, p.apellido_paterno FROM empresa_contacto ec INNER JOIN persona p ON ec.id_persona = p.id_persona WHERE ec.activo = 1");
if ($conStmt === false || !sqlsrv_has_rows($conStmt)) {
    echo "<p class='err'>❌ No hay contactos activos en la BD. Cree un contacto primero.</p>";
    echo "</div></body></html>";
    exit;
}
$con = sqlsrv_fetch_array($conStmt, SQLSRV_FETCH_ASSOC);
echo "<p class='ok'>✓ Contacto encontrado: ID=" . $con['id_empresa_contacto'] . " - " . htmlspecialchars($con['nombres'] . " " . $con['apellido_paterno']) . "</p>";
echo "</div>";

// Verificar que existe un usuario válido
echo "<div class='box'>";
echo "<h3>6. Usuario de prueba</h3>";
$usrStmt = sqlsrv_query($conn, "SELECT TOP 1 id_persona, nombres, apellido_paterno FROM persona WHERE estado = 1");
if ($usrStmt === false || !sqlsrv_has_rows($usrStmt)) {
    echo "<p class='warn'>⚠ No hay usuarios activos. Usaremos ID 1.</p>";
    $id_usuario = 1;
} else {
    $usr = sqlsrv_fetch_array($usrStmt, SQLSRV_FETCH_ASSOC);
    $id_usuario = intval($usr['id_persona']);
    echo "<p class='ok'>✓ Usuario encontrado: ID=" . $id_usuario . " - " . htmlspecialchars($usr['nombres'] . " " . $usr['apellido_paterno']) . "</p>";
}
echo "</div>";

// Verificar tabla atencion
echo "<div class='box'>";
echo "<h3>7. Estructura de la tabla 'atencion'</h3>";
$atColsStmt = sqlsrv_query($conn, "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'atencion' ORDER BY ORDINAL_POSITION");
if ($atColsStmt === false) {
    echo "<p class='err'>❌ Error: " . print_r(sqlsrv_errors(), true) . "</p>";
} else {
    echo "<table border='1' cellpadding='4' style='border-collapse:collapse;'>";
    echo "<tr style='background:#333;color:white;'><th>Columna</th><th>Tipo</th><th>Nullable</th></tr>";
    while ($col = sqlsrv_fetch_array($atColsStmt, SQLSRV_FETCH_ASSOC)) {
        echo "<tr><td>" . $col['COLUMN_NAME'] . "</td><td>" . $col['DATA_TYPE'] . "</td><td>" . $col['IS_NULLABLE'] . "</td></tr>";
    }
    echo "</table>";
}
echo "</div>";

// INTENTO 1: Crear ticket
echo "<div class='box'>";
echo "<h3>8. INTENTO de creación de ticket</h3>";

$id_empresa = intval($emp['id_empresa']);
$id_empresa_contacto = intval($con['id_empresa_contacto']);
$detalle_reporte = "Ticket de prueba desde diagnóstico - " . date('Y-m-d H:i:s');
$prioridad = "MEDIA";
$estado = "PENDIENTE";
$medio = "EMAIL";

echo "<strong>SQL a ejecutar:</strong><br>";
$sql = "INSERT INTO ticket (id_empresa, id_empresa_contacto, detalle_reporte, prioridad, estado, medio_contacto, id_usuario, fecha_registro, hora_registro) VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE(), CAST(GETDATE() AS TIME))";
echo "<pre>" . htmlspecialchars($sql) . "</pre>";
echo "<strong>Parámetros:</strong><br>";
echo "<pre>" . json_encode(array($id_empresa, $id_empresa_contacto, $detalle_reporte, $prioridad, $estado, $medio, $id_usuario), JSON_PRETTY_PRINT) . "</pre>";

$params = array($id_empresa, $id_empresa_contacto, $detalle_reporte, $prioridad, $estado, $medio, $id_usuario);
$stmt = sqlsrv_query($conn, $sql, $params);

if ($stmt === false) {
    echo "<p class='err'>❌ ERROR al insertar ticket:</p>";
    echo "<pre>" . print_r(sqlsrv_errors(), true) . "</pre>";
    echo "</div>";
} else {
    echo "<p class='ok'>✓ Ticket insertado correctamente</p>";

    // Obtener ID
    $maxStmt = sqlsrv_query($conn, "SELECT MAX(id_ticket) AS max_id FROM ticket");
    $id_ticket = 0;
    if ($maxStmt !== false && $row = sqlsrv_fetch_array($maxStmt, SQLSRV_FETCH_ASSOC)) {
        $id_ticket = intval($row['max_id']);
    }
    echo "<p>ID del ticket nuevo: <strong>$id_ticket</strong></p>";

    if ($id_ticket) {
        // Generar nro_ticket
        $year = date('Y');
        $nro = $year . '-' . str_pad($id_ticket, 5, '0', STR_PAD_LEFT);
        sqlsrv_query($conn, "UPDATE ticket SET nro_ticket = ? WHERE id_ticket = ?", array($nro, $id_ticket));
        echo "<p>Nro ticket: <strong>$nro</strong></p>";

        // INTENTO 2: Crear atención
        echo "<h3>9. INTENTO de creación de atención</h3>";
        $atSql = "INSERT INTO atencion (id_ticket, id_usuario, detalle_atencion, solucion_aplicada, estado) VALUES (?, ?, ?, ?, ?)";
        $atParams = array($id_ticket, $id_usuario, "Atención de prueba", "Solución de prueba", "COMPLETADO");
        echo "<strong>SQL:</strong><br><pre>" . htmlspecialchars($atSql) . "</pre>";
        echo "<strong>Parámetros:</strong><br><pre>" . json_encode($atParams, JSON_PRETTY_PRINT) . "</pre>";

        $atStmt = sqlsrv_query($conn, $atSql, $atParams);
        if ($atStmt === false) {
            echo "<p class='err'>❌ ERROR al insertar atención:</p>";
            echo "<pre>" . print_r(sqlsrv_errors(), true) . "</pre>";
        } else {
            echo "<p class='ok'>✓ Atención insertada correctamente</p>";
        }

        // INTENTO 3: Cerrar como RESUELTO
        echo "<h3>10. INTENTO de cierre (RESUELTO)</h3>";
        $closeSql = "UPDATE ticket SET estado = ?, fecha_cierre = CAST(GETDATE() AS DATE), hora_cierre = CAST(GETDATE() AS TIME) WHERE id_ticket = ?";
        $closeParams = array("RESUELTO", $id_ticket);
        $closeStmt = sqlsrv_query($conn, $closeSql, $closeParams);
        if ($closeStmt === false) {
            echo "<p class='err'>❌ ERROR al cerrar ticket:</p>";
            echo "<pre>" . print_r(sqlsrv_errors(), true) . "</pre>";
        } else {
            echo "<p class='ok'>✓ Ticket cerrado como RESUELTO</p>";
        }

        // Limpiar: eliminar el ticket de prueba
        sqlsrv_query($conn, "DELETE FROM atencion WHERE id_ticket = ?", array($id_ticket));
        sqlsrv_query($conn, "DELETE FROM ticket WHERE id_ticket = ?", array($id_ticket));
        echo "<p class='warn'>⚠ Ticket de prueba eliminado (limpieza)</p>";
    }
}
echo "</div>";

echo "<div class='box'>";
echo "<h3>📋 Conclusión</h3>";
echo "<p>Si llegaste hasta aquí sin errores, la creación de tickets funciona correctamente.</p>";
echo "<p>Si hubo un error en algún paso, el mensaje de SQL Server arriba te dirá exactamente qué columna o constraint está fallando.</p>";
echo "<p>Comúnmente los errores son:</p>";
echo "<ul>";
echo "<li><strong>Columna no existe</strong>: La tabla ticket o atencion no tiene una columna que el INSERT espera.</li>";
echo "<li><strong>FOREIGN KEY violation</strong>: El id_empresa, id_empresa_contacto o id_usuario no existen en sus tablas.</li>";
echo "<li><strong>NOT NULL violation</strong>: Falta una columna obligatoria que no tiene DEFAULT.</li>";
echo "<li><strong>Trigger error</strong>: Un trigger en la tabla está fallando.</li>";
echo "</ul>";
echo "</div>";

sqlsrv_close($conn);
echo "</body></html>";
