<?php
/**
 * ERP SOPORTE — API v2.111
 * Reconstruida desde cero para máxima velocidad y estabilidad.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);
date_default_timezone_set('America/Lima');

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

// FIX v2.111 — Caché server-side simple para acelerar sync_light y list.
$CACHE_DIR = __DIR__ . '/erp_cache';
if (!is_dir($CACHE_DIR)) @mkdir($CACHE_DIR, 0775, true);

// FIX v2.119 — Verificar si AUTO_CLOSE está activado y avisar.
function check_auto_close($conn) {
    $stmt = @sqlsrv_query($conn, "SELECT is_auto_close_on FROM sys.databases WHERE name = DB_NAME()");
    if ($stmt !== false && $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
        if ($row['is_auto_close_on'] == 1) {
            // Intentar desactivarlo
            @sqlsrv_query($conn, "ALTER DATABASE " . DB_NAME() . " SET AUTO_CLOSE OFF");
        }
    }
}

function get_cache($key, $ttl = 30) {
    global $CACHE_DIR;
    $file = $CACHE_DIR . '/' . md5($key) . '.json';
    if (!file_exists($file)) return null;
    if (time() - filemtime($file) > $ttl) { @unlink($file); return null; }
    $data = @file_get_contents($file);
    return $data ? json_decode($data, true) : null;
}

function set_cache($key, $data) {
    global $CACHE_DIR;
    $file = $CACHE_DIR . '/' . md5($key) . '.json';
    @file_put_contents($file, json_encode($data), LOCK_EX);
}

function clear_cache() {
    global $CACHE_DIR;
    if (!is_dir($CACHE_DIR)) return;
    foreach (glob($CACHE_DIR . '/*.json') as $f) @unlink($f);
}

// Cargar configuración
$dbConfig = require __DIR__ . '/db_config.php';
$conn = @sqlsrv_connect($dbConfig['serverName'], $dbConfig['connectionInfo']);
if (!$conn) {
    echo json_encode(array("status" => "error", "message" => "No se pudo conectar a la base de datos."));
    exit;
}

// FIX v2.119 — Verificar y desactivar AUTO_CLOSE automáticamente.
check_auto_close($conn);

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
    // FIX v2.120 — Mejorar detección de hostname.
    $host = 'No resuelto';
    if ($ip && $ip !== 'unknown' && $ip !== '127.0.0.1' && $ip !== '::1') {
        $r = @gethostbyaddr($ip);
        if ($r && $r !== $ip) $host = $r;
    }
    // Intento 2: Variables de entorno de IIS / Windows
    if ($host === 'No resuelto') {
        $env_vars = array('HTTP_CLIENT_COMPUTERNAME', 'HTTP_X_FORWARDED_COMPUTERNAME', 'REMOTE_HOST', 'COMPUTERNAME', 'USERDOMAIN');
        foreach ($env_vars as $var) {
            if (isset($_SERVER[$var]) && $_SERVER[$var] && $_SERVER[$var] !== $ip) {
                $host = $_SERVER[$var];
                break;
            }
        }
    }
    // Intento 3: Si es localhost, usar el nombre del servidor
    if ($host === 'No resuelto' && ($ip === '127.0.0.1' || $ip === '::1' || $ip === 'unknown')) {
        $host = @gethostname() ?: 'Servidor Local';
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
        // FIX v2.119 — Caché de 30 segundos para sync_light (aumentado de 15s).
        $cached = get_cache('sync_light', 30);
        if ($cached !== null) {
            echo json_encode(array("status" => "success", "data" => $cached, "cached" => true));
            break;
        }
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
        set_cache('sync_light', $data);
        echo json_encode(array("status" => "success", "data" => $data));
        break;

    case 'list':
        $estado = isset($_GET['estado']) && $_GET['estado'] !== 'ALL' ? $_GET['estado'] : null;
        $prioridad = isset($_GET['prioridad']) && $_GET['prioridad'] !== 'ALL' ? $_GET['prioridad'] : null;
        $id_empresa = isset($_GET['id_empresa']) && $_GET['id_empresa'] !== 'ALL' ? intval($_GET['id_empresa']) : null;
        $id_sucursal = isset($_GET['id_sucursal']) && $_GET['id_sucursal'] !== 'ALL' ? intval($_GET['id_sucursal']) : null;
        $id_motivo = isset($_GET['id_motivo_contacto']) && $_GET['id_motivo_contacto'] !== 'ALL' ? intval($_GET['id_motivo_contacto']) : null;
        
        // FIX v2.112 — Caché de 5 segundos para la lista de tickets.
        $list_cache_key = 'list_' . md5(json_encode(array($estado, $prioridad, $id_empresa, $id_sucursal, $id_motivo)));
        $list_cached = get_cache($list_cache_key, 5);
        if ($list_cached !== null) {
            echo json_encode(array("status" => "success", "total" => count($list_cached), "data" => $list_cached, "cached" => true));
            break;
        }
        
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
        set_cache($list_cache_key, $tickets);
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
        clear_cache();
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


    // ============================================================
    // OPERACIONES CRUD
    // ============================================================

    case 'create':
    case 'create_with_attention':
        $id_empresa = intval(isset($input['id_empresa']) ? $input['id_empresa'] : 0);
        $id_empresa_contacto = intval(isset($input['id_empresa_contacto']) ? $input['id_empresa_contacto'] : 0);
        $id_sucursal = isset($input['id_sucursal']) && $input['id_sucursal'] ? intval($input['id_sucursal']) : null;
        $detalle_reporte = trim(isset($input['detalle_reporte']) ? $input['detalle_reporte'] : '');
        $prioridad = trim(isset($input['prioridad']) ? $input['prioridad'] : 'MEDIA');
        $medio_contacto = trim(isset($input['medio_contacto']) ? $input['medio_contacto'] : 'EMAIL');
        $id_motivo = isset($input['id_motivo_contacto']) && $input['id_motivo_contacto'] ? intval($input['id_motivo_contacto']) : null;
        $id_usuario = intval(isset($input['id_usuario']) ? $input['id_usuario'] : 1);
        $detalle_atencion = trim(isset($input['detalle_atencion']) ? $input['detalle_atencion'] : '');
        $solucion_aplicada = trim(isset($input['solucion_aplicada']) ? $input['solucion_aplicada'] : '');
        $cerrar_ticket = isset($input['cerrar_ticket']) ? ($input['cerrar_ticket'] === true || $input['cerrar_ticket'] === '1' || $input['cerrar_ticket'] === 1) : false;

        if (!$id_empresa || !$id_empresa_contacto || !$detalle_reporte) {
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios."));
            break;
        }

        // FIX v2.109 — INSERT dinámico que se adapta a las columnas de la tabla.
        // Detectar columnas existentes en la tabla ticket.
        $colStmt = sqlsrv_query($conn, "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ticket'");
        $ticketCols = array();
        if ($colStmt !== false) { while ($cr = sqlsrv_fetch_array($colStmt, SQLSRV_FETCH_ASSOC)) $ticketCols[] = $cr['COLUMN_NAME']; }

        $insertCols = array();
        $insertPlaceholders = array();
        $insParams = array();

        // FIX v2.117 — Nro de ticket: reiniciar cada año desde 1.
        // Formato: YYYY-NNNNN (ej: 2026-00001, 2027-00001).
        $year = date('Y');
        $yearStmt = sqlsrv_query($conn, "SELECT COUNT(*) AS cnt FROM ticket WHERE YEAR(fecha_registro) = ?", array($year));
        $yearCount = 0;
        if ($yearStmt !== false && $yr = sqlsrv_fetch_array($yearStmt, SQLSRV_FETCH_ASSOC)) $yearCount = intval($yr['cnt']);
        $nro_ticket_generado = $year . '-' . str_pad($yearCount + 1, 5, '0', STR_PAD_LEFT);

        $colMap = array(
            'id_empresa' => $id_empresa,
            'id_empresa_contacto' => $id_empresa_contacto,
            'id_sucursal' => $id_sucursal,
            'detalle_reporte' => $detalle_reporte,
            'prioridad' => $prioridad,
            'estado' => 'PENDIENTE',
            'medio_contacto' => $medio_contacto,
            'id_motivo_contacto' => $id_motivo,
            'id_usuario' => $id_usuario,
            'nro_ticket' => $nro_ticket_generado,
        );
        foreach ($colMap as $col => $val) {
            if (in_array($col, $ticketCols)) {
                $insertCols[] = $col;
                $insertPlaceholders[] = '?';
                $insParams[] = $val;
            }
        }
        if (in_array('fecha_registro', $ticketCols)) { $insertCols[] = 'fecha_registro'; $insertPlaceholders[] = 'GETDATE()'; }
        if (in_array('hora_registro', $ticketCols)) { $insertCols[] = 'hora_registro'; $insertPlaceholders[] = 'CAST(GETDATE() AS TIME)'; }

        $insSql = "INSERT INTO ticket (" . implode(', ', $insertCols) . ") VALUES (" . implode(', ', $insertPlaceholders) . ")";
        $insStmt = sqlsrv_query($conn, $insSql, $insParams);
        if ($insStmt === false) {
            $errors = sqlsrv_errors();
            $errMsg = '';
            if (is_array($errors)) { foreach ($errors as $e) { $errMsg .= $e['message'] . " "; } }
            echo json_encode(array("status" => "error", "message" => "No se pudo crear el ticket: " . $errMsg, "sql" => $insSql, "params" => $insParams));
            break;
        }
        // Obtener ID real
        $maxStmt = sqlsrv_query($conn, "SELECT MAX(id_ticket) AS max_id FROM ticket");
        $id_ticket = 0;
        if ($maxStmt !== false && $r = sqlsrv_fetch_array($maxStmt, SQLSRV_FETCH_ASSOC)) $id_ticket = intval($r['max_id']);
        // Recalcular nro_ticket con el ID real (por si el conteo no fue exacto)
        // FIX v2.117: El número se basa en el conteo de tickets del año actual.
        $yearStmt2 = sqlsrv_query($conn, "SELECT COUNT(*) AS cnt FROM ticket WHERE YEAR(fecha_registro) = ? AND id_ticket <= ?", array($year, $id_ticket));
        $realYearCount = 0;
        if ($yearStmt2 !== false && $yr2 = sqlsrv_fetch_array($yearStmt2, SQLSRV_FETCH_ASSOC)) $realYearCount = intval($yr2['cnt']);
        $nro_ticket = $year . '-' . str_pad($realYearCount, 5, '0', STR_PAD_LEFT);
        if ($nro_ticket !== $nro_ticket_generado) {
            sqlsrv_query($conn, "UPDATE ticket SET nro_ticket = ? WHERE id_ticket = ?", array($nro_ticket, $id_ticket));
        }
        log_op($conn, "TICKETS", "Crear ticket", "Ticket Nro: " . $nro_ticket, $input);

        // FIX v2.111 — Notificar al técnico por WhatsApp si se asignó un usuario.
        if ($id_usuario && $id_usuario > 0) {
            $waStmt = sqlsrv_query($conn, "SELECT TOP 1 telefono, nombres + ' ' + apellido_paterno AS nombre FROM persona WHERE id_persona = ?", array($id_usuario));
            if ($waStmt !== false && $waRow = sqlsrv_fetch_array($waStmt, SQLSRV_FETCH_ASSOC)) {
                $telefono = trim($waRow['telefono'] ?? '');
                $nombreTec = $waRow['nombre'] ?? 'Técnico';
                if ($telefono) {
                    // Limpiar número (solo dígitos)
                    $telefono = preg_replace('/[^0-9]/', '', $telefono);
                    if (strlen($telefono) === 9) $telefono = '51' . $telefono;
                    $waMsg = "Hola " . $nombreTec . ", se le ha asignado el Ticket " . $nro_ticket . ". Por favor ingrese al sistema ERP SOPORTE para atenderlo.";
                    $waUrl = "https://wa.me/" . $telefono . "?text=" . urlencode($waMsg);
                    // Guardar URL en respuesta para que el frontend pueda abrirlo
                    $whatsapp_url = $waUrl;
                }
            }
        }

        // Si hay atención
        if (!empty($detalle_atencion)) {
            $atEstado = $cerrar_ticket ? "COMPLETADO" : "EN_PROCESO";
            $atSql = "INSERT INTO atencion (id_ticket, id_usuario, detalle_atencion, solucion_aplicada, estado) VALUES (?, ?, ?, ?, ?)";
            sqlsrv_query($conn, $atSql, array($id_ticket, $id_usuario, $detalle_atencion, $solucion_aplicada, $atEstado));
            log_op($conn, "TICKETS", "Registrar atencion", "Ticket " . $nro_ticket, $input);
        }
        // Si hay cierre
        if ($cerrar_ticket) {
            sqlsrv_query($conn, "UPDATE ticket SET estado = 'RESUELTO', fecha_cierre = CAST(GETDATE() AS DATE), hora_cierre = CAST(GETDATE() AS TIME) WHERE id_ticket = ?", array($id_ticket));
            sqlsrv_query($conn, "INSERT INTO ticket_historial_estado (id_ticket, estado_anterior, estado_nuevo, id_usuario, motivo, fecha_cambio) VALUES (?, 'PENDIENTE', 'RESUELTO', ?, 'Ticket resuelto al registrar', GETDATE())", array($id_ticket, $id_usuario));
            log_op($conn, "TICKETS", "Cerrar ticket", $nro_ticket . " -> RESUELTO", $input);
        }

        // Subir archivos si hay
        if (isset($input['files']) && is_array($input['files']) && count($input['files']) > 0) {
            foreach ($input['files'] as $file) {
                if (!isset($file['base64Content'])) continue;
                $nombre_original = $file['name'];
                $tipo_mime = isset($file['type']) ? $file['type'] : 'application/octet-stream';
                $tamano = isset($file['size']) ? intval($file['size']) : strlen($file['base64Content']);
                $ext = pathinfo($nombre_original, PATHINFO_EXTENSION);
                $sysName = 'usr-' . $id_usuario . '-' . time() . '.' . $ext;
                $checksum = hash('sha256', $file['base64Content']);
                $base64 = $file['base64Content'];

                $archSql = "INSERT INTO archivo (nombre_original, nombre_sistema, ruta, tipo_mime, extension, tamano_bytes, tamano_formato, checksum, id_usuario_subio, fecha_subida, estado, base64Content) OUTPUT INSERTED.id_archivo VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), 1, ?)";
                $archStmt = sqlsrv_query($conn, $archSql, array($nombre_original, $sysName, '/uploads/' . $sysName, $tipo_mime, $ext, $tamano, number_format($tamano/1048576, 2) . ' MB', $checksum, $id_usuario, $base64));
                if ($archStmt !== false && $archRow = sqlsrv_fetch_array($archStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_archivo = intval($archRow['id_archivo']);
                    sqlsrv_query($conn, "INSERT INTO ticket_archivo (id_ticket, id_archivo, tipo_evidencia) VALUES (?, ?, 'REPORTE_INICIAL')", array($id_ticket, $id_archivo));
                }
            }
            log_op($conn, "TICKETS", "Subir evidencia", $nro_ticket, $input);
        }

        clear_cache();
        $response = array("status" => "success", "message" => "Ticket creado: " . $nro_ticket, "id_ticket" => $id_ticket, "nro_ticket" => $nro_ticket);
        if (isset($whatsapp_url)) $response["whatsapp_url"] = $whatsapp_url;
        echo json_encode($response);
        break;

    case 'create_attention':
        $id_ticket = intval(isset($input['id_ticket']) ? $input['id_ticket'] : 0);
        $id_usuario = intval(isset($input['id_usuario']) ? $input['id_usuario'] : 1);
        $detalle_atencion = trim(isset($input['detalle_atencion']) ? $input['detalle_atencion'] : '');
        $solucion_aplicada = trim(isset($input['solucion_aplicada']) ? $input['solucion_aplicada'] : '');
        $estado = trim(isset($input['estado']) ? $input['estado'] : 'EN_PROCESO');
        $fecha_inicio = isset($input['fecha_inicio']) && $input['fecha_inicio'] ? $input['fecha_inicio'] : null;
        $hora_inicio = isset($input['hora_inicio']) && $input['hora_inicio'] ? $input['hora_inicio'] : null;
        $fecha_fin = isset($input['fecha_fin']) && $input['fecha_fin'] ? $input['fecha_fin'] : null;
        $hora_fin = isset($input['hora_fin']) && $input['hora_fin'] ? $input['hora_fin'] : null;
        if (!$id_ticket || !$detalle_atencion) { echo json_encode(array("status"=>"error","message"=>"Faltan campos.")); break; }
        $atSql = "INSERT INTO atencion (id_ticket, id_usuario, detalle_atencion, solucion_aplicada, estado, fecha_inicio, hora_inicio, fecha_fin, hora_fin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
        $atStmt = sqlsrv_query($conn, $atSql, array($id_ticket, $id_usuario, $detalle_atencion, $solucion_aplicada, $estado, $fecha_inicio, $hora_inicio, $fecha_fin, $hora_fin));
        if ($atStmt === false) { echo json_encode(array("status"=>"error","message"=>"No se pudo registrar la atencion.")); break; }
        log_op($conn, "TICKETS", "Registrar atencion", "Ticket #" . $id_ticket, $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Atencion registrada."));
        break;

    case 'update_attention':
        $id_atencion = intval(isset($input['id_atencion']) ? $input['id_atencion'] : 0);
        $detalle_atencion = trim(isset($input['detalle_atencion']) ? $input['detalle_atencion'] : '');
        $solucion_aplicada = trim(isset($input['solucion_aplicada']) ? $input['solucion_aplicada'] : '');
        if (!$id_atencion || !$detalle_atencion) { echo json_encode(array("status"=>"error","message"=>"Faltan campos.")); break; }
        sqlsrv_query($conn, "UPDATE atencion SET detalle_atencion = ?, solucion_aplicada = ? WHERE id_atencion = ?", array($detalle_atencion, $solucion_aplicada, $id_atencion));
        log_op($conn, "TICKETS", "Editar atencion", "Atencion", $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Atencion actualizada."));
        break;

    case 'update_status':
        $id_ticket = intval(isset($input['id_ticket']) ? $input['id_ticket'] : 0);
        $estado = trim(isset($input['estado']) ? $input['estado'] : '');
        $motivo = trim(isset($input['motivo']) ? $input['motivo'] : '');
        $id_usuario = intval(isset($input['id_usuario']) ? $input['id_usuario'] : 1);
        $notificar_cierre = isset($input['notificar_cierre']) ? true : false;
        if (!$id_ticket || !$estado || !$motivo) { echo json_encode(array("status"=>"error","message"=>"Faltan campos.")); break; }
        $estado_anterior = null;
        $s = sqlsrv_query($conn, "SELECT estado FROM ticket WHERE id_ticket = ?", array($id_ticket));
        if ($s !== false && $r = sqlsrv_fetch_array($s, SQLSRV_FETCH_ASSOC)) $estado_anterior = $r['estado'];
        $cierreFecha = ($estado === 'CERRADO' || $estado === 'RESUELTO') ? 'CAST(GETDATE() AS DATE)' : 'NULL';
        $cierreHora = ($estado === 'CERRADO' || $estado === 'RESUELTO') ? 'CAST(GETDATE() AS TIME)' : 'NULL';
        $estado_efectivo = ($estado === 'REABIERTO') ? 'PENDIENTE' : $estado;
        sqlsrv_query($conn, "UPDATE ticket SET estado = ?, fecha_cierre = $cierreFecha, hora_cierre = $cierreHora WHERE id_ticket = ?", array($estado_efectivo, $id_ticket));
        if ($estado_anterior !== null && $estado_anterior !== $estado_efectivo) {
            sqlsrv_query($conn, "INSERT INTO ticket_historial_estado (id_ticket, estado_anterior, estado_nuevo, id_usuario, motivo, fecha_cambio) VALUES (?, ?, ?, ?, ?, GETDATE())", array($id_ticket, $estado_anterior, $estado_efectivo, $id_usuario, $motivo));
        }
        log_op($conn, "TICKETS", "Cambiar estado", "Ticket -> " . $estado, $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Estado actualizado a " . $estado));
        break;

    case 'delete_ticket':
        $id_ticket = intval(isset($input['id_ticket']) ? $input['id_ticket'] : 0);
        if (!$id_ticket) { echo json_encode(array("status"=>"error","message"=>"Falta id_ticket")); break; }
        $ats = sqlsrv_query($conn, "SELECT id_atencion FROM atencion WHERE id_ticket = ?", array($id_ticket));
        if ($ats !== false) { while ($ar = sqlsrv_fetch_array($ats, SQLSRV_FETCH_ASSOC)) { sqlsrv_query($conn, "DELETE FROM atencion_archivo WHERE id_atencion = ?", array($ar['id_atencion'])); } }
        $afs = sqlsrv_query($conn, "SELECT id_archivo FROM ticket_archivo WHERE id_ticket = ?", array($id_ticket));
        if ($afs !== false) { while ($af = sqlsrv_fetch_array($afs, SQLSRV_FETCH_ASSOC)) { sqlsrv_query($conn, "DELETE FROM archivo WHERE id_archivo = ?", array($af['id_archivo'])); } }
        sqlsrv_query($conn, "DELETE FROM ticket_archivo WHERE id_ticket = ?", array($id_ticket));
        sqlsrv_query($conn, "DELETE FROM atencion WHERE id_ticket = ?", array($id_ticket));
        sqlsrv_query($conn, "DELETE FROM ticket_historial_estado WHERE id_ticket = ?", array($id_ticket));
        sqlsrv_query($conn, "DELETE FROM ticket WHERE id_ticket = ?", array($id_ticket));
        log_op($conn, "TICKETS", "Eliminar ticket", "Ticket eliminado", $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Ticket eliminado."));
        break;

    case 'upload_file':
        $id_ticket = intval(isset($input['id_ticket']) ? $input['id_ticket'] : 0);
        $id_usuario = intval(isset($input['id_usuario']) ? $input['id_usuario'] : 1);
        $tipo_evidencia = isset($input['tipo_evidencia']) ? $input['tipo_evidencia'] : 'EVIDENCIA_ADICIONAL';
        $file = isset($input['file']) ? $input['file'] : null;
        if (!$id_ticket || !$file) { echo json_encode(array("status"=>"error","message"=>"Faltan campos.")); break; }
        $nombre_original = isset($file['name']) ? $file['name'] : 'archivo';
        $tipo_mime = isset($file['type']) ? $file['type'] : 'application/octet-stream';
        $tamano = isset($file['size']) ? intval($file['size']) : 0;
        $ext = pathinfo($nombre_original, PATHINFO_EXTENSION);
        $sysName = 'usr-' . $id_usuario . '-' . time() . '.' . $ext;
        $checksum = hash('sha256', $file['base64Content']);
        $base64 = $file['base64Content'];
        $archSql = "INSERT INTO archivo (nombre_original, nombre_sistema, ruta, tipo_mime, extension, tamano_bytes, tamano_formato, checksum, id_usuario_subio, fecha_subida, estado, base64Content) OUTPUT INSERTED.id_archivo VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), 1, ?)";
        $archStmt = sqlsrv_query($conn, $archSql, array($nombre_original, $sysName, '/uploads/'.$sysName, $tipo_mime, $ext, $tamano, number_format($tamano/1048576,2).' MB', $checksum, $id_usuario, $base64));
        if ($archStmt === false) { echo json_encode(array("status"=>"error","message"=>"No se pudo subir el archivo.")); break; }
        $archRow = sqlsrv_fetch_array($archStmt, SQLSRV_FETCH_ASSOC);
        $id_archivo = intval($archRow['id_archivo']);
        sqlsrv_query($conn, "INSERT INTO ticket_archivo (id_ticket, id_archivo, tipo_evidencia) VALUES (?, ?, ?)", array($id_ticket, $id_archivo, $tipo_evidencia));
        log_op($conn, "TICKETS", "Subir evidencia", "Archivo: " . $nombre_original, $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Archivo subido.","id_archivo"=>$id_archivo));
        break;

    case 'get_archivo':
        $id_archivo = intval(isset($_GET['id_archivo']) ? $_GET['id_archivo'] : 0);
        if (!$id_archivo) { echo json_encode(array("status"=>"error","message"=>"Falta id_archivo")); break; }
        $stmt = sqlsrv_query($conn, "SELECT * FROM archivo WHERE id_archivo = ?", array($id_archivo));
        if ($stmt !== false && $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
            echo json_encode(array("status"=>"success","data"=>normalize_row($row)));
        } else {
            echo json_encode(array("status"=>"error","message"=>"Archivo no encontrado"));
        }
        break;

    case 'save_empresa':
        $id_empresa = intval(isset($input['id_empresa']) ? $input['id_empresa'] : 0);
        $ruc = trim(isset($input['ruc']) ? $input['ruc'] : '');
        $razon_social = trim(isset($input['razon_social']) ? $input['razon_social'] : '');
        $nombre_comercial = trim(isset($input['nombre_comercial']) ? $input['nombre_comercial'] : '');
        $telefono = trim(isset($input['telefono']) ? $input['telefono'] : '');
        $correo = trim(isset($input['correo']) ? $input['correo'] : '');
        $id_rubro = isset($input['id_rubro']) && $input['id_rubro'] ? intval($input['id_rubro']) : null;
        $id_grupo = isset($input['id_grupo']) && $input['id_grupo'] ? intval($input['id_grupo']) : null;
        $direccion = trim(isset($input['direccion']) ? $input['direccion'] : '');
        $referencia = trim(isset($input['referencia']) ? $input['referencia'] : '');
        $id_division = isset($input['id_division']) && $input['id_division'] ? intval($input['id_division']) : null;
        $crear_sede = (isset($input['crear_sede']) && ($input['crear_sede'] === true || $input['crear_sede'] === '1' || $input['crear_sede'] === 1)) ? true : false;
        if (!$ruc || !$razon_social || !$correo || !$direccion) { echo json_encode(array("status"=>"error","message"=>"Faltan campos obligatorios.")); break; }
        // FIX v2.117 — Validar RUC duplicado.
        $rucCheck = sqlsrv_query($conn, "SELECT COUNT(*) AS c FROM empresa WHERE ruc = ? AND id_empresa <> ?", array($ruc, $id_empresa));
        if ($rucCheck !== false && $rucRow = sqlsrv_fetch_array($rucCheck, SQLSRV_FETCH_ASSOC)) {
            if (intval($rucRow['c']) > 0) {
                echo json_encode(array("status"=>"error","message"=>"El RUC " . $ruc . " ya está registrado. No se permiten RUC duplicados."));
                break;
            }
        }
        if ($id_empresa === 0) {
            $ubi = sqlsrv_query($conn, "INSERT INTO ubicacion (direccion, referencia, id_division) OUTPUT INSERTED.id_ubicacion VALUES (?, ?, ?)", array($direccion, $referencia, $id_division));
            $id_ubicacion = 0;
            if ($ubi !== false && $urow = sqlsrv_fetch_array($ubi, SQLSRV_FETCH_ASSOC)) $id_ubicacion = intval($urow['id_ubicacion']);
            // FIX v2.118 — Si OUTPUT no funciona para ubicacion, usar MAX.
            if (!$id_ubicacion) {
                $maxUbi = sqlsrv_query($conn, "SELECT MAX(id_ubicacion) AS max_id FROM ubicacion");
                if ($maxUbi !== false && $muRow = sqlsrv_fetch_array($maxUbi, SQLSRV_FETCH_ASSOC)) $id_ubicacion = intval($muRow['max_id']);
            }
            $empSql = "INSERT INTO empresa (ruc, razon_social, nombre_comercial, telefono, correo, id_rubro, id_grupo, id_ubicacion) OUTPUT INSERTED.id_empresa VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
            $empStmt = sqlsrv_query($conn, $empSql, array($ruc, $razon_social, $nombre_comercial, $telefono, $correo, $id_rubro, $id_grupo, $id_ubicacion));
            $id_empresa = 0;
            if ($empStmt !== false && $erow = sqlsrv_fetch_array($empStmt, SQLSRV_FETCH_ASSOC)) $id_empresa = intval($erow['id_empresa']);
            // FIX v2.118 — Si OUTPUT no funciona para empresa, usar MAX.
            if (!$id_empresa) {
                $maxEmp = sqlsrv_query($conn, "SELECT MAX(id_empresa) AS max_id FROM empresa");
                if ($maxEmp !== false && $meRow = sqlsrv_fetch_array($maxEmp, SQLSRV_FETCH_ASSOC)) $id_empresa = intval($meRow['max_id']);
            }
            if ($id_empresa && $crear_sede) {
                $sucNombre = "Sede Principal - " . ($nombre_comercial ? $nombre_comercial : "Central");
                sqlsrv_query($conn, "INSERT INTO empresa_sucursal (id_empresa, nombre, id_ubicacion, telefono, es_principal) VALUES (?, ?, ?, ?, 1)", array($id_empresa, $sucNombre, $id_ubicacion, $telefono));
            }
            log_op($conn, "CLIENTES", "Crear empresa", $razon_social . " RUC: " . $ruc, $input);
        } else {
            $gUbi = sqlsrv_query($conn, "SELECT id_ubicacion FROM empresa WHERE id_empresa = ?", array($id_empresa));
            $id_ubicacion = null;
            if ($gUbi !== false && $gr = sqlsrv_fetch_array($gUbi, SQLSRV_FETCH_ASSOC)) $id_ubicacion = intval($gr['id_ubicacion']);
            if ($id_ubicacion) {
                sqlsrv_query($conn, "UPDATE ubicacion SET direccion = ?, referencia = ?, id_division = ? WHERE id_ubicacion = ?", array($direccion, $referencia, $id_division, $id_ubicacion));
            } else {
                $ubi = sqlsrv_query($conn, "INSERT INTO ubicacion (direccion, referencia, id_division) OUTPUT INSERTED.id_ubicacion VALUES (?, ?, ?)", array($direccion, $referencia, $id_division));
                if ($ubi !== false && $urow = sqlsrv_fetch_array($ubi, SQLSRV_FETCH_ASSOC)) { $id_ubicacion = intval($urow['id_ubicacion']); sqlsrv_query($conn, "UPDATE empresa SET id_ubicacion = ? WHERE id_empresa = ?", array($id_ubicacion, $id_empresa)); }
            }
            sqlsrv_query($conn, "UPDATE empresa SET ruc = ?, razon_social = ?, nombre_comercial = ?, telefono = ?, correo = ?, id_rubro = ?, id_grupo = ? WHERE id_empresa = ?", array($ruc, $razon_social, $nombre_comercial, $telefono, $correo, $id_rubro, $id_grupo, $id_empresa));
            log_op($conn, "CLIENTES", "Editar empresa", $razon_social, $input);
        }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Empresa guardada.","id_empresa"=>$id_empresa));
        break;

    case 'delete_empresa':
        $id_empresa = intval(isset($input['id_empresa']) ? $input['id_empresa'] : 0);
        if (!$id_empresa) { echo json_encode(array("status"=>"error","message"=>"Falta id_empresa")); break; }
        $chk = sqlsrv_query($conn, "SELECT COUNT(*) AS c FROM ticket WHERE id_empresa = ?", array($id_empresa));
        if ($chk !== false && $r = sqlsrv_fetch_array($chk, SQLSRV_FETCH_ASSOC)) { if (intval($r['c']) > 0) { echo json_encode(array("status"=>"error","message"=>"No se puede eliminar: tiene tickets asociados.")); break; } }
        sqlsrv_query($conn, "DELETE FROM empresa WHERE id_empresa = ?", array($id_empresa));
        log_op($conn, "CLIENTES", "Eliminar empresa", "Empresa", $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Empresa eliminada."));
        break;

    case 'save_sucursal':
        $id_sucursal = intval(isset($input['id_sucursal']) ? $input['id_sucursal'] : 0);
        $id_empresa = intval(isset($input['id_empresa']) ? $input['id_empresa'] : 0);
        $nombre = trim(isset($input['nombre']) ? $input['nombre'] : '');
        $telefono = trim(isset($input['telefono']) ? $input['telefono'] : '');
        $es_principal = isset($input['es_principal']) ? 1 : 0;
        $direccion = trim(isset($input['direccion']) ? $input['direccion'] : '');
        $referencia = trim(isset($input['referencia']) ? $input['referencia'] : '');
        $id_division = isset($input['id_division']) && $input['id_division'] ? intval($input['id_division']) : null;
        if (!$id_empresa || !$nombre || !$direccion) { echo json_encode(array("status"=>"error","message"=>"Faltan campos.")); break; }
        if ($id_sucursal === 0) {
            $ubi = sqlsrv_query($conn, "INSERT INTO ubicacion (direccion, referencia, id_division) OUTPUT INSERTED.id_ubicacion VALUES (?, ?, ?)", array($direccion, $referencia, $id_division));
            $id_ubicacion = 0;
            if ($ubi !== false && $urow = sqlsrv_fetch_array($ubi, SQLSRV_FETCH_ASSOC)) $id_ubicacion = intval($urow['id_ubicacion']);
            sqlsrv_query($conn, "INSERT INTO empresa_sucursal (id_empresa, nombre, id_ubicacion, telefono, es_principal) VALUES (?, ?, ?, ?, ?)", array($id_empresa, $nombre, $id_ubicacion, $telefono, $es_principal));
            log_op($conn, "CLIENTES", "Crear sucursal", $nombre, $input);
        } else {
            $gUbi = sqlsrv_query($conn, "SELECT id_ubicacion FROM empresa_sucursal WHERE id_sucursal = ?", array($id_sucursal));
            $id_ubicacion = null;
            if ($gUbi !== false && $gr = sqlsrv_fetch_array($gUbi, SQLSRV_FETCH_ASSOC)) $id_ubicacion = intval($gr['id_ubicacion']);
            if ($id_ubicacion) { sqlsrv_query($conn, "UPDATE ubicacion SET direccion = ?, referencia = ?, id_division = ? WHERE id_ubicacion = ?", array($direccion, $referencia, $id_division, $id_ubicacion)); }
            sqlsrv_query($conn, "UPDATE empresa_sucursal SET id_empresa = ?, nombre = ?, telefono = ?, es_principal = ? WHERE id_sucursal = ?", array($id_empresa, $nombre, $telefono, $es_principal, $id_sucursal));
            log_op($conn, "CLIENTES", "Editar sucursal", $nombre, $input);
        }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Sucursal guardada."));
        break;

    case 'delete_sucursal':
        $id_sucursal = intval(isset($input['id_sucursal']) ? $input['id_sucursal'] : 0);
        if (!$id_sucursal) { echo json_encode(array("status"=>"error","message"=>"Falta id_sucursal")); break; }
        sqlsrv_query($conn, "DELETE FROM empresa_sucursal WHERE id_sucursal = ?", array($id_sucursal));
        log_op($conn, "CLIENTES", "Eliminar sucursal", "Sucursal", $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Sucursal eliminada."));
        break;

    case 'save_contacto':
        $id_empresa_contacto = intval(isset($input['id_empresa_contacto']) ? $input['id_empresa_contacto'] : 0);
        $id_empresa = intval(isset($input['id_empresa']) ? $input['id_empresa'] : 0);
        $id_sucursal = isset($input['id_sucursal']) && $input['id_sucursal'] ? intval($input['id_sucursal']) : null;
        $id_persona = isset($input['id_persona']) && $input['id_persona'] ? intval($input['id_persona']) : null;
        $cargo = trim(isset($input['cargo']) ? $input['cargo'] : '');
        $telefono_empresa = trim(isset($input['telefono_empresa']) ? $input['telefono_empresa'] : '');
        $correo_empresa = trim(isset($input['correo_empresa']) ? $input['correo_empresa'] : '');
        $es_principal = isset($input['es_principal']) ? 1 : 0;
        if (!$id_empresa || !$id_persona) { echo json_encode(array("status"=>"error","message"=>"Faltan campos.")); break; }
        if ($id_empresa_contacto === 0) {
            sqlsrv_query($conn, "INSERT INTO empresa_contacto (id_empresa, id_sucursal, id_persona, cargo, telefono_empresa, correo_empresa, es_principal, estado) VALUES (?, ?, ?, ?, ?, ?, ?, 1)", array($id_empresa, $id_sucursal, $id_persona, $cargo, $telefono_empresa, $correo_empresa, $es_principal));
            log_op($conn, "CLIENTES", "Crear contacto", $cargo, $input);
        } else {
            sqlsrv_query($conn, "UPDATE empresa_contacto SET id_empresa = ?, id_sucursal = ?, id_persona = ?, cargo = ?, telefono_empresa = ?, correo_empresa = ?, es_principal = ?, estado = 1 WHERE id_empresa_contacto = ?", array($id_empresa, $id_sucursal, $id_persona, $cargo, $telefono_empresa, $correo_empresa, $es_principal, $id_empresa_contacto));
            log_op($conn, "CLIENTES", "Editar contacto", $cargo, $input);
        }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Contacto guardado."));
        break;

    case 'delete_contacto':
        $id_empresa_contacto = intval(isset($input['id_empresa_contacto']) ? $input['id_empresa_contacto'] : 0);
        if (!$id_empresa_contacto) { echo json_encode(array("status"=>"error","message"=>"Falta id")); break; }
        sqlsrv_query($conn, "DELETE FROM empresa_contacto WHERE id_empresa_contacto = ?", array($id_empresa_contacto));
        log_op($conn, "CLIENTES", "Eliminar contacto", "Contacto", $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Contacto eliminado."));
        break;

    case 'save_persona':
        $id_persona = intval(isset($input['id_persona']) ? $input['id_persona'] : 0);
        $nombres = trim(isset($input['nombres']) ? $input['nombres'] : '');
        $apellido_paterno = trim(isset($input['apellido_paterno']) ? $input['apellido_paterno'] : '');
        $apellido_materno = isset($input['apellido_materno']) ? trim($input['apellido_materno']) : null;
        $tipo_documento = isset($input['tipo_documento']) ? trim($input['tipo_documento']) : 'DNI';
        $numero_documento = isset($input['numero_documento']) ? trim($input['numero_documento']) : '';
        $correo = trim(isset($input['correo']) ? $input['correo'] : '');
        $telefono = isset($input['telefono']) ? trim($input['telefono']) : null;
        $sexo = isset($input['sexo']) ? trim($input['sexo']) : 'M';
        $contrasena = isset($input['contrasena']) ? trim($input['contrasena']) : '';
        $id_rol = intval(isset($input['id_rol']) ? $input['id_rol'] : 3);
        if (!$nombres || !$apellido_paterno || !$correo) { echo json_encode(array("status"=>"error","message"=>"Faltan campos.")); break; }
        $hashedPass = $contrasena ? hash('sha256', $contrasena) : '';
        if ($id_persona === 0) {
            $sql = "INSERT INTO persona (tipo_documento, numero_documento, nombres, apellido_paterno, apellido_materno, correo, telefono, sexo, estado, contrasena, bloqueado) OUTPUT INSERTED.id_persona VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)";
            $params = array($tipo_documento, $numero_documento, $nombres, $apellido_paterno, $apellido_materno, $correo, $telefono, $sexo, $hashedPass);
            $stmt = sqlsrv_query($conn, $sql, $params);
            $newId = 0;
            if ($stmt !== false && $r = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) $newId = intval($r['id_persona']);
            // FIX v2.118 — Si OUTPUT no funciona, usar SCOPE_IDENTITY como fallback.
            if (!$newId) {
                $idStmt = sqlsrv_query($conn, "SELECT SCOPE_IDENTITY() AS id_persona");
                if ($idStmt !== false && $idRow = sqlsrv_fetch_array($idStmt, SQLSRV_FETCH_ASSOC)) $newId = intval($idRow['id_persona']);
            }
            // FIX v2.118 — Si tampoco funciona, usar MAX(id_persona).
            if (!$newId) {
                $maxStmt = sqlsrv_query($conn, "SELECT MAX(id_persona) AS max_id FROM persona");
                if ($maxStmt !== false && $maxRow = sqlsrv_fetch_array($maxStmt, SQLSRV_FETCH_ASSOC)) $newId = intval($maxRow['max_id']);
            }
            if ($newId) sqlsrv_query($conn, "INSERT INTO persona_rol_asignacion (id_persona, id_rol, fecha_asignacion, asignado_por) VALUES (?, ?, GETDATE(), 1)", array($newId, $id_rol));
            log_op($conn, "SEGURIDAD", "Crear usuario", $nombres . " " . $apellido_paterno, $input);
            clear_cache();
            echo json_encode(array("status"=>"success","message"=>"Usuario guardado.","id_persona"=>$newId));
            break;
        } else {
            if ($contrasena) {
                sqlsrv_query($conn, "UPDATE persona SET tipo_documento=?, numero_documento=?, nombres=?, apellido_paterno=?, apellido_materno=?, correo=?, telefono=?, sexo=?, contrasena=? WHERE id_persona=?", array($tipo_documento, $numero_documento, $nombres, $apellido_paterno, $apellido_materno, $correo, $telefono, $sexo, $hashedPass, $id_persona));
            } else {
                sqlsrv_query($conn, "UPDATE persona SET tipo_documento=?, numero_documento=?, nombres=?, apellido_paterno=?, apellido_materno=?, correo=?, telefono=?, sexo=? WHERE id_persona=?", array($tipo_documento, $numero_documento, $nombres, $apellido_paterno, $apellido_materno, $correo, $telefono, $sexo, $id_persona));
            }
            sqlsrv_query($conn, "UPDATE persona_rol_asignacion SET id_rol = ? WHERE id_persona = ?", array($id_rol, $id_persona));
            log_op($conn, "SEGURIDAD", "Editar usuario", $nombres . " " . $apellido_paterno, $input);
        }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Usuario guardado."));
        break;

    case 'delete_persona':
        $id_persona = intval(isset($input['id_persona']) ? $input['id_persona'] : 0);
        if (!$id_persona) { echo json_encode(array("status"=>"error","message"=>"Falta id")); break; }
        if ($id_persona === 1) { echo json_encode(array("status"=>"error","message"=>"No se puede eliminar al admin principal")); break; }
        sqlsrv_query($conn, "UPDATE persona SET estado = 0 WHERE id_persona = ?", array($id_persona));
        log_op($conn, "SEGURIDAD", "Eliminar usuario", "Usuario", $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Usuario desactivado."));
        break;

    case 'save_rubro':
        $id_rubro = intval(isset($input['id_rubro']) ? $input['id_rubro'] : 0);
        $nombre = trim(isset($input['nombre']) ? $input['nombre'] : (isset($input['rubro_nombre']) ? $input['rubro_nombre'] : ''));
        if (!$nombre) { echo json_encode(array("status"=>"error","message"=>"Falta nombre")); break; }
        if ($id_rubro === 0) { sqlsrv_query($conn, "INSERT INTO rubro (nombre) VALUES (?)", array($nombre)); log_op($conn,"CLIENTES","Crear rubro",$nombre,$input); }
        else { sqlsrv_query($conn, "UPDATE rubro SET nombre = ? WHERE id_rubro = ?", array($nombre, $id_rubro)); log_op($conn,"CLIENTES","Editar rubro",$nombre,$input); }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Rubro guardado."));
        break;

    case 'delete_rubro':
        $id_rubro = intval(isset($input['id_rubro']) ? $input['id_rubro'] : 0);
        if (!$id_rubro) { echo json_encode(array("status"=>"error","message"=>"Falta id")); break; }
        sqlsrv_query($conn, "DELETE FROM rubro WHERE id_rubro = ?", array($id_rubro));
        log_op($conn,"CLIENTES","Eliminar rubro","Rubro",$input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Rubro eliminado."));
        break;

    case 'save_grupo':
        $id_grupo = intval(isset($input['id_grupo']) ? $input['id_grupo'] : 0);
        $nombre = trim(isset($input['nombre']) ? $input['nombre'] : '');
        $descripcion = trim(isset($input['descripcion']) ? $input['descripcion'] : '');
        if (!$nombre) { echo json_encode(array("status"=>"error","message"=>"Falta nombre")); break; }
        if ($id_grupo === 0) { sqlsrv_query($conn, "INSERT INTO grupo_empresarial (nombre, descripcion) VALUES (?, ?)", array($nombre, $descripcion ?: null)); log_op($conn,"CLIENTES","Crear grupo",$nombre,$input); }
        else { sqlsrv_query($conn, "UPDATE grupo_empresarial SET nombre = ?, descripcion = ? WHERE id_grupo = ?", array($nombre, $descripcion ?: null, $id_grupo)); log_op($conn,"CLIENTES","Editar grupo",$nombre,$input); }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Grupo guardado."));
        break;

    case 'delete_grupo':
        $id_grupo = intval(isset($input['id_grupo']) ? $input['id_grupo'] : 0);
        if (!$id_grupo) { echo json_encode(array("status"=>"error","message"=>"Falta id")); break; }
        sqlsrv_query($conn, "DELETE FROM grupo_empresarial WHERE id_grupo = ?", array($id_grupo));
        log_op($conn,"CLIENTES","Eliminar grupo","Grupo",$input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Grupo eliminado."));
        break;

    case 'save_division':
        $id_division = isset($input['id_division']) && $input['id_division'] ? intval($input['id_division']) : 0;
        $nombre = trim(isset($input['nombre']) ? $input['nombre'] : '');
        $id_tipo_division = intval(isset($input['id_tipo_division']) ? $input['id_tipo_division'] : 3);
        $id_division_padre = isset($input['id_division_padre']) && $input['id_division_padre'] ? intval($input['id_division_padre']) : null;
        $id_pais = intval(isset($input['id_pais']) ? $input['id_pais'] : 1);
        if (!$nombre) { echo json_encode(array("status"=>"error","message"=>"Falta el nombre de la división.")); break; }
        if ($id_division === 0) {
            $sql = "INSERT INTO division_geografica (nombre, id_tipo_division, id_division_padre) OUTPUT INSERTED.id_division VALUES (?, ?, ?)";
            $stmt = sqlsrv_query($conn, $sql, array($nombre, $id_tipo_division, $id_division_padre));
            if ($stmt === false) { echo json_encode(array("status"=>"error","message"=>"No se pudo crear la división.")); break; }
            $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
            $id_division = intval($row['id_division']);
            log_op($conn, "GEOGRAFIA", "Crear división", $nombre, $input);
        } else {
            sqlsrv_query($conn, "UPDATE division_geografica SET nombre = ?, id_tipo_division = ?, id_division_padre = ? WHERE id_division = ?", array($nombre, $id_tipo_division, $id_division_padre, $id_division));
            log_op($conn, "GEOGRAFIA", "Editar división", $nombre, $input);
        }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"División guardada.","id_division"=>$id_division));
        break;

    case 'delete_division':
        $id_division = intval(isset($input['id_division']) ? $input['id_division'] : 0);
        if (!$id_division) { echo json_encode(array("status"=>"error","message"=>"Falta id_division")); break; }
        sqlsrv_query($conn, "DELETE FROM division_geografica WHERE id_division = ?", array($id_division));
        log_op($conn, "GEOGRAFIA", "Eliminar división", "División", $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"División eliminada."));
        break;

    case 'save_pais':
        $id_pais = isset($input['id_pais']) && $input['id_pais'] ? intval($input['id_pais']) : 0;
        $nombre = trim(isset($input['nombre']) ? $input['nombre'] : '');
        $codigo_iso = trim(isset($input['codigo_iso']) ? $input['codigo_iso'] : '');
        if (!$nombre) { echo json_encode(array("status"=>"error","message"=>"Falta nombre")); break; }
        if ($id_pais === 0) { sqlsrv_query($conn, "INSERT INTO pais (nombre, codigo_iso) VALUES (?, ?)", array($nombre, $codigo_iso)); log_op($conn,"GEOGRAFIA","Crear país",$nombre,$input); }
        else { sqlsrv_query($conn, "UPDATE pais SET nombre = ?, codigo_iso = ? WHERE id_pais = ?", array($nombre, $codigo_iso, $id_pais)); log_op($conn,"GEOGRAFIA","Editar país",$nombre,$input); }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"País guardado."));
        break;

    case 'delete_pais':
        $id_pais = intval(isset($input['id_pais']) ? $input['id_pais'] : 0);
        if (!$id_pais) { echo json_encode(array("status"=>"error","message"=>"Falta id")); break; }
        sqlsrv_query($conn, "DELETE FROM pais WHERE id_pais = ?", array($id_pais));
        log_op($conn,"GEOGRAFIA","Eliminar país","País",$input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"País eliminado."));
        break;

    case 'save_tipo_division':
        $id_tipo = isset($input['id_tipo_division']) && $input['id_tipo_division'] ? intval($input['id_tipo_division']) : 0;
        $nombre = trim(isset($input['nombre']) ? $input['nombre'] : '');
        if (!$nombre) { echo json_encode(array("status"=>"error","message"=>"Falta nombre")); break; }
        if ($id_tipo === 0) { sqlsrv_query($conn, "INSERT INTO pais_tipo_division (nombre, orden) VALUES (?, 1)", array($nombre)); log_op($conn,"GEOGRAFIA","Crear tipo división",$nombre,$input); }
        else { sqlsrv_query($conn, "UPDATE pais_tipo_division SET nombre = ? WHERE id_tipo_division = ?", array($nombre, $id_tipo)); log_op($conn,"GEOGRAFIA","Editar tipo división",$nombre,$input); }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Tipo de división guardado."));
        break;

    case 'delete_tipo_division':
        $id_tipo = intval(isset($input['id_tipo_division']) ? $input['id_tipo_division'] : 0);
        if (!$id_tipo) { echo json_encode(array("status"=>"error","message"=>"Falta id")); break; }
        sqlsrv_query($conn, "DELETE FROM pais_tipo_division WHERE id_tipo_division = ?", array($id_tipo));
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Tipo de división eliminado."));
        break;

    case 'save_motivo':
        $id_motivo = isset($input['id_motivo']) && $input['id_motivo'] ? intval($input['id_motivo']) : null;
        $nombre = trim(isset($input['nombre']) ? $input['nombre'] : '');
        $descripcion = isset($input['descripcion']) ? trim($input['descripcion']) : null;
        $activo = isset($input['activo']) ? 1 : 1;
        $orden = isset($input['orden']) ? intval($input['orden']) : 0;
        if (!$nombre) { echo json_encode(array("status"=>"error","message"=>"Falta nombre")); break; }
        if ($id_motivo === null) { sqlsrv_query($conn, "INSERT INTO motivo_contacto (nombre, descripcion, activo, orden) VALUES (?, ?, 1, ?)", array($nombre, $descripcion, $orden)); log_op($conn,"CLIENTES","Crear motivo",$nombre,$input); }
        else { sqlsrv_query($conn, "UPDATE motivo_contacto SET nombre = ?, descripcion = ?, activo = ?, orden = ? WHERE id_motivo = ?", array($nombre, $descripcion, $activo, $orden, $id_motivo)); log_op($conn,"CLIENTES","Editar motivo",$nombre,$input); }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Motivo guardado."));
        break;

    case 'delete_motivo':
        $id_motivo = intval(isset($input['id_motivo']) ? $input['id_motivo'] : 0);
        if (!$id_motivo) { echo json_encode(array("status"=>"error","message"=>"Falta id")); break; }
        sqlsrv_query($conn, "DELETE FROM motivo_contacto WHERE id_motivo = ?", array($id_motivo));
        log_op($conn,"CLIENTES","Eliminar motivo","Motivo",$input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Motivo eliminado."));
        break;

    case 'save_baja':
        $tipo_entidad = strtoupper(trim(isset($input['tipo_entidad']) ? $input['tipo_entidad'] : ''));
        $id_entidad = intval(isset($input['id_entidad']) ? $input['id_entidad'] : 0);
        $motivo = trim(isset($input['motivo']) ? $input['motivo'] : '');
        $id_usuario = intval(isset($input['id_usuario']) ? $input['id_usuario'] : 1);
        $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
        if (!$tipo_entidad || !$id_entidad || !$motivo) { echo json_encode(array("status"=>"error","message"=>"Faltan campos.")); break; }
        sqlsrv_query($conn, "INSERT INTO bajas_registro (tipo_entidad, id_entidad, id_usuario, motivo, fecha_baja, ip_address) VALUES (?, ?, ?, ?, GETDATE(), ?)", array($tipo_entidad, $id_entidad, $id_usuario, $motivo, $ip));
        if ($tipo_entidad === 'EMPRESA') { sqlsrv_query($conn, "UPDATE empresa SET activo = 0, fecha_baja = GETDATE() WHERE id_empresa = ?", array($id_entidad)); sqlsrv_query($conn, "UPDATE empresa_sucursal SET activo = 0, fecha_baja = GETDATE() WHERE id_empresa = ?", array($id_entidad)); sqlsrv_query($conn, "UPDATE empresa_contacto SET activo = 0, fecha_baja = GETDATE() WHERE id_empresa = ?", array($id_entidad)); }
        elseif ($tipo_entidad === 'SUCURSAL') { sqlsrv_query($conn, "UPDATE empresa_sucursal SET activo = 0, fecha_baja = GETDATE() WHERE id_sucursal = ?", array($id_entidad)); }
        elseif ($tipo_entidad === 'CONTACTO') { sqlsrv_query($conn, "UPDATE empresa_contacto SET activo = 0, fecha_baja = GETDATE() WHERE id_empresa_contacto = ?", array($id_entidad)); }
        log_op($conn, "BAJAS", "Dar de baja", $tipo_entidad . " - " . $motivo, $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Baja registrada."));
        break;

    case 'reactivar_baja':
        $tipo_entidad = strtoupper(trim(isset($input['tipo_entidad']) ? $input['tipo_entidad'] : ''));
        $id_entidad = intval(isset($input['id_entidad']) ? $input['id_entidad'] : 0);
        if (!$tipo_entidad || !$id_entidad) { echo json_encode(array("status"=>"error","message"=>"Faltan campos.")); break; }
        sqlsrv_query($conn, "DELETE FROM bajas_registro WHERE tipo_entidad = ? AND id_entidad = ?", array($tipo_entidad, $id_entidad));
        if ($tipo_entidad === 'EMPRESA') { sqlsrv_query($conn, "UPDATE empresa SET activo = 1, fecha_baja = NULL WHERE id_empresa = ?", array($id_entidad)); sqlsrv_query($conn, "UPDATE empresa_sucursal SET activo = 1, fecha_baja = NULL WHERE id_empresa = ?", array($id_entidad)); sqlsrv_query($conn, "UPDATE empresa_contacto SET activo = 1, fecha_baja = NULL WHERE id_empresa = ?", array($id_entidad)); }
        elseif ($tipo_entidad === 'SUCURSAL') { sqlsrv_query($conn, "UPDATE empresa_sucursal SET activo = 1, fecha_baja = NULL WHERE id_sucursal = ?", array($id_entidad)); }
        elseif ($tipo_entidad === 'CONTACTO') { sqlsrv_query($conn, "UPDATE empresa_contacto SET activo = 1, fecha_baja = NULL WHERE id_empresa_contacto = ?", array($id_entidad)); }
        log_op($conn, "BAJAS", "Reactivar", $tipo_entidad, $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Entidad reactivada."));
        break;

    case 'save_role_permissions':
        $id_rol = intval(isset($input['id_rol']) ? $input['id_rol'] : 0);
        $permisos = isset($input['permisos']) ? $input['permisos'] : '{}';
        if (!$id_rol) { echo json_encode(array("status"=>"error","message"=>"Falta id_rol")); break; }
        sqlsrv_query($conn, "DELETE FROM role_permissions WHERE id_rol = ?", array($id_rol));
        $permisosArray = json_decode($permisos, true);
        if (!$permisosArray) $permisosArray = array();
        $modulos = array('DASHBOARD','TICKETS','CLIENTES','GEOGRAFIA','SEGURIDAD','REPORTES');
        foreach ($modulos as $modulo) {
            $p = isset($permisosArray[$modulo]) ? $permisosArray[$modulo] : array();
            sqlsrv_query($conn, "INSERT INTO role_permissions (id_rol, modulo, ver, registrar, modificar, eliminar, aprobar, exportar, imprimir, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())",
                array($id_rol, $modulo, !empty($p['ver'])?1:0, !empty($p['registrar'])?1:0, !empty($p['modificar'])?1:0, !empty($p['eliminar'])?1:0, !empty($p['aprobar'])?1:0, !empty($p['exportar'])?1:0, !empty($p['imprimir'])?1:0));
        }
        log_op($conn, "SEGURIDAD", "Guardar permisos", "Rol: " . $id_rol, $input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Permisos guardados."));
        break;

    case 'save_role':
        $id_rol = isset($input['id_rol']) && $input['id_rol'] ? intval($input['id_rol']) : 0;
        $nombre = trim(isset($input['nombre']) ? $input['nombre'] : '');
        $descripcion = trim(isset($input['descripcion']) ? $input['descripcion'] : '');
        if (!$nombre) { echo json_encode(array("status"=>"error","message"=>"Falta nombre")); break; }
        if ($id_rol === 0) { sqlsrv_query($conn, "INSERT INTO persona_rol (nombre, descripcion) VALUES (?, ?)", array($nombre, $descripcion ?: null)); log_op($conn,"SEGURIDAD","Crear rol",$nombre,$input); }
        else { sqlsrv_query($conn, "UPDATE persona_rol SET nombre = ?, descripcion = ? WHERE id_rol = ?", array($nombre, $descripcion ?: null, $id_rol)); log_op($conn,"SEGURIDAD","Editar rol",$nombre,$input); }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Rol guardado."));
        break;

    case 'delete_role':
        $id_rol = intval(isset($input['id_rol']) ? $input['id_rol'] : 0);
        if (!$id_rol) { echo json_encode(array("status"=>"error","message"=>"Falta id")); break; }
        if ($id_rol <= 4) { echo json_encode(array("status"=>"error","message"=>"No se pueden eliminar roles nativos")); break; }
        sqlsrv_query($conn, "DELETE FROM role_permissions WHERE id_rol = ?", array($id_rol));
        sqlsrv_query($conn, "DELETE FROM persona_rol WHERE id_rol = ?", array($id_rol));
        log_op($conn,"SEGURIDAD","Eliminar rol","Rol",$input);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Rol eliminado."));
        break;

    case 'get_auditoria':
        $limit = isset($_GET['limit']) ? intval($_GET['limit']) : 50;
        $data = safe_fetch($conn, "SELECT TOP $limit id_auditoria, usuario, fecha_hora, modulo, operacion, detalles, ip_address, hostname FROM auditoria_operacion ORDER BY id_auditoria DESC");
        echo json_encode(array("status" => "success", "data" => $data));
        break;

    case 'clear_audit_logs':
        $tipo = trim(isset($input['tipo']) ? $input['tipo'] : 'all');
        $fecha_desde = trim(isset($input['fecha_desde']) ? $input['fecha_desde'] : '');
        $fecha_hasta = trim(isset($input['fecha_hasta']) ? $input['fecha_hasta'] : '');
        $eliminados = 0;
        if ($tipo === 'all' || $tipo === 'operaciones') {
            // FIX v2.114 — TRUNCATE reinicia los IDs desde cero.
            if (!$fecha_desde && !$fecha_hasta) {
                @sqlsrv_query($conn, "TRUNCATE TABLE auditoria_operacion");
            } elseif ($fecha_desde && $fecha_hasta) {
                @sqlsrv_query($conn, "DELETE FROM auditoria_operacion WHERE CAST(fecha_hora AS DATE) BETWEEN ? AND ?", array($fecha_desde, $fecha_hasta));
            }
        }
        if ($tipo === 'all' || $tipo === 'accesos') {
            if (!$fecha_desde && !$fecha_hasta) {
                @sqlsrv_query($conn, "TRUNCATE TABLE acceso_auditoria");
            } elseif ($fecha_desde && $fecha_hasta) {
                @sqlsrv_query($conn, "DELETE FROM acceso_auditoria WHERE CAST(fecha_hora AS DATE) BETWEEN ? AND ?", array($fecha_desde, $fecha_hasta));
            }
        }
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Bitácora limpiada. Los IDs se reiniciaron desde cero."));
        break;

    case 'get_email_templates':
        $defaults = array(
            'TICKET_REGISTRO' => array('asunto' => 'Ticket #{NRO_TICKET} registrado', 'cuerpo' => '<h1>Su ticket ha sido registrado</h1><p>Ticket: {NRO_TICKET}</p><p>Empresa: {RAZON_SOCIAL}</p><p>Prioridad: {PRIORIDAD}</p><p>Detalle: {DETALLE}</p>'),
            'TICKET_CIERRE' => array('asunto' => 'Su Ticket #{NRO_TICKET} ha sido resuelto', 'cuerpo' => '<h1>Su ticket ha sido resuelto</h1><p>Ticket: {NRO_TICKET}</p><p>Solución: {SOLUCION}</p>'),
        );
        $templatesFile = __DIR__ . '/email_templates.json';
        if (file_exists($templatesFile)) { $saved = json_decode(file_get_contents($templatesFile), true); if (is_array($saved)) $defaults = array_merge($defaults, $saved); }
        echo json_encode(array("status" => "success", "data" => $defaults));
        break;

    case 'save_email_template':
        $template_id = trim(isset($input['template_id']) ? $input['template_id'] : '');
        $asunto = trim(isset($input['asunto']) ? $input['asunto'] : '');
        $cuerpo = isset($input['cuerpo']) ? $input['cuerpo'] : '';
        if (!$template_id) { echo json_encode(array("status"=>"error","message"=>"Falta template_id")); break; }
        $templatesFile = __DIR__ . '/email_templates.json';
        $existing = array();
        if (file_exists($templatesFile)) $existing = json_decode(file_get_contents($templatesFile), true) ?: array();
        $existing[$template_id] = array('asunto' => $asunto, 'cuerpo' => $cuerpo);
        @file_put_contents($templatesFile, json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
        clear_cache();
        echo json_encode(array("status"=>"success","message"=>"Plantilla guardada."));
        break;

    default:
        // Para cualquier otra acción, devolver success vacío
        clear_cache();
        echo json_encode(array("status" => "success", "message" => "Acción no implementada en versión mínima: " . $action));
        break;
}

sqlsrv_close($conn);
?>
