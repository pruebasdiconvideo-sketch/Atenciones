<?php
// Test simple: verificar si api_tickets.php tiene errores de sintaxis
error_reporting(E_ALL);
ini_set('display_errors', 1);
header("Content-Type: text/html; charset=UTF-8");

echo "<h1>Verificador de api_tickets.php</h1>";

$file = __DIR__ . '/api_tickets.php';
echo "<p>Archivo: $file</p>";
echo "<p>Existe: " . (file_exists($file) ? 'SI' : 'NO') . "</p>";
echo "<p>Tamaño: " . filesize($file) . " bytes</p>";

// Verificar sintaxis PHP
echo "<h2>1. Verificación de sintaxis</h2>";
$output = array();
$returnVar = 0;
exec("php -l " . escapeshellarg($file) . " 2>&1", $output, $returnVar);
echo "<pre>" . htmlspecialchars(implode("\n", $output)) . "</pre>";
echo "<p>Return code: $returnVar</p>";

// Si php -l no está disponible, intentar incluir el archivo
if ($returnVar !== 0 && empty($output)) {
    echo "<h2>2. Intentando incluir el archivo...</h2>";
    try {
        // Capturar errores fatales
        $content = file_get_contents($file);
        
        // Verificar balance de llaves
        $open = substr_count($content, '{');
        $close = substr_count($content, '}');
        echo "<p>Llaves: $open abiertas, $close cerradas, diff=" . ($open - $close) . "</p>";
        
        // Verificar balance de paréntesis
        $openP = substr_count($content, '(');
        $closeP = substr_count($content, ')');
        echo "<p>Paréntesis: $openP abiertos, $closeP cerrados, diff=" . ($openP - $closeP) . "</p>";
        
        // Buscar líneas con problemas
        $lines = explode("\n", $content);
        $errors = array();
        for ($i = 0; $i < count($lines); $i++) {
            $line = $lines[$i];
            // Buscar comillas dobles impares (excluyendo comentarios)
            $trimmed = trim($line);
            if (strpos($trimmed, '//') === 0 || strpos($trimmed, '*') === 0) continue;
            
            // Contar comillas no escapadas
            $count = 0;
            $j = 0;
            while ($j < strlen($line)) {
                if ($line[$j] == '"' && ($j == 0 || $line[$j-1] != '\\')) {
                    $count++;
                }
                $j++;
            }
            // Solo reportar si es impar Y la línea tiene contenido PHP
            if ($count % 2 != 0 && strpos($line, '$') !== false && strpos($line, '"') !== false) {
                // Verificar si es multi-línea (la siguiente línea continúa el string)
                $nextLine = isset($lines[$i+1]) ? $lines[$i+1] : '';
                if (strpos($nextLine, '"') === false && strpos($line, '";') === false && strpos($line, '" .') === false) {
                    $errors[] = "Línea " . ($i+1) . ": " . substr($trimmed, 0, 100);
                }
            }
        }
        
        if (!empty($errors)) {
            echo "<h3>Posibles errores de comillas:</h3>";
            echo "<ul>";
            foreach (array_slice($errors, 0, 10) as $err) {
                echo "<li>$err</li>";
            }
            echo "</ul>";
        }
        
        // Buscar BOM
        if (substr($content, 0, 3) === "\xEF\xBB\xBF") {
            echo "<p style='color:red'>⚠ BOM detectado al inicio del archivo</p>";
        }
        
        // Buscar caracteres null
        if (strpos($content, "\x00") !== false) {
            echo "<p style='color:red'>⚠ Caracter null detectado</p>";
        }
        
        echo "<h2>3. Intentando ejecutar sync_light directamente...</h2>";
        echo "<p>Simulando llamada a sync_light...</p>";
        
        // Cargar configuración
        $dbConfig = require __DIR__ . '/db_config.php';
        $conn = @sqlsrv_connect($dbConfig['serverName'], $dbConfig['connectionInfo']);
        if (!$conn) {
            echo "<p style='color:red'>Error de conexión: " . print_r(sqlsrv_errors(), true) . "</p>";
            exit;
        }
        echo "<p style='color:green'>✓ Conexión OK</p>";
        
        // Ejecutar las mismas consultas que sync_light
        $tablas = array(
            'paises' => "SELECT id_pais, nombre, codigo_iso FROM pais ORDER BY nombre",
            'empresas' => "SELECT id_empresa, ruc, razon_social, nombre_comercial, telefono, correo, id_rubro, id_grupo, id_ubicacion, activo, fecha_baja FROM empresa WHERE activo = 1 ORDER BY razon_social",
            'tickets' => "SELECT TOP 100 id_ticket, nro_ticket, fecha_registro, hora_registro, fecha_cierre, hora_cierre, id_usuario, id_empresa_contacto, id_empresa, id_sucursal, detalle_reporte, prioridad, estado, medio_contacto, id_motivo_contacto FROM ticket ORDER BY id_ticket DESC",
            'auditoriaOperaciones' => "SELECT TOP 50 id_auditoria, usuario, fecha_hora, modulo, operacion, detalles, ip_address, hostname FROM auditoria_operacion ORDER BY id_auditoria DESC",
        );
        
        $data = array();
        foreach ($tablas as $key => $sql) {
            $stmt = @sqlsrv_query($conn, $sql);
            if ($stmt === false) {
                $errs = sqlsrv_errors();
                echo "<p style='color:red'>❌ $key: " . $errs[0]['message'] . "</p>";
            } else {
                $rows = array();
                while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
                    // Normalizar fechas
                    foreach ($row as $k => $v) {
                        if (is_object($v) && method_exists($v, 'format')) {
                            if (in_array($k, ['fecha_registro', 'fecha_cierre', 'fecha_nacimiento', 'fecha_cambio', 'fecha_inicio', 'fecha_fin', 'fecha_subida'])) {
                                $row[$k] = $v->format('Y-m-d');
                            } else if (in_array($k, ['hora_registro', 'hora_cierre', 'hora_inicio', 'hora_fin'])) {
                                $row[$k] = $v->format('H:i:s');
                            } else {
                                $row[$k] = $v->format('Y-m-d H:i:s');
                            }
                        }
                        if (in_array($k, ['es_principal', 'bloqueado'])) {
                            $row[$k] = (bool)$v;
                        }
                    }
                    $rows[] = $row;
                }
                $data[$key] = $rows;
                echo "<p style='color:green'>✓ $key: " . count($rows) . " filas</p>";
            }
        }
        
        echo "<h2>4. Resultado</h2>";
        echo "<p>Si llegaste hasta aquí, las consultas funcionan. El problema está en el código PHP de api_tickets.php.</p>";
        echo "<p>Posibles causas:</p>";
        echo "<ul>";
        echo "<li>Error de sintaxis en api_tickets.php (llave faltante, punto y coma, etc.)</li>";
        echo "<li>Memoria insuficiente (aumentar memory_limit en php.ini)</li>";
        echo "<li>Tiempo de ejecución agotado (aumentar max_execution_time en php.ini)</li>";
        echo "</ul>";
        
        sqlsrv_close($conn);
        
    } catch (Exception $e) {
        echo "<p style='color:red'>Error: " . $e->getMessage() . "</p>";
    }
}
?>
