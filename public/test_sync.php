<?php
/**
 * ERP SOPORTE — Diagnóstico de sync_light
 * v2.90
 *
 * Abre en el navegador:
 * http://localhost:806/backend/test_sync.php
 *
 * Muestra qué tablas fallan en sync_light.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);
header("Content-Type: text/html; charset=UTF-8");

echo "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Test Sync</title>";
echo "<style>body{font-family:monospace;max-width:1000px;margin:20px auto;padding:20px;background:#f5f5f5;font-size:12px;}";
echo ".ok{color:green;font-weight:bold;}.err{color:red;font-weight:bold;}.warn{color:orange;font-weight:bold;}";
echo ".box{background:white;padding:15px;border:1px solid #ccc;margin:10px 0;}";
echo "table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:4px;}";
echo "th{background:#333;color:white;}";
echo "</style></head><body>";

echo "<h1>🧪 Diagnóstico de sync_light — v2.90</h1>";

$configFile = __DIR__ . '/db_config.php';
$dbConfig = require $configFile;
$conn = @sqlsrv_connect($dbConfig['serverName'], $dbConfig['connectionInfo']);
if (!$conn) {
    die("<p class='err'>❌ No se pudo conectar a SQL Server: " . print_r(sqlsrv_errors(), true) . "</p>");
}
echo "<p class='ok'>✓ Conectado a SQL Server</p>";

// Lista de tablas que sync_light consulta
$tablas = array(
    'pais' => "SELECT id_pais, nombre, codigo_iso FROM pais ORDER BY nombre",
    'division_geografica' => "SELECT id_division, nombre, id_tipo_division, id_division_padre FROM division_geografica ORDER BY id_division_padre ASC, id_tipo_division ASC, nombre ASC",
    'ubicacion' => "SELECT id_ubicacion, direccion, referencia, id_division FROM ubicacion",
    'rubro' => "SELECT id_rubro, nombre FROM rubro ORDER BY nombre",
    'grupo_empresarial' => "SELECT id_grupo, nombre, descripcion FROM grupo_empresarial ORDER BY nombre",
    'empresa' => "SELECT id_empresa, ruc, razon_social, nombre_comercial, telefono, correo, id_rubro, id_grupo, id_ubicacion, activo, fecha_baja FROM empresa WHERE activo = 1 ORDER BY razon_social",
    'empresa_sucursal' => "SELECT id_sucursal, id_empresa, nombre, id_ubicacion, telefono, es_principal, activo, fecha_baja FROM empresa_sucursal WHERE activo = 1 ORDER BY nombre",
    'persona' => "SELECT TOP 100 id_persona, tipo_documento, numero_documento, nombres, apellido_paterno, correo, estado FROM persona WHERE estado = 1",
    'empresa_contacto' => "SELECT id_empresa_contacto, id_empresa, id_sucursal, id_persona, cargo, correo_empresa, es_principal, estado, activo FROM empresa_contacto WHERE activo = 1 ORDER BY id_empresa",
    'ticket' => "SELECT TOP 10 id_ticket, nro_ticket, fecha_registro, estado, prioridad FROM ticket ORDER BY id_ticket DESC",
    'ticket_historial_estado' => "SELECT TOP 10 id_historial, id_ticket, estado_anterior, estado_nuevo FROM ticket_historial_estado ORDER BY id_historial DESC",
    'atencion' => "SELECT TOP 10 id_atencion, id_ticket, id_usuario, estado FROM atencion ORDER BY id_atencion DESC",
    'auditoria_operacion' => "SELECT TOP 10 id_auditoria, usuario, fecha_hora, modulo, operacion FROM auditoria_operacion ORDER BY id_auditoria DESC",
    'acceso_auditoria' => "SELECT TOP 10 id_acceso, correo, fecha_hora, estado FROM acceso_auditoria ORDER BY id_acceso DESC",
    'motivo_contacto' => "SELECT id_motivo, nombre, activo, orden FROM motivo_contacto ORDER BY orden, nombre",
    'persona_rol' => "SELECT id_rol, nombre FROM persona_rol ORDER BY id_rol",
    'persona_rol_asignacion' => "SELECT id_persona, id_rol FROM persona_rol_asignacion",
    'role_permissions' => "SELECT id_rol, modulo, ver FROM role_permissions ORDER BY id_rol, modulo",
    'atencion_tiempo' => "SELECT id_atencion, duracion_minutos, duracion_horas FROM atencion_tiempo",
    'bajas_registro' => "SELECT TOP 10 id_baja, tipo_entidad, id_entidad, motivo FROM bajas_registro ORDER BY id_baja DESC",
);

echo "<div class='box'>";
echo "<h3>Test de cada tabla en sync_light</h3>";
echo "<table>";
echo "<tr><th>Tabla</th><th>Estado</th><th>Filas</th><th>Error</th></tr>";

$todo_ok = true;
foreach ($tablas as $nombre => $sql) {
    $stmt = @sqlsrv_query($conn, $sql);
    if ($stmt === false) {
        $errors = sqlsrv_errors();
        $errorMsg = '';
        foreach ($errors as $e) {
            $errorMsg .= $e['message'] . " (SQLSTATE: " . $e['SQLSTATE'] . ", code: " . $e['code'] . ")";
        }
        echo "<tr><td><strong>$nombre</strong></td><td class='err'>❌ ERROR</td><td>0</td><td>" . htmlspecialchars($errorMsg) . "</td></tr>";
        $todo_ok = false;
    } else {
        $count = 0;
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
            $count++;
        }
        $class = $count > 0 ? 'ok' : 'warn';
        $icon = $count > 0 ? '✓' : '⚠';
        echo "<tr><td><strong>$nombre</strong></td><td class='$class'>$icon OK</td><td>$count</td><td>—</td></tr>";
    }
}
echo "</table>";
echo "</div>";

echo "<div class='box'>";
if ($todo_ok) {
    echo "<h3 class='ok'>✅ Todas las tablas funcionan correctamente</h3>";
    echo "<p>Si sync_light aún falla, el problema puede ser:</p>";
    echo "<ul>";
    echo "<li>Un error de PHP (revisa el log de PHP en C:\Windows\Temp\php-errors.log)</li>";
    echo "<li>El caché server-side (asegúrate de que ERP_CACHE_ENABLED = false)</li>";
    echo "<li>Un problema de encoding UTF-8 en los datos</li>";
    echo "</ul>";
} else {
    echo "<h3 class='err'>❌ Algunas tablas fallan</h3>";
    echo "<p>Las tablas marcadas con ERROR tienen problemas. Comúnmente es porque:</p>";
    echo "<ul>";
    echo "<li>La tabla no existe (ejecuta el script SQL de creación)</li>";
    echo "<li>Una columna no existe (ejecuta los scripts fix_*.sql)</li>";
    echo "<li>La tabla está vacía (eso es OK, solo advertencia)</li>";
    echo "</ul>";
}
echo "</div>";

// También probar el endpoint sync_light directamente
echo "<div class='box'>";
echo "<h3>Test directo de sync_light</h3>";
echo "<p>Puedes abrir directamente: <a href='api_tickets.php?action=sync_light' target='_blank'>api_tickets.php?action=sync_light</a></p>";
echo "<p>Si devuelve JSON con status=success, el backend funciona. Si devuelve error, muestra el problema.</p>";
echo "</div>";

sqlsrv_close($conn);
echo "</body></html>";
