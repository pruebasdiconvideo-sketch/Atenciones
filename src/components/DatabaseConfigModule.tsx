import { useState, useEffect, FormEvent } from "react";
import { getApiUrl, getIisServerUrl } from "../utils/api";
import { logTechnicalError, getFriendlyErrorMessage } from "../utils/errorLogger";
import { Database, Server, Link, ShieldCheck, Wifi, AlertTriangle, CheckCircle2, RefreshCw, X, HelpCircle } from "lucide-react";

interface DatabaseConfigModuleProps {
  onConfigSuccess: () => void;
  onClose?: () => void;
  isBlocking?: boolean;
}

export function DatabaseConfigModule({ onConfigSuccess, onClose, isBlocking = false }: DatabaseConfigModuleProps) {
  const [iisServerUrl, setIisServerUrl] = useState("");
  const [dbServer, setDbServer] = useState("");
  const [dbName, setDbName] = useState("");
  const [dbUser, setDbUser] = useState("");
  const [dbPass, setDbPass] = useState("");
  const [testingDb, setTestingDb] = useState(false);
  const [dbTestResult, setDbTestResult] = useState<{ status: "success" | "error"; message: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Load current values on mount
  useEffect(() => {
    setIisServerUrl(getIisServerUrl());

    // Fetch active DB config from PHP server if possible
    const getConfigUrl = () => {
      return getApiUrl("get_db_config");
    };

    fetch(getConfigUrl())
      .then(res => res.json())
      .then(data => {
        if (data.status === "success" && data.config) {
          setDbServer(data.config.serverName || "");
          setDbName(data.config.Database || "");
          setDbUser(data.config.UID || "");
          setDbPass(data.config.PWD || "");
        }
      })
      .catch(e => {
        console.warn("No se pudo recuperar configuración del servidor:", e.message);
      });
  }, []);

  const handleTestAndSave = (e: FormEvent) => {
    e.preventDefault();
    if (!iisServerUrl.trim()) {
      setDbTestResult({ status: "error", message: "La URL del servidor web IIS es requerida." });
      return;
    }
    if (!dbServer.trim() || !dbName.trim() || !dbUser.trim()) {
      setDbTestResult({ status: "error", message: "Todos los campos del Servidor SQL son requeridos (Servidor, Base de Datos, Usuario)." });
      return;
    }
    if (!dbPass) {
      setDbTestResult({ status: "error", message: "Ingrese la contraseña del usuario SQL para validar la conexión." });
      return;
    }

    setTestingDb(true);
    setDbTestResult(null);

    // 1. Temporarily save the IIS server URL in localStorage
    if (typeof window !== "undefined") {
      window.localStorage.setItem("iis_server_url", iisServerUrl.trim());
    }

    // 2. Build the API URL with the new configuration
    const testApiUrl = getApiUrl("test_and_save_db_config");

    fetch(testApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverName: dbServer.trim(),
        Database: dbName.trim(),
        UID: dbUser.trim(),
        PWD: dbPass
      })
    })
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: Fallo de comunicación.`);
        }
        return res.json();
      })
      .then(data => {
        setTestingDb(false);
        if (data.status === "success") {
          setDbTestResult({
            status: "success",
            message: "¡Conexión validada exitosamente con SQL Server y configuración guardada!"
          });
          // Notify parent of successful configuration change
          setTimeout(() => {
            onConfigSuccess();
          }, 1000);
        } else {
          // Keep IIS server URL but report database connection failure
          setDbTestResult({
            status: "error",
            message: data.message || "El servidor IIS no pudo conectarse al servidor SQL con estos datos."
          });
          logTechnicalError(new Error("Configuración de BD incorrecta"), {
            url: testApiUrl,
            sqlStatus: "ERROR_CONEXION_CONFIG_TEST",
            customInfo: { rawData: data }
          });
        }
      })
      .catch(err => {
        setTestingDb(false);
        setDbTestResult({
          status: "error",
          message: "No se pudo contactar al servidor IIS en la URL especificada. Verifique que el servicio de API PHP esté arriba y permita CORS."
        });
        logTechnicalError(err, {
          url: testApiUrl,
          sqlStatus: "ERROR_CONEXION_CONFIG_HTTP"
        });
      });
  };

  return (
    <div className="bg-[#E4E3E0] border border-[#141414] p-6 max-w-xl w-full mx-auto space-y-6">

      {/* Encabezado */}
      <div className="flex items-center justify-between border-b border-[#141414] pb-3">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-[#141414]" />
          <h3 className="font-serif italic text-lg font-bold text-[#141414]">Configuración del Servidor de Datos</h3>
        </div>
        {onClose && !isBlocking && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-[#141414]/10 rounded-none transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nota de Seguridad */}
      <div className="bg-white/40 border border-[#141414]/10 p-3.5 text-xs text-zinc-700 space-y-2">
        <div className="flex items-center gap-1.5 font-bold uppercase text-[10px] text-[#141414]">
          <ShieldCheck className="w-4 h-4 text-emerald-800" />
          Módulo de Conexión Seguro e Independiente
        </div>
        <p className="leading-relaxed font-sans">
          Por motivos de seguridad, la aplicación cliente se conecta <strong>únicamente al servidor web IIS</strong>.
          El usuario final nunca establece una conexión de red directa con la base de datos SQL Server.
          Todas las peticiones son procesadas de manera interna, transparente y segura por el backend.
        </p>
      </div>

      {/* Formulario */}
      <form onSubmit={handleTestAndSave} className="space-y-4">

        {/* URL del Servidor IIS */}
        <div className="space-y-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#141414] flex items-center gap-1">
            <Link className="w-3.5 h-3.5" /> Dirección del Servidor IIS (API PHP)
          </label>
          <input
            type="url"
            required
            value={iisServerUrl}
            onChange={(e) => { setIisServerUrl(e.target.value); setDbTestResult(null); }}
            className="w-full bg-white border border-[#141414]/30 p-2 text-xs font-mono rounded-none"
            placeholder="http://192.168.1.100:806"
          />
          <p className="text-[9px] text-zinc-500 font-sans leading-normal">
            URL donde se hospeda el archivo <code className="font-mono bg-zinc-200/50 px-1 rounded">api_tickets.php</code>.
            Ejemplo: <code className="font-mono bg-zinc-200/50 px-1 rounded">http://192.168.100.5:806</code>
          </p>
        </div>

        {/* Credenciales de Base de Datos */}
        <div className="border border-[#141414]/10 p-4 bg-white/30 space-y-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 border-b border-[#141414]/10 pb-1 flex items-center gap-1">
            <Server className="w-3.5 h-3.5" /> Parámetros del Servidor SQL Server
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase text-[#141414]">Servidor / Host SQL</label>
              <input
                type="text"
                required
                value={dbServer}
                onChange={(e) => { setDbServer(e.target.value); setDbTestResult(null); }}
                className="w-full bg-white border border-[#141414]/30 p-2 text-xs font-mono rounded-none"
                placeholder="DESKTOP-FOOD01U\SQLEXPRESS2022"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase text-[#141414]">Nombre Base de Datos</label>
              <input
                type="text"
                required
                value={dbName}
                onChange={(e) => { setDbName(e.target.value); setDbTestResult(null); }}
                className="w-full bg-white border border-[#141414]/30 p-2 text-xs font-mono rounded-none"
                placeholder="DiconSoporte"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase text-[#141414]">Usuario SQL (UID)</label>
              <input
                type="text"
                required
                value={dbUser}
                onChange={(e) => { setDbUser(e.target.value); setDbTestResult(null); }}
                className="w-full bg-white border border-[#141414]/30 p-2 text-xs font-mono rounded-none"
                placeholder="sa"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase text-[#141414]">Contraseña SQL (PWD)</label>
              <input
                type="password"
                required
                value={dbPass}
                onChange={(e) => { setDbPass(e.target.value); setDbTestResult(null); }}
                className="w-full bg-white border border-[#141414]/30 p-2 text-xs font-mono rounded-none"
                placeholder="••••••••"
              />
            </div>
          </div>
        </div>

        {/* Resultados del Test */}
        {dbTestResult && (
          <div className={`p-3 text-xs border rounded-none flex gap-2 font-mono items-start ${dbTestResult.status === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-300"
              : "bg-red-50 text-red-900 border-red-300"
            }`}>
            {dbTestResult.status === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-800 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-800 shrink-0 mt-0.5" />
            )}
            <div className="leading-relaxed">
              <strong>{dbTestResult.status === "success" ? "ÉXITO:" : "ERROR:"}</strong> {dbTestResult.message}
            </div>
          </div>
        )}

        {/* Botones de acción */}
        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <button
            type="submit"
            disabled={testingDb}
            className="flex-1 bg-[#141414] text-[#E4E3E0] py-3.5 hover:bg-[#141414]/90 font-bold uppercase text-xs tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            {testingDb ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Validando y Enlazando...
              </>
            ) : (
              "Guardar y Enlazar Base de Datos"
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="px-4 py-3.5 border border-[#141414]/30 text-[#141414] hover:bg-white/40 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <HelpCircle className="w-4 h-4" />
            Ayuda
          </button>
        </div>
      </form>

      {showHelp && (
        <div className="bg-zinc-50 border border-[#141414]/20 p-4 text-[11px] text-zinc-600 font-sans space-y-2 animate-fade-in-quick">
          <h4 className="font-bold text-[#141414] uppercase text-[10px]">¿Cómo funciona este enlace?</h4>
          <p className="leading-relaxed">
            1. El cliente web (su navegador) envía la configuración del servidor SQL al servidor IIS.
          </p>
          <p className="leading-relaxed">
            2. El servidor IIS ejecuta una función de prueba con <code className="font-mono bg-zinc-200 px-0.5 py-0.2">sqlsrv_connect</code> utilizando las credenciales proporcionadas.
          </p>
          <p className="leading-relaxed">
            3. Si la conexión es exitosa, el servidor web IIS almacena la configuración de manera segura en un archivo local privado.
          </p>
          <p className="leading-relaxed">
            4. El sistema recarga los catálogos y tickets sincronizados de forma totalmente transparente para continuar trabajando.
          </p>
        </div>
      )}
    </div>
  );
}
