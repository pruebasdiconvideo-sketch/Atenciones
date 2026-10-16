/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect } from "react";
import { MockDatabase } from "../db/mockDb";
import { Pais, TipoDivision, DivisionGeografica, Ubicacion, Persona, Empresa, EmpresaSucursal } from "../types";
import { getApiUrl as getDynamicApiUrl } from "../utils/api";
import { logTechnicalError } from "../utils/errorLogger";
import { 
  Globe, 
  Map, 
  MapPin, 
  Building2, 
  ChevronRight, 
  ChevronDown, 
  Compass, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  User,
  Plus,
  Edit,
  Trash2,
  Shield,
  Sliders,
  Search,
  Lock,
  Unlock,
  Settings,
  Check,
  X,
  Building,
  Mail,
  Phone,
  Layers,
  Database,
  ArrowRight,
  ShieldCheck,
  BookOpen
} from "lucide-react";

interface GeographicViewerProps {
  db: MockDatabase;
  updateDb?: (newDb: MockDatabase) => void;
  currentUser?: Persona | null;
  currentUserRole?: string;
  onSync?: () => void;
}

// ------------------------------------------------
// 0. Funciones auxiliares para API
// ------------------------------------------------
const isCloudSandbox = typeof window !== "undefined" && (
  window.location.hostname.endsWith(".run.app") || 
  window.location.hostname.endsWith(".google.com") || 
  window.location.hostname.includes("aistudio-preview")
);

const safeFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const hasCustomUrl = typeof window !== "undefined" && window.localStorage.getItem("iis_server_url");
  if (isCloudSandbox && !hasCustomUrl) {
    return Promise.resolve(new Response(JSON.stringify({ 
      status: "success", 
      message: "Simulation active",
      id_pais: 999,
      id_tipo_division: 999,
      id_division: 999
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
  }
  return window.fetch(input, init);
};

const getApiUrl = (action: string) => getDynamicApiUrl(action);

const handleApiResponse = async (response: Response, successMessage: string, errorMessage: string) => {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `${errorMessage} (HTTP ${response.status})`);
  }
  const data = await response.json();
  if (data.status !== "success") {
    throw new Error(data.message || errorMessage);
  }
  console.log(successMessage, data);
  return data;
};

// ------------------------------------------------
// Componente principal
// ------------------------------------------------
export function GeographicViewer({ db, updateDb, currentUser, currentUserRole, onSync }: GeographicViewerProps) {
  // -----------------------------------------------------------------
  // 1. DYNAMIC SECURITY & ACCESS PERMISSIONS CONTROL
  // -----------------------------------------------------------------
  const defaultPrivileges = useMemo(() => {
    if (!currentUser || !db) {
      return { SELECT: true, INSERT: false, UPDATE: false, DELETE: false, GRANT_ASSIGN: false };
    }
    const userAsignacion = db.asignacionesRoles?.find(a => a.id_persona === currentUser.id_persona);
    const userRoleId = userAsignacion ? userAsignacion.id_rol : null;

    if (userRoleId === 1) {
      return { SELECT: true, INSERT: true, UPDATE: true, DELETE: true, GRANT_ASSIGN: true };
    }

    const perms = db.systemConfig?.rolePermissions?.[userRoleId || 0]?.GEOGRAFIA;
    if (perms) {
      return {
        SELECT: !!perms.ver,
        INSERT: !!perms.registrar,
        UPDATE: !!perms.modificar,
        DELETE: !!perms.eliminar,
        GRANT_ASSIGN: !!perms.aprobar
      };
    }

    const role = currentUserRole ? currentUserRole.toLowerCase() : "visitante";
    if (role.includes("admin")) {
      return { SELECT: true, INSERT: true, UPDATE: true, DELETE: true, GRANT_ASSIGN: true };
    } else if (role.includes("superv")) {
      return { SELECT: true, INSERT: true, UPDATE: true, DELETE: false, GRANT_ASSIGN: true };
    } else if (role.includes("tecn") || role.includes("técn")) {
      return { SELECT: true, INSERT: false, UPDATE: false, DELETE: false, GRANT_ASSIGN: true };
    } else {
      return { SELECT: true, INSERT: false, UPDATE: false, DELETE: false, GRANT_ASSIGN: false };
    }
  }, [currentUser, db, currentUserRole]);

  const [privileges, setPrivileges] = useState({
    SELECT: true,
    INSERT: true,
    UPDATE: true,
    DELETE: true,
    GRANT_ASSIGN: true
  });

  useEffect(() => {
    setPrivileges(defaultPrivileges);
  }, [defaultPrivileges]);

  // Toast / System responses
  const [terminalLog, setTerminalLog] = useState<{ text: string; type: "success" | "error" | "info"; time: string }[]>([
    { text: "MSSQL SYSTEM INITIALIZED: Directorios geográficos cargados con aislamiento READ COMMITTED.", type: "info", time: new Date().toLocaleTimeString() }
  ]);

  const addLog = (text: string, type: "success" | "error" | "info" = "info") => {
    const time = new Date().toLocaleTimeString();
    setTerminalLog(prev => [{ text, type, time }, ...prev].slice(0, 5));
  };

  // -----------------------------------------------------------------
  // 2. ACTIVE VIEW TABS
  // -----------------------------------------------------------------
  const [currentTab, setCurrentTab] = useState<"EXPLORADOR" | "CONFIGURACION">("EXPLORADOR");

  // -----------------------------------------------------------------
  // 3. FLEXIBLE SCHEMAS CONFIGURATION STATE (PER-COUNTRY HIERARCHY)
  // -----------------------------------------------------------------
  const [countryHierarchies, setCountryHierarchies] = useState<{ [paisId: number]: number[] }>({
    1: [1, 2, 3],
    2: [1, 2, 3],
    3: [1, 3]
  });

  // ================================================================
  // ===== MAPA DE ASOCIACIÓN PAÍS-DIVISIÓN (persistente) =====
  // ================================================================
  // 1. Inicializar desde localStorage
  const [divisionPaisMap, setDivisionPaisMap] = useState<{ [divId: number]: number }>(() => {
    const saved = localStorage.getItem("GEOGRAPHIC_DIVISION_PAIS_MAP");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) { /* ignore */ }
    }
    // Valores por defecto para las divisiones raíz iniciales
    return { 1: 1, 6: 1, 9: 2 };
  });

  // 2. Guardar en localStorage cada vez que cambie
  useEffect(() => {
    localStorage.setItem("GEOGRAPHIC_DIVISION_PAIS_MAP", JSON.stringify(divisionPaisMap));
  }, [divisionPaisMap]);

  // ===== RECONSTRUCCIÓN AUTOMÁTICA DEL MAPA DESPUÉS DE SINCRONIZAR =====
  useEffect(() => {
    console.log('=== Reconstruyendo divisionPaisMap desde db ===');
    const rootDivs = db.divisionesGeograficas.filter(d => d.id_division_padre === null);
    console.log('Raíces encontradas:', rootDivs.map(r => ({ id: r.id_division, nombre: r.nombre })));

    setDivisionPaisMap(prev => {
      const newMap = { ...prev };
      
      // Eliminar entradas huérfanas (que ya no existen en db)
      const existingIds = new Set(db.divisionesGeograficas.map(d => d.id_division));
      Object.keys(newMap).forEach(key => {
        if (!existingIds.has(Number(key))) {
          delete newMap[Number(key)];
        }
      });

      // Agregar nuevas raíces sin asignación (asignar Perú por defecto)
      rootDivs.forEach(div => {
        if (!(div.id_division in newMap)) {
          console.log(`Asignando raíz '${div.nombre}' (ID ${div.id_division}) a Perú (ID 1) por defecto`);
          newMap[div.id_division] = 1;
        } else {
          console.log(`Raíz '${div.nombre}' (ID ${div.id_division}) ya tiene país ${newMap[div.id_division]}`);
        }
      });

      return newMap;
    });
  }, [db]); // Dependencia en todo el objeto db para detectar cambios tras sync_all

  // ===== SINCRONIZAR EXPANSIÓN DE PAÍSES =====
  useEffect(() => {
    setExpandedPaises(prev => {
      const newExpanded = { ...prev };
      db.paises.forEach(p => {
        if (!(p.id_pais in newExpanded)) {
          newExpanded[p.id_pais] = true;
        }
      });
      return newExpanded;
    });
  }, [db.paises]);

  // -----------------------------------------------------------------
  // 4. MAIN INTERACTIVE EXPANSION KEYS & SEARCH STRINGS
  // -----------------------------------------------------------------
  const [expandedPaises, setExpandedPaises] = useState<{ [key: number]: boolean }>(() => {
    const init: { [key: number]: boolean } = {};
    db.paises.forEach(p => { init[p.id_pais] = true; });
    return init;
  });
  const [expandedDivs, setExpandedDivs] = useState<{ [key: number]: boolean }>({});
  const [activeGeoType, setActiveGeoType] = useState<"ALL" | "PAIS" | "DIVISION">("ALL");
  const [activeGeoId, setActiveGeoId] = useState<number | null>(null);
  const [treeSearch, setTreeSearch] = useState("");

  // Modals visibility
  const [showPaisModal, setShowPaisModal] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showDivModal, setShowDivModal] = useState(false);
  const [showAssignedLocationModal, setShowAssignedLocationModal] = useState(false);

  // Editable objects / forms
  const [countryEditId, setCountryEditId] = useState<number | null>(null);
  const [countryFormName, setCountryFormName] = useState("");
  const [countryFormIso, setCountryFormIso] = useState("");

  const [typeEditId, setTypeEditId] = useState<number | null>(null);
  const [typeFormName, setTypeFormName] = useState("");

  const [divEditId, setDivEditId] = useState<number | null>(null);
  const [divFormNombre, setDivFormNombre] = useState("");
  const [divFormTipoId, setDivFormTipoId] = useState<number>(1);
  const [divFormPadreId, setDivFormPadreId] = useState<string>("null");
  const [divFormPaisId, setDivFormPaisId] = useState<number | null>(null);

  // -----------------------------------------------------------------
  // Helper functions
  // -----------------------------------------------------------------
  const getCountryOfDivision = (divId: number): number | null => {
    let current = db.divisionesGeograficas.find(dg => dg.id_division === divId);
    while (current && current.id_division_padre !== null) {
      current = db.divisionesGeograficas.find(dg => dg.id_division === current!.id_division_padre);
    }
    if (current) {
      return divisionPaisMap[current.id_division] || 1;
    }
    return null;
  };

  const getRootDivisionsOfPais = (paisId: number) => {
    return db.divisionesGeograficas.filter(d => {
      if (d.id_division_padre !== null) return false;
      const associatedPais = divisionPaisMap[d.id_division];
      return associatedPais === paisId;
    });
  };

  const getChildrenDivisions = (parentId: number) => {
    return db.divisionesGeograficas.filter(d => d.id_division_padre === parentId);
  };

  const getBreadcrumbPath = (divId: number | null): string => {
    if (divId === null) return "";
    const crumbs: string[] = [];
    let current = db.divisionesGeograficas.find(dg => dg.id_division === divId);
    while (current) {
      crumbs.unshift(current.nombre);
      current = db.divisionesGeograficas.find(dg => dg.id_division === current!.id_division_padre);
    }
    return crumbs.join(" ➔ ");
  };

  // -----------------------------------------------------------------
  // API ACTIONS: PAIS
  // -----------------------------------------------------------------
  const handleSaveCountry = async () => {
    if (!countryFormName || !countryFormIso) {
      alert("Por favor rellene todos los campos obligatorios.");
      return;
    }
    if (countryFormIso.length > 3) {
      alert("El código ISO del país debe tener un máximo de 3 caracteres.");
      return;
    }

    if (!updateDb) return;

    try {
      const payload = {
        id_pais: countryEditId || 0,
        nombre: countryFormName,
        codigo_iso: countryFormIso.toUpperCase()
      };

      const response = await safeFetch(getApiUrl("save_pais"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await handleApiResponse(response, "País guardado en SQL Server", "Error al guardar país en SQL Server");

      const nextDb = { ...db };
      if (countryEditId !== null) {
        nextDb.paises = db.paises.map(p =>
          p.id_pais === countryEditId ? { ...p, nombre: countryFormName, codigo_iso: countryFormIso.toUpperCase() } : p
        );
        addLog(`TRANSACCIÓN EXITOSA - País '${countryFormName}' actualizado en la base de datos.`, "success");
      } else {
        const newCountry: Pais = {
          id_pais: data.id_pais || (db.paises.length > 0 ? Math.max(...db.paises.map(p => p.id_pais)) + 1 : 1),
          nombre: countryFormName,
          codigo_iso: countryFormIso.toUpperCase()
        };
        nextDb.paises = [...db.paises, newCountry];
        setCountryHierarchies(prev => ({ ...prev, [newCountry.id_pais]: [1, 2, 3] }));
        addLog(`TRANSACCIÓN EXITOSA - Nuevo país registrado: '${countryFormName}' con código ISO '${countryFormIso.toUpperCase()}'.`, "success");
      }

      updateDb(nextDb);
      setShowPaisModal(false);


    } catch (error: any) {
      console.error("Error en handleSaveCountry:", error);
      alert(`❌ Error al guardar el país: ${error.message || "Intente nuevamente."}`);
      logTechnicalError(error, { url: getApiUrl("save_pais"), sqlStatus: "SAVE_PAIS_ERROR", currentUser });
    }
  };

  const handleDeleteCountry = async (id: number) => {
    if (!privileges.DELETE) {
      addLog("ACCESO RESTRINGIDO: No cuenta con privilegios para eliminar registros geográficos.", "error");
      alert("PERMISOS RESTRINGIDOS: Se requiere rol de nivel Administrador.");
      return;
    }

    const activeRoots = getRootDivisionsOfPais(id);
    if (activeRoots.length > 0) {
      const errorMsg = `VIOLACIÓN DE CLAVE FORÁNEA (FK_DIVISION_PAIS): Imposible eliminar el país ID ${id}. Se hallaron ${activeRoots.length} divisiones de primer nivel activas.`;
      addLog(errorMsg, "error");
      alert(errorMsg);
      return;
    }

    if (!confirm("¿Está seguro que desea eliminar este país de la base de datos de manera irreversible?")) return;
    if (!updateDb) return;

    try {
      const response = await safeFetch(getApiUrl("delete_pais"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_pais: id })
      });

      await handleApiResponse(response, "País eliminado de SQL Server", "Error al eliminar país en SQL Server");

      const nextDb = { ...db };
      nextDb.paises = db.paises.filter(p => p.id_pais !== id);
      setCountryHierarchies(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });

      updateDb(nextDb);
      addLog(`TRANSACCIÓN EXITOSA - País con ID ${id} eliminado correctamente del sistema.`, "success");


    } catch (error: any) {
      console.error("Error en handleDeleteCountry:", error);
      alert(`❌ Error al eliminar el país: ${error.message || "Intente nuevamente."}`);
      logTechnicalError(error, { url: getApiUrl("delete_pais"), sqlStatus: "DELETE_PAIS_ERROR", currentUser });
    }
  };

  // -----------------------------------------------------------------
  // API ACTIONS: TIPO DIVISION
  // -----------------------------------------------------------------
  const handleSaveType = async () => {
    if (!typeFormName) {
      alert("Ingrese el nombre del tipo de división.");
      return;
    }
    if (!updateDb) return;

    try {
      const payload = {
        id_tipo_division: typeEditId || 0,
        nombre: typeFormName
      };

      const response = await safeFetch(getApiUrl("save_tipo_division"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await handleApiResponse(response, "Tipo división guardado en SQL Server", "Error al guardar tipo división en SQL Server");

      const nextDb = { ...db };
      if (typeEditId !== null) {
        nextDb.tiposDivision = db.tiposDivision.map(t =>
          t.id_tipo_division === typeEditId ? { ...t, nombre: typeFormName } : t
        );
        addLog(`TRANSACCIÓN EXITOSA - Tipo de división '${typeFormName}' actualizado en catálogo.`, "success");
      } else {
        const newType: TipoDivision = {
          id_tipo_division: data.id_tipo_division || (db.tiposDivision.length > 0 ? Math.max(...db.tiposDivision.map(t => t.id_tipo_division)) + 1 : 1),
          nombre: typeFormName
        };
        nextDb.tiposDivision = [...db.tiposDivision, newType];
        addLog(`TRANSACCIÓN EXITOSA - Nuevo tipo de división '${typeFormName}' insertado en catálogo.`, "success");
      }

      updateDb(nextDb);
      setShowTypeModal(false);


    } catch (error: any) {
      console.error("Error en handleSaveType:", error);
      alert(`❌ Error al guardar el tipo de división: ${error.message || "Intente nuevamente."}`);
      logTechnicalError(error, { url: getApiUrl("save_tipo_division"), sqlStatus: "SAVE_TIPO_DIVISION_ERROR", currentUser });
    }
  };

  const handleDeleteType = async (id: number) => {
    if (!privileges.DELETE) {
      alert("No autorizado.");
      return;
    }

    const boundDivisions = db.divisionesGeograficas.filter(d => d.id_tipo_division === id);
    if (boundDivisions.length > 0) {
      const msg = `INTEGRITY CONSTRAINT VIOLATION: Imposible borrar. ${boundDivisions.length} divisiones de la tabla 'divisionesGeograficas' poseen este tipo.`;
      addLog(msg, "error");
      alert(msg);
      return;
    }

    if (!confirm("¿Desea eliminar este tipo administrativo del sistema?")) return;
    if (!updateDb) return;

    try {
      const response = await safeFetch(getApiUrl("delete_tipo_division"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_tipo_division: id })
      });

      await handleApiResponse(response, "Tipo división eliminado de SQL Server", "Error al eliminar tipo división en SQL Server");

      const nextDb = { ...db };
      nextDb.tiposDivision = db.tiposDivision.filter(t => t.id_tipo_division !== id);
      updateDb(nextDb);
      addLog(`TRANSACCIÓN EXITOSA - Tipo de división ID ${id} eliminado del catálogo.`, "success");


    } catch (error: any) {
      console.error("Error en handleDeleteType:", error);
      alert(`❌ Error al eliminar el tipo de división: ${error.message || "Intente nuevamente."}`);
      logTechnicalError(error, { url: getApiUrl("delete_tipo_division"), sqlStatus: "DELETE_TIPO_DIVISION_ERROR", currentUser });
    }
  };

  // -----------------------------------------------------------------
  // API ACTIONS: DIVISION GEOGRAFICA
  // -----------------------------------------------------------------
  const handleSaveDiv = async () => {
    if (!divFormNombre) {
      alert("Rellene el nombre de la división geográfica.");
      return;
    }
    if (!updateDb) return;

    const parentIdNumeric = divFormPadreId === "null" ? null : Number(divFormPadreId);

    // Si es raíz, el país es obligatorio
    if (parentIdNumeric === null && (divFormPaisId === null || divFormPaisId === undefined)) {
      alert("Debe seleccionar un país de destino para la división raíz.");
      return;
    }

    // Consistency checks
    if (parentIdNumeric !== null) {
      const parentNode = db.divisionesGeograficas.find(dg => dg.id_division === parentIdNumeric);
      if (!parentNode) {
        alert("Error de consistencia SQL: La división superior seleccionada no existe.");
        return;
      }
      if (divEditId !== null && parentIdNumeric === divEditId) {
        alert("Error de consistencia SQL: Una división no puede ser superior a sí misma.");
        return;
      }
      const selectedCountryId = divFormPaisId || getCountryOfDivision(parentIdNumeric) || 1;
      const config = countryHierarchies[selectedCountryId] || [1, 2, 3];
      const parentTypeIndex = config.indexOf(parentNode.id_tipo_division);
      const currentTypeIndex = config.indexOf(divFormTipoId);
      if (currentTypeIndex !== -1 && parentTypeIndex !== -1 && currentTypeIndex <= parentTypeIndex) {
        const msg = `CONSISTENCIA RECHAZADA: La división superior '${parentNode.nombre}' posee un nivel jerárquico igual o de menor generalidad.`;
        addLog(msg, "error");
        alert(msg);
        return;
      }
    }

    try {
      const payload = {
        id_division: divEditId || 0,
        nombre: divFormNombre,
        id_tipo_division: divFormTipoId,
        id_division_padre: parentIdNumeric,
        id_pais: divFormPaisId
      };

      const response = await safeFetch(getApiUrl("save_division"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await handleApiResponse(response, "División guardada en SQL Server", "Error al guardar división en SQL Server");

      // Verificar que la respuesta contenga el ID de la división
      if (!data.id_division) {
        throw new Error("La respuesta del servidor no incluye el ID de la división creada.");
      }

      const realId = data.id_division;
      const nextDb = { ...db };

      if (divEditId !== null) {
        // UPDATE
        nextDb.divisionesGeograficas = db.divisionesGeograficas.map(d =>
          d.id_division === divEditId
            ? { ...d, nombre: divFormNombre, id_tipo_division: divFormTipoId, id_division_padre: parentIdNumeric }
            : d
        );
        if (parentIdNumeric === null && divFormPaisId !== null && divFormPaisId !== undefined) {
          setDivisionPaisMap(prev => {
            const newMap = { ...prev };
            newMap[divEditId] = divFormPaisId;
            return newMap;
          });
        } else if (parentIdNumeric === null) {
          setDivisionPaisMap(prev => {
            const c = { ...prev };
            delete c[divEditId];
            return c;
          });
        } else {
          setDivisionPaisMap(prev => {
            const c = { ...prev };
            delete c[divEditId];
            return c;
          });
        }
        addLog(`TRANSACCIÓN EXITOSA - División geográfica '${divFormNombre}' actualizada.`, "success");
      } else {
        // INSERT - usar el ID real devuelto por la API
        const newDiv: DivisionGeografica = {
          id_division: realId,
          nombre: divFormNombre,
          id_tipo_division: divFormTipoId,
          id_division_padre: parentIdNumeric
        };
        nextDb.divisionesGeograficas = [...db.divisionesGeograficas, newDiv];
        
        // Actualizar el mapa con el ID real
        if (parentIdNumeric === null && divFormPaisId !== null && divFormPaisId !== undefined) {
          setDivisionPaisMap(prev => ({ ...prev, [realId]: divFormPaisId }));
        } else if (parentIdNumeric === null) {
          // Si es raíz pero no tiene país asignado, asignar Perú por defecto
          setDivisionPaisMap(prev => {
            if (!(realId in prev)) {
              return { ...prev, [realId]: 1 };
            }
            return prev;
          });
        }
        
        // Expandir el nodo padre para que la nueva división sea visible
        if (parentIdNumeric !== null) {
          setExpandedDivs(prev => ({ ...prev, [parentIdNumeric]: true }));
        }
        
        addLog(`TRANSACCIÓN EXITOSA - Nueva división '${divFormNombre}' registrada con ID ${realId}.`, "success");
      }

      updateDb(nextDb);
      setShowDivModal(false);
      // FIX v2.24: No llamar onSync() — eso recarga toda la página y desmonta el componente.
      // Los datos ya se guardaron en SQL Server y se actualizaron en el estado local.

    } catch (error: any) {
      console.error("Error en handleSaveDiv:", error);
      alert(`❌ Error al guardar la división: ${error.message || "Intente nuevamente."}`);
      logTechnicalError(error, { url: getApiUrl("save_division"), sqlStatus: "SAVE_DIVISION_ERROR", currentUser });
    }
  };

  const handleDeleteDiv = async (id: number) => {
    if (!privileges.DELETE) {
      alert("No autorizado.");
      return;
    }

    const childDivs = getChildrenDivisions(id);
    if (childDivs.length > 0) {
      const errorMsg = `CONSTRAINT ERROR: Imposible eliminar '${db.divisionesGeograficas.find(dg => dg.id_division === id)?.nombre}'. Existen ${childDivs.length} subdivisiones.`;
      addLog(errorMsg, "error");
      alert(errorMsg);
      return;
    }

    const boundLocations = db.ubicaciones.filter(u => u.id_division === id);
    if (boundLocations.length > 0) {
      const errorMsg = `CONSTRAINT ERROR: Imposible eliminar. Referenciado en ${boundLocations.length} registros de 'ubicaciones'.`;
      addLog(errorMsg, "error");
      alert(errorMsg);
      return;
    }

    if (!confirm("¿Desea eliminar permanentemente esta división geográfica?")) return;
    if (!updateDb) return;

    try {
      const response = await safeFetch(getApiUrl("delete_division"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_division: id })
      });

      await handleApiResponse(response, "División eliminada de SQL Server", "Error al eliminar división en SQL Server");

      const nextDb = { ...db };
      nextDb.divisionesGeograficas = db.divisionesGeograficas.filter(d => d.id_division !== id);
      setDivisionPaisMap(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });

      updateDb(nextDb);
      addLog(`TRANSACCIÓN EXITOSA - División geográfica ID ${id} eliminada.`, "success");


    } catch (error: any) {
      console.error("Error en handleDeleteDiv:", error);
      alert(`❌ Error al eliminar la división: ${error.message || "Intente nuevamente."}`);
      logTechnicalError(error, { url: getApiUrl("delete_division"), sqlStatus: "DELETE_DIVISION_ERROR", currentUser });
    }
  };

  // -----------------------------------------------------------------
  // Handlers para abrir modales
  // -----------------------------------------------------------------
  const handleOpenCountryModal = (pais: Pais | null) => {
    if (pais) {
      if (!privileges.UPDATE) {
        addLog("ACCESO RESTRINGIDO: No cuenta con permisos para modificar registros geográficos.", "error");
        alert("PERMISOS RESTRINGIDOS: No cuenta con privilegios para modificar directorios.");
        return;
      }
      setCountryEditId(pais.id_pais);
      setCountryFormName(pais.nombre);
      setCountryFormIso(pais.codigo_iso);
    } else {
      if (!privileges.INSERT) {
        addLog("ACCESO RESTRINGIDO: No cuenta con permisos para registrar nuevos registros geográficos.", "error");
        alert("PERMISOS RESTRINGIDOS: No tiene privilegios de creación.");
        return;
      }
      setCountryEditId(null);
      setCountryFormName("");
      setCountryFormIso("");
    }
    setShowPaisModal(true);
  };

  const handleOpenTypeModal = (type: TipoDivision | null) => {
    if (type) {
      if (!privileges.UPDATE) {
        alert("Sin privilegios de modificación.");
        return;
      }
      setTypeEditId(type.id_tipo_division);
      setTypeFormName(type.nombre);
    } else {
      if (!privileges.INSERT) {
        alert("Sin privilegios de inserción.");
        return;
      }
      setTypeEditId(null);
      setTypeFormName("");
    }
    setShowTypeModal(true);
  };

  const handleOpenDivModal = (div: DivisionGeografica | null, defaultParentId?: number, defaultPaisId?: number) => {
    if (div) {
      if (!privileges.UPDATE) {
        alert("Sin privilegios de edición.");
        return;
      }
      setDivEditId(div.id_division);
      setDivFormNombre(div.nombre);
      setDivFormTipoId(div.id_tipo_division);
      setDivFormPadreId(div.id_division_padre === null ? "null" : String(div.id_division_padre));
      setDivFormPaisId(getCountryOfDivision(div.id_division) || 1);
    } else {
      if (!privileges.INSERT) {
        alert("Sin privilegios de registro.");
        return;
      }
      setDivEditId(null);
      setDivFormNombre("");
      setDivFormTipoId(1);
      setDivFormPadreId(defaultParentId !== undefined ? String(defaultParentId) : "null");
      setDivFormPaisId(defaultPaisId !== undefined ? defaultPaisId : null);
    }
    setShowDivModal(true);
  };

  // -----------------------------------------------------------------
  // 5. REGIONAL STATS
  // -----------------------------------------------------------------
  const regionalMetrics = useMemo(() => {
    const matchedTickets = db.tickets.filter((t) => {
      if (activeGeoType === "ALL") return true;
      const company = db.empresas.find(e => e.id_empresa === t.id_empresa);
      if (!company) return false;
      const ubi = db.ubicaciones.find(u => u.id_ubicacion === company.id_ubicacion);
      if (!ubi) return false;
      if (activeGeoType === "PAIS") {
        const countryId = getCountryOfDivision(ubi.id_division);
        return countryId === activeGeoId;
      }
      let currentId: number | null = ubi.id_division;
      while (currentId !== null) {
        if (currentId === activeGeoId) return true;
        const currentDg = db.divisionesGeograficas.find(dg => dg.id_division === currentId);
        currentId = currentDg ? currentDg.id_division_padre : null;
      }
      return false;
    });

    const total = matchedTickets.length;
    const pending = matchedTickets.filter(t => t.estado === "PENDIENTE" || t.estado === "REABIERTO").length;
    const active = matchedTickets.filter(t => t.estado === "EN_ATENCION").length;
    const resolved = matchedTickets.filter(t => t.estado === "RESUELTO" || t.estado === "CERRADO").length;

    const branchesInScope = db.sucursales.filter(s => {
      if (activeGeoType === "ALL") return true;
      const u = db.ubicaciones.find(ub => ub.id_ubicacion === s.id_ubicacion);
      if (!u) return false;
      if (activeGeoType === "PAIS") {
        return getCountryOfDivision(u.id_division) === activeGeoId;
      }
      let currentId: number | null = u.id_division;
      while (currentId !== null) {
        if (currentId === activeGeoId) return true;
        const currentDg = db.divisionesGeograficas.find(dg => dg.id_division === currentId);
        currentId = currentDg ? currentDg.id_division_padre : null;
      }
      return false;
    });

    return {
      tickets: matchedTickets,
      total,
      pending,
      active,
      resolved,
      branchesCount: branchesInScope.length,
      branchesList: branchesInScope
    };
  }, [db, activeGeoType, activeGeoId]);

  const filteredPaises = useMemo(() => {
    if (!treeSearch) return db.paises;
    const q = treeSearch.toLowerCase();
    return db.paises.filter(p => {
      const matchName = p.nombre.toLowerCase().includes(q) || p.codigo_iso.toLowerCase().includes(q);
      const matchedDivs = db.divisionesGeograficas.filter(d =>
        getCountryOfDivision(d.id_division) === p.id_pais && d.nombre.toLowerCase().includes(q)
      );
      return matchName || matchedDivs.length > 0;
    });
  }, [db, treeSearch]);

  const activeGeoName = useMemo(() => {
    if (activeGeoType === "ALL") return "La Red de Soporte LATAM";
    if (activeGeoType === "PAIS") {
      return db.paises.find(p => p.id_pais === activeGeoId)?.nombre || "País Desconocido";
    }
    return db.divisionesGeograficas.find(dg => dg.id_division === activeGeoId)?.nombre || "División Desconocida";
  }, [db, activeGeoType, activeGeoId]);

  // -----------------------------------------------------------------
  // 6. ASSISTED ASSIGNMENT (playground)
  // -----------------------------------------------------------------
  const [assignTargetType, setAssignTargetType] = useState<"EMPRESA" | "SUCURSAL" | "PERSONA">("EMPRESA");
  const [assignTargetId, setAssignTargetId] = useState<number>(1);
  const [assignCalle, setAssignCalle] = useState("");
  const [assignReferencia, setAssignReferencia] = useState("");
  const [modalCountryId, setModalCountryId] = useState<number>(1);
  const [modalSelections, setModalSelections] = useState<{ [levelIndex: number]: number | null }>({});

  const currentModalHierarchy = countryHierarchies[modalCountryId] || [1, 2, 3];

  const modalValidationStatus = useMemo(() => {
    const totalRequiredLevels = currentModalHierarchy.length;
    const selectedLevelsCount = Object.keys(modalSelections).filter(k => modalSelections[Number(k)] !== null).length;

    if (selectedLevelsCount === 0) {
      return { ok: false, label: "Pendiente: Seleccione los niveles geográficos desde la raíz.", color: "text-amber-800 bg-amber-50" };
    }
    if (selectedLevelsCount < totalRequiredLevels) {
      return { ok: false, label: `Incompleto: Ha definido ${selectedLevelsCount} de ${totalRequiredLevels} niveles.`, color: "text-amber-800 bg-amber-50" };
    }

    for (let i = 1; i < totalRequiredLevels; i++) {
      const childId = modalSelections[i];
      const parentId = modalSelections[i - 1];
      if (childId && parentId) {
        const cDg = db.divisionesGeograficas.find(dg => dg.id_division === childId);
        if (!cDg || cDg.id_division_padre !== parentId) {
          return { ok: false, label: "Falla de integridad: Nivel geográfico no coincide con la jerarquía.", color: "text-red-800 bg-red-50" };
        }
      }
    }

    const finalLeafDivId = modalSelections[totalRequiredLevels - 1];
    const finalDivName = db.divisionesGeograficas.find(dg => dg.id_division === finalLeafDivId)?.nombre || "";

    return {
      ok: true,
      label: `Consistencia validada: Jerarquía ${db.paises.find(p => p.id_pais === modalCountryId)?.nombre} ➔ ${getBreadcrumbPath(finalLeafDivId)} aprobada.`,
      color: "text-emerald-800 bg-emerald-50/70 border border-emerald-500/25"
    };
  }, [db, modalCountryId, modalSelections, currentModalHierarchy]);

  const handleAssignLocationTransaction = () => {
    if (!privileges.GRANT_ASSIGN) {
      alert("Su cuenta actual no goza de privilegios 'GRANT_ASSIGN_LOCATION' para vincular direcciones.");
      return;
    }
    if (!modalValidationStatus.ok) {
      alert("No se puede proceder: La jerarquía de selección es inconsistente o se encuentra incompleta.");
      return;
    }
    if (!assignCalle) {
      alert("Indique la dirección detallada o número para registrar la ubicación.");
      return;
    }

    if (!updateDb) return;
    const nextDb = { ...db };

    const totalRequiredLevels = currentModalHierarchy.length;
    const finalDivId = modalSelections[totalRequiredLevels - 1];

    if (!finalDivId) {
      alert("Error: No se halló el ID de división de cierre.");
      return;
    }

    const nextUbiId = db.ubicaciones.length > 0 ? Math.max(...db.ubicaciones.map(u => u.id_ubicacion)) + 1 : 1;
    const newUbi: Ubicacion = {
      id_ubicacion: nextUbiId,
      direccion: assignCalle,
      referencia: assignReferencia || null,
      id_division: finalDivId
    };
    nextDb.ubicaciones.push(newUbi);

    if (assignTargetType === "EMPRESA") {
      nextDb.empresas = db.empresas.map(e =>
        e.id_empresa === assignTargetId ? { ...e, id_ubicacion: nextUbiId } : e
      );
      addLog(`Vinculando ubicación ID ${nextUbiId} a la empresa ID ${assignTargetId}`, "success");
    } else if (assignTargetType === "SUCURSAL") {
      nextDb.sucursales = db.sucursales.map(s =>
        s.id_sucursal === assignTargetId ? { ...s, id_ubicacion: nextUbiId } : s
      );
      addLog(`Vinculando ubicación ID ${nextUbiId} a la sucursal ID ${assignTargetId}`, "success");
    } else {
      nextDb.personas = db.personas.map(p =>
        p.id_persona === assignTargetId ? { ...p, direccion: `${assignCalle} (Ref: ${assignReferencia || 'Sin desc'})` } : p
      );
      addLog(`Vinculando dirección a la persona ID ${assignTargetId}`, "success");
    }

    updateDb(nextDb);
    setShowAssignedLocationModal(false);
    addLog(`Nueva dirección física vinculada exitosamente con ID #${nextUbiId}.`, "success");
    alert("¡DIRECCIÓN ASIGNADA CON ÉXITO! La vinculación geográfica y de dirección se han actualizado correctamente.");

  };

  // ================================================================
  // DIAGNÓSTICO EN CONSOLA
  // ================================================================
  useEffect(() => {
    console.log('=== DIAGNÓSTICO GEOGRÁFICO ===');
    const roots = db.divisionesGeograficas.filter(d => d.id_division_padre === null);
    console.log('Divisiones raíz:', roots.map(r => ({ id: r.id_division, nombre: r.nombre })));
    console.log('divisionPaisMap:', divisionPaisMap);
    console.log('Países:', db.paises.map(p => ({ id: p.id_pais, nombre: p.nombre })));
  }, [db.divisionesGeograficas, divisionPaisMap]);

  // -----------------------------------------------------------------
  // RENDER - COMPLETO
  // -----------------------------------------------------------------
  return (
    <div className="space-y-6 text-[#141414]">
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b-2 border-[#141414] pb-4 gap-4">
        <div>
          <span className="bg-[#141414] text-[#E4E3E0] text-[9.5px] uppercase font-bold tracking-widest px-2 py-0.5 font-mono mb-2 inline-block">
            Módulo SQL de Integridad Geolocalizada
          </span>
          <h2 className="text-3xl font-serif italic text-[#141414] leading-tight">Directorios Geográficos</h2>
          <p className="text-[10px] uppercase font-bold tracking-widest text-[#141414]/70 mt-1">
            Gestión independiente de países, divisiones jerárquicas y consistencia territorial.
          </p>
        </div>
        <div className="flex items-center gap-2.5 bg-white/40 border border-[#141414]/15 px-3.5 py-2 text-xs font-mono text-zinc-700">
          <Shield className="w-4 h-4 text-slate-800" />
          <span>PRIVILEGIOS ACTIVOS DEL ROL: <strong className="text-[#141414] uppercase">{currentUserRole || "VISITANTE"}</strong></span>
        </div>
      </div>

      {/* TABS */}
      <div className="flex border-b border-[#141414] gap-1">
        {[
          { key: "EXPLORADOR", label: "📊 EXPLORADOR Y CRUD", icon: Compass },
          { key: "CONFIGURACION", label: "⚙️ CONFIGURACIÓN DE NIVELES", icon: Sliders }
        ].map((tab) => {
          const isActive = currentTab === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setCurrentTab(tab.key as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-mono font-bold uppercase transition-all tracking-wider border-t border-x cursor-pointer ${
                isActive 
                  ? "bg-[#141414] text-[#E4E3E0] border-[#141414]" 
                  : "bg-white/40 text-[#141414]/70 border-transparent hover:bg-white/80"
              }`}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* FIX v2.116 — Bitácora de transacciones eliminada del módulo geográfico. */}

      {!privileges.SELECT ? (
        <div className="p-16 border border-red-250 bg-red-50 text-center space-y-2">
          <Lock className="w-10 h-10 text-red-700 mx-auto" />
          <h3 className="font-serif italic text-lg text-red-900">ACCESO RESTRINGIDO - SELECT DENIED</h3>
          <p className="text-xs font-mono text-red-700 max-w-md mx-auto">Su perfil actual o permisos revocados no permiten examinar los directorios territoriales.</p>
        </div>
      ) : (
        <>
          {currentTab === "EXPLORADOR" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* TREE PANEL */}
              <div className="bg-white border border-[#141414] rounded-none p-5 lg:col-span-1 space-y-4">
                <div className="flex items-center justify-between border-b border-[#141414]/20 pb-2 gap-4">
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-[#141414]/70" />
                    <span className="font-bold text-xs uppercase font-mono">Estructura Jerárquica</span>
                  </div>
                  {privileges.INSERT && (
                    <button
                      onClick={() => handleOpenCountryModal(null)}
                      className="p-1 border border-[#141414] bg-zinc-150 hover:bg-[#141414] hover:text-[#E4E3E0] text-[9.5px] font-mono font-bold uppercase transition-colors cursor-pointer"
                      title="Registrar nuevo País"
                    >
                      + País
                    </button>
                  )}
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={treeSearch}
                    onChange={(e) => setTreeSearch(e.target.value)}
                    placeholder="Filtrar territorio..."
                    className="w-full bg-slate-50 border border-slate-300 p-2 pl-8 text-xs font-mono focus:outline-none placeholder-slate-400"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                </div>

                <div className="space-y-3.5 max-h-[500px] overflow-y-auto pr-1">
                  <div 
                    onClick={() => {
                      setActiveGeoType("ALL");
                      setActiveGeoId(null);
                    }}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                      activeGeoType === "ALL" ? "bg-[#141414]/90 text-white font-bold" : "hover:bg-slate-100 font-semibold"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase">🗺️ Corporación LATAM (Raíz)</span>
                    <span className="text-[9.5px] px-1 bg-zinc-300 text-zinc-900 border border-zinc-400">{db.paises.length} P</span>
                  </div>

                  <div className="pl-2 space-y-3 border-l border-[#141414]/15 ml-2">
                    {filteredPaises.map((pais) => {
                      const isExpanded = !!expandedPaises[pais.id_pais];
                      const roots = getRootDivisionsOfPais(pais.id_pais);
                      const isCurrent = activeGeoType === "PAIS" && activeGeoId === pais.id_pais;

                      return (
                        <div key={pais.id_pais} className="space-y-1.5 font-mono text-xs">
                          <div className="flex items-center justify-between py-1 group hover:bg-[#141414]/5 px-1">
                            <div 
                              onClick={() => {
                                setExpandedPaises(prev => ({ ...prev, [pais.id_pais]: !prev[pais.id_pais] }));
                                setActiveGeoType("PAIS");
                                setActiveGeoId(pais.id_pais);
                              }}
                              className={`flex items-center gap-1.5 cursor-pointer flex-1 truncate ${
                                isCurrent ? "text-indigo-800 font-bold underline underline-offset-2" : "text-[#141414] font-semibold"
                              }`}
                            >
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                              <Globe className="w-3.5 h-3.5 text-slate-600 inline-block" />
                              <span>{pais.nombre.toUpperCase()}</span>
                              <span className="text-[9.5px] text-[#141414]/55">({pais.codigo_iso})</span>
                            </div>
                            <div className="hidden group-hover:flex items-center gap-1 ml-1 shrink-0">
                              {privileges.INSERT && (
                                <button 
                                  onClick={() => handleOpenDivModal(null, undefined, pais.id_pais)} 
                                  className="text-[9px] px-1 bg-slate-200 border border-[#141414]/15 hover:bg-[#141414] hover:text-white"
                                  title="Añadir división de 1er nivel"
                                >
                                  + Div
                                </button>
                              )}
                              {privileges.UPDATE && (
                                <button onClick={() => handleOpenCountryModal(pais)} className="text-slate-600 hover:text-indigo-600"><Edit className="w-3 h-3" /></button>
                              )}
                              {privileges.DELETE && (
                                <button onClick={() => handleDeleteCountry(pais.id_pais)} className="text-slate-500 hover:text-red-700"><Trash2 className="w-3 h-3" /></button>
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="pl-4 border-l border-dashed border-slate-300 space-y-2">
                              {roots.map((root) => {
                                const isRootExpanded = !!expandedDivs[root.id_division];
                                const subProvincias = getChildrenDivisions(root.id_division);
                                const isDivCurrent = activeGeoType === "DIVISION" && activeGeoId === root.id_division;

                                return (
                                  <div key={root.id_division} className="space-y-1">
                                    <div className="flex items-center justify-between group hover:bg-[#141414]/5 py-0.5 px-0.5">
                                      <div 
                                        onClick={() => {
                                          setExpandedDivs(prev => ({ ...prev, [root.id_division]: !prev[root.id_division] }));
                                          setActiveGeoType("DIVISION");
                                          setActiveGeoId(root.id_division);
                                        }}
                                        className={`flex items-center gap-1 cursor-pointer flex-1 text-[11px] ${
                                          isDivCurrent ? "text-indigo-900 font-bold" : "text-slate-800"
                                        }`}
                                      >
                                        {isRootExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                        <span className="w-1.5 h-1.5 bg-[#141414]/70 shrink-0" />
                                        <span className="truncate">{root.nombre}</span>
                                      </div>
                                      <div className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
                                        {privileges.INSERT && (
                                          <button 
                                            onClick={() => handleOpenDivModal(null, root.id_division, pais.id_pais)}
                                            className="text-[9px] px-1 bg-zinc-200 border border-[#141414]/20 hover:bg-zinc-800 hover:text-white"
                                            title="Añadir división de 2do nivel"
                                          >
                                            + Sub
                                          </button>
                                        )}
                                        {privileges.UPDATE && (
                                          <button onClick={() => handleOpenDivModal(root)} className="text-slate-600 hover:text-indigo-600"><Edit className="w-3 h-3" /></button>
                                        )}
                                        {privileges.DELETE && (
                                          <button onClick={() => handleDeleteDiv(root.id_division)} className="text-slate-500 hover:text-red-700"><Trash2 className="w-3 h-3" /></button>
                                        )}
                                      </div>
                                    </div>

                                    {isRootExpanded && (
                                      <div className="pl-4 border-l border-dotted border-slate-300 space-y-1">
                                        {subProvincias.map((prov) => {
                                          const isProvExpanded = !!expandedDivs[prov.id_division];
                                          const subDistritos = getChildrenDivisions(prov.id_division);
                                          const isProvCurrent = activeGeoType === "DIVISION" && activeGeoId === prov.id_division;

                                          return (
                                            <div key={prov.id_division} className="space-y-1">
                                              <div className="flex items-center justify-between group hover:bg-[#141414]/5 py-0.5 px-0.5">
                                                <div 
                                                  onClick={() => {
                                                    setExpandedDivs(prev => ({ ...prev, [prov.id_division]: !prev[prov.id_division] }));
                                                    setActiveGeoType("DIVISION");
                                                    setActiveGeoId(prov.id_division);
                                                  }}
                                                  className={`flex items-center gap-1 cursor-pointer flex-1 text-[10.5px] ${
                                                    isProvCurrent ? "text-indigo-900 font-bold" : "text-slate-600 font-medium"
                                                  }`}
                                                >
                                                  {isProvExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                                                  <span className="italic">├─ {prov.nombre}</span>
                                                </div>
                                                <div className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
                                                  {privileges.INSERT && (
                                                    <button 
                                                      onClick={() => handleOpenDivModal(null, prov.id_division, pais.id_pais)}
                                                      className="text-[9px] px-1 bg-zinc-200 border border-[#141414]/20 hover:bg-zinc-800 hover:text-white"
                                                      title="Añadir nivel de distrito / ciudad"
                                                    >
                                                      + Sub
                                                    </button>
                                                  )}
                                                  {privileges.UPDATE && (
                                                    <button onClick={() => handleOpenDivModal(prov)} className="text-slate-600 hover:text-indigo-600"><Edit className="w-3 h-3" /></button>
                                                  )}
                                                  {privileges.DELETE && (
                                                    <button onClick={() => handleDeleteDiv(prov.id_division)} className="text-slate-400 hover:text-red-700"><Trash2 className="w-3 h-3" /></button>
                                                  )}
                                                </div>
                                              </div>

                                              {isProvExpanded && (
                                                <div className="pl-4 border-l border-zinc-300 space-y-0.5">
                                                  {subDistritos.map((dist) => {
                                                    const isDistCurrent = activeGeoType === "DIVISION" && activeGeoId === dist.id_division;

                                                    return (
                                                      <div 
                                                        key={dist.id_division}
                                                        className="flex items-center justify-between group hover:bg-[#141414]/10 py-1.5 px-1.5 rounded transition-colors"
                                                      >
                                                        <div 
                                                          onClick={() => {
                                                            setActiveGeoType("DIVISION");
                                                            setActiveGeoId(dist.id_division);
                                                          }}
                                                          className={`flex items-center gap-1 cursor-pointer flex-1 text-[10px] uppercase ${
                                                            isDistCurrent ? "text-indigo-900 font-bold underline" : "text-[#141414] opacity-80"
                                                          }`}
                                                        >
                                                          <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                                                          <span>{dist.nombre}</span>
                                                        </div>
                                                        <div className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
                                                          {privileges.UPDATE && (
                                                            <button onClick={() => handleOpenDivModal(dist)} className="text-slate-600 hover:text-indigo-800"><Edit className="w-3 h-3" /></button>
                                                          )}
                                                          {privileges.DELETE && (
                                                            <button onClick={() => handleDeleteDiv(dist.id_division)} className="text-slate-400 hover:text-red-700"><Trash2 className="w-3 h-3" /></button>
                                                          )}
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* NODE DETAIL INSPECTOR */}
              <div className="lg:col-span-2 space-y-5">
                <div className="bg-[#141414] text-[#E4E3E0] p-5 relative border border-[#141414]">
                  <div className="relative z-10 space-y-1.5 font-mono">
                    <span className="bg-[#E4E3E0] text-[#141414] text-[9px] uppercase font-bold px-1.5 py-0.5 tracking-wider">
                      CONSOLA DE AUDITORÍA GEOGRÁFICA
                    </span>
                    <p className="text-xl font-bold font-serif italic tracking-wide">{activeGeoName.toUpperCase()}</p>
                    <p className="text-[10.5px] text-zinc-300">
                      Ubicación: {activeGeoType === "DIVISION" ? getBreadcrumbPath(activeGeoId) : "Ámbito Global"} 
                    </p>
                  </div>
                  <div className="absolute right-3 bottom-3 opacity-10 pointer-events-none select-none">
                    <Database className="w-32 h-32" />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white border border-[#141414] p-3.5 flex flex-col justify-between font-mono">
                    <span className="text-[9px] font-bold uppercase text-[#141414]/70">INCIDENCIAS</span>
                    <p className="text-2xl font-serif italic font-bold text-[#141414] mt-1">{regionalMetrics.total}</p>
                    <span className="text-[9px] text-[#141414]/60">SLA total en división</span>
                  </div>
                  <div className="bg-white border border-[#141414] p-3.5 flex flex-col justify-between font-mono">
                    <span className="text-[9px] font-bold uppercase text-amber-700">PENDIENTES</span>
                    <p className="text-2xl font-serif italic font-bold text-amber-700 mt-1">{regionalMetrics.pending}</p>
                    <span className="text-[9px] text-amber-800/60 font-semibold">Crítico en cola</span>
                  </div>
                  <div className="bg-white border border-[#141414] p-3.5 flex flex-col justify-between font-mono">
                    <span className="text-[9px] font-bold uppercase text-purple-700">EN CURSO</span>
                    <p className="text-2xl font-serif italic font-bold text-purple-700 mt-1">{regionalMetrics.active}</p>
                    <span className="text-[9px] text-[#141414]/60">SLA activo hoy</span>
                  </div>
                  <div className="bg-white border border-[#141414] p-3.5 flex flex-col justify-between font-mono">
                    <span className="text-[9px] font-bold uppercase text-emerald-700">SEDES ACTIVAS</span>
                    <p className="text-2xl font-serif italic font-bold text-emerald-700 mt-1">{regionalMetrics.branchesCount}</p>
                    <span className="text-[9px] text-emerald-800/60 font-semibold">Infraestructura</span>
                  </div>
                </div>

                <div className="border border-[#141414] bg-white font-mono rounded-none">
                  <div className="p-3 bg-[#E4E3E0] border-b border-[#141414] flex items-center justify-between">
                    <span className="font-bold text-[10.5px] uppercase flex items-center gap-1.5">
                      <Building className="w-4 h-4" /> SEDES FÍSICAS ASOCIADAS AL NODO SELECCIONADO
                    </span>
                    <span className="text-[10px] font-bold bg-[#141414] text-[#E4E3E0] px-2 py-0.5 border">
                      {regionalMetrics.branchesCount} SUCURSALES
                    </span>
                  </div>
                  <div className="divide-y divide-zinc-200 p-1 max-h-[180px] overflow-y-auto text-xs">
                    {regionalMetrics.branchesList.map(s => {
                      const emp = db.empresas.find(e => e.id_empresa === s.id_empresa);
                      const ubi = db.ubicaciones.find(u => u.id_ubicacion === s.id_ubicacion);
                      return (
                        <div key={s.id_sucursal} className="p-3 flex items-start justify-between hover:bg-slate-50 gap-4">
                          <div className="space-y-1">
                            <span className="font-bold uppercase text-[#141414] block">
                              📍 {s.nombre} {s.es_principal && <span className="bg-emerald-100 border border-emerald-400 text-emerald-950 font-sans text-[8.5px] px-1 ml-1 rounded">MATRIZ</span>}
                            </span>
                            <span className="text-[10px] uppercase text-slate-500 block">
                              Propietario: {emp?.nombre_comercial || emp?.razon_social} (RUC {emp?.ruc})
                            </span>
                            <span className="text-[9.5px] text-zinc-500 block">
                              Dirección: {ubi?.direccion} ({ubi ? getBreadcrumbPath(ubi.id_division) : 'Sin división'})
                            </span>
                          </div>
                          {s.telefono && (
                            <span className="text-[10px] text-slate-500 shrink-0 flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {s.telefono}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {regionalMetrics.branchesCount === 0 && (
                      <div className="p-8 text-center text-slate-500 text-xs italic">
                        No se registran sedes corporativas vinculadas directamente a la demarcación seleccionada.
                      </div>
                    )}
                  </div>
                </div>

                <div className="border border-[#141414] bg-white font-mono">
                  <div className="p-3 bg-[#E4E3E0] border-b border-[#141414] flex items-center justify-between">
                    <span className="font-bold text-[10.5px] uppercase flex items-center gap-1.5">
                      <FileText className="w-4 h-4" /> INCIDENCIAS ASOCIADAS (MAPA RELACIONAL SQL)
                    </span>
                    <span className="text-[10px] font-bold bg-[#141414] text-[#E4E3E0] px-2 py-0.5 border">
                      {regionalMetrics.total} REPORTES
                    </span>
                  </div>
                  <div className="divide-y divide-zinc-200 max-h-[250px] overflow-y-auto">
                    {regionalMetrics.tickets.map(t => {
                      const isUnsolved = t.estado === "PENDIENTE" || t.estado === "REABIERTO";
                      return (
                        <div key={t.id_ticket} className="p-3.5 hover:bg-slate-50 text-xs flex justify-between gap-4">
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[#141414] text-sm">{t.nro_ticket}</span>
                              <span className="text-indigo-800 font-bold uppercase text-[9px] truncate max-w-[130px]">
                                {db.empresas.find(e => e.id_empresa === t.id_empresa)?.nombre_comercial || 'EMPRESA'}
                              </span>
                            </div>
                            <p className="text-zinc-700 font-sans font-medium line-clamp-1">{t.detalle_reporte}</p>
                            <span className="text-[9px] text-[#141414]/65 block">
                              Sede: {db.sucursales.find(suc => suc.id_sucursal === t.id_sucursal)?.nombre || 'General'} | Prioridad: <strong className="text-red-900">{t.prioridad}</strong>
                            </span>
                          </div>
                          <div className="text-right shrink-0 self-center">
                            <span className={`px-1.5 py-0.5 border text-[9px] font-bold rounded uppercase ${
                              isUnsolved ? "bg-amber-100 text-amber-955 border-amber-400" : "bg-emerald-100 text-emerald-955 border-emerald-400"
                            }`}>
                              {t.estado}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {regionalMetrics.total === 0 && (
                      <div className="p-8 text-center text-slate-500 italic text-xs">
                        No se detectan incidentes atribuidos a esta ramificación geográfica administrada.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentTab === "CONFIGURACION" && (
            <div className="space-y-6">
              <div className="bg-white border border-[#141414] p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-[#141414]/15 pb-2">
                  <Sliders className="w-5 h-5 text-slate-800" />
                  <span className="font-serif italic text-lg text-[#141414]">Configuración Flexible de Jerarquías de RDBMS</span>
                </div>
                <p className="text-xs font-sans text-slate-600 leading-relaxed max-w-4xl">
                  Defina los niveles administrativos válidos para cada país registrado en la base de datos de manera secuencial. 
                  Esto permite dar soporte a distintas estructuras de división sin duplicar estructuras en SQL.
                </p>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="border border-slate-200">
                    <div className="p-3 bg-zinc-100 border-b border-slate-200 font-mono font-bold text-[10.5px] uppercase">
                      🗺️ Estructura Administrativa Configurada por País
                    </div>
                    <div className="divide-y divide-slate-100 font-mono text-xs">
                      {db.paises.map(pais => {
                        const schema = countryHierarchies[pais.id_pais] || [1, 2, 3];
                        return (
                          <div key={pais.id_pais} className="p-4 space-y-3 hover:bg-slate-50/50">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[#141414] uppercase text-sm flex items-center gap-1.5">
                                <Globe className="w-4 h-4 text-slate-500" /> {pais.nombre} ({pais.codigo_iso})
                              </span>
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => handleOpenCountryModal(pais)}
                                  className="p-1 border border-slate-200 hover:border-[#141414] bg-white rounded cursor-pointer"
                                  title="Editar Nombre / ISO"
                                >
                                  <Edit className="w-3.5 h-3.5 text-zinc-600" />
                                </button>
                                <button
                                  onClick={() => handleDeleteCountry(pais.id_pais)}
                                  className="p-1 border border-slate-200 hover:border-red-600 bg-white hover:bg-red-50 rounded cursor-pointer"
                                  title="Eliminar País"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-red-600" />
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap pt-1">
                              {schema.map((typeId, seq) => {
                                const t = db.tiposDivision.find(td => td.id_tipo_division === typeId);
                                return (
                                  <div key={typeId} className="flex items-center gap-1">
                                    {seq > 0 && <ArrowRight className="w-3 h-3 text-slate-400" />}
                                    <span className="px-2 py-0.5 border border-indigo-200 bg-indigo-50/70 text-indigo-950 font-bold text-[9.5px] uppercase">
                                      {seq + 1}º: {t?.nombre || `Tipo #${typeId}`}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="space-y-1 pt-2 border-t border-dashed border-slate-250">
                              <label className="block text-[9.5px] font-bold text-slate-500 uppercase">Ajustar Niveles Administrativos:</label>
                              <div className="flex gap-1">
                                {db.tiposDivision.map(td => {
                                  const alreadyIn = schema.includes(td.id_tipo_division);
                                  return (
                                    <button
                                      key={td.id_tipo_division}
                                      onClick={() => {
                                        if (!privileges.UPDATE) {
                                          alert("No posee privilegios UPDATE para alterar esquemas.");
                                          return;
                                        }
                                        let nextSchema = [...schema];
                                        if (alreadyIn) {
                                          if (schema.length <= 1) {
                                            alert("Un país debe poseer como mínimo 1 nivel territorial.");
                                            return;
                                          }
                                          nextSchema = schema.filter(id => id !== td.id_tipo_division);
                                        } else {
                                          nextSchema.push(td.id_tipo_division);
                                        }
                                        setCountryHierarchies(prev => ({ ...prev, [pais.id_pais]: nextSchema }));
                                        addLog(`Esquema actualizado para el país ${pais.nombre}.`, "info");
                                      }}
                                      className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all uppercase cursor-pointer ${
                                        alreadyIn 
                                          ? "bg-slate-800 text-white border border-slate-800" 
                                          : "bg-white text-zinc-650 border border-slate-350 hover:bg-slate-100"
                                      }`}
                                    >
                                      {alreadyIn ? `✓ ${td.nombre.split(" ")[0]}` : `+ ${td.nombre.split(" ")[0]}`}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border border-slate-200">
                    <div className="p-3 bg-zinc-100 border-b border-slate-200 font-mono font-bold text-[10.5px] uppercase flex justify-between items-center">
                      <span>🏷️ Tipos de Demarcación Administrativa</span>
                      {privileges.INSERT && (
                        <button
                          onClick={() => handleOpenTypeModal(null)}
                          className="px-2 py-0.5 bg-[#141414] text-[#E4E3E0] text-[9.5px] font-mono hover:bg-[#141414]/90 cursor-pointer"
                        >
                          + Crear Tipo
                        </button>
                      )}
                    </div>
                    <div className="divide-y divide-slate-100 font-mono text-xs">
                      {db.tiposDivision.map(td => {
                        const countOfDivs = db.divisionesGeograficas.filter(dg => dg.id_tipo_division === td.id_tipo_division).length;
                        return (
                          <div key={td.id_tipo_division} className="p-4 flex items-center justify-between hover:bg-slate-50/50">
                            <div>
                              <span className="font-bold text-[#141414] uppercase block text-sm">{td.nombre}</span>
                              <span className="text-[10px] text-zinc-550 block mt-0.5">
                                PK_TIPO: #{td.id_tipo_division} | Divisiones asignadas: {countOfDivs}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleOpenTypeModal(td)}
                                className="p-1 border border-slate-200 hover:border-[#141414] rounded cursor-pointer"
                              >
                                <Edit className="w-3.5 h-3.5 text-zinc-600" />
                              </button>
                              <button
                                onClick={() => handleDeleteType(td.id_tipo_division)}
                                className="p-1 border border-slate-200 hover:border-red-600 bg-white hover:bg-red-50 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-red-600" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentTab === (null as any) && (
            <div className="max-w-4xl mx-auto">
              <div className="bg-white border border-[#141414] p-6 space-y-5">
                <div className="flex items-center gap-2 border-b border-[#141414]/15 pb-2">
                  <MapPin className="w-5 h-5 text-indigo-700" />
                  <span className="font-serif italic text-lg text-[#141414]">Asignador Asistida de Ubicaciones Geográficas</span>
                </div>
                <p className="text-xs font-sans text-slate-650 leading-relaxed">
                  Utilice este playground para experimentar de manera interactiva la asignación georreferenciada de direcciones.
                </p>

                <div className="bg-slate-50 p-4 border border-slate-200 rounded-none space-y-4 font-mono text-xs">
                  <span className="font-bold text-[10.5px] uppercase block text-blue-800">
                    🛠️ 1. Seleccione la Entidad de Destino
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Tipo de registro destino:</label>
                      <select
                        value={assignTargetType}
                        onChange={(e) => {
                          const t = e.target.value as any;
                          setAssignTargetType(t);
                          if (t === "EMPRESA") setAssignTargetId(db.empresas[0]?.id_empresa || 1);
                          else if (t === "SUCURSAL") setAssignTargetId(db.sucursales[0]?.id_sucursal || 1);
                          else setAssignTargetId(db.personas[0]?.id_persona || 1);
                        }}
                        className="w-full bg-white border border-slate-350 p-2 focus:outline-none"
                      >
                        <option value="EMPRESA">🏢 Empresa Cliente (Matriz)</option>
                        <option value="SUCURSAL">📍 Sucursal / Sede Física</option>
                        <option value="PERSONA">👤 Usuario / Contacto del Sistema</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Seleccionar registro:</label>
                      <select
                        value={assignTargetId}
                        onChange={(e) => setAssignTargetId(Number(e.target.value))}
                        className="w-full bg-white border border-slate-350 p-2 focus:outline-none text-slate-700"
                      >
                        {assignTargetType === "EMPRESA" && db.empresas.map(e => (
                          <option key={e.id_empresa} value={e.id_empresa}>{e.nombre_comercial || e.razon_social} (RUC {e.ruc})</option>
                        ))}
                        {assignTargetType === "SUCURSAL" && db.sucursales.map(s => (
                          <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre} [Empresa #{s.id_empresa}]</option>
                        ))}
                        {assignTargetType === "PERSONA" && db.personas.map(p => (
                          <option key={p.id_persona} value={p.id_persona}>{p.nombres} {p.apellido_paterno} ({p.tipo_documento}: {p.numero_documento})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 font-mono text-xs">
                  <span className="font-bold text-[10.5px] uppercase block text-blue-800">
                    📍 2. Formulario de Datos Domiciliarios
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Dirección <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={assignCalle}
                        onChange={(e) => setAssignCalle(e.target.value)}
                        placeholder="Av. Paseo de la República Nro 4022"
                        className="w-full bg-white border border-slate-350 p-2 focus:outline-none placeholder-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Referencia</label>
                      <input
                        type="text"
                        value={assignReferencia}
                        onChange={(e) => setAssignReferencia(e.target.value)}
                        placeholder="Cerca a la estación Aramburú"
                        className="w-full bg-white border border-slate-350 p-2 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="border border-indigo-200 bg-indigo-50/50 p-4 rounded-none space-y-3.5">
                    <div className="flex items-start gap-3">
                      <Compass className="w-5 h-5 text-indigo-700 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <span className="font-bold text-xs uppercase text-indigo-950 block">PROCESO DE ASIGNACIÓN GEOGRÁFICA</span>
                        <p className="text-[11px] text-slate-600 leading-normal">
                          Antes de registrar, es obligatorio validar la jerarquía territorial del país de destino.
                        </p>
                      </div>
                    </div>
                    <div className="p-3 bg-white border border-indigo-150 inline-flex items-center gap-2 text-xs w-full justify-between">
                      <div className="truncate">
                        <span className="font-bold uppercase text-[9px] text-[#141414]/60 block mb-0.5">Demarcación actual validada:</span>
                        {Object.keys(modalSelections).length > 0 ? (
                          <span className="font-bold text-indigo-900 uppercase">
                            ⚙️ {db.paises.find(p => p.id_pais === modalCountryId)?.nombre} ➔ {getBreadcrumbPath(modalSelections[currentModalHierarchy.length - 1] || null) || "Incompleta"}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">-- Ninguna ubicación seleccionada aún --</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setModalSelections({});
                          setShowAssignedLocationModal(true);
                        }}
                        className="px-3.5 py-1.5 bg-indigo-750 hover:bg-indigo-900 border border-indigo-600 text-white font-bold uppercase text-[10px] cursor-pointer shadow-sm hover:shadow transition-all"
                      >
                        🔍 Abrir Ventana Modal
                      </button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200 flex justify-end">
                    <button
                      type="button"
                      onClick={handleAssignLocationTransaction}
                      disabled={!modalValidationStatus.ok || !assignCalle}
                      className={`px-5 py-2.5 font-bold uppercase text-xs transition-colors rounded-none border border-zinc-900 ${
                        modalValidationStatus.ok && assignCalle 
                          ? "bg-zinc-900 text-white hover:bg-zinc-900/90 cursor-pointer" 
                          : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                      }`}
                    >
                      Asignar y Confirmar en Base de Datos
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODALS */}
      {showPaisModal && (
        <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-none">
          <div className="bg-[#E4E3E0] text-[#141414] border-2 border-[#141414] p-5 w-full max-w-md space-y-4">
            <div className="flex justify-between items-center border-b border-[#141414]/20 pb-2">
              <span className="font-serif italic font-bold text-lg">
                {countryEditId !== null ? "Modificar País" : "Registrar Nuevo País"}
              </span>
              <button onClick={() => setShowPaisModal(false)} className="cursor-pointer"><X className="w-5 h-5 text-slate-600" /></button>
            </div>
            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="block font-bold text-slate-600 uppercase mb-1">Nombre Oficial del País <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={countryFormName}
                  onChange={(e) => setCountryFormName(e.target.value)}
                  placeholder="Chile, Argentina, Ecuador"
                  className="w-full bg-white border border-slate-350 p-2 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 uppercase mb-1">Código ISO <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  maxLength={3}
                  value={countryFormIso}
                  onChange={(e) => setCountryFormIso(e.target.value)}
                  placeholder="CHL (Max 3 caracteres)"
                  className="w-full bg-white border border-slate-350 p-2 focus:outline-none uppercase font-bold"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowPaisModal(false)} className="px-4 py-2 border border-slate-350 hover:bg-slate-100 uppercase text-[10.5px] font-bold cursor-pointer">Cancelar</button>
              <button onClick={handleSaveCountry} className="px-4 py-2 bg-slate-900 border border-slate-900 text-white flex items-center gap-1.5 uppercase text-[10.5px] font-bold hover:bg-slate-800 cursor-pointer">Guardar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {showTypeModal && (
        <div className="fixed inset-0 bg-[#141414]/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] text-[#141414] border-2 border-[#141414] p-5 w-full max-w-md space-y-4">
            <div className="flex justify-between items-center border-b border-[#141414]/20 pb-2">
              <span className="font-serif italic font-bold text-lg">
                {typeEditId !== null ? "Modificar Nivel Administrativo" : "Registrar Nuevo Nivel Administrativo"}
              </span>
              <button onClick={() => setShowTypeModal(false)} className="cursor-pointer"><X className="w-5 h-5 text-slate-600" /></button>
            </div>
            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="block font-bold text-slate-600 uppercase mb-1">Denominación del Nivel <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={typeFormName}
                  onChange={(e) => setTypeFormName(e.target.value)}
                  placeholder="Estado, Región, Provincia..."
                  className="w-full bg-white border border-slate-350 p-2 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Ej: "Región" (Perú/Chile), "Estado" (USA).</span>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowTypeModal(false)} className="px-4 py-2 border border-slate-350 hover:bg-slate-100 uppercase text-[10.5px] font-bold cursor-pointer">Cancelar</button>
              <button onClick={handleSaveType} className="px-4 py-2 bg-slate-900 text-white uppercase text-[10.5px] font-bold hover:bg-slate-800 cursor-pointer">Guardar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {showDivModal && (
        <div className="fixed inset-0 bg-[#141414]/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] text-[#141414] border-2 border-[#141414] p-5 w-full max-w-lg space-y-4">
            <div className="flex justify-between items-center border-b border-[#141414]/20 pb-2">
              <span className="font-serif italic font-bold text-lg">
                {divEditId !== null ? "Modificar División Geográfica" : "Registrar Nueva División Geográfica"}
              </span>
              <button onClick={() => setShowDivModal(false)} className="cursor-pointer"><X className="w-5 h-5 text-slate-600" /></button>
            </div>
            <div className="space-y-4.5 font-mono text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-600 uppercase mb-1">País de Destino</label>
                  <select
                    value={divFormPaisId ?? ''}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setDivFormPaisId(val);
                    }}
                    disabled={
                      (divEditId !== null && divFormPadreId !== "null") ||
                      (divEditId === null && divFormPaisId !== null && divFormPaisId !== undefined)
                    }
                    className="w-full bg-white border border-slate-350 p-2 focus:outline-none"
                  >
                    <option value="">-- Seleccionar país --</option>
                    {db.paises.map(p => (
                      <option key={p.id_pais} value={p.id_pais}>{p.nombre}</option>
                    ))}
                  </select>
                  {divEditId !== null && divFormPadreId === "null" && (
                    <span className="text-[10px] text-amber-700 block mt-1">
                      ⚠️ Cambiar el país de una división raíz afecta a todas sus subdivisiones.
                    </span>
                  )}
                  {divFormPaisId === null && divEditId === null && (
                    <span className="text-[10px] text-red-600 block mt-1">* Obligatorio para divisiones raíz</span>
                  )}
                  {divEditId !== null && divFormPadreId !== "null" && (
                    <span className="text-[10px] text-slate-500 block mt-1">
                      El país se hereda de la división superior.
                    </span>
                  )}
                </div>
                <div>
                  <label className="block font-bold text-slate-600 uppercase mb-1">Tipo de nivel</label>
                  <select
                    value={divFormTipoId}
                    onChange={(e) => setDivFormTipoId(Number(e.target.value))}
                    className="w-full bg-white border border-slate-350 p-2 focus:outline-none"
                  >
                    {db.tiposDivision.map(td => <option key={td.id_tipo_division} value={td.id_tipo_division}>{td.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-600 uppercase mb-1">División Superior (FK)</label>
                <select
                  value={divFormPadreId}
                  onChange={(e) => setDivFormPadreId(e.target.value)}
                  className="w-full bg-white border border-slate-350 p-2 focus:outline-none text-slate-700"
                >
                  <option value="null">-- Ninguno (Raíz del País) --</option>
                  {db.divisionesGeograficas
                    .filter(dg => {
                      if (divFormPaisId !== null && divFormPaisId !== undefined) {
                        return getCountryOfDivision(dg.id_division) === divFormPaisId;
                      }
                      return true;
                    })
                    .map(dg => <option key={dg.id_division} value={dg.id_division}>{getBreadcrumbPath(dg.id_division)}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-600 uppercase mb-1">Nombre del nodo <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={divFormNombre}
                  onChange={(e) => setDivFormNombre(e.target.value)}
                  placeholder="Miraflores, Las Condes, Usaquén"
                  className="w-full bg-white border border-slate-350 p-2 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowDivModal(false)} className="px-4 py-2 border border-slate-350 hover:bg-slate-100 uppercase text-[10.5px] font-bold cursor-pointer">Cancelar</button>
              <button onClick={handleSaveDiv} className="px-4 py-2 bg-slate-900 text-white uppercase text-[10.5px] font-bold hover:bg-slate-800 cursor-pointer">Confirmar Transacción</button>
            </div>
          </div>
        </div>
      )}

      {showAssignedLocationModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] text-[#141414] border-2 border-[#141414] p-5 w-full max-w-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-[#141414]/25 pb-2">
              <span className="font-serif italic font-bold text-base flex items-center gap-1.5 text-indigo-900">
                <Compass className="w-5 h-5 text-indigo-700" /> Ventana Modal de Consulta Geográfica Asistida
              </span>
              <button onClick={() => setShowAssignedLocationModal(false)} className="cursor-pointer"><X className="w-5 h-5 text-slate-600" /></button>
            </div>
            <p className="text-xs text-slate-600 max-w-xl">
              Seleccione jerárquicamente cada nivel territorial. El sistema activará el siguiente selector únicamente tras la validación de integridad referencial.
            </p>
            <div className="space-y-4 font-mono text-xs">
              <div className="p-3 bg-white border border-slate-300">
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Paso 1: País de Ámbito de Destino</label>
                <div className="flex flex-wrap gap-2">
                  {db.paises.map(p => {
                    const isSelected = p.id_pais === modalCountryId;
                    return (
                      <button
                        key={p.id_pais}
                        type="button"
                        onClick={() => {
                          setModalCountryId(p.id_pais);
                          setModalSelections({});
                        }}
                        className={`px-3 py-1.5 border font-bold text-[11px] uppercase cursor-pointer ${
                          isSelected ? "bg-[#141414] text-[#E4E3E0] border-[#141414]" : "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700"
                        }`}
                      >
                        🌎 {p.nombre} ({p.codigo_iso})
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 pt-1">
                {currentModalHierarchy.map((typeId, index) => {
                  const levelType = db.tiposDivision.find(t => t.id_tipo_division === typeId);
                  const previousLevelId = index === 0 ? null : modalSelections[index - 1];
                  const isBlocked = index > 0 && previousLevelId === null;
                  const matchedOptions = db.divisionesGeograficas.filter(dg => {
                    if (dg.id_tipo_division !== typeId) return false;
                    if (index === 0) return divisionPaisMap[dg.id_division] === modalCountryId;
                    return dg.id_division_padre === previousLevelId;
                  });
                  const activeChoice = modalSelections[index] || "";

                  return (
                    <div key={typeId} className={`p-3.5 border transition-all ${isBlocked ? "bg-slate-100/50 opacity-40 border-slate-200 select-none" : "bg-white border-slate-350"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] font-bold uppercase text-slate-650">
                          Paso {index + 2}: Seleccionar {levelType?.nombre || `Nivel #${typeId}`}
                        </label>
                        {isBlocked && <span className="text-[9px] text-amber-800 bg-amber-50 px-1 border uppercase font-bold">Bloqueado</span>}
                      </div>
                      <select
                        disabled={isBlocked}
                        value={activeChoice}
                        onChange={(e) => {
                          const val = e.target.value === "" ? null : Number(e.target.value);
                          setModalSelections(prev => {
                            const updated = { ...prev };
                            updated[index] = val;
                            for (let next = index + 1; next < currentModalHierarchy.length; next++) {
                              updated[next] = null;
                            }
                            return updated;
                          });
                        }}
                        className="w-full bg-slate-50 border border-slate-300 p-2 focus:outline-none"
                      >
                        <option value="">-- Seleccionar opción ({matchedOptions.length} hallados) --</option>
                        {matchedOptions.map(option => <option key={option.id_division} value={option.id_division}>{option.nombre}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className={`p-3 font-mono text-[10.5px] uppercase ${modalValidationStatus.color}`}>
                {modalValidationStatus.label}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowAssignedLocationModal(false)} className="px-4 py-2 border border-slate-350 hover:bg-slate-100 uppercase text-[10.5px] font-bold cursor-pointer font-mono">Cerrar Consulta</button>
              <button
                type="button"
                disabled={!modalValidationStatus.ok}
                onClick={() => setShowAssignedLocationModal(false)}
                className={`px-4 py-2 uppercase text-[10.5px] font-bold flex items-center gap-1.5 font-mono ${
                  modalValidationStatus.ok ? "bg-indigo-750 text-white hover:bg-indigo-900 cursor-pointer border border-[#141414]" : "bg-slate-200 text-slate-400 border-slate-200 cursor-not-allowed"
                }`}
              >
                Confirmar Selección Validada
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}