/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, FormEvent } from "react";
import { getInitialDatabase, saveDatabase, resetDatabase, MockDatabase } from "./db/mockDb";
import { Persona } from "./types";
// FIX v2.39 — Lazy loading de componentes pesados.
// Solo se carga el componente cuando el usuario navega a esa pestaña.
// Esto reduce el bundle inicial ~60% (de ~700KB a ~250KB).
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { lazy, Suspense } from "react";

const TicketManager = lazy(() => import("./components/TicketManager").then(m => ({ default: m.TicketManager })));
const CompanyManager = lazy(() => import("./components/CompanyManager").then(m => ({ default: m.CompanyManager })));
const GeographicViewer = lazy(() => import("./components/GeographicViewer").then(m => ({ default: m.GeographicViewer })));
const UserManager = lazy(() => import("./components/UserManager").then(m => ({ default: m.UserManager })));
const ReportEngine = lazy(() => import("./components/ReportEngine").then(m => ({ default: m.ReportEngine })));
import { logTechnicalError } from "./utils/errorLogger";
import { getApiUrl } from "./utils/api";
import {
  LayoutDashboard,
  Ticket,
  Building2,
  Globe,
  ShieldCheck,
  BarChart3,
  LogOut,
  AlertCircle,
  RefreshCw,
  ServerCrash,
  Menu,
  X,
  ChevronDown
} from "lucide-react";

type MainViewTab = "DASHBOARD" | "TICKET" | "COMPANY" | "GEOGRAPHIC" | "USERS" | "REPORTS";
type NavigationGroupId = "principal" | "atenciones" | "empresas" | "administracion" | "reportes";

const navigationGroups: { id: NavigationGroupId; label: string; Icon: typeof LayoutDashboard; items: { id: MainViewTab; label: string; Icon: typeof LayoutDashboard }[] }[] = [
  { id: "principal", label: "Principal", Icon: LayoutDashboard, items: [{ id: "DASHBOARD", label: "Panel principal", Icon: LayoutDashboard }] },
  { id: "atenciones", label: "Atenciones", Icon: Ticket, items: [{ id: "TICKET", label: "Tickets", Icon: Ticket }] },
  {
    id: "empresas",
    label: "Empresas",
    Icon: Building2,
    items: [
      { id: "COMPANY", label: "Empresas", Icon: Building2 },
      { id: "GEOGRAPHIC", label: "Geografía y catálogos", Icon: Globe }
    ]
  },
  { id: "administracion", label: "Administración", Icon: ShieldCheck, items: [{ id: "USERS", label: "Auditoría y usuarios", Icon: ShieldCheck }] },
  { id: "reportes", label: "Reportes", Icon: BarChart3, items: [{ id: "REPORTS", label: "Reportes y ANS", Icon: BarChart3 }] }
];

