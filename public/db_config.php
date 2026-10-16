<?php
/**
 * Configuración interna del backend PHP en IIS.
 * Servidor de pruebas temporal. Cambiar serverName al promover a producción.
 * El navegador nunca recibe estas credenciales; configure PWD en el servidor IIS.
 */

return [
    'serverName' => 'DESKTOP-FOOD01U\\SQL2025',
    'connectionInfo' => [
        'Database' => 'MonosyncERP',
        'UID' => 'sa',
        'PWD' => '123',
        'CharacterSet' => 'UTF-8',
        'TrustServerCertificate' => true,
        'LoginTimeout' => 15
    ]
];
