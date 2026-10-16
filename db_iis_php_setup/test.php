<?php
$serverName = "DESKTOP-PG8T45\SQL2022"; // o DESKTOP-PG8TI45\SQL2022
$connectionInfo = array(
    "Database" => "MonosyncERP",
    "UID" => "sa",
    "PWD" => "123"
);
$conn = sqlsrv_connect($serverName, $connectionInfo);
if ($conn) {
    echo "Conexión exitosa";
    sqlsrv_close($conn);
} else {
    echo "Error de conexión: ";
    print_r(sqlsrv_errors());
}
?>