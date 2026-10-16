# 📦 Guía de Entrega y Despliegue de Producto Final en Windows IIS y SQL Server
## Sistema ERP Monosync - Control de Incidencias Multipaís S.A.C.

Esta carpeta contiene todos los entregables de la base de datos, el backend y los archivos de configuración requeridos para montar el **Sistema ERP Monosync** de manera local en tu PC usando **Microsoft IIS (Internet Information Services)** en el puerto **806** y **SQL Server**.

---

## 📁 Entregables en esta Carpeta

1. **`database.sql`**: Script completo de base de datos para **Microsoft SQL Server**. Define las 22 tablas relacionales con claves foráneas, restricciones avanzadas, y carga los datos semilla iniciales (rubros, roles, usuarios, etc.).
2. **`api_tickets.php`**: API REST robusta programada en PHP 8.x que conecta con SQL Server para realizar consultas y filtros dinámicos y seguros de incidencias.
3. **`web.config`**: Configuración nativa de IIS para soportar la redirección interna del enrutador de React (evitando errores 404 al recargar) y registrar tipos MIME modernos de archivos estáticos.

---

## 🛠️ Requisitos Previos en Windows

1. **IIS (Internet Information Services)** con los siguientes módulos instalados:
   - **Módulo de reescritura de URL (URL Rewrite Module)** (Indispensable para React SPA. Descárgalo de: https://www.iis.net/downloads/microsoft/url-rewrite).
   - **FastCGI Settings** y compatibilidad con **PHP**.
2. **PHP v8.1 o v8.2** instalado y registrado en IIS.
3. **Microsoft SQL Server (v2019 o superior)** con SQL Server Management Studio (SSMS).
4. **Microsoft Drivers for PHP for SQL Server** (`php_sqlsrv.dll` y `php_pdo_sqlsrv.dll`) correspondientes a tu versión de PHP.

---

## 🚀 Guía de Despliegue de Extremo a Extremo

Sigue estos 5 pasos ordenados para levantar el sistema completo como un **producto final estable**:

### Paso 1: Inicializar la Base de Datos y Cargar Datos de Prueba
1. Abre **SQL Server Management Studio (SSMS)** y conéctate a tu instancia de base de datos.
2. Abre y ejecuta primero el archivo **`database.sql`** (presiona **F5**) para crear la base de datos `MonosyncERP` y sus 22 tablas vacías.
3. **IMPORTANTE (Cargar Datos de Prueba):** Abre y ejecuta el archivo **`seed_data.sql`** (presiona **F5**) para poblar las tablas con empresas (Interbank, Plaza Vea, Alicorp, etc.), sedes, contactos de clientes, técnicos asignados y 5 tickets de soporte de prueba listos para usar en la web.

---

### Paso 2: Compilar el Frontend React (Solución al error "Vite no se reconoce")
Si al ejecutar `npm run build` obtienes un error como *"vite no se reconoce como un comando interno o externo"*, es porque necesitas descargar e instalar primero los archivos de soporte de la app (módulos de Node). Sigue estos pasos exactos en tu terminal CMD o PowerShell:

1. Asegúrate de tener **Node.js** instalado en tu computadora. Si no lo tienes, descárgalo e instálalo gratis desde [https://nodejs.org/](https://nodejs.org/) (selecciona la versión LTS recomendada).
2. Abre la consola de comandos de Windows en la ruta de tu proyecto (`D:\BDCLIENTES\Abercrombie\Ayudas`).
3. Ejecuta el siguiente comando para descargar e instalar todas las dependencias del sistema:
   ```bash
   npm install
   ```
   *(Espera a que termine. Creará una carpeta `node_modules` en tu carpeta del proyecto).*
4. Una vez terminado, compila la aplicación para producción con:
   ```bash
   npm run build
   ```
5. Esto creará exitosamente una carpeta llamada **`dist/`** en la raíz del proyecto, libre de errores. **Esta carpeta `dist/` contiene tu producto final compilado.**

---

### Paso 3: Configurar el Sitio Web en IIS (Puerto 806)
1. Abre el **Administrador de Internet Information Services (IIS)** (`inetmgr` desde Ejecutar).
2. En el panel izquierdo, haz clic derecho sobre **Sitios (Sites)** y selecciona **Agregar sitio web... (Add Website...)**.
3. Configura los siguientes campos:
   - **Nombre del sitio**: `MonosyncERP`
   - **Ruta de acceso física (Physical Path)**: Crea o selecciona una carpeta de tu preferencia (ej. `C:\inetpub\MonosyncERP\`).
   - **Puerto**: Cambia el puerto a **`806`**.
4. Haz clic en **Aceptar**.

---

### Paso 4: Copiar los Archivos Finales al Directorio de IIS
Ahora copiaremos los archivos compilados del frontend y el backend de datos en la carpeta física de IIS (ej. `C:\inetpub\MonosyncERP\`):

1. Entra a la carpeta **`dist/`** generada en el *Paso 2*.
2. Copia todo su contenido y pégalo en `C:\inetpub\MonosyncERP\`.
3. Copia el archivo **`web.config`** que está dentro de esta carpeta de despliegue (`db_iis_php_setup/web.config`) y pégalo directamente en la raíz de tu sitio web de IIS (`C:\inetpub\MonosyncERP\web.config`). *Esto resolverá inmediatamente el problema del error 404 al navegar.*
4. Copia el archivo **`api_tickets.php`** y colócalo en el mismo directorio de IIS (`C:\inetpub\MonosyncERP\api_tickets.php`).

---

### Paso 5: Configurar la Conexión SQL Server en PHP
1. Abre tu instalación de PHP y asegúrate de registrar las DLL en tu archivo `php.ini`:
   ```ini
   extension=php_sqlsrv.dll
   extension=php_pdo_sqlsrv.dll
   ```
2. Abre el archivo `api_tickets.php` en `C:\inetpub\MonosyncERP\` con un editor de texto y edita los valores de la base de datos con las credenciales de tu SQL Server:
   ```php
   $serverName = "LOCALHOST\\SQLEXPRESS"; // Tu instancia de SQL Server
   $connectionInfo = array(
       "Database" => "MonosyncERP",
       "UID" => "sa",                    // Tu usuario SQL
       "PWD" => "TuContrasenaSegura",    // Tu clave SQL
       "CharacterSet" => "UTF-8"
   );
   ```
3. Ejecuta `iisreset` en tu consola CMD de Windows como Administrador para guardar los cambios en IIS.

---

## 🔍 Verificación del Éxito del Despliegue
¡Listo! Abre tu navegador favorito e ingresa a:
👉 **`http://localhost:806/`**

### ¿Por qué ya no dará error 404 (Not Found)?
Gracias al archivo **`web.config`**, cualquier petición que el navegador haga (como `/reports`, `/dashboard` o `/geographic`) que no sea un archivo físico real, será reescrita internamente de forma silenciosa e instantánea por IIS para ser gestionada por el enrutador virtual de la aplicación React (`index.html`), resolviendo de forma nativa e industrial el problema de los recursos no encontrados.

---
**MONOSYNC ERP** - Tecnología robusta, escalable y con despliegue de nivel empresarial.
