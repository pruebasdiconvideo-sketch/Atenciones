<?php
/**
 * ERP SOPORTE — API Mínima v2.105
 * Versión simplificada para diagnosticar el error 500.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);
date_default_timezone_set('America/Lima');

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

// Cargar configuración
$dbConfig = require __DIR__ . '/db_config.php';
$conn = @sqlsrv_connect($dbConfig['serverName'], $dbConfig['connectionInfo']);
if (!$conn) {
    echo json_encode(array("status" => "error", "message" => "No se pudo conectar a la base de datos."));
    exit;
}

// Procesar input
$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);
if (!$input || !is_array($input)) $input = $_POST;
if (!$input || !is_array($input)) $input = $_REQUEST;

$action = isset($_GET['action']) ? $_GET['action'] : 'list';

// Función simple para normalizar fechas
function normalize_row($row) {
    if (!is_array($row)) return $row;
    foreach ($row as $key => $val) {
        if (is_object($val) && method_exists($val, 'format')) {
            if (in_array($key, ['fecha_registro','fecha_cierre','fecha_nacimiento','fecha_cambio','fecha_inicio','fecha_fin','fecha_subida','fecha_baja','fecha_asignacion'])) {
                $row[$key] = $val->format('Y-m-d');
            } else if (in_array($key, ['hora_registro','hora_cierre','hora_inicio','hora_fin'])) {
                $row[$key] = $val->format('H:i:s');
            } else {
                $row[$key] = $val->format('Y-m-d H:i:s');
            }
        }
        if (in_array($key, ['es_principal','bloqueado']) && !is_null($val)) {
            $row[$key] = (bool)$val;
        }
        if ($key === 'estado' && !is_null($val) && !is_string($val)) {
            $row[$key] = (bool)$val;
        }
    }
    return $row;
}

function fetch_all_rows($conn, $sql) {
    $stmt = @sqlsrv_query($conn, $sql);
    if ($stmt === false) return array();
    $rows = array();
    while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
        if ($row !== false) $rows[] = normalize_row($row);
    }
    return $rows;
}

function safe_fetch($conn, $sql) {
    $rows = @fetch_all_rows($conn, $sql);
    return $rows ?: array();
}

function log_op($conn, $modulo, $operacion, $detalles, $input) {
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
    $host = 'No resuelto';
    if ($ip && $ip !== 'unknown') {
        $r = @gethostbyaddr($ip);
        if ($r && $r !== $ip) $host = $r;
    }
    $usuario = 'Sistema';
    if (isset($input['id_usuario'])) {
        $s = @sqlsrv_query($conn, "SELECT nombres + ' ' + apellido_paterno AS n FROM persona WHERE id_persona = ?", array(intval($input['id_usuario'])));
        if ($s !== false && $row = sqlsrv_fetch_array($s, SQLSRV_FETCH_ASSOC)) $usuario = $row['n'];
    }
    $op_map = array('CREACION'=>'CREACION','MODIFICACION'=>'MODIFICACION','ELIMINACION'=>'ELIMINACION');
    $op_final = 'MODIFICACION';
    $op_upper = strtoupper($operacion);
    if (strpos($op_upper,'CREAR')!==false || strpos($op_upper,'REGISTRAR')!==false || strpos($op_upper,'NUEVO')!==false) $op_final='CREACION';
    elseif (strpos($op_upper,'ELIMINAR')!==false || strpos($op_upper,'BAJA')!==false) $op_final='ELIMINACION';
    $detalle_full = $operacion . ' — ' . $detalles;
    @sqlsrv_query($conn, "INSERT INTO auditoria_operacion (usuario, fecha_hora, modulo, operacion, detalles, ip_address, hostname) VALUES (?, GETDATE(), ?, ?, ?, ?, ?)", array($usuario, $modulo, $op_final, $detalle_full, $ip, $host));
}

switch ($action) {
    case 'sync_light':
        $data = array(
            "paises" => safe_fetch($conn, "SELECT id_pais, nombre, codigo_iso FROM pais ORDER BY nombre"),
            "divisionesGeograficas" => safe_fetch($conn, "SELECT id_division, nombre, id_tipo_division, id_division_padre FROM division_geografica ORDER BY id_division_padre ASC, id_tipo_division ASC, nombre ASC"),
            "ubicaciones" => safe_fetch($conn, "SELECT id_ubicacion, direccion, referencia, id_division FROM ubicacion"),
            "rubros" => safe_fetch($conn, "SELECT id_rubro, nombre FROM rubro ORDER BY nombre"),
            "gruposEmpresariales" => safe_fetch($conn, "SELECT id_grupo, nombre, descripcion FROM grupo_empresarial ORDER BY nombre"),
            "empresas" => safe_fetch($conn, "SELECT id_empresa, ruc, razon_social, nombre_comercial, telefono, correo, id_rubro, id_grupo, id_ubicacion, activo, fecha_baja FROM empresa WHERE activo = 1 ORDER BY razon_social"),
            "sucursales" => safe_fetch($conn, "SELECT id_sucursal, id_empresa, nombre, id_ubicacion, telefono, es_principal, activo, fecha_baja FROM empresa_sucursal WHERE activo = 1 ORDER BY nombre"),
            "personas" => safe_fetch($conn, "SELECT id_persona, tipo_documento, numero_documento, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, telefono, correo, direccion, sexo, estado FROM persona WHERE estado = 1"),
            "contactosEmpresariales" => safe_fetch($conn, "SELECT id_empresa_contacto, id_empresa, id_sucursal, id_persona, cargo, telefono_empresa, correo_empresa, es_principal, estado, activo, fecha_baja FROM empresa_contacto WHERE activo = 1 ORDER BY id_empresa"),
            "tickets" => safe_fetch($conn, "SELECT TOP 100 id_ticket, nro_ticket, fecha_registro, hora_registro, fecha_cierre, hora_cierre, id_usuario, id_empresa_contacto, id_empresa, id_sucursal, detalle_reporte, prioridad, estado, medio_contacto, id_motivo_contacto FROM ticket ORDER BY id_ticket DESC"),
            "historialEstados" => safe_fetch($conn, "SELECT TOP 50 id_historial, id_ticket, estado_anterior, estado_nuevo, id_usuario, motivo, fecha_cambio FROM ticket_historial_estado ORDER BY id_historial DESC"),
            "atenciones" => safe_fetch($conn, "SELECT TOP 100 id_atencion, id_ticket, id_usuario, fecha_inicio, hora_inicio, fecha_fin, hora_fin, detalle_atencion, solucion_aplicada, estado FROM atencion ORDER BY id_atencion DESC"),
            "auditoriaOperaciones" => safe_fetch($conn, "SELECT TOP 50 id_auditoria, usuario, fecha_hora, modulo, operacion, detalles, ip_address, hostname FROM auditoria_operacion ORDER BY id_auditoria DESC"),
            "auditoriaAccesos" => safe_fetch($conn, "SELECT TOP 50 id_acceso, correo, fecha_hora, ip_address, hostname, estado, intentos_previos FROM acceso_auditoria ORDER BY id_acceso DESC"),
            "bajasRegistradas" => safe_fetch($conn, "SELECT TOP 50 b.id_baja, b.tipo_entidad, b.id_entidad, b.id_usuario, b.motivo, b.fecha_baja, b.ip_address, CASE WHEN b.tipo_entidad = 'EMPRESA' THEN (SELECT TOP 1 ISNULL(e.nombre_comercial, e.razon_social) FROM empresa e WHERE e.id_empresa = b.id_entidad) WHEN b.tipo_entidad = 'SUCURSAL' THEN (SELECT TOP 1 s.nombre FROM empresa_sucursal s WHERE s.id_sucursal = b.id_entidad) WHEN b.tipo_entidad = 'CONTACTO' THEN (SELECT TOP 1 p.nombres + ' ' + p.apellido_paterno FROM empresa_contacto ec INNER JOIN persona p ON p.id_persona = ec.id_persona WHERE ec.id_empresa_contacto = b.id_entidad) ELSE NULL END AS nombre_entidad FROM bajas_registro b ORDER BY b.fecha_baja DESC"),
            "motivosContacto" => safe_fetch($conn, "SELECT id_motivo, nombre, descripcion, activo, orden FROM motivo_contacto ORDER BY orden, nombre"),
            "roles" => safe_fetch($conn, "SELECT id_rol, nombre, descripcion FROM persona_rol ORDER BY id_rol"),
            "asignacionesRoles" => safe_fetch($conn, "SELECT id_persona, id_rol, fecha_asignacion, asignado_por FROM persona_rol_asignacion"),
            "rolePermissions" => safe_fetch($conn, "SELECT id_rol, modulo, ver, registrar, modificar, eliminar, aprobar, exportar, imprimir FROM role_permissions ORDER BY id_rol, modulo"),
            "atencionesTiempo" => safe_fetch($conn, "SELECT id_atencion, duracion_minutos, duracion_horas, duracion_formato FROM atencion_tiempo")
        );
        echo json_encode(array("status" => "success", "data" => $data));
        break;

    case 'list':
        $estado = isset($_GET['estado']) && $_GET['estado'] !== 'ALL' ? $_GET['estado'] : null;
        $prioridad = isset($_GET['prioridad']) && $_GET['prioridad'] !== 'ALL' ? $_GET['prioridad'] : null;
        $id_empresa = isset($_GET['id_empresa']) && $_GET['id_empresa'] !== 'ALL' ? intval($_GET['id_empresa']) : null;
        $id_sucursal = isset($_GET['id_sucursal']) && $_GET['id_sucursal'] !== 'ALL' ? intval($_GET['id_sucursal']) : null;
        $id_motivo = isset($_GET['id_motivo_contacto']) && $_GET['id_motivo_contacto'] !== 'ALL' ? intval($_GET['id_motivo_contacto']) : null;
        
        $where = array("1=1");
        $params = array();
        if ($estado) { $where[] = "estado = ?"; $params[] = $estado; }
        if ($prioridad) { $where[] = "prioridad = ?"; $params[] = $prioridad; }
        if ($id_empresa) { $where[] = "id_empresa = ?"; $params[] = $id_empresa; }
        if ($id_sucursal) { $where[] = "id_sucursal = ?"; $params[] = $id_sucursal; }
        if ($id_motivo) { $where[] = "id_motivo_contacto = ?"; $params[] = $id_motivo; }
        
        $sql = "SELECT TOP 100 id_ticket, nro_ticket, fecha_registro, hora_registro, fecha_cierre, hora_cierre, id_usuario, id_empresa_contacto, id_empresa, id_sucursal, detalle_reporte, prioridad, estado, medio_contacto, id_motivo_contacto FROM ticket WHERE " . implode(' AND ', $where) . " ORDER BY id_ticket DESC";
        $stmt = sqlsrv_query($conn, $sql, $params);
        $tickets = array();
        if ($stmt !== false) {
            while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
                $tickets[] = normalize_row($row);
            }
        }
        echo json_encode(array("status" => "success", "total" => count($tickets), "data" => $tickets));
        break;

    case 'authenticate':
        $correo = trim(isset($input['correo']) ? $input['correo'] : '');
        $contrasena = trim(isset($input['contrasena']) ? $input['contrasena'] : '');
        $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
        $host = 'No resuelto';
        $r = @gethostbyaddr($ip);
        if ($r && $r !== $ip) $host = $r;
        
        if (!$correo || !$contrasena) {
            echo json_encode(array("status" => "error", "message" => "Ingrese correo y contraseña."));
            break;
        }
        $hashed = hash('sha256', $contrasena);
        $stmt = sqlsrv_query($conn, "SELECT TOP 1 p.*, pr.nombre as rol_nombre, pr.id_rol FROM persona p LEFT JOIN persona_rol_asignacion pra ON p.id_persona = pra.id_persona LEFT JOIN persona_rol pr ON pra.id_rol = pr.id_rol WHERE p.correo = ? AND p.estado = 1", array($correo));
        if ($stmt === false || !sqlsrv_has_rows($stmt)) {
            @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, hostname, estado, intentos_previos) VALUES (?, GETDATE(), ?, ?, 'FALLIDO', 0)", array($correo, $ip, $host));
            echo json_encode(array("status" => "error", "message" => "Correo o contraseña incorrectos."));
            break;
        }
        $user = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
        if ($user['bloqueado'] == 1) {
            echo json_encode(array("status" => "error", "message" => "Cuenta bloqueada. Contacte al administrador."));
            break;
        }
        $storedPass = $user['contrasena'];
        $valid = ($contrasena === $storedPass) || ($hashed === $storedPass) || (strtolower($hashed) === strtolower($storedPass));
        if (!$valid) {
            @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, hostname, estado, intentos_previos) VALUES (?, GETDATE(), ?, ?, 'FALLIDO', 0)", array($correo, $ip, $host));
            echo json_encode(array("status" => "error", "message" => "Correo o contraseña incorrectos."));
            break;
        }
        if (strlen($storedPass) < 64) {
            sqlsrv_query($conn, "UPDATE persona SET contrasena = ? WHERE id_persona = ?", array($hashed, $user['id_persona']));
        }
        @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, hostname, estado, intentos_previos) VALUES (?, GETDATE(), ?, ?, 'EXITOSO', 0)", array($correo, $ip, $host));
        log_op($conn, "SEGURIDAD", "Login exitoso", $correo, $input);
        unset($user['contrasena']);
        echo json_encode(array("status" => "success", "message" => "Autenticación exitosa", "user" => normalize_row($user)));
        break;

    case 'get_ticket_traceability':
        $id_ticket = isset($_GET['id_ticket']) ? intval($_GET['id_ticket']) : 0;
        if (!$id_ticket) { echo json_encode(array("status"=>"error","message"=>"Falta id_ticket")); break; }
        
        $tStmt = @sqlsrv_query($conn, "SELECT t.*, ec.correo_empresa, p.correo as correo_persona, p.nombres + ' ' + p.apellido_paterno as contacto_nombre, e.nombre_comercial, e.razon_social, e.ruc FROM ticket t LEFT JOIN empresa_contacto ec ON t.id_empresa_contacto = ec.id_empresa_contacto LEFT JOIN persona p ON ec.id_persona = p.id_persona LEFT JOIN empresa e ON t.id_empresa = e.id_empresa WHERE t.id_ticket = ?", array($id_ticket));
        $ticket = null;
        if ($tStmt !== false && $tRow = sqlsrv_fetch_array($tStmt, SQLSRV_FETCH_ASSOC)) $ticket = normalize_row($tRow);
        
        $hStmt = @sqlsrv_query($conn, "SELECT * FROM ticket_historial_estado WHERE id_ticket = ? ORDER BY fecha_cambio DESC", array($id_ticket));
        $historial = array();
        if ($hStmt !== false) { while ($hRow = sqlsrv_fetch_array($hStmt, SQLSRV_FETCH_ASSOC)) $historial[] = normalize_row($hRow); }
        
        $aStmt = @sqlsrv_query($conn, "SELECT a.*, p.nombres + ' ' + p.apellido_paterno as tecnico_nombre FROM atencion a LEFT JOIN persona p ON a.id_usuario = p.id_persona WHERE a.id_ticket = ? ORDER BY a.fecha_inicio DESC, a.hora_inicio DESC", array($id_ticket));
        $atenciones = array();
        if ($aStmt !== false) { while ($aRow = sqlsrv_fetch_array($aStmt, SQLSRV_FETCH_ASSOC)) $atenciones[] = normalize_row($aRow); }
        
        $evidencias = array();
        $eStmt = @sqlsrv_query($conn, "SELECT ta.id_ticket_archivo, ta.id_ticket, ta.id_archivo, ta.tipo_evidencia, a.nombre_original, a.nombre_sistema, a.ruta, a.tipo_mime, a.extension, a.tamano_bytes, a.tamano_formato, a.fecha_subida, a.estado, a.id_usuario_subio FROM ticket_archivo ta INNER JOIN archivo a ON ta.id_archivo = a.id_archivo WHERE ta.id_ticket = ? ORDER BY a.fecha_subida DESC", array($id_ticket));
        if ($eStmt !== false) { while ($eRow = sqlsrv_fetch_array($eStmt, SQLSRV_FETCH_ASSOC)) $evidencias[] = normalize_row($eRow); }
        
        echo json_encode(array("status"=>"success","data"=>array("ticket"=>$ticket,"historial"=>$historial,"atenciones"=>$atenciones,"evidencias"=>$evidencias)));
        break;

    default:
        // Para cualquier otra acción, devolver success vacío
        echo json_encode(array("status" => "success", "message" => "Acción no implementada en versión mínima: " . $action));
        break;
}

sqlsrv_close($conn);
?>