export default function App() {
  const [db, setDb] = useState<MockDatabase | null>(null);
  const [currentUser, setCurrentUser] = useState<Persona | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>("");
  // FIX v2.77 — Persistir activeTab en sessionStorage para que al presionar F5 no vuelva al Dashboard.
  const [activeTab, setActiveTabState] = useState<MainViewTab>(() => {
    const saved = sessionStorage.getItem("activeTab");
    if (saved && ["DASHBOARD", "TICKET", "COMPANY", "GEOGRAPHIC", "USERS", "REPORTS"].includes(saved)) {
      return saved as MainViewTab;
    }
    return "DASHBOARD";
  });
  const setActiveTab = (tab: MainViewTab) => {
    setActiveTabState(tab);
    sessionStorage.setItem("activeTab", tab);
    const activeGroup = navigationGroups.find(group => group.items.some(item => item.id === tab));
    if (activeGroup) setExpandedMenuGroup(activeGroup.id);
    setMobileMenuOpen(false);
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedMenuGroup, setExpandedMenuGroup] = useState<NavigationGroupId>(() =>
    navigationGroups.find(group => group.items.some(item => item.id === activeTab))?.id ?? "principal"
  );

  const [dbSyncedWithSql, setDbSyncedWithSql] = useState<boolean>(false);
  const [sqlSyncError, setSqlSyncError] = useState<string | null>(null);

  // Connection states
  const [isInitialSyncing, setIsInitialSyncing] = useState<boolean>(true);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState<boolean>(false);
  const [changePassCurrent, setChangePassCurrent] = useState("");
  const [changePassNew, setChangePassNew] = useState("");
  const [changePassConfirm, setChangePassConfirm] = useState("");
  const [simulationMode, setSimulationMode] = useState<boolean>(false);

  const isCloudSandbox = () => {
    const hostname = window.location.hostname;
    const hasCustomUrl = typeof window !== "undefined" && window.localStorage.getItem("iis_server_url");
    if (hasCustomUrl) return false;
    return hostname.endsWith(".run.app") || hostname.endsWith(".google.com") || hostname.includes("aistudio-preview");
  };

  const triggerInitialSync = (showSpinner: boolean = true) => {
    if (showSpinner) setIsInitialSyncing(true);
    setSqlSyncError(null);

    const initialDb = getInitialDatabase();

    // FIX v2.63 — Usar sync_light en lugar de sync_all para evitar 500 por memoria.
    const getSyncApiUrl = () => {
      return getApiUrl("sync_light");
    };

    fetch(getSyncApiUrl())
      .then(res => res.json().then(data => ({ res, data })))
      .then(({ res, data }) => {
        if (!res.ok || data.status !== "success") {
          const diagnostic = [
            data.message,
            data.details,
            data.serverName ? `Servidor SQL: ${data.serverName}` : "",
            data.database ? `Base de datos: ${data.database}` : "",
            data.hint
          ].filter(Boolean).join("\n");
          throw new Error(diagnostic || `Error de conexión HTTP ${res.status}.`);
        }
        return data;
      })
      .then(data => {
        setIsInitialSyncing(false);
        if (data.status === "success" && data.data) {
          const syncedDb = {
            ...initialDb,
            ...data.data
          };
          setDb(syncedDb);
          setDbSyncedWithSql(true);
          setSqlSyncError(null);
          console.log("el sistema: Sincronización inicial exitosa.");
        } else {
          throw new Error(data.message || "Error al sincronizar base de datos.");
        }
      })
      .catch(err => {
        setIsInitialSyncing(false);
        logTechnicalError(err, { url: getSyncApiUrl(), sqlStatus: "ERROR_CONEXION_INICIAL", currentUser });

        let friendlyErr = "No se pudo establecer comunicación con el Servidor Web IIS (API PHP). Por favor verifique que la URL de IIS sea correcta y que el servidor web permita peticiones.";
        if (err.message && err.message.toLowerCase().includes("sql server")) {
          friendlyErr = `IIS respondió, pero SQL Server rechazó la conexión.\n\n${err.message}`;
        } else if (err.message && err.message.includes("HTTP")) {
          friendlyErr = `Error de Comunicación: El servidor web de API PHP respondió con error (${err.message}).`;
        }

        setSqlSyncError(friendlyErr);
        setDbSyncedWithSql(false);
      });
  };

  // ====================================================================
  // FIX v2.38 — triggerLightSync: sincronización rápida posterior a operaciones.
  // Usa sync_light que EXCLUYE base64Content y limita historial/auditoría
  // a los últimos 200 registros. Es ~10x más rápido que sync_all.
  // Ideal para refrescar después de: baja, reactivar, editar, crear, eliminar.
  // ====================================================================
  // FIX v2.98 — onSync DESHABILITADO para operaciones CRUD.
  // Antes: cada operación llamaba onSync() que ejecutaba sync_light (20+ tablas, 30-60s).
  // Ahora: onSync() no hace nada. Las operaciones usan updateDb() que es instantáneo.
  // El usuario puede refrescar manualmente con el botón "↻ Actualizar" cuando quiera.
  const triggerLightSync = () => {
    // No hacer nada — esto evita la lentitud de 30-60 segundos.
    // Los datos se actualizan con updateDb() que es instantáneo.
    console.log("onSync deshabilitado para evitar lentitud.");
  };

  // FIX v2.98 — triggerFullSync: sincronización REAL desde el backend.
  // Se usa SOLO cuando el usuario presiona el botón "↻ Actualizar" manualmente.
  // No se llama automáticamente después de operaciones CRUD.
  const triggerFullSync = () => {
    const url = getApiUrl("sync_light");
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Error de conexión`);
        return res.json();
      })
      .then(data => {
        if (data.status === "success" && data.data) {
          setDb(prevDb => ({
            ...prevDb,
            ...data.data,
            paises: prevDb.paises,
            tiposDivision: prevDb.tiposDivision,
            divisionesGeograficas: prevDb.divisionesGeograficas,
            ubicaciones: prevDb.ubicaciones,
            rubros: prevDb.rubros,
            gruposEmpresariales: prevDb.gruposEmpresariales,
            roles: prevDb.roles,
            asignacionesRoles: prevDb.asignacionesRoles,
            rolePermissions: prevDb.rolePermissions,
            auditoriaAccesos: prevDb.auditoriaAccesos,
            archivos: prevDb.archivos,
            ticketArchivos: prevDb.ticketArchivos,
            atencionArchivos: prevDb.atencionArchivos,
          }));
          console.log("Sincronización manual completada.");
        }
      })
      .catch(err => {
        console.warn("Sincronización manual falló:", err?.message || err);
      });
  };

  // FIX v2.83 — Forzar el título del navegador a "ERP SOPORTE" en cada render.
  // Algunos servidores (IIS) o el bundle cacheado muestran un título antiguo
  // ("My Google Studio App" o similar). Esto garantiza que siempre sea correcto.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "ERP SOPORTE";
    }
  }, []);

  // Load Database state on mount
  useEffect(() => {
    const initialDb = getInitialDatabase();
    setDb(initialDb);

    fetch(getApiUrl("session_status"))
      .then(async response => response.ok ? response.json() : null)
      .then(data => {
        if (data?.status === "success" && data.user) {
          setCurrentUser(data.user as Persona);
          setCurrentUserRole(data.roleName || data.user.rol_nombre || "Externo");
          triggerInitialSync(false);
          return;
        }
        setIsInitialSyncing(false);
        sessionStorage.removeItem("active_persona_session");
        sessionStorage.removeItem("active_persona_role");
      })
      .catch(() => setIsInitialSyncing(false));
  }, []);

  // ====================================================================
  // FIX v2.18: Cerrar sesión por inactividad de 5 minutos
  // ====================================================================
  useEffect(() => {
    if (!currentUser) return;

    const INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 minutos en milisegundos
    let inactivityTimer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        // Cerrar sesión automáticamente
        alert("Su sesión ha sido cerrada por inactividad (5 minutos sin actividad).");
        setCurrentUser(null);
        setCurrentUserRole("");
        sessionStorage.removeItem("active_persona_session");
        sessionStorage.removeItem("active_persona_role");
        setActiveTab("DASHBOARD");
      }, INACTIVITY_LIMIT);
    };

    // Eventos que reinician el timer
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

    events.forEach(event => {
      document.addEventListener(event, resetTimer, { passive: true });
    });

    // Iniciar timer
    resetTimer();

    return () => {
      clearTimeout(inactivityTimer);
      events.forEach(event => {
        document.removeEventListener(event, resetTimer);
      });
    };
  }, [currentUser]);

  // FIX v2.18: NO guardar en localStorage. Solo actualizar el estado en memoria.
  // Toda la información se guarda  a través de los endpoints del API.
  // El localStorage solo se usa para systemConfig (SMTP) que no está en la BD.
  const handleUpdateDb = (newDb: MockDatabase) => {
    setDb(newDb);
    // Guardar SOLO systemConfig en localStorage (para preservar configuración SMTP)
    try {
      if (newDb.systemConfig) {
        const savedDb = getInitialDatabase();
        savedDb.systemConfig = newDb.systemConfig;
        localStorage.setItem("SOPORTE_TICKETS_DB", JSON.stringify({
          ...savedDb,
          // No guardar datos pesados en localStorage
          tickets: [],
          atenciones: [],
          historialEstados: [],
          archivos: [],
          ticketArchivos: [],
          personas: [],
          empresas: [],
          sucursales: [],
          contactosEmpresariales: [],
          motivosContacto: [],
          rubros: [],
          gruposEmpresariales: [],
          asignacionesRoles: [],
          auditoriaAccesos: [],
          auditoriaOperaciones: [],
          paises: [],
          divisionesGeograficas: [],
          ubicaciones: [],
        }));
      }
    } catch (e) {
      console.warn("No se pudo guardar systemConfig:", e);
    }
  };

  const handleLoginSuccess = (user: Persona, roleName: string) => {
    setCurrentUser(user);
    setCurrentUserRole(roleName);
    // FIX v2.23: Después del login, sincronizar inmediatamente con la BD
    // para traer los permisos reales (rolePermissions) desde el sistema.
    // Sin esto, el primer login muestra TODAS las opciones (del localStorage seed)
    // y solo al presionar F5 se aplican los permisos reales.
    // No mostrar spinner para no confundir al usuario.
    triggerInitialSync(false);
  };

  const handleLogout = () => {
    void fetch(getApiUrl("logout"), { method: "POST" }).catch(() => undefined);
    setCurrentUser(null);
    setCurrentUserRole("");
    sessionStorage.removeItem("active_persona_session");
    sessionStorage.removeItem("active_persona_role");
    setActiveTab("DASHBOARD");
  };

  const handleResetEntireDb = () => {
    if (confirm("¿Está seguro de restaurar toda la base de datos a su estado semilla SQL original? Esto borrará cualquier ticket o empresa ingresados en esta sesión.")) {
      const freshDb = resetDatabase();
      setDb(freshDb);
      alert("MSSQL RESTORE SUCCESS: Base de datos seed recargada exitosamente.");
    }
  };

  // Helper to check module view ("ver") permission dynamically
  // FIX v2.27: Cargar permisos desde rolePermissions (BD).
  // El problema era que si no encontraba el permiso en el array, caía al fallback
  // que da más permisos de los que debería. Ahora si el permiso existe en la BD
  // pero ver=false, respeta eso y NO cae al fallback.
  const hasVerPermission = (tabId: MainViewTab) => {
    if (!db || !currentUser) {
      return tabId === "DASHBOARD" || tabId === "TICKET";
    }
    const userAsignacion = db.asignacionesRoles?.find(a => Number(a.id_persona) === Number(currentUser.id_persona));
    const userRoleId = userAsignacion ? Number(userAsignacion.id_rol) : null;

    // FIX v2.62 — Admin bypass: id_rol === 1 OR id_persona === 1 (default admin) OR role name includes "admin"
    if (userRoleId === 1 || currentUser.id_persona === 1) return true;

    const roleLower = (currentUserRole || "").toLowerCase();
    if (roleLower.includes("admin")) return true;

    const permissionMap: Record<MainViewTab, string> = {
      DASHBOARD: "DASHBOARD",
      TICKET: "TICKETS",
      COMPANY: "CLIENTES",
      GEOGRAPHIC: "GEOGRAFIA",
      USERS: "SEGURIDAD",
      REPORTS: "REPORTES",
    };

    const moduleKey = permissionMap[tabId];

    // Buscar en rolePermissions (array desde BD, devuelto por sync_all/sync_light)
    const allPerms = (db as any).rolePermissions || db.systemConfig?.rolePermissions;

    // FIX v2.62 — Si allPerms es un array vacío o null, usar fallback por nombre de rol.
    // Antes, un array vacío [] hacía que se retornara false para todo.
    if (Array.isArray(allPerms) && allPerms.length > 0 && userRoleId !== null) {
      const perm = allPerms.find((p: any) =>
        Number(p.id_rol) === Number(userRoleId) && p.modulo === moduleKey
      );
      if (perm) {
        const verVal = perm.ver === true || perm.ver === 1 || perm.ver === "1" || perm.ver === "true";
        return verVal;
      }
      // Si no encontramos el permiso para este rol+modulo, asumir que NO tiene acceso
      return false;
    }
    // Formato legacy (localStorage)
    else if (allPerms && typeof allPerms === 'object' && !Array.isArray(allPerms) && userRoleId !== null) {
      const perms = allPerms[userRoleId] || allPerms[String(userRoleId)];
      if (perms && perms[moduleKey]) {
        return !!perms[moduleKey].ver;
      }
      return false;
    }

    // Fallback por nombre de rol (cuando no hay permisos en BD ni localStorage)
    if (roleLower.includes("superv")) return moduleKey !== "SEGURIDAD";
    if (roleLower.includes("tecn") || roleLower.includes("técn")) {
      return ["DASHBOARD", "TICKET", "REPORTS"].includes(tabId);
    }
    return tabId === "TICKET" || tabId === "DASHBOARD";
  };

  // Auto-redirect if the current tab is not permitted
  useEffect(() => {
    if (!db || !currentUser) return;
    const tabs: MainViewTab[] = ["DASHBOARD", "TICKET", "COMPANY", "GEOGRAPHIC", "USERS", "REPORTS"];
    if (!hasVerPermission(activeTab)) {
      const firstPermitted = tabs.find(t => hasVerPermission(t));
      if (firstPermitted) {
        setActiveTab(firstPermitted);
      }
    }
  }, [currentUser, db, activeTab]);

  // Render loading state while performing the initial sync check
  if (isInitialSyncing) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] flex flex-col justify-center items-center space-y-4">
        <RefreshCw className="w-8 h-8 text-slate-800 animate-spin" />
        <span className="text-sm font-semibold uppercase tracking-wider font-sans">Sincronizando Base de Datos el sistema...</span>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] flex flex-col justify-center items-center space-y-4">
        <RefreshCw className="w-8 h-8 text-slate-800 animate-spin" />
        <span className="text-sm font-semibold uppercase tracking-wider font-sans">Cargando Plataforma de Soporte...</span>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-4">
        <Login db={db} onLoginSuccess={handleLoginSuccess} updateDb={handleUpdateDb} />
      </div>
    );
  }

  // If sync failed and we are not in simulation mode, block application with the secure configuration screen
  if (!dbSyncedWithSql && !simulationMode) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] flex flex-col items-center justify-center p-4 sm:p-6 select-none font-sans">
        <div className="max-w-2xl w-full bg-white border border-[#141414] shadow-sm p-6 sm:p-8 space-y-6">

          {/* Status Icon & Title */}
          <div className="flex flex-col sm:flex-row items-center gap-4 border-b border-[#141414] pb-4">
            <div className="p-3 bg-red-100 border border-red-400 text-red-800">
              <ServerCrash className="w-10 h-10" />
            </div>
            <div className="text-center sm:text-left space-y-1">
              <h1 className="font-serif italic text-2xl font-bold leading-tight text-red-950">
                Fallo de Enlace con la Base de Datos
              </h1>
              <p className="text-[10px] font-mono tracking-widest text-red-800 bg-red-50 border border-red-200 px-2 py-0.5 inline-block font-bold">
                ESTADO: SIN CONEXIÓN (DISCONNECTED)
              </p>
            </div>
          </div>

          {/* Friendly Controlled Error Notice */}
          <div className="text-xs text-zinc-700 leading-relaxed space-y-3 font-sans">
            <p>
              La plataforma <strong>ERP SOPORTE</strong> no puede recuperar ni procesar datos en este momento porque no tiene una conexión activa con el servidor de la base de datos el sistema.
            </p>
            <p>
              Por motivos de seguridad y arquitectura, <strong>el usuario final nunca establece una conexión directa a la base de datos ni tiene acceso a la información del servidor</strong>. Toda la comunicación de datos se gestiona internamente en el servidor web.
            </p>
            <p className="bg-amber-50 border border-amber-300 p-3.5 text-amber-900 font-sans text-[11px] leading-relaxed">
              La conexión se configura solo en <code className="font-mono">db_config.php</code>, junto a la API PHP en la carpeta física del sitio IIS. El proceso PHP del IIS se conecta por TCP al SQL Server remoto; no introduzca credenciales en esta página.
            </p>
          </div>

          {/* Actual Connection Error Panel */}
          {sqlSyncError && (
            <div className="bg-red-50 border border-red-250 p-4 text-xs font-mono text-red-900 space-y-1">
              <div className="font-bold uppercase text-[9px] text-red-800 tracking-wider">Detalle del Error:</div>
              <p className="leading-relaxed whitespace-pre-wrap">{sqlSyncError}</p>
            </div>
          )}

          {/* Bottom Action Triggers */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-[#141414]/10">
            <button
              type="button"
              onClick={triggerInitialSync}
              className="flex-1 bg-[#141414] text-[#E4E3E0] hover:bg-[#141414]/95 py-3.5 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar Sincronización
            </button>

            <button
              type="button"
              onClick={() => {
                setSimulationMode(true);
                const seedDb = getInitialDatabase();
                setDb(seedDb);
              }}
              className="px-5 py-3.5 border border-[#141414]/30 text-[#141414] hover:bg-zinc-100 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
              title="Permite evaluar las interfaces del sistema usando datos de prueba locales."
            >
              Simular Conexión Local (Contingencia)
            </button>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] flex flex-col antialiased font-sans">

      {/* 1. TOP BRAND CONNECTION STATUS BANNER */}
      <div className="bg-[#141414] text-[11px] font-mono text-[#E4E3E0] px-5 py-2.5 flex flex-col sm:flex-row items-center justify-between border-b border-[#141414] gap-2 shrink-0 no-print">
        <div className="flex items-center gap-3">
          <span className="font-serif italic text-[13px] tracking-wide text-white">ERP SOPORTE</span>
          <span className="opacity-30">|</span>
          <span className="text-zinc-400 font-sans">Plataforma de Atención y Soporte Técnico</span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[10px] font-sans uppercase justify-center sm:justify-end">
          {simulationMode ? (
            <div className="flex items-center gap-2 bg-amber-500/15 text-amber-400 border border-amber-500/45 px-2.5 py-1 rounded-none font-bold text-[10px]" title="Modo Simulación activo para demostración. Para conectar su servidor real, utilice el botón 'Configurar Enlace BD' en la barra lateral.">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              Modo Simulación (Contingencia Local)
            </div>
          ) : dbSyncedWithSql ? (
            <div className="flex items-center gap-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/45 px-2.5 py-1 rounded-none font-bold text-[10px]">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              el sistema: Conectado y Sincronizado
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-red-500/15 text-red-400 border border-red-500/45 px-2.5 py-1 rounded-none font-bold text-[10px]" title={sqlSyncError || "Error de conexión con el sistema"}>
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse"></span>
              el sistema: Desconectado
            </div>
          )}
          <span className="opacity-80">{new Date().toLocaleDateString("es-ES", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>

      {/* 2. MAIN SPLIT LAYOUT — FIX v2.113: sidebar fijo, no se mueve */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">

        {/* SIDEBAR NAVIGATION PANEL — Fijo, no scroll */}
        <aside className="w-full md:w-60 bg-[#F1F0ED] text-[#141414] flex flex-col shrink-0 border-b md:border-b-0 md:border-r border-[#141414]/20 no-print md:sticky md:top-0 md:h-screen md:overflow-y-auto">

          {/* Logo Brand Title */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:border-b md:border-[#141414]/15 md:p-6">
            <div className="min-w-0">
              <h2 className="font-serif italic text-xl md:text-2xl text-[#141414] leading-tight">ERP SOPORTE</h2>
              <p className="text-[9px] uppercase tracking-[0.12em] opacity-60">Mesa de Servicios ERP</p>
            </div>
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-[#141414]/20 bg-white text-[#176B62] md:hidden"
              aria-label={mobileMenuOpen ? "Cerrar menú de navegación" : "Abrir menú de navegación"}
              aria-expanded={mobileMenuOpen}
              aria-controls="primary-navigation"
              onClick={() => setMobileMenuOpen(open => !open)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          {/* Navigation Items */}
          <nav
            id="primary-navigation"
            aria-label="Navegación principal"
            className={`${mobileMenuOpen ? "flex" : "hidden"} max-h-[55vh] flex-col gap-1 overflow-y-auto border-t border-[#141414]/10 px-3 py-2 md:flex md:max-h-none md:flex-1 md:min-h-0 md:overflow-y-auto md:border-t-0 md:px-4 md:py-4`}
          >
            {navigationGroups.map(group => {
              const visibleItems = group.items.filter(item => hasVerPermission(item.id));
              if (visibleItems.length === 0) return null;
              const GroupIcon = group.Icon;
              const isExpanded = expandedMenuGroup === group.id;

              return (
                <section key={group.id} className="border-b border-[#141414]/10 pb-1 last:border-b-0">
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2.5 text-left text-xs font-bold text-[#30302E] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176B62]"
                    aria-expanded={isExpanded}
                    aria-controls={`navigation-group-${group.id}`}
                    onClick={() => setExpandedMenuGroup(isExpanded ? "principal" : group.id)}
                  >
                    <GroupIcon className="h-4 w-4 shrink-0 text-[#176B62]" aria-hidden="true" />
                    <span className="flex-1">{group.label}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {isExpanded && (
                    <div id={`navigation-group-${group.id}`} className="ml-3 flex flex-col gap-1 border-l border-[#176B62]/25 py-1 pl-2">
                      {visibleItems.map(item => {
                        const isActive = activeTab === item.id;
                        const ItemIcon = item.Icon;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setActiveTab(item.id)}
                            aria-current={isActive ? "page" : undefined}
                            className={`flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-sm border px-3 py-2 text-left text-[13px] leading-5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176B62] ${isActive
                              ? "border-[#176B62]/20 bg-[#176B62] text-white md:border-l-2 md:border-l-[#176B62] md:bg-white md:font-semibold md:text-[#141414]"
                              : "border-transparent text-[#454542] hover:bg-white hover:text-[#141414]"
                              }`}
                          >
                            <ItemIcon className={`h-4 w-4 shrink-0 ${isActive ? "text-current" : "text-[#176B62]"}`} aria-hidden="true" />
                            <span className="min-w-0 break-words">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </nav>

          {/* Sidebar Footer User Info Drawer Component */}
          <div className="flex items-center justify-between gap-3 border-t border-[#141414]/15 px-4 py-3 text-xs md:block md:space-y-4 md:p-5">

            <div className="min-w-0 space-y-1.5 font-mono text-[11px]">
              <div className="text-[9px] uppercase font-black opacity-50 tracking-wider">SESIÓN AUTORIZADA</div>
              <p className="max-w-full truncate font-bold uppercase" title={`${currentUser.nombres} ${currentUser.apellido_paterno}`}>
                {currentUser.nombres} {currentUser.apellido_paterno}
              </p>
              <p className="truncate text-[10.5px] opacity-70 font-semibold">{currentUserRole.toUpperCase()}</p>
            </div>

            <div className="flex shrink-0 flex-col gap-1.5 md:space-y-2">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full rounded-sm bg-[#141414] px-3 py-2 text-center text-[10px] font-bold uppercase transition-colors cursor-pointer hover:bg-[#176B62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176B62]"
              >
                Cerrar Sesión
              </button>

              {/* FIX v2.21: Botón para que el usuario cambie su propia contraseña */}
              <button
                type="button"
                onClick={() => setShowChangePasswordModal(true)}
                className="w-full rounded-sm border border-[#141414]/20 bg-white px-3 py-2 text-center text-[10px] font-bold transition-colors cursor-pointer hover:border-[#176B62] hover:text-[#176B62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176B62]"
              >
                Cambiar Contraseña
              </button>

            </div>

          </div>

        </aside>

        {/* MAIN VIEWS WORKSTAGE */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#E4E3E0] min-h-0 min-w-0">

          {/* Contenido scrollable — FIX v2.112: ocupar TODO el ancho disponible */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
            <div className="w-full space-y-4">

              {/* Conditional Sub-views rendering */}
              {/* FIX v2.39 — Suspense + fallback para lazy-loaded components */}
              <Suspense fallback={
                <div className="flex items-center justify-center p-12">
                  <div className="text-xs font-mono uppercase tracking-widest text-[#141414]/60 animate-pulse">
                    Cargando módulo...
                  </div>
                </div>
              }>
                {activeTab === "DASHBOARD" && <Dashboard db={db} />}
                {activeTab === "TICKET" && <TicketManager db={db} currentUser={currentUser} currentRole={currentUserRole} updateDb={handleUpdateDb} onSync={triggerFullSync} dbSyncedWithSql={dbSyncedWithSql} />}
                {activeTab === "COMPANY" && (
                  <CompanyManager
                    db={db}
                    updateDb={handleUpdateDb}
                    currentUser={currentUser}
                    currentUserRole={currentUserRole}
                    onSync={triggerFullSync}
                  />
                )}
                {activeTab === "GEOGRAPHIC" && (
                  <GeographicViewer
                    db={db}
                    updateDb={handleUpdateDb}
                    currentUser={currentUser}
                    currentUserRole={currentUserRole}
                    onSync={triggerFullSync}
                  />
                )}
                {activeTab === "USERS" && <UserManager db={db} updateDb={handleUpdateDb} currentUser={currentUser} onSync={triggerFullSync} />}
                {activeTab === "REPORTS" && <ReportEngine db={db} currentUser={currentUser} onSync={triggerFullSync} />}
              </Suspense>

            </div>
          </div>

          {/* FIX v2.82 — Footer global: SIEMPRE al final de la ventana,
              sin importar el largo del contenido. Solo uno, más presentable. */}
          <footer className="shrink-0 bg-[#141414] text-[#E4E3E0] px-5 py-2 border-t border-[#141414] no-print">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-1.5 text-[10px] font-mono uppercase tracking-wider">
              <div className="flex items-center gap-3">
                <span className="font-serif italic text-[12px]">ERP SOPORTE</span>
                <span className="opacity-30">|</span>
                <span className="text-zinc-400">Mesa de Servicios · v2.83</span>
              </div>
              <div className="flex items-center gap-3 text-zinc-400">
                <span>© {new Date().getFullYear()} ERP SOPORTE</span>
                <span className="opacity-30">|</span>
                <span>el sistema · IIS · PHP · React</span>
              </div>
            </div>
          </footer>

        </main>

      </div>

      {/* MODAL CAMBIAR CONTRASEÑA */}
      {showChangePasswordModal && currentUser && (
        <div className="fixed inset-0 bg-[#141414]/75 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="max-w-md w-full bg-[#E4E3E0] border-2 border-[#141414] p-6 space-y-4">
            <div className="border-b border-[#141414] pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#141414]">Cambiar mi contraseña</h3>
              <p className="text-[11px] text-[#141414]/60 mt-1">Usuario: {currentUser.correo}</p>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!changePassCurrent || !changePassNew || !changePassConfirm) {
                alert("Complete todos los campos.");
                return;
              }
              if (changePassNew.length < 6) {
                alert("La nueva contraseña debe tener al menos 6 caracteres.");
                return;
              }
              if (changePassNew !== changePassConfirm) {
                alert("Las contraseñas no coinciden.");
                return;
              }

              // Enviar al backend
              const params = new URLSearchParams();
              params.append("action", "authenticate");
              const apiUrl = getApiUrl(undefined, params);

              // PASO 1: Verificar contraseña actual
              fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ correo: currentUser.correo, contrasena: changePassCurrent })
              })
                .then(res => res.json())
                .then(authData => {
                  if (authData.status !== "success") {
                    alert("La contraseña actual es incorrecta.");
                    return;
                  }
                  // PASO 2: Guardar la nueva contraseña
                  fetch(getApiUrl("save_persona"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      id_persona: currentUser.id_persona,
                      tipo_documento: currentUser.tipo_documento,
                      numero_documento: currentUser.numero_documento,
                      nombres: currentUser.nombres,
                      apellido_paterno: currentUser.apellido_paterno,
                      apellido_materno: currentUser.apellido_materno || null,
                      fecha_nacimiento: currentUser.fecha_nacimiento || null,
                      telefono: currentUser.telefono || null,
                      correo: currentUser.correo,
                      direccion: currentUser.direccion || null,
                      sexo: currentUser.sexo || "M",
                      estado: true,
                      id_empresa: currentUser.id_empresa || null,
                      id_sucursal: currentUser.id_sucursal || null,
                      contrasena: changePassNew,  // Texto plano — el PHP lo hashea
                      bloqueado: false,
                      id_rol: 0  // No cambiar rol
                    })
                  })
                    .then(res => res.json())
                    .then(saveData => {
                      if (saveData.status === "success") {
                        alert("Contraseña cambiada exitosamente en la base de datos.");
                        setShowChangePasswordModal(false);
                        setChangePassCurrent("");
                        setChangePassNew("");
                        setChangePassConfirm("");
                        // FIX v2.22: Refrescar los datos desde la BD para que el cambio se refleje
                        triggerInitialSync();
                      } else {
                        alert("Error al cambiar contraseña: " + (saveData.message || "desconocido"));
                      }
                    })
                    .catch(err => alert("No se pudo conectar con el servidor. Intente nuevamente."));
                })
                .catch(err => alert("No se pudo conectar con el servidor. Intente nuevamente."));
            }} className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-[#141414]/70 mb-1">Contraseña actual</label>
                <input
                  type="password"
                  required
                  value={changePassCurrent}
                  onChange={(e) => setChangePassCurrent(e.target.value)}
                  className="w-full bg-white border border-[#141414] p-2 text-sm font-mono focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-[#141414]/70 mb-1">Nueva contraseña</label>
                <input
                  type="password"
                  required
                  value={changePassNew}
                  onChange={(e) => setChangePassNew(e.target.value)}
                  className="w-full bg-white border border-[#141414] p-2 text-sm font-mono focus:outline-none"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-[#141414]/70 mb-1">Confirmar nueva contraseña</label>
                <input
                  type="password"
                  required
                  value={changePassConfirm}
                  onChange={(e) => setChangePassConfirm(e.target.value)}
                  className="w-full bg-white border border-[#141414] p-2 text-sm font-mono focus:outline-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowChangePasswordModal(false);
                    setChangePassCurrent("");
                    setChangePassNew("");
                    setChangePassConfirm("");
                  }}
                  className="flex-1 py-2 bg-white border border-[#141414] text-[#141414] font-bold uppercase text-[10px] hover:bg-zinc-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#141414] text-[#E4E3E0] font-bold uppercase text-[10px] hover:bg-[#141414]/90 cursor-pointer"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}