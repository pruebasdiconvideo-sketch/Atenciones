<?php
/**
 * ERP SOPORTE — Test PHP Básico
 * v2.90.1
 *
 * Copia este archivo a la MISMA carpeta donde está api_tickets.php
 * (probablemente C:\inetpub\wwwroot\HelpDesk2\dist\ o la raíz del sitio)
 *
 * Luego abre: http://192.168.196.180:806/test_php.php
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);
header("Content-Type: text/html; charset=UTF-8");

echo "<h1>🧪 Test PHP Básico</h1>";
echo "<p>Si ves esto, PHP funciona correctamente.</p>";
echo "<p>Fecha: " . date('Y-m-d H:i:s') . "</p>";
echo "<p>Versión PHP: " . PHP_VERSION . "</p>";

// Verificar extensión sqlsrv
echo "<h2>1. Extensiones</h2>";
echo "<p>sqlsrv cargado: " . (extension_loaded('sqlsrv') ? '✓ SÍ' : '❌ NO') . "</p>";
echo "<p>pdo_sqlsrv cargado: " . (extension_loaded('pdo_sqlsrv') ? '✓ SÍ' : '❌ NO') . "</p>";

// Verificar db_config.php
echo "<h2>2. Configuración</h2>";
$configFile = __DIR__ . '/db_config.php';
echo "<p>db_config.php existe: " . (file_exists($configFile) ? '✓ SÍ' : '❌ NO') . "</p>";
echo "<p>Carpeta actual: " . __DIR__ . "</p>";

if (file_exists($configFile)) {
    $dbConfig = require $configFile;
    echo "<p>Server: " . htmlspecialchars($dbConfig['serverName'] ?? 'NO DEFINIDO') . "</p>";
    echo "<p>Database: " . htmlspecialchars($dbConfig['connectionInfo']['Database'] ?? 'NO DEFINIDO') . "</p>";

    // Probar conexión
    echo "<h2>3. Conexión SQL Server</h2>";
    $conn = @sqlsrv_connect($dbConfig['serverName'], $dbConfig['connectionInfo']);
    if (!$conn) {
        echo "<p style='color:red;'>❌ Error de conexión:</p>";
        echo "<pre style='background:#fee;padding:10px;'>" . print_r(sqlsrv_errors(), true) . "</pre>";
    } else {
        echo "<p style='color:green;'>✓ Conexión exitosa</p>";

        // Contar registros en tablas clave
        echo "<h2>4. Registros en tablas</h2>";
        $tablas = array('empresa', 'empresa_sucursal', 'empresa_contacto', 'persona', 'ticket', 'atencion', 'motivo_contacto', 'rubro', 'persona_rol', 'role_permissions');
        echo "<table border='1' cellpadding='5' style='border-collapse:collapse;'>";
        echo "<tr style='background:#333;color:white;'><th>Tabla</th><th>Existe</th><th>Registros</th></tr>";
        foreach ($tablas as $t) {
            $chk = @sqlsrv_query($conn, "SELECT COUNT(*) AS c FROM $t");
            if ($chk === false) {
                echo "<tr><td>$t</td><td style='color:red;'>❌ NO</td><td>—</td></tr>";
            } else {
                $row = sqlsrv_fetch_array($chk, SQLSRV_FETCH_ASSOC);
                echo "<tr><td>$t</td><td style='color:green;'>✓ SÍ</td><td>" . $row['c'] . "</td></tr>";
            }
        }
        echo "</table>";

        // Mostrar columnas de ticket
        echo "<h2>5. Columnas de la tabla 'ticket'</h2>";
        $cols = @sqlsrv_query($conn, "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ticket' ORDER BY ORDINAL_POSITION");
        if ($cols === false) {
            echo "<p style='color:red;'>❌ No se pudo obtener columnas</p>";
        } else {
            echo "<table border='1' cellpadding='5' style='border-collapse:collapse;'>";
            echo "<tr style='background:#333;color:white;'><th>Columna</th><th>Tipo</th><th>Nullable</th></tr>";
            while ($c = sqlsrv_fetch_array($cols, SQLSRV_FETCH_ASSOC)) {
                echo "<tr><td><strong>" . $c['COLUMN_NAME'] . "</strong></td><td>" . $c['DATA_TYPE'] . "</td><td>" . $c['IS_NULLABLE'] . "</td></tr>";
            }
            echo "</table>";
        }

        // Intentar INSERT de prueba
        echo "<h2>6. Test INSERT de ticket</h2>";
        $testSql = "INSERT INTO ticket (id_empresa, id_empresa_contacto, detalle_reporte, prioridad, estado, id_usuario, fecha_registro, hora_registro) VALUES (1, 1, 'TEST', 'MEDIA', 'PENDIENTE', 1, GETDATE(), CAST(GETDATE() AS TIME))";
        echo "<p><strong>SQL:</strong> " . htmlspecialchars($testSql) . "</p>";
        $testStmt = @sqlsrv_query($conn, $testSql);
        if ($testStmt === false) {
            echo "<p style='color:red;'>❌ ERROR:</p>";
            echo "<pre style='background:#fee;padding:10px;'>" . print_r(sqlsrv_errors(), true) . "</pre>";
        } else {
            echo "<p style='color:green;'>✓ INSERT exitoso</p>";
            // Obtener ID y limpiar
            $maxStmt = sqlsrv_query($conn, "SELECT MAX(id_ticket) AS max_id FROM ticket");
            if ($maxStmt && $r = sqlsrv_fetch_array($maxStmt, SQLSRV_FETCH_ASSOC)) {
                $testId = intval($r['max_id']);
                sqlsrv_query($conn, "DELETE FROM ticket WHERE id_ticket = ?", array($testId));
                echo "<p style='color:orange;'>⚠ Ticket de prueba (ID $testId) eliminado</p>";
            }
        }

        sqlsrv_close($conn);
    }
}

echo "<h2>7. Próximos pasos</h2>";
echo "<ul>";
echo "<li>Si la conexión falla → revisa db_config.php</li>";
echo "<li>Si una tabla no existe → ejecuta el script SQL de creación</li>";
echo "<li>Si el INSERT falla → el error de SQL Server te dirá qué columna falta</li>";
echo "<li><strong>Copia el resultado de esta página (o toma captura) y envíalo</strong></li>";
echo "</ul>";
