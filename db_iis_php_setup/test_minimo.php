<?php
/**
 * ERP SOPORTE — Diagnóstico MÍNIMO de Creación de Ticket
 * v2.89.1
 *
 * Este script es MÍNIMO: solo prueba el INSERT del ticket, sin atencion, sin cierre.
 * Si esto funciona, el problema está en la atencion. Si falla, el problema está en el ticket.
 *
 * Abre en el navegador:
 * http://localhost:806/backend/test_minimo.php
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);
header("Content-Type: text/html; charset=UTF-8");

echo "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Test Mínimo</title>";
echo "<style>body{font-family:monospace;max-width:900px;margin:20px auto;padding:20px;background:#f5f5f5;font-size:13px;}";
echo ".ok{color:green;font-weight:bold;}.err{color:red;font-weight:bold;}.warn{color:orange;font-weight:bold;}";
echo ".box{background:white;padding:15px;border:1px solid #ccc;margin:10px 0;}";
echo "pre{background:#1e1e1e;color:#d4d4d4;padding:10px;overflow-x:auto;white-space:pre-wrap;}";
echo "</style></head><body>";

echo "<h1>🧪 Test MÍNIMO de Creación de Ticket</h1>";
echo "<p>Fecha: " . date('Y-m-d H:i:s') . "</p>";

// 1. Cargar configuración
echo "<div class='box'><h3>1. Cargar db_config.php</h3>";
$configFile = __DIR__ . '/db_config.php';
if (!file_exists($configFile)) {
    echo "<p class='err'>❌ No existe: $configFile</p></div></body></html>";
    exit;
}
$dbConfig = require $configFile;
echo "<p class='ok'>✓ Cargado. Server: " . htmlspecialchars($dbConfig['serverName']) . "</p>";
echo "</div>";

// 2. Conectar
echo "<div class='box'><h3>2. Conectar a SQL Server</h3>";
$conn = @sqlsrv_connect($dbConfig['serverName'], $dbConfig['connectionInfo']);
if (!$conn) {
    echo "<p class='err'>❌ Error de conexión:</p>";
    echo "<pre>" . print_r(sqlsrv_errors(), true) . "</pre>";
    echo "</div></body></html>";
    exit;
}
echo "<p class='ok'>✓ Conectado</p>";
echo "</div>";

// 3. Verificar tabla ticket existe
echo "<div class='box'><h3>3. ¿Existe la tabla 'ticket'?</h3>";
$chk = sqlsrv_query($conn, "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ticket'");
$row = sqlsrv_fetch_array($chk, SQLSRV_FETCH_ASSOC);
if (intval($row['c']) === 0) {
    echo "<p class='err'>❌ La tabla 'ticket' NO EXISTE en la base de datos.</p>";
    echo "</div></body></html>";
    exit;
}
echo "<p class='ok'>✓ La tabla 'ticket' existe</p>";
echo "</div>";

// 4. Mostrar columnas de ticket
echo "<div class='box'><h3>4. Columnas de la tabla 'ticket'</h3>";
$cols = sqlsrv_query($conn, "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ticket' ORDER BY ORDINAL_POSITION");
echo "<table border='1' cellpadding='5' style='border-collapse:collapse;'>";
echo "<tr style='background:#333;color:white;'><th>Columna</th><th>Tipo</th><th>Nullable</th><th>Default</th></tr>";
$columnas = array();
while ($c = sqlsrv_fetch_array($cols, SQLSRV_FETCH_ASSOC)) {
    $columnas[] = $c['COLUMN_NAME'];
    echo "<tr><td><strong>" . $c['COLUMN_NAME'] . "</strong></td><td>" . $c['DATA_TYPE'] . "</td><td>" . $c['IS_NULLABLE'] . "</td><td>" . htmlspecialchars($c['COLUMN_DEFAULT'] ?? 'NULL') . "</td></tr>";
}
echo "</table>";
echo "</div>";

// 5. Buscar empresa válida
echo "<div class='box'><h3>5. Buscar empresa activa</h3>";
$empStmt = sqlsrv_query($conn, "SELECT TOP 1 id_empresa, razon_social FROM empresa WHERE activo = 1");
if ($empStmt === false || !sqlsrv_has_rows($empStmt)) {
    echo "<p class='err'>❌ No hay empresas activas.</p>";
    echo "<p>Errores: <pre>" . print_r(sqlsrv_errors(), true) . "</pre></p>";
    echo "</div></body></html>";
    exit;
}
$emp = sqlsrv_fetch_array($empStmt, SQLSRV_FETCH_ASSOC);
$id_empresa = intval($emp['id_empresa']);
echo "<p class='ok'>✓ Empresa: ID=$id_empresa - " . htmlspecialchars($emp['razon_social']) . "</p>";
echo "</div>";

// 6. Buscar contacto válido
echo "<div class='box'><h3>6. Buscar contacto activo</h3>";
$conStmt = sqlsrv_query($conn, "SELECT TOP 1 ec.id_empresa_contacto FROM empresa_contacto ec WHERE ec.activo = 1");
if ($conStmt === false || !sqlsrv_has_rows($conStmt)) {
    echo "<p class='err'>❌ No hay contactos activos.</p>";
    echo "</div></body></html>";
    exit;
}
$con = sqlsrv_fetch_array($conStmt, SQLSRV_FETCH_ASSOC);
$id_contacto = intval($con['id_empresa_contacto']);
echo "<p class='ok'>✓ Contacto: ID=$id_contacto</p>";
echo "</div>";

// 7. Buscar usuario válido
echo "<div class='box'><h3>7. Buscar usuario activo</h3>";
$usrStmt = sqlsrv_query($conn, "SELECT TOP 1 id_persona FROM persona WHERE estado = 1");
$id_usuario = 1;
if ($usrStmt !== false && sqlsrv_has_rows($usrStmt)) {
    $usr = sqlsrv_fetch_array($usrStmt, SQLSRV_FETCH_ASSOC);
    $id_usuario = intval($usr['id_persona']);
}
echo "<p class='ok'>✓ Usuario: ID=$id_usuario</p>";
echo "</div>";

// 8. INSERT MÍNIMO - solo columnas que SEGURAMENTE existen
echo "<div class='box'><h3>8. INSERT MÍNIMO del ticket</h3>";

// Construir INSERT dinámicamente según las columnas que existen
$campos_obligatorios = array('id_empresa', 'id_empresa_contacto', 'detalle_reporte', 'prioridad', 'estado', 'id_usuario');
$campos_disponibles = array();
foreach ($campos_obligatorios as $campo) {
    if (in_array($campo, $columnas)) {
        $campos_disponibles[] = $campo;
    }
}

// Agregar campos opcionales si existen
$campos_opcionales = array('medio_contacto', 'id_motivo_contacto', 'id_sucursal', 'fecha_registro', 'hora_registro');
foreach ($campos_opcionales as $campo) {
    if (in_array($campo, $columnas)) {
        $campos_disponibles[] = $campo;
    }
}

echo "<p>Campos disponibles para INSERT: <strong>" . implode(', ', $campos_disponibles) . "</strong></p>";

// Construir SQL
$placeholders = array();
$valores = array();
foreach ($campos_disponibles as $campo) {
    if ($campo === 'fecha_registro') {
        $placeholders[] = 'GETDATE()';
    } elseif ($campo === 'hora_registro') {
        $placeholders[] = 'CAST(GETDATE() AS TIME)';
    } else {
        $placeholders[] = '?';
        switch ($campo) {
            case 'id_empresa': $valores[] = $id_empresa; break;
            case 'id_empresa_contacto': $valores[] = $id_contacto; break;
            case 'detalle_reporte': $valores[] = "Ticket de prueba mínimo " . date('H:i:s'); break;
            case 'prioridad': $valores[] = "MEDIA"; break;
            case 'estado': $valores[] = "PENDIENTE"; break;
            case 'id_usuario': $valores[] = $id_usuario; break;
            case 'medio_contacto': $valores[] = "EMAIL"; break;
            case 'id_motivo_contacto': $valores[] = null; break;
            case 'id_sucursal': $valores[] = null; break;
        }
    }
}

$sql = "INSERT INTO ticket (" . implode(', ', $campos_disponibles) . ") VALUES (" . implode(', ', $placeholders) . ")";
echo "<p><strong>SQL:</strong></p><pre>" . htmlspecialchars($sql) . "</pre>";
echo "<p><strong>Valores:</strong> " . json_encode($valores) . "</p>";

$stmt = sqlsrv_query($conn, $sql, $valores);
if ($stmt === false) {
    echo "<p class='err'>❌ ERROR en INSERT:</p>";
    echo "<pre>" . print_r(sqlsrv_errors(), true) . "</pre>";
    echo "</div>";
} else {
    echo "<p class='ok'>✓ Ticket insertado correctamente</p>";

    // Obtener ID
    $maxStmt = sqlsrv_query($conn, "SELECT MAX(id_ticket) AS max_id FROM ticket");
    $id_ticket = 0;
    if ($maxStmt !== false && $r = sqlsrv_fetch_array($maxStmt, SQLSRV_FETCH_ASSOC)) {
        $id_ticket = intval($r['max_id']);
    }
    echo "<p>ID nuevo: <strong>$id_ticket</strong></p>";

    // Generar nro_ticket si la columna existe
    if (in_array('nro_ticket', $columnas) && $id_ticket) {
        $year = date('Y');
        $nro = $year . '-' . str_pad($id_ticket, 5, '0', STR_PAD_LEFT);
        $updNro = sqlsrv_query($conn, "UPDATE ticket SET nro_ticket = ? WHERE id_ticket = ?", array($nro, $id_ticket));
        if ($updNro !== false) {
            echo "<p class='ok'>✓ nro_ticket actualizado: $nro</p>";
        } else {
            echo "<p class='warn'>⚠ No se pudo actualizar nro_ticket: " . print_r(sqlsrv_errors(), true) . "</p>";
        }
    }

    // Limpiar
    if ($id_ticket) {
        sqlsrv_query($conn, "DELETE FROM ticket WHERE id_ticket = ?", array($id_ticket));
        echo "<p class='warn'>⚠ Ticket de prueba eliminado (limpieza)</p>";
    }
    echo "</div>";

    echo "<div class='box'><h3>✅ CONCLUSIÓN</h3>";
    echo "<p>Si llegaste aquí, el INSERT del ticket funciona. El problema está en:</p>";
    echo "<ul>";
    echo "<li>La creación de la <strong>atención</strong> (tabla atencion)</li>";
    echo "<li>O el <strong>UPDATE</strong> a RESUELTO</li>";
    echo "<li>O el <strong>SP sp_ticket_create</strong> que no existe</li>";
    echo "</ul>";
    echo "<p>Revisa el log de PHP en C:\Windows\Temp\php-errors.log para más detalles.</p>";
    echo "</div>";
}

sqlsrv_close($conn);
echo "</body></html>";
