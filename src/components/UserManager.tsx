/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from "react";
import { MockDatabase } from "../db/mockDb";
import { Persona, PersonaRol, AccesoAuditoria } from "../types";
import { logTechnicalError, getFriendlyErrorMessage } from "../utils/errorLogger";
import { getApiUrl as getDynamicApiUrl, getIisServerUrl } from "../utils/api";
import { 
  Plus, 
  Search, 
  UserCheck, 
  UserX, 
  ShieldCheck, 
  Eye, 
  Activity, 
  UserPlus, 
  Edit, 
  Check, 
  ShieldAlert,
  Server,
  Key,
  Trash2
} from "lucide-react";

// SHA-256 helper
const getSHA256 = async (str: string): Promise<string> => {
  try {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return "sha256_mock_" + Math.abs(hash).toString(16);
  }
};

interface UserManagerProps {
  db: MockDatabase;
  updateDb: (newDb: MockDatabase) => void;
  currentUser?: any;
  // FIX v2.81 — onSync permite refrescar desde la BD después de CRUD,
  // evitando tener que presionar F5 para ver los cambios.
  onSync?: () => void;
}

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
      id_persona: 999
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
  }
  return window.fetch(input, init);
};

const fetch = safeFetch;

type UserSubTab = "USUARIOS" | "PERMISOS" | "PARAMETROS" | "LOGS";

export function UserManager({ db, updateDb, currentUser, onSync }: UserManagerProps) {
  const [activeTab, setActiveTab] = useState<UserSubTab>("USUARIOS");
  const [searchQuery, setSearchQuery] = useState("");
  // FIX v2.39 — Debounce en búsqueda para evitar refilter en cada tecla.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);
  const [userTypeFilter, setUserTypeFilter] = useState<"INTERNOS" | "CONTACTOS">("INTERNOS");

  // Modal / Form trigger states
  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(null); // null means "Create"

  // User form states
  const [formTipoDoc, setFormTipoDoc] = useState("DNI");
  const [formNumDoc, setFormNumDoc] = useState("");
  const [formNombres, setFormNombres] = useState("");
  const [formApPaterno, setFormApPaterno] = useState("");
  const [formApMaterno, setFormApMaterno] = useState("");
  const [formBirthday, setFormBirthday] = useState("");
  const [formTel, setFormTel] = useState("");
  const [formCorreo, setFormCorreo] = useState("");
  const [formDireccion, setFormDireccion] = useState("");
  const [formSexo, setFormSexo] = useState<"M" | "F">("M");
  const [formRolId, setFormRolId] = useState<number>(3); // Default Técnico

  // Added company/branch, password, and lock states to user entity
  const [formEmpresaId, setFormEmpresaId] = useState<number>(1);
  const [formSucursalId, setFormSucursalId] = useState<number | "null">("null");
  const [formContrasena, setFormContrasena] = useState<string>("");
  const [formBloqueado, setFormBloqueado] = useState<boolean>(false);

  // System Parameterization local states mapped to db.systemConfig
  const [selectedTemplateId, setSelectedTemplateId] = useState("TICKET_REGISTRO");
  const [templateAsunto, setTemplateAsunto] = useState("");
  const [templateCuerpo, setTemplateCuerpo] = useState("");
  // FIX v2.87 — Plantillas cargadas desde el backend (email_templates.json)
  const [emailTemplates, setEmailTemplates] = useState<Record<string, {asunto: string, cuerpo: string}>>({});
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [testEmailTarget, setTestEmailTarget] = useState("");

  const [smtpHost, setSmtpHost] = useState(db.systemConfig?.smtpHost || "smtp.corp-mail.com");
  const [smtpPort, setSmtpPort] = useState(db.systemConfig?.smtpPort || 587);
  const [smtpUser, setSmtpUser] = useState(db.systemConfig?.smtpUser || "notificaciones@soporte.com");
  const [smtpPass, setSmtpPass] = useState(db.systemConfig?.smtpPass || "SuperSecurePass123!");
  const [smtpSec, setSmtpSec] = useState(db.systemConfig?.smtpSecurity || "TLS");
  const [smtpSender, setSmtpSender] = useState(db.systemConfig?.smtpSender || "notificaciones@soporte.com");

  const [smtpValidated, setSmtpValidated] = useState<boolean>(false);
  const [smtpValidationMsg, setSmtpValidationMsg] = useState<string | null>(null);
  const [validatingSmtp, setValidatingSmtp] = useState<boolean>(false);

  const [maxAttempts, setMaxAttempts] = useState(db.systemConfig?.security?.intentosMaximos || 3);
  const [lockoutSeconds, setLockoutSeconds] = useState(db.systemConfig?.security?.tiempoBloqueoSegundos || 30);
  const [inactivityMinutes, setInactivityMinutes] = useState(db.systemConfig?.security?.inactividadMinutos || 15);
  const [pwdExpireDays, setPwdExpireDays] = useState(db.systemConfig?.security?.vencimientoContrasenaDias || 90);
  const [mfaOptional, setMfaOptional] = useState(db.systemConfig?.security?.dobleFactorOpcional || false);

  const [logEmpresas, setLogEmpresas] = useState(db.systemConfig?.auditConfig?.logEmpresas ?? true);
  const [logSucursales, setLogSucursales] = useState(db.systemConfig?.auditConfig?.logSucursales ?? true);
  const [logTickets, setLogTickets] = useState(db.systemConfig?.auditConfig?.logTickets ?? true);
  const [logUsuarios, setLogUsuarios] = useState(db.systemConfig?.auditConfig?.logUsuarios ?? true);
  const [logGeografico, setLogGeografico] = useState(db.systemConfig?.auditConfig?.logGeografico ?? true);

  // States & document type list registries editors helper states
  const [newStateId, setNewStateId] = useState("");
  const [newStateName, setNewStateName] = useState("");
  const [newStateColor, setNewStateColor] = useState("amber");
  
  const [newDocId, setNewDocId] = useState("");
  const [newDocName, setNewDocName] = useState("");
  const [newDocLength, setNewDocLength] = useState(8);

  // New Search Modal states for volume catalogs in UserManager
  const [showEmpresaSearchModal, setShowEmpresaSearchModal] = useState(false);
  const [empresaSearchQuery, setEmpresaSearchQuery] = useState("");

  const [showSucursalSearchModal, setShowSucursalSearchModal] = useState(false);
  const [sucursalSearchQuery, setSucursalSearchQuery] = useState("");

  // States for Roles & operational permissions matrix CRUD
  const [selectedRoleIdForPerms, setSelectedRoleIdForPerms] = useState<number>(1);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editRoleId, setEditRoleId] = useState<number | null>(null); // null means "Create"
  const [formRoleName, setFormRoleName] = useState("");
  const [formRoleDesc, setFormRoleDesc] = useState("");

  // React effect to load chosen email template values dynamically
  // FIX v2.87 — Cargar plantillas desde el backend (email_templates.json vía API)
  React.useEffect(() => {
    if (!templatesLoaded) {
      fetch(getApiUrl("get_email_templates"))
        .then(res => res.json())
        .then(data => {
          if (data.status === "success" && data.data) {
            setEmailTemplates(data.data);
            setTemplatesLoaded(true);
          }
        })
        .catch(err => console.warn("No se pudieron cargar plantillas desde el backend:", err));
    }
  }, [templatesLoaded]);

  React.useEffect(() => {
    // Primero intentar cargar desde el backend (emailTemplates)
    if (emailTemplates && emailTemplates[selectedTemplateId]) {
      setTemplateAsunto(emailTemplates[selectedTemplateId].asunto);
      setTemplateCuerpo(emailTemplates[selectedTemplateId].cuerpo);
    } else if (db.systemConfig) {
      // Fallback: usar plantillas locales (semilla)
      const templ = db.systemConfig.notificationTemplates.find(t => t.id === selectedTemplateId);
      if (templ) {
        setTemplateAsunto(templ.asunto);
        setTemplateCuerpo(templ.cuerpo);
      }
    }
  }, [selectedTemplateId, emailTemplates, db.systemConfig]);

  const resetFormStates = () => {
    setFormTipoDoc("DNI");
    setFormNumDoc("");
    setFormNombres("");
    setFormApPaterno("");
    setFormApMaterno("");
    setFormBirthday("");
    setFormTel("");
    setFormCorreo("");
    setFormDireccion("");
    setFormSexo("M");
    setFormRolId(3);
    setFormEmpresaId(db.empresas[0]?.id_empresa || 1);
    setFormSucursalId("null");
    setFormContrasena("");
    setFormBloqueado(false);
  };

  // -------------------------------------------------------------
  // ROLES & PERMISSIONS DYNAMIC LOGIC WITH MANUAL SAVE
  // -------------------------------------------------------------
  const [pendingRolePermissions, setPendingRolePermissions] = useState<{ [roleId: string]: any }>({});
  const [hasUnsavedPerms, setHasUnsavedPerms] = useState<boolean>(false);

  React.useEffect(() => {
    if (db.systemConfig?.rolePermissions) {
      setPendingRolePermissions(db.systemConfig.rolePermissions);
      setHasUnsavedPerms(false);
    }
  }, [db.systemConfig?.rolePermissions]);

  const getRolePermissions = (roleId: number) => {
    if (pendingRolePermissions && (pendingRolePermissions[roleId] || pendingRolePermissions[roleId.toString()])) {
      return pendingRolePermissions[roleId] || pendingRolePermissions[roleId.toString()];
    }
    const rolePermissions = db.systemConfig?.rolePermissions;
    if (rolePermissions) {
      if (rolePermissions[roleId]) {
        return rolePermissions[roleId];
      }
      if (rolePermissions[roleId.toString()]) {
        return rolePermissions[roleId.toString()];
      }
    }
    const templates: { [rid: number]: any } = {
      1: {
        DASHBOARD: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
        TICKETS: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
        CLIENTES: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
        GEOGRAFIA: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
        SEGURIDAD: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
        REPORTES: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true }
      },
      2: {
        DASHBOARD: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: true, exportar: true, imprimir: true },
        TICKETS: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: true, exportar: true, imprimir: true },
        CLIENTES: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: false, exportar: true, imprimir: true },
        GEOGRAFIA: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: false, exportar: true, imprimir: true },
        SEGURIDAD: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
        REPORTES: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: true, exportar: true, imprimir: true }
      },
      3: {
        DASHBOARD: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: true },
        TICKETS: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: true, exportar: true, imprimir: true },
        CLIENTES: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
        GEOGRAFIA: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
        SEGURIDAD: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
        REPORTES: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: true }
      },
      4: {
        DASHBOARD: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
        TICKETS: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: false, exportar: false, imprimir: true },
        CLIENTES: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
        GEOGRAFIA: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
        SEGURIDAD: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
        REPORTES: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false }
      }
    };
    return templates[roleId] || {
      DASHBOARD: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      TICKETS: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      CLIENTES: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      GEOGRAFIA: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      SEGURIDAD: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      REPORTES: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false }
    };
  };

  const handleTogglePermission = (roleId: number, moduleName: string, action: string) => {
    const currentPerms = getRolePermissions(roleId);
    const updatedRolePerms = {
      ...currentPerms,
      [moduleName]: {
        ...currentPerms[moduleName],
        [action]: !currentPerms[moduleName][action]
      }
    };

    setPendingRolePermissions(prev => ({
      ...prev,
      [roleId]: updatedRolePerms
    }));
    setHasUnsavedPerms(true);
  };

  const handleSaveAllPermissions = () => {
    // FIX v2.17: Guardar permisos , no solo en localStorage.
    // Esto hace que TODOS los PCs vean los mismos permisos.
    const roleId = selectedRoleIdForPerms;
    if (!roleId) {
      alert("Seleccione un rol primero.");
      return;
    }

    const permsForRole = pendingRolePermissions[roleId] || pendingRolePermissions[roleId.toString()];
    if (!permsForRole) {
      alert("No hay permisos para guardar.");
      return;
    }

    // Llamar al backend para guardar en BD
    const saveUrl = getApiUrl("save_role_permissions");
    fetch(saveUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_rol: roleId,
        permisos: JSON.stringify(permsForRole)
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "success") {
        // También actualizar localStorage para UI inmediata
        updateDb({
          ...db,
          systemConfig: {
            ...db.systemConfig!,
            rolePermissions: pendingRolePermissions
          }
        });
        setHasUnsavedPerms(false);
        alert("Permisos guardados en la base de datos. Todos los usuarios verán los cambios al recargar.");

        // Registrar en bitácora
        logOperacion("SEGURIDAD", "Guardar permisos", `Rol ${roleId}: ${db.roles.find(r => r.id_rol === roleId)?.nombre}`);
      } else {
        alert("Error al guardar permisos: " + (data.message || "desconocido"));
      }
    })
    .catch(err => {
      console.error("Error al guardar permisos:", err);
      alert("Error de conexión al guardar permisos.");
    });
  };

  // FIX v2.17: Función para registrar operaciones en la bitácora de auditoría
  const logOperacion = (modulo: string, operacion: string, detalles: string = "") => {
    const usuario = db.personas.find(p => p.id_persona === currentUser?.id_persona);
    const usuarioNombre = usuario ? `${usuario.nombres} ${usuario.apellido_paterno}` : "Sistema";
    const logUrl = getApiUrl("log_operacion");
    fetch(logUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: usuarioNombre,
        modulo,
        operacion,
        detalles
      })
    }).catch(() => { /* Silencioso */ });
  };

  const handleSaveRole = async () => {
    if (!formRoleName.trim()) {
      alert("⚠ Por favor defina el nombre del rol.");
      return;
    }

    // FIX v2.88 — Guardar rol en el backend (persona_rol) para que persista en BD.
    try {
      const response = await fetch(getApiUrl("save_role"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_rol: editRoleId || 0,
          nombre: formRoleName.trim(),
          descripcion: formRoleDesc.trim() || null
        })
      });
      const data = await response.json();
      if (data.status !== "success") {
        alert("❌ Error al guardar el rol:\n\n" + (data.message || "Error desconocido"));
        return;
      }

      // Actualizar estado local
      const nextDb = { ...db };
      if (editRoleId === null) {
        // Crear
        const newId = data.id_rol || (db.roles.length > 0 ? Math.max(...db.roles.map(r => r.id_rol)) + 1 : 1);
        const newRole: PersonaRol = {
          id_rol: newId,
          nombre: formRoleName.trim(),
          descripcion: formRoleDesc.trim() || null
        };
        nextDb.roles = [...db.roles, newRole];
      } else {
        // Editar
        nextDb.roles = db.roles.map(r => {
          if (r.id_rol === editRoleId) {
            return { ...r, nombre: formRoleName.trim(), descripcion: formRoleDesc.trim() || null };
          }
          return r;
        });
      }
      updateDb(nextDb);
      logOperacion("SEGURIDAD", editRoleId === null ? "Crear rol" : "Editar rol", `Rol: ${formRoleName}`);
      alert(`✓ ${editRoleId === null ? "REGISTRO EXITOSO" : "MODIFICACIÓN COMPLETADA"}: El rol '${formRoleName}' ha sido ${editRoleId === null ? "registrado" : "actualizado"} en la base de datos.`);
      setShowRoleModal(false);
    } catch (err: any) {
      alert("❌ Error de conexión al guardar el rol: " + (err?.message || err));
    }
  };

  const handleDeleteRole = async (roleId: number, roleName: string) => {
    if (roleId <= 4) {
      alert("⚠ RESTRICCIÓN DE SEGURIDAD: Los roles nativos del sistema (1-4) no pueden ser eliminados para proteger la integridad operativa.");
      return;
    }

    if (!confirm(`¿Está seguro de eliminar el rol '${roleName}'?\n\nEsta acción no se puede deshacer. Si hay usuarios asignados a este rol, deberá reasignarlos primero.`)) {
      return;
    }

    // FIX v2.88 — Eliminar rol en el backend (persona_rol)
    try {
      const response = await fetch(getApiUrl("delete_role"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_rol: roleId })
      });
      const data = await response.json();
      if (data.status !== "success") {
        alert("❌ No se puede eliminar el rol:\n\n" + (data.message || "Error desconocido"));
        return;
      }

      // Actualizar estado local
      const nextDb = { ...db };
      nextDb.roles = db.roles.filter(r => r.id_rol !== roleId);
      nextDb.asignacionesRoles = db.asignacionesRoles.map(a => {
        if (a.id_rol === roleId) {
          return { ...a, id_rol: 3 }; // Safe fallback a Técnico
        }
        return a;
      });
      updateDb(nextDb);
      logOperacion("SEGURIDAD", "Eliminar rol", `Rol: ${roleName} (ID: ${roleId})`);
      alert(`✓ ELIMINACIÓN REALIZADA: El rol '${roleName}' ha sido eliminado de la base de datos.`);
      if (selectedRoleIdForPerms === roleId) {
        setSelectedRoleIdForPerms(1);
      }
    } catch (err: any) {
      alert("❌ Error de conexión al eliminar el rol: " + (err?.message || err));
    }
  };

  // -------------------------------------------------------------
  // USER ACTIONS
  // -------------------------------------------------------------

  const getApiUrl = (action: string) => {
    return getDynamicApiUrl(action);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNombres || !formApPaterno || !formCorreo) {
      alert("Por favor rellene los campos requeridos (*).");
      return;
    }

    const isInternal = formRolId !== 4;
    const finalEmpresaId = isInternal ? null : formEmpresaId;
    const finalSucursalId = isInternal ? null : (formSucursalId === "null" ? null : formSucursalId);

    let nextDb = { ...db };

    // FIX v2.21: NO hashear en el frontend. Enviar texto plano y dejar que el PHP haga el hash.
    // Antes, si crypto.subtle fallaba (HTTP sin HTTPS), devolvía un hash mock incorrecto
    // y el login del usuario fallaba siempre.
    // El PHP ya detecta si la contraseña es texto plano o hash (64 hex chars) y la hashea correctamente.
    const finalHashedPass = formContrasena || "";

    if (selectedPersonaId === null) {
      // Create user
      // Document unique constraint
      // FIX v2.28: DNI no obligatorio, solo validar duplicados si se ingresó
      if (formNumDoc && db.personas.some(p => p.numero_documento === formNumDoc)) {
        alert("CONSTRAINT VIOLATION: El número de documento ya se encuentra registrado.");
        return;
      }
      if (db.personas.some(p => p.correo.toLowerCase() === formCorreo.toLowerCase().trim())) {
        alert("CONSTRAINT VIOLATION: El correo electrónico ya se encuentra registrado.");
        return;
      }

      const nextId = db.personas.length > 0 ? Math.max(...db.personas.map(p => p.id_persona)) + 1 : 1;
      const newPersona: Persona = {
        id_persona: nextId,
        tipo_documento: formTipoDoc,
        numero_documento: formNumDoc,
        nombres: formNombres,
        apellido_paterno: formApPaterno,
        apellido_materno: formApMaterno || null,
        fecha_nacimiento: formBirthday || null,
        telefono: formTel || null,
        correo: formCorreo.trim().toLowerCase(),
        direccion: formDireccion || null,
        sexo: formSexo,
        estado: true,
        id_empresa: finalEmpresaId,
        id_sucursal: finalSucursalId,
        contrasena: finalHashedPass,
        bloqueado: formBloqueado
      };

      // Assign role
      const newAsignacion = {
        id_persona: nextId,
        id_rol: formRolId,
        fecha_asignacion: new Date().toISOString().replace("T", " ").substring(0, 19),
        asignado_por: 1
      };

      nextDb.personas = [...db.personas, newPersona];
      nextDb.asignacionesRoles = [...db.asignacionesRoles, newAsignacion as any];

      // FIX v2.19: Enviar al backend y ESPERAR respuesta antes de guardar localmente.
      // Si el backend falla, NO guardar en localStorage — el usuario debe existir .
      const payload = {
        id_persona: 0,
        tipo_documento: formTipoDoc,
        numero_documento: formNumDoc,
        nombres: formNombres,
        apellido_paterno: formApPaterno,
        apellido_materno: formApMaterno || null,
        fecha_nacimiento: formBirthday || null,
        telefono: formTel || null,
        correo: formCorreo.trim().toLowerCase(),
        direccion: formDireccion || null,
        sexo: formSexo,
        estado: true,
        id_empresa: finalEmpresaId,
        id_sucursal: finalSucursalId,
        contrasena: finalHashedPass || "",
        bloqueado: formBloqueado,
        id_rol: formRolId
      };

      try {
        const response = await fetch(getApiUrl("save_persona"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.status !== "success") {
          alert("ERROR al crear usuario en la base de datos:\n\n" + (data.message || "Error desconocido") + "\n\nEl usuario NO fue creado.");
          return; // NO guardar localmente, NO cerrar modal
        }
        // Éxito: actualizar el ID real devuelto por el sistema
        if (data.id_persona) {
          newPersona.id_persona = data.id_persona;
        }
        console.log("Usuario creado :", data);
      } catch (err: any) {
        alert("ERROR de conexión al crear usuario:\n\n" + (err?.message || err) + "\n\nVerifique la conexión con el servidor.");
        return; // NO guardar localmente
      }

    } else {
      // Edit User
      nextDb.personas = db.personas.map(p => {
        if (p.id_persona === selectedPersonaId) {
          const updatedPass = formContrasena ? formContrasena : p.contrasena;
          return {
            ...p,
            tipo_documento: formTipoDoc,
            numero_documento: formNumDoc,
            nombres: formNombres,
            apellido_paterno: formApPaterno,
            apellido_materno: formApMaterno || null,
            fecha_nacimiento: formBirthday || null,
            telefono: formTel || null,
            correo: formCorreo.trim().toLowerCase(),
            direccion: formDireccion || null,
            sexo: formSexo,
            id_empresa: finalEmpresaId,
            id_sucursal: finalSucursalId,
            contrasena: updatedPass,
            bloqueado: formBloqueado
          };
        }
        return p;
      });

      // Update role assignment
      nextDb.asignacionesRoles = db.asignacionesRoles.map(a => {
        if (a.id_persona === selectedPersonaId) {
          return {
            ...a,
            id_rol: formRolId
          } as any;
        }
        return a;
      });

      const currentPersonaObj = db.personas.find(p => p.id_persona === selectedPersonaId);
      const updatedPassForApi = formContrasena || "";

      // FIX v2.19: Esperar respuesta del backend antes de guardar localmente
      try {
        const response = await fetch(getApiUrl("save_persona"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_persona: selectedPersonaId,
            tipo_documento: formTipoDoc,
            numero_documento: formNumDoc,
            nombres: formNombres,
            apellido_paterno: formApPaterno,
            apellido_materno: formApMaterno || null,
            fecha_nacimiento: formBirthday || null,
            telefono: formTel || null,
            correo: formCorreo.trim().toLowerCase(),
            direccion: formDireccion || null,
            sexo: formSexo,
            estado: true,
            id_empresa: finalEmpresaId,
            id_sucursal: finalSucursalId,
            contrasena: updatedPassForApi || "",
            bloqueado: formBloqueado,
            id_rol: formRolId
          })
        });
        const data = await response.json();
        if (data.status !== "success") {
          alert("ERROR al actualizar usuario en la base de datos:\n\n" + (data.message || "Error desconocido"));
          return;
        }
        console.log("Usuario actualizado :", data);
      } catch (err: any) {
        alert("ERROR de conexión al actualizar usuario:\n\n" + (err?.message || err));
        return;
      }
    }

    // Registrar en bitácora
    logOperacion("SEGURIDAD", selectedPersonaId ? "Editar usuario" : "Crear usuario", `${formNombres} ${formApPaterno} (${formCorreo})`);

    updateDb(nextDb);
    setShowUserModal(false);
  };

  const handleEditTrigger = (p: Persona) => {
    setSelectedPersonaId(p.id_persona);

    setFormTipoDoc(p.tipo_documento);
    setFormNumDoc(p.numero_documento);
    setFormNombres(p.nombres);
    setFormApPaterno(p.apellido_paterno);
    setFormApMaterno(p.apellido_materno || "");
    setFormBirthday(p.fecha_nacimiento || "");
    setFormTel(p.telefono || "");
    setFormCorreo(p.correo);
    setFormDireccion(p.direccion || "");
    setFormSexo(p.sexo || "M");

    setFormEmpresaId(p.id_empresa || 1);
    setFormSucursalId(p.id_sucursal ?? "null");
    setFormContrasena(p.contrasena || "");
    setFormBloqueado(!!p.bloqueado);

    const asignacion = db.asignacionesRoles.find(a => a.id_persona === p.id_persona);
    if (asignacion) {
      setFormRolId((asignacion as any).id_rol);
    }

    setShowUserModal(true);
  };

  const handleToggleState = (personaId: number) => {
    // Avoid self lock
    if (personaId === 1) {
      alert("No se puede desactivar al Administrador principal del sistema.");
      return;
    }

    // FIX v2.20: Enviar al backend y esperar respuesta
    fetch(getApiUrl("delete_persona"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_persona: personaId })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "success") {
        const nextDb = {
          ...db,
          personas: db.personas.map(p => {
            if (p.id_persona === personaId) return { ...p, estado: !p.estado };
            return p;
          })
        };
        updateDb(nextDb);
        logOperacion("SEGURIDAD", "Cambiar estado usuario", `Usuario ID ${personaId}: ${data.message}`);
      } else {
        alert("Error: " + (data.message || "desconocido"));
      }
    })
    .catch(err => alert("No se pudo conectar con el servidor. Intente nuevamente."));
  };

  // FIX v2.20: Eliminar usuario del sistema
  const handleDeleteUser = (personaId: number) => {
    if (personaId === 1) {
      alert("No se puede eliminar al Administrador principal del sistema.");
      return;
    }

    const persona = db.personas.find(p => p.id_persona === personaId);
    const nombrePersona = persona ? `${persona.nombres} ${persona.apellido_paterno}` : `Usuario #${personaId}`;

    if (!confirm(`¿Está seguro de ELIMINAR al usuario "${nombrePersona}"?\n\nSi el usuario tiene tickets o atenciones asociadas, será DESACTIVADO (no borrado físicamente).\nSi no tiene registros, será eliminado permanentemente de la base de datos.\n\nEsta acción no se puede deshacer.`)) {
      return;
    }

    fetch(getApiUrl("delete_persona"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_persona: personaId })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "success") {
        // Actualizar estado local
        const nextDb = {
          ...db,
          personas: db.personas.filter(p => p.id_persona !== personaId),
          asignacionesRoles: db.asignacionesRoles.filter(a => a.id_persona !== personaId)
        };
        updateDb(nextDb);
        logOperacion("SEGURIDAD", "Eliminar usuario", `${nombrePersona} (ID ${personaId}): ${data.message}`);
        alert("Usuario eliminado: " + data.message);
      } else {
        alert("Error al eliminar: " + (data.message || "desconocido"));
      }
    })
    .catch(err => alert("No se pudo conectar con el servidor. Intente nuevamente."));
  };

  // -------------------------------------------------------------
  // METADATA RESOLVERS
  // -------------------------------------------------------------
  const resolveRoleForUser = (userId: number) => {
    const asig = db.asignacionesRoles?.find(a => Number(a.id_persona) === Number(userId));
    if (!asig) return "Sin rol";
    const rId = Number((asig as any).id_rol);
    const role = db.roles?.find(r => Number(r.id_rol) === rId);
    return role?.nombre || "Sin rol";
  };

  // Filter list — FIX v2.3: Respeta userTypeFilter INTERNOS vs CONTACTOS.
  // INTERNOS = roles 1 (Admin), 2 (Supervisor), 3 (Técnico) y cualquier rol personalizado (id_rol > 4)
  // CONTACTOS = rol 4 (Cliente / Contacto empresarial). Estos NO son usuarios del sistema,
  // son personas registradas como contactos de empresas clientes. No pueden iniciar sesión
  // (a menos que se les asigne un rol interno adicional) y NO aparecen en la lista de usuarios.
  const filteredUsers = useMemo(() => {
    const q = debouncedSearchQuery.toLowerCase();
    return db.personas.filter(p => {
      const matchSearch = p.nombres.toLowerCase().includes(q) ||
        p.apellido_paterno.toLowerCase().includes(q) ||
        p.correo.toLowerCase().includes(q) ||
        p.numero_documento.includes(q);

      if (!matchSearch) return false;

      const roleName = resolveRoleForUser(p.id_persona);
      const isClient = roleName === "Cliente / Contacto empresarial";

      // FIX v2.3: Aplicar userTypeFilter
      if (userTypeFilter === "INTERNOS" && isClient) return false;
      if (userTypeFilter === "CONTACTOS" && !isClient) return false;

      return true;
    });
  }, [db.personas, searchQuery, db.asignacionesRoles, userTypeFilter]);

  // FIX v2.3: Helper para detectar si una persona tiene credenciales de acceso (es usuario real del sistema)
  const hasLoginCredentials = (p: Persona): boolean => {
    // Un usuario "interno" tiene un rol != 4 (no es cliente)
    const asig = db.asignacionesRoles.find(a => a.id_persona === p.id_persona);
    if (!asig) return false;
    const rId = (asig as any).id_rol;
    return rId !== 4 && rId !== undefined && rId !== null;
  };

  // FIX v2.3: Lista de contactos empresariales (rol 4) — son personas de empresas clientes
  // que figuran como contactos en `empresa_contacto`. NO son usuarios del sistema.
  const filteredContactosEmpresariales = useMemo(() => {
    const q = debouncedSearchQuery.toLowerCase();
    // Buscar personas que tengan asignación de rol 4
    const clientPersonaIds = db.asignacionesRoles
      .filter(a => (a as any).id_rol === 4)
      .map(a => a.id_persona);

    // También incluir personas referenciadas en `empresa_contacto` (aunque no tengan asignación)
    const contactoEmpresaPersonaIds = (db.contactosEmpresariales || []).map(c => c.id_persona);

    const allContactoIds = new Set([...clientPersonaIds, ...contactoEmpresaPersonaIds]);

    return db.personas.filter(p => {
      if (!allContactoIds.has(p.id_persona)) return false;
      const matchSearch = p.nombres.toLowerCase().includes(q) ||
        p.apellido_paterno.toLowerCase().includes(q) ||
        p.correo.toLowerCase().includes(q) ||
        p.numero_documento.includes(q);
      return matchSearch;
    });
  }, [db.personas, db.asignacionesRoles, db.contactosEmpresariales, searchQuery]);

  // Permissions Matrix constant
  const PERMISSIONS_MATRIX = [
    { module: "Dashboard & SLAs", admin: "Administrar", supervisor: "Crear, Editar, Exportar", tecnico: "Solo lectura", cliente: "Solo lectura" },
    { module: "Ciclo de Tickets", admin: "Administrar", supervisor: "Administrar", tecnico: "Crear, Editar, Exportar", cliente: "Crear, Solo lectura" },
    { module: "Historial de Cambios", admin: "Solo lectura (Auditor)", supervisor: "Solo lectura (Auditor)", tecnico: "Solo lectura (Auditor)", cliente: "Solo lectura" },
    { module: "Atenciones Técnicas", admin: "Crear, Editar", supervisor: "Crear, Editar, Consultar", tecnico: "Administrar", cliente: "Solo lectura" },
    { module: "Directorio Empresarial", admin: "Administrar", supervisor: "Solo lectura", tecnico: "Solo lectura", cliente: "Solo lectura" },
    { module: "Auditoría de Accesos & Logs", admin: "Administrar (Total)", supervisor: "Solo lectura", tecnico: "Ninguno", cliente: "Ninguno" },
  ];

  // FIX v2.24: Estados para filtros de bitácora
  const [logFechaDesde, setLogFechaDesde] = useState("");
  const [logFechaHasta, setLogFechaHasta] = useState("");
  const [logFilterType, setLogFilterType] = useState<string>("all");

  // Filtrar accesos por fecha y tipo
  const filteredAccesos = useMemo(() => {
    return (db.auditoriaAccesos || []).filter((l: any) => {
      const fechaStr = String(l.fecha_hora || "").substring(0, 10);
      if (logFechaDesde && fechaStr < logFechaDesde) return false;
      if (logFechaHasta && fechaStr > logFechaHasta) return false;
      if (logFilterType !== "all" && l.estado !== logFilterType) return false;
      return true;
    }).reverse();
  }, [db.auditoriaAccesos, logFechaDesde, logFechaHasta, logFilterType]);

  // Filtrar operaciones por fecha
  const filteredOperaciones = useMemo(() => {
    return (db.auditoriaOperaciones || []).filter((op: any) => {
      const fechaStr = String(op.fecha_hora || "").substring(0, 10);
      if (logFechaDesde && fechaStr < logFechaDesde) return false;
      if (logFechaHasta && fechaStr > logFechaHasta) return false;
      return true;
    }).reverse();
  }, [db.auditoriaOperaciones, logFechaDesde, logFechaHasta]);

  // Eliminar bitácora
  const handleClearAuditLogs = () => {
    if (!confirm("¿Está seguro de eliminar los registros de bitácora?\n\nSi no especifica fechas, se eliminarán TODOS los registros.")) return;

    fetch(getApiUrl("clear_audit_logs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "all",
        fecha_desde: logFechaDesde || "",
        fecha_hasta: logFechaHasta || ""
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "success") {
        alert(data.message);
        logOperacion("SEGURIDAD", "Limpiar bitácora", `Fechas: ${logFechaDesde || "inicio"} a ${logFechaHasta || "fin"}`);
        if (typeof window !== "undefined") window.location.reload();
      } else {
        alert("Error: " + (data.message || "desconocido"));
      }
    })
    .catch(err => alert("No se pudo conectar con el servidor. Intente nuevamente."));
  };

  return (
    <div className="space-y-6 text-[#141414]">
      
      {/* Top action block */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b-2 border-[#141414] pb-4">
        <div>
          <h2 className="text-3xl font-serif italic text-[#141414]">Control de Accesos</h2>
          <p className="text-[10px] uppercase font-bold tracking-widest text-[#141414]/70 mt-1">
            Gestione usuarios, roles, permisos y revise los registros de actividad del sistema.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* FIX v2.97 — Botón Actualizar para refrescar bitácora y datos. */}
          <button
            type="button"
            onClick={() => {
              if (onSync) onSync();
            }}
            className="flex items-center gap-1.5 border border-[#141414] bg-white text-[#141414] px-3 py-1.5 text-[10px] font-mono font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
            title="Actualizar datos desde el servidor"
            aria-label="Actualizar"
          >
            ↻ Actualizar
          </button>

          {activeTab === "USUARIOS" && (
            <button
              type="button"
              onClick={() => {
                setSelectedPersonaId(null);
              resetFormStates();
              setShowUserModal(true);
            }}
            className="flex items-center gap-1.5 bg-[#141414] text-[#E4E3E0] border border-[#141414] px-3 py-1.5 text-[11px] font-mono font-bold uppercase hover:bg-[#141414]/90 transition-colors cursor-pointer"
          >
            <UserPlus className="w-4 h-4" /> Registrar Usuario
          </button>
        )}
        </div>
      </div>

      {/* SUB-TABS SELECTOR DE SEGURIDAD */}
      <div className="flex border-b border-[#141414] overflow-x-auto bg-[#E4E3E0] rounded-none">
        {[
          { key: "USUARIOS", label: "USUARIOS Y ROLES" },
          { key: "PERMISOS", label: "MATRIZ DE PERMISOS" },
          { key: "PARAMETROS", label: "⚙️ CONFIGURACIONES DE SISTEMA" },
          { key: "LOGS", label: "REGISTRO DE AUDITORÍA" }
        ].map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key as UserSubTab);
                setSearchQuery("");
              }}
              className={`px-5 py-3.5 border-b-2 text-xs font-mono uppercase transition-colors whitespace-nowrap cursor-pointer ${
                isActive 
                  ? "border-[#141414] text-[#141414] font-bold bg-[#E4E3E0]/60 border-b-3" 
                  : "border-transparent text-[#141414]/60 hover:text-[#141414] hover:bg-[#E4E3E0]/30"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* FILTER ACCORDING TO TAB */}
      {activeTab === "USUARIOS" && (
        <div className="space-y-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 opacity-50" />
            </span>
            <input
              type="text"
              className="text-xs w-full bg-transparent border border-[#141414] pl-9 pr-3 py-2.5 text-[#141414] font-mono focus:bg-white focus:outline-none"
              placeholder="Buscar por nombre, correo electrónico o ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* FIX v2.3: Selector INTERNOS vs CONTACTOS EMPRESARIALES */}
          <div className="flex border border-[#141414] bg-[#E4E3E0]">
            <button
              type="button"
              onClick={() => setUserTypeFilter("INTERNOS")}
              className={`flex-1 px-4 py-2.5 text-xs font-mono font-bold uppercase transition-colors cursor-pointer ${
                userTypeFilter === "INTERNOS"
                  ? "bg-[#141414] text-[#E4E3E0]"
                  : "text-[#141414]/70 hover:bg-[#141414]/10"
              }`}
            >
              🧑‍💻 Usuarios Internos (Administradores / Supervisores / Técnicos)
            </button>
            <button
              type="button"
              onClick={() => setUserTypeFilter("CONTACTOS")}
              className={`flex-1 px-4 py-2.5 text-xs font-mono font-bold uppercase transition-colors cursor-pointer border-l border-[#141414] ${
                userTypeFilter === "CONTACTOS"
                  ? "bg-[#141414] text-[#E4E3E0]"
                  : "text-[#141414]/70 hover:bg-[#141414]/10"
              }`}
            >
              🏢 Contactos de Empresas Clientes (NO inician sesión)
            </button>
          </div>

          {/* DYNAMIC CATEGORY USER CLASSIFICATION TAB SYSTEM */}
          <div className="bg-[#141414] text-[#E4E3E0] px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            {userTypeFilter === "INTERNOS" ? (
              <>🧑‍💻 PERSONAL INTERNO Y CONTROL DE ROLES DE SOPORTE</>
            ) : (
              <>🏢 DIRECTORIO DE CONTACTOS DE EMPRESAS CLIENTES</>
            )}
          </div>
        </div>
      )}

      {/* CORE DISPLAY */}
      <div className="border border-[#141414] bg-white/20 overflow-hidden rounded-none">

        {/* TAB 1: USER LISTING — INTERNOS */}
        {activeTab === "USUARIOS" && userTypeFilter === "INTERNOS" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider font-mono border-b border-[#141414]">
                  <th className="py-3 px-4">Persona ID</th>
                  <th className="py-3 px-4">Nombres y Apellidos</th>
                  <th className="py-3 px-4">Identificación</th>
                  <th className="py-3 px-4">Correo Corporativo</th>
                  <th className="py-3 px-4">Rol Asignado</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/15 text-xs font-mono text-[#141414]">
                {filteredUsers.map((p) => {

                  const roleColors = {
                    "Administrador": "bg-red-500/10 text-red-950 border border-red-500 font-bold",
                    "Supervisor": "bg-yellow-500/10 text-yellow-950 border border-yellow-600 font-bold",
                    "Técnico": "bg-blue-500/10 text-blue-900 border border-blue-500 font-bold",
                    "Cliente / Contacto empresarial": "bg-zinc-500/10 text-zinc-800 border border-zinc-500 font-bold"
                  };

                  const boundRole = resolveRoleForUser(p.id_persona);

                  return (
                    <tr key={p.id_persona} className="hover:bg-[#141414]/5 transition-colors">
                      <td className="py-4 px-4 font-mono font-bold text-[#141414]/50">
                        USER #{p.id_persona}
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-bold text-[#141414] block uppercase text-[12px]">{p.nombres} {p.apellido_paterno} {p.apellido_materno}</span>
                        {p.telefono && <span className="text-[10px] text-[#141414]/65 block mt-0.5">📞 {p.telefono}</span>}
                      </td>
                      <td className="py-4 px-4 font-mono text-[11px] text-[#141414]/75">
                        {p.tipo_documento.toUpperCase()}: {p.numero_documento}
                      </td>
                      <td className="py-4 px-4 font-bold text-[#141414]">
                        {p.correo.toUpperCase()}
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2 py-0.5 border text-[9px] uppercase ${
                          (roleColors as any)[boundRole] || "bg-slate-50 text-slate-600"
                        }`}>
                          {boundRole === "Cliente / Contacto empresarial" ? "Contacto Cliente" : boundRole.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        {p.estado ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase text-emerald-950 bg-emerald-500/10 border border-emerald-500 px-1.5 py-0.5">
                            ACTIVO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase text-zinc-700 bg-zinc-500/10 border border-zinc-500 px-1.5 py-0.5">
                            INACTIVO
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEditTrigger(p)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
                            title="Editar usuario"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleState(p.id_persona)}
                            className={`p-1.5 border border-[#141414] bg-white transition-colors cursor-pointer ${
                              p.estado ? "hover:bg-red-900 hover:text-[#E4E3E0]" : "hover:bg-emerald-600 hover:text-[#E4E3E0]"
                            }`}
                            title={p.estado ? "Desactivar usuario" : "Activar usuario"}
                          >
                            {p.estado ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </button>
                          {p.id_persona !== 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(p.id_persona)}
                              className="p-1.5 border border-red-600 bg-white text-red-600 hover:bg-red-600 hover:text-white transition-colors cursor-pointer"
                              title="Eliminar usuario del sistema"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-zinc-400 italic uppercase font-mono">
                      No se encontraron usuarios internos con el criterio de búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* FIX v2.3: TAB 1B — LISTADO DE CONTACTOS EMPRESARIALES (NO son usuarios del sistema) */}
        {activeTab === "USUARIOS" && userTypeFilter === "CONTACTOS" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider font-mono border-b border-[#141414]">
                  <th className="py-3 px-4">Contacto ID</th>
                  <th className="py-3 px-4">Nombres y Apellidos</th>
                  <th className="py-3 px-4">Empresa Cliente</th>
                  <th className="py-3 px-4">Cargo</th>
                  <th className="py-3 px-4">Correo / Teléfono</th>
                  <th className="py-3 px-4">Acceso al Sistema</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/15 text-xs font-mono text-[#141414]">
                {filteredContactosEmpresariales.map((p) => {
                  // Buscar el contacto empresarial asociado
                  const contacto = (db.contactosEmpresariales || []).find(c => c.id_persona === p.id_persona);
                  const empresa = contacto ? db.empresas.find(e => e.id_empresa === contacto.id_empresa) : null;
                  const empresaNombre = empresa ? (empresa.nombre_comercial || empresa.razon_social) : "—";
                  const cargo = contacto?.cargo || "—";

                  // ¿Tiene acceso al sistema? Solo si tiene rol != 4
                  const tieneAcceso = hasLoginCredentials(p);

                  return (
                    <tr key={p.id_persona} className="hover:bg-[#141414]/5 transition-colors">
                      <td className="py-4 px-4 font-mono font-bold text-[#141414]/50">
                        CNT #{p.id_persona}
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-bold text-[#141414] block uppercase text-[12px]">
                          {p.nombres} {p.apellido_paterno} {p.apellido_materno || ""}
                        </span>
                        <span className="text-[10px] text-zinc-500 block mt-0.5">
                          {p.tipo_documento.toUpperCase()}: {p.numero_documento}
                        </span>
                      </td>
                      <td className="py-4 px-4 uppercase font-bold">
                        {empresaNombre}
                      </td>
                      <td className="py-4 px-4 uppercase text-[11px]">
                        {cargo}
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-bold text-[#141414]">{p.correo}</div>
                        {p.telefono && <div className="text-[10px] text-zinc-500 mt-0.5">📞 {p.telefono}</div>}
                      </td>
                      <td className="py-4 px-4">
                        {tieneAcceso ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase text-emerald-950 bg-emerald-500/10 border border-emerald-500 px-1.5 py-0.5">
                            ✓ TIENE ACCESO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase text-zinc-600 bg-zinc-300/30 border border-zinc-400 px-1.5 py-0.5">
                            ✗ SIN ACCESO
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEditTrigger(p)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
                            title="Editar contacto"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleState(p.id_persona)}
                            className={`p-1.5 border border-[#141414] bg-white transition-colors cursor-pointer ${
                              p.estado ? "hover:bg-red-900 hover:text-[#E4E3E0]" : "hover:bg-emerald-600 hover:text-[#E4E3E0]"
                            }`}
                            title={p.estado ? "Desactivar contacto" : "Activar contacto"}
                          >
                            {p.estado ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </button>
                          {p.id_persona !== 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(p.id_persona)}
                              className="p-1.5 border border-red-600 bg-white text-red-600 hover:bg-red-600 hover:text-white transition-colors cursor-pointer"
                              title="Eliminar contacto"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredContactosEmpresariales.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-zinc-400 italic uppercase font-mono">
                      No se encontraron contactos empresariales con el criterio de búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: AUDIT LOGS PANEL */}
        {activeTab === "LOGS" && (
          <div className="space-y-6">

            {/* FIX v2.24: Filtros por fecha y botones de eliminar bitácora */}
            <div className="border border-[#141414] bg-white/10 p-4 space-y-3">
              <div className="flex items-center gap-2 mb-2 border-b border-[#141414]/20 pb-2">
                <span className="font-serif italic text-xs uppercase font-bold">Filtros de Bitácora</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-[#141414]/65 mb-1 uppercase">Desde</label>
                  <input type="date" value={logFechaDesde} onChange={(e) => setLogFechaDesde(e.target.value)} className="w-full text-xs bg-white border border-[#141414] p-1.5 font-mono focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#141414]/65 mb-1 uppercase">Hasta</label>
                  <input type="date" value={logFechaHasta} onChange={(e) => setLogFechaHasta(e.target.value)} className="w-full text-xs bg-white border border-[#141414] p-1.5 font-mono focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#141414]/65 mb-1 uppercase">Filtrar por</label>
                  <select value={logFilterType} onChange={(e) => setLogFilterType(e.target.value as any)} className="w-full text-xs bg-white border border-[#141414] p-1.5 font-mono focus:outline-none cursor-pointer">
                    <option value="all">Todos</option>
                    <option value="EXITOSO">Solo exitosos</option>
                    <option value="FALLIDO">Solo fallidos</option>
                    <option value="BLOQUEADO">Solo bloqueados</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setLogFechaDesde(""); setLogFechaHasta(""); setLogFilterType("all"); }} className="flex-1 px-2 py-1.5 text-[10px] font-mono font-bold uppercase border border-[#141414] bg-white hover:bg-[#141414] hover:text-[#E4E3E0] cursor-pointer">Limpiar</button>
                  <button type="button" onClick={handleClearAuditLogs} className="flex-1 px-2 py-1.5 text-[10px] font-mono font-bold uppercase border border-red-600 bg-white text-red-600 hover:bg-red-600 hover:text-white cursor-pointer">Eliminar bitácora</button>
                </div>
              </div>
            </div>

            {/* PANEL 1: ACCESS AUTHORIZATION LOGS */}
            <div>
              <div className="bg-[#141414] px-4 py-3 border-b border-[#141414] text-[#E4E3E0] flex items-center justify-between text-xs font-mono uppercase">
                <span className="flex items-center gap-1.5 font-bold">
                  🔐 Bitácora de Control de Acceso
                </span>
                <span className="text-[#E4E3E0]/70 text-[10px]">Total: {filteredAccesos.length}</span>
              </div>

              <div className="overflow-x-auto border border-t-0 border-[#141414]">
                <table className="w-full text-left border-collapse font-mono text-xs">
                  <thead>
                    <tr className="bg-[#E4E3E0]/60 border-b border-[#141414] text-[10px] font-bold uppercase text-[#141414] tracking-wider font-mono">
                      <th className="py-3 px-4">Usuario</th>
                      <th className="py-3 px-4">IP Origen</th>
                      <th className="py-3 px-4">PC / Equipo</th>
                      <th className="py-3 px-4">Fecha y Hora</th>
                      <th className="py-3 px-4">Estado Conexión</th>
                      <th className="py-3 px-4 text-center">Intentos Consecutivos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/15 text-[#141414]">
                    {filteredAccesos.map((l: any) => {
                      const isSuccess = l.estado === "EXITOSO";
                      const isBlocked = l.estado === "BLOQUEADO";

                      return (
                        <tr key={l.id_acceso} className="hover:bg-[#141414]/5 bg-white">
                          <td className="py-3.5 px-4 font-bold">
                            {l.correo.toUpperCase()}
                          </td>
                          <td className="py-3.5 px-4">
                            {l.ip_address}
                          </td>
                          <td className="py-3.5 px-4 text-blue-800 font-bold">
                            {/* FIX v2.86 — Mostrar hostname (nombre de la PC) del usuario que accede. */}
                            {l.hostname || "—"}
                          </td>
                          <td className="py-3.5 px-4">
                            {l.fecha_hora}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`px-1.5 py-0.5 border text-[9px] font-bold uppercase ${
                              isSuccess 
                                ? "bg-emerald-500/10 text-emerald-900 border-emerald-500" 
                                : isBlocked 
                                  ? "bg-red-500/10 text-red-950 border-red-500" 
                                  : "bg-orange-500/10 text-orange-950 border-orange-500"
                            }`}>
                              {l.estado}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {l.intentos_previos}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* PANEL 2: SYSTEM OPERATIONS AUDITING */}
            <div>
              <div className="bg-[#141414] px-4 py-3 border-b border-[#141414] text-[#E4E3E0] flex items-center justify-between text-xs font-mono uppercase">
                <span className="flex items-center gap-1.5 font-bold">
                  📝 BITÁCORA DE AUDITORÍA OPERACIONAL Y TRANSACCIONAL
                </span>
                <span className="text-[#E4E3E0]/85 text-[10px] bg-white/10 border border-white/10 px-2 py-0.5 rounded font-bold font-mono">
                  Total operaciones: {filteredOperaciones.length}
                </span>
              </div>
              <div className="overflow-x-auto border border-t-0 border-[#141414] bg-white">
                <table className="w-full text-left border-collapse font-mono text-xs">
                  <thead>
                    <tr className="bg-[#141414]/5 border-b border-[#141414]/20 text-[10px] font-bold uppercase text-[#141414] tracking-wider font-mono">
                      <th className="py-3 px-4">Fecha y Hora</th>
                      <th className="py-3 px-4">Usuario</th>
                      <th className="py-3 px-4">Módulo</th>
                      <th className="py-3 px-4">Acción</th>
                      <th className="py-3 px-4">Detalle</th>
                      <th className="py-3 px-4">Origen (IP / PC)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-100 text-slate-700">
                    {filteredOperaciones.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-400 font-bold uppercase text-[10px]">
                          No hay operaciones registradas. Presione "↻ Actualizar" para ver las últimas acciones.
                        </td>
                      </tr>
                    ) : (
                      filteredOperaciones.map((op: any) => {
                        return (
                          <tr key={op.id_auditoria} className="hover:bg-slate-50 transition-all bg-white text-slate-800">
                            <td className="py-3 px-4 text-slate-500">{op.fecha_hora}</td>
                            <td className="py-3 px-4 font-bold text-slate-900">{(op.usuario || "—").toUpperCase()}</td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-[9px] font-bold rounded uppercase">
                                {op.modulo || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 border text-[9px] font-extrabold rounded uppercase bg-emerald-500/10 text-emerald-800 border-emerald-500">
                                {op.operacion || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-sans text-[11px] leading-snug font-medium text-slate-800">
                              {op.detalles || "—"}
                            </td>
                            <td className="py-3 px-4 text-blue-700 font-bold text-[10px] font-mono">{op.ip_address || "—"}<br/><span className="text-zinc-500">{op.hostname || ""}</span></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB 3: SYSTEM PERMISSIONS MATRIX */}
        {activeTab === "PERMISOS" && (
          <div className="p-5 font-mono text-xs text-[#141414]">
            
            <div className="bg-[#141414]/5 border-2 border-[#141414] p-4 rounded-none mb-6 flex items-start gap-4">
              <ShieldAlert className="w-5 h-5 text-[#141414] shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-[#141414] text-sm uppercase block">Consola de Control de Roles y Matriz de Privilegios (CRUD)</span>
                <p className="text-[#141414]/75 text-[11px] font-sans leading-relaxed mt-1">
                  Administre los cargos asignables de la organización y configure individualmente los permisos de Ver, Registrar, Modificar, Eliminar, Aprobar, Exportar e Imprimir para cada módulo del aplicativo ERP.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Roles list */}
              <div className="lg:col-span-4 border border-[#141414] bg-white p-4 space-y-4 flex flex-col justify-between">
                <div>
                  <div className="border-b border-[#141414] pb-2 mb-3 flex justify-between items-center">
                    <span className="font-bold uppercase tracking-wider text-[11px]">📋 Directorio de Roles de Usuario</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditRoleId(null);
                        setFormRoleName("");
                        setFormRoleDesc("");
                        setShowRoleModal(true);
                      }}
                      className="bg-[#141414] text-[#E4E3E0] px-2 py-1 text-[9px] font-bold uppercase hover:bg-[#141414]/90 cursor-pointer"
                    >
                      + Nuevo Rol
                    </button>
                  </div>
                  
                  <div className="space-y-2.5 max-h-[450px] overflow-y-auto">
                    {db.roles.map((r) => {
                      const isSelected = r.id_rol === selectedRoleIdForPerms;
                      const isPredefined = r.id_rol <= 4;
                      return (
                        <div 
                          key={r.id_rol}
                          onClick={() => setSelectedRoleIdForPerms(r.id_rol)}
                          className={`border p-3 transition-all cursor-pointer relative ${
                            isSelected 
                              ? "border-[#141414] bg-[#141414]/5 shadow-[2px_2px_0px_#141414]" 
                              : "border-slate-200 hover:border-[#141414]/40"
                          }`}
                        >
                          <div className="flex justify-between items-start pr-12">
                            <div>
                              <span className="font-bold text-xs uppercase tracking-tight block">
                                {r.nombre}
                              </span>
                              <span className="text-[10px] text-slate-500 font-sans block mt-1 leading-normal">
                                {r.descripcion || "Sin descripción disponible."}
                              </span>
                            </div>
                            <span className="text-[9px] font-bold text-slate-400 absolute right-3 top-3">
                              ID_{r.id_rol}
                            </span>
                          </div>

                          <div className="mt-3 flex gap-2 border-t border-[#141414]/10 pt-2 text-[9px]">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditRoleId(r.id_rol);
                                setFormRoleName(r.nombre);
                                setFormRoleDesc(r.descripcion || "");
                                setShowRoleModal(true);
                              }}
                              className="text-indigo-800 font-bold hover:underline py-0.5"
                            >
                              [EDITAR DETALLES]
                            </button>
                            {!isPredefined && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteRole(r.id_rol, r.nombre);
                                }}
                                className="text-red-700 font-bold hover:underline py-0.5 ml-auto"
                              >
                                [ELIMINAR ROL]
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-[#E4E3E0]/30 p-2.5 border border-[#141414]/15 mt-3 text-[10px] text-slate-700 font-sans leading-relaxed">
                  💡 <strong>Parámetro de Resguardo:</strong> Los roles fijos (Administración, Supervisión, Técnico y Cliente) no admiten eliminación física para impedir el bloqueo accidental del sistema.
                </div>
              </div>

              {/* Right Column: Dynamic Permissions checklists */}
              <div className="lg:col-span-8 border border-[#141414] bg-white p-4 flex flex-col justify-between">
                <div>
                  <div className="border-b border-[#141414] pb-2 mb-4">
                    <span className="font-bold uppercase tracking-wider text-[11px]">
                      🛡️ Configurar Facultades del Rol:{" "}
                      <span className="text-red-800 underline bg-red-500/5 px-1 pb-0.5">
                        {db.roles.find(r => r.id_rol === selectedRoleIdForPerms)?.nombre.toUpperCase() || "ADMINISTRADOR"}
                      </span>
                    </span>
                  </div>

                  <div className="overflow-x-auto border border-[#141414]/15 rounded">
                    <table className="w-full text-left font-mono border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-[#141414] text-[#E4E3E0] uppercase text-[9px] tracking-wider font-mono">
                          <th className="py-2.5 px-3 border border-[#141414]">Módulo / Opción</th>
                          <th className="py-2.5 px-2 text-center border border-[#141414]">Ver</th>
                          <th className="py-2.5 px-2 text-center border border-[#141414]">Registrar</th>
                          <th className="py-2.5 px-2 text-center border border-[#141414]">Modificar</th>
                          <th className="py-2.5 px-2 text-center border border-[#141414]">Eliminar</th>
                          <th className="py-2.5 px-2 text-center border border-[#141414]">Aprobar</th>
                          <th className="py-2.5 px-2 text-center border border-[#141414]">Exportar</th>
                          <th className="py-2.5 px-2 text-center border border-[#141414]">Imprimir</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#141414]/10">
                        {[
                          { key: "DASHBOARD", label: "📊 PANEL PRINCIPAL" },
                          { key: "TICKETS", label: "🎫 CONTROL TICKETS Y ATENCIONES" },
                          { key: "CLIENTES", label: "🏢 SOCIOS / CARTERA COMERCIAL" },
                          { key: "GEOGRAFIA", label: "🗺️ DIVISIONES TERRITORIALES" },
                          { key: "SEGURIDAD", label: "🛡️ USUARIOS Y PARÁMETROS" },
                          { key: "REPORTES", label: "📈 MOTOR ESTADÍSTICO & KPI" }
                        ].map((mod) => {
                          const perms = getRolePermissions(selectedRoleIdForPerms)[mod.key] || {
                            ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false
                          };
                          return (
                            <tr key={mod.key} className="hover:bg-slate-50">
                              <td className="py-3 px-3 font-bold bg-[#E4E3E0]/20 border border-[#141414]/10">
                                {mod.label}
                              </td>
                              <td className="py-3 px-2 text-center border border-[#141414]/10">
                                <input
                                  type="checkbox"
                                  checked={perms.ver}
                                  onChange={() => handleTogglePermission(selectedRoleIdForPerms, mod.key, "ver")}
                                  className="cursor-pointer accent-[#141414]"
                                />
                              </td>
                              <td className="py-3 px-2 text-center border border-[#141414]/10">
                                <input
                                  type="checkbox"
                                  checked={perms.registrar}
                                  onChange={() => handleTogglePermission(selectedRoleIdForPerms, mod.key, "registrar")}
                                  className="cursor-pointer accent-[#141414]"
                                />
                              </td>
                              <td className="py-3 px-2 text-center border border-[#141414]/10">
                                <input
                                  type="checkbox"
                                  checked={perms.modificar}
                                  onChange={() => handleTogglePermission(selectedRoleIdForPerms, mod.key, "modificar")}
                                  className="cursor-pointer accent-[#141414]"
                                />
                              </td>
                              <td className="py-3 px-2 text-center border border-[#141414]/10">
                                <input
                                  type="checkbox"
                                  checked={perms.eliminar}
                                  onChange={() => handleTogglePermission(selectedRoleIdForPerms, mod.key, "eliminar")}
                                  className="cursor-pointer accent-[#141414]"
                                />
                              </td>
                              <td className="py-3 px-2 text-center border border-[#141414]/10">
                                <input
                                  type="checkbox"
                                  checked={perms.aprobar}
                                  onChange={() => handleTogglePermission(selectedRoleIdForPerms, mod.key, "aprobar")}
                                  className="cursor-pointer accent-[#141414]"
                                />
                              </td>
                              <td className="py-3 px-2 text-center border border-[#141414]/10">
                                <input
                                  type="checkbox"
                                  checked={perms.exportar}
                                  onChange={() => handleTogglePermission(selectedRoleIdForPerms, mod.key, "exportar")}
                                  className="cursor-pointer accent-[#141414]"
                                />
                              </td>
                              <td className="py-3 px-2 text-center border border-[#141414]/10">
                                <input
                                  type="checkbox"
                                  checked={perms.imprimir}
                                  onChange={() => handleTogglePermission(selectedRoleIdForPerms, mod.key, "imprimir")}
                                  className="cursor-pointer accent-[#141414]"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Warning / Save Panel */}
                <div className="mt-5 space-y-3">
                  {hasUnsavedPerms ? (
                    <div className="bg-amber-50 border border-amber-500 p-3 flex items-center justify-between text-amber-900 text-[11px] font-sans">
                      <span className="flex items-center gap-2">
                        ⚠️ <strong>CAMBIOS PENDIENTES:</strong> Se han modificado los privilegios del rol pero aún no se han guardado en el servidor.
                      </span>
                      <span className="font-bold shrink-0 bg-amber-500 text-white px-2 py-0.5 uppercase tracking-tighter text-[9px]">
                        No Guardado
                      </span>
                    </div>
                  ) : (
                    <div className="bg-emerald-50 border border-emerald-500 p-3 flex items-center justify-between text-emerald-900 text-[11px] font-sans">
                      <span className="flex items-center gap-2">
                        ✓ <strong>SISTEMA AL DÍA:</strong> Todos los privilegios se encuentran debidamente sincronizados y persistidos.
                      </span>
                      <span className="font-bold shrink-0 bg-emerald-600 text-white px-2 py-0.5 uppercase tracking-tighter text-[9px]">
                        Persistido
                      </span>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleSaveAllPermissions}
                      className={`flex-1 py-3 px-4 text-xs font-mono font-bold uppercase transition-all flex items-center justify-center gap-2 border ${
                        hasUnsavedPerms 
                          ? "bg-zinc-900 text-[#E4E3E0] border-[#141414] hover:bg-black cursor-pointer shadow-[3px_3px_0px_#141414]" 
                          : "bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed"
                      }`}
                      disabled={!hasUnsavedPerms}
                    >
                      💾 Guardar Matriz de Permisos
                    </button>
                  </div>
                </div>
              </div>

            </div>

            {/* Render submodal for creating/modifying roles */}
            {showRoleModal && (
              <div className="fixed inset-0 bg-[#141414]/80 z-50 flex items-center justify-center p-4">
                <div className="bg-white border-2 border-[#141414] w-full max-w-md p-5 font-mono text-xs text-[#141414] shadow-[4px_4px_0px_#141414]">
                  <div className="border-b-2 border-[#141414] pb-2 mb-4 flex justify-between items-center bg-[#E4E3E0]/30 p-2">
                    <span className="font-bold uppercase tracking-wider">
                      {editRoleId === null ? " Crear Nuevo Rol" : " Modificar Rol Existente"}
                    </span>
                    <button 
                      type="button" 
                      onClick={() => setShowRoleModal(false)}
                      className="font-bold text-xs bg-white hover:bg-[#141414] hover:text-[#E4E3E0] px-1.5 py-0.5 border border-[#141414] cursor-pointer"
                    >
                      [X]
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block font-bold uppercase tracking-tight mb-1 text-[10px]">Nombre del Rol:</label>
                      <input 
                        type="text"
                        value={formRoleName}
                        onChange={(e) => setFormRoleName(e.target.value)}
                        placeholder="E.g., Auditor de SLA, Soporte Nivel 2"
                        className="w-full bg-white border border-[#141414] p-2 text-xs focus:outline-none"
                        disabled={editRoleId !== null && editRoleId <= 4}
                      />
                    </div>
                    <div>
                      <label className="block font-bold uppercase tracking-tight mb-1 text-[10px]">Descripción / Funciones:</label>
                      <textarea 
                        value={formRoleDesc}
                        onChange={(e) => setFormRoleDesc(e.target.value)}
                        placeholder="Defina las responsabilidades organizacionales atribuidas a este cargo..."
                        rows={3}
                        className="w-full bg-white border border-[#141414] p-2 text-xs focus:outline-none"
                      />
                    </div>
                    <div className="border-t border-[#141414]/20 pt-4 flex justify-end gap-2 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setShowRoleModal(false)}
                        className="bg-white hover:bg-[#141414]/10 border border-[#141414] px-3 py-1.5 font-bold uppercase cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveRole}
                        className="bg-[#141414] text-[#E4E3E0] hover:bg-[#141414]/95 border border-[#141414] px-4 py-1.5 font-bold uppercase cursor-pointer"
                      >
                        Guardar Cambios
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* TAB 4: CONFIGURACIONES DE SISTEMA (PARAMETRIZACIONES) */}
        {activeTab === "PARAMETROS" && (
          <div className="p-6 space-y-8 font-mono text-xs text-[#141414]">
            
            <div className="bg-[#141414]/5 border-2 border-[#141414] p-4 text-[#141414] flex items-start gap-3">
              <Server className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold uppercase tracking-wider block text-[13px]">Consola Central de Parametrizaciones & Catálogos Generales</span>
                <p className="text-[11px] leading-relaxed mt-1 opacity-80 font-sans">
                  Administre las credenciales de correo SMTP, plantillas de notificaciones, estados dinámicos del HelpDesk, tablas maestras de tipos de documentos, políticas de bloqueo y toggles transaccionales de auditoría.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Col 1: SMTP and Email templates */}
              <div className="space-y-6">
                
                {/* SMTP SECTION */}
                <div className="border border-[#141414] bg-white p-5 space-y-4">
                  <div className="border-b border-[#141414] pb-2 font-bold uppercase tracking-wider text-[#141414] flex items-center gap-1.5">
                    📬 Servidor de Correo Corporativo (SMTP)
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase mb-1">Host SMTP</label>
                      <input 
                        type="text" 
                        value={smtpHost} 
                        onChange={(e) => { setSmtpHost(e.target.value); setSmtpValidated(false); }} 
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase mb-1">Puerto SMTP</label>
                      <input 
                        type="number" 
                        value={smtpPort} 
                        onChange={(e) => { setSmtpPort(parseInt(e.target.value) || 587); setSmtpValidated(false); }} 
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs animate-none font-bold" 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold uppercase mb-1">Usuario de Autenticación</label>
                      <input 
                        type="text" 
                        value={smtpUser} 
                        onChange={(e) => { setSmtpUser(e.target.value); setSmtpValidated(false); }} 
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase mb-1">Seguridad</label>
                      <select 
                        value={smtpSec} 
                        onChange={(e) => { setSmtpSec(e.target.value as any); setSmtpValidated(false); }} 
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs text-slate-800 font-bold"
                      >
                        <option value="TLS">STARTTLS (TLS)</option>
                        <option value="SSL">SSL / TLS</option>
                        <option value="NONE">Sin Cifrado</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase mb-1">Cuenta Remitente (Sender)</label>
                      <input 
                        type="email" 
                        value={smtpSender} 
                        onChange={(e) => { setSmtpSender(e.target.value); setSmtpValidated(false); }} 
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs" 
                        placeholder="remitente@soporte.com"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase mb-1">Contraseña Segura</label>
                      <input 
                        type="password" 
                        value={smtpPass} 
                        onChange={(e) => { setSmtpPass(e.target.value); setSmtpValidated(false); }} 
                        placeholder="••••••••••••••"
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs" 
                      />
                    </div>
                  </div>

                  {smtpValidationMsg && (
                    <div className={`p-2.5 text-xs font-mono border ${
                      smtpValidated 
                        ? "bg-emerald-50 text-emerald-900 border-emerald-300" 
                        : "bg-red-50 text-red-900 border-red-300"
                    }`}>
                      {smtpValidationMsg}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      type="button" 
                      disabled={validatingSmtp}
                      onClick={() => {
                        setValidatingSmtp(true);
                        setSmtpValidationMsg(null);
                        setSmtpValidated(false);

                        // If sandbox, simulate checking
                        const isCloud = window.location.hostname.endsWith(".run.app") || window.location.hostname.endsWith(".google.com") || window.location.hostname.includes("aistudio-preview");
                        if (isCloud) {
                          setTimeout(() => {
                            setValidatingSmtp(false);
                            if (!smtpHost) {
                              setSmtpValidationMsg("❌ Servidor no disponible.");
                            } else if (!smtpPort || ![25, 465, 587, 2525, 8025].includes(smtpPort)) {
                              setSmtpValidationMsg("❌ Puerto incorrecto.");
                            } else if (!smtpUser || !smtpUser.includes("@")) {
                              setSmtpValidationMsg("❌ Error de autenticación.");
                            } else if (!smtpSender || !smtpSender.includes("@")) {
                              setSmtpValidationMsg("❌ Error de autenticación. Cuenta remitente inválida.");
                            } else if (smtpPass.length < 3) {
                              setSmtpValidationMsg("❌ Error de autenticación.");
                            } else {
                              setSmtpValidated(true);
                              setSmtpValidationMsg("✅ Conexión Exitosa. El servidor SMTP de desarrollo en la nube respondió correctamente.");
                            }
                          }, 800);
                          return;
                        }

                        const getApiUrl = () => {
                          return getDynamicApiUrl("test_smtp");
                        };

                        fetch(getApiUrl(), {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            smtpHost,
                            smtpPort,
                            smtpUser,
                            smtpPass,
                            smtpSecurity: smtpSec,
                            sender: smtpSender
                          })
                        })
                          .then(res => res.json())
                          .then(data => {
                            setValidatingSmtp(false);
                            if (data.status === "success") {
                              setSmtpValidated(true);
                              setSmtpValidationMsg(data.message || "✅ Conexión Exitosa.");
                            } else {
                              setSmtpValidated(false);
                              setSmtpValidationMsg(data.message || "❌ Servidor no disponible.");
                            }
                          })
                          .catch(err => {
                            setValidatingSmtp(false);
                            setSmtpValidated(false);
                            setSmtpValidationMsg(`❌ Servidor no disponible. Error: ${err.message}`);
                          });
                      }}
                      className="w-full bg-zinc-200 text-[#141414] border border-[#141414] py-2 hover:bg-zinc-300 font-bold uppercase text-[10px] transition-all cursor-pointer disabled:opacity-50"
                    >
                      {validatingSmtp ? "Validando..." : "Validar Configuración SMTP"}
                    </button>

                    <button 
                      type="button" 
                      disabled={!smtpValidated}
                      onClick={() => {
                        if (!db.systemConfig) return;
                        const nextConfig = {
                          ...db.systemConfig,
                          smtpHost,
                          smtpPort,
                          smtpUser,
                          smtpPass,
                          smtpSecurity: smtpSec,
                          smtpSender
                        };
                        updateDb({ ...db, systemConfig: nextConfig });
                        alert("SMTP UPDATE: Credenciales del servidor de correo actualizadas exitosamente en el ERP.");
                      }}
                      className="w-full bg-[#141414] text-[#E4E3E0] py-2 hover:bg-[#141414]/90 font-bold uppercase text-[10px] transition-all cursor-pointer disabled:opacity-50 disabled:bg-zinc-400 disabled:cursor-not-allowed"
                    >
                      Guardar Ajustes SMTP
                    </button>
                  </div>
                </div>

                {/* EMAIL TEMPLATES EDITOR */}
                <div className="border border-[#141414] bg-white p-5 space-y-4">
                  <div className="border-b border-[#141414] pb-2 font-bold uppercase tracking-wider text-[#141414]">
                    📧 Gestor de Plantillas de Notificaciones
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase mb-1">Seleccionar Tipo de Evento</label>
                    <select 
                      value={selectedTemplateId} 
                      onChange={(e) => setSelectedTemplateId(e.target.value)} 
                      className="w-full bg-slate-50 border border-[#141414]/30 p-2 text-xs text-[#141414] font-bold"
                    >
                      {db.systemConfig?.notificationTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.titulo}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase mb-1">Asunto del Correo (Subject)</label>
                    <input 
                      type="text" 
                      value={templateAsunto} 
                      onChange={(e) => setTemplateAsunto(e.target.value)} 
                      className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs font-bold text-[#141414]" 
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase mb-1">Cuerpo del Mensaje (Cuerpo)</label>
                    <textarea 
                      rows={6}
                      value={templateCuerpo} 
                      onChange={(e) => setTemplateCuerpo(e.target.value)} 
                      className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs font-serif leading-relaxed text-[#141414]" 
                    />
                  </div>

                  <div className="bg-amber-50 border border-amber-600/30 p-2 text-[9px] text-amber-950 font-sans leading-relaxed">
                    <strong>Etiquetas de reemplazo autorizadas:</strong><br />
                    Use <code className="font-mono bg-amber-100 px-1 font-bold text-amber-900">{`{NRO_TICKET}`}</code>, <code className="font-mono bg-amber-100 px-1 font-bold text-amber-900">{`{DETALLE}`}</code>, <code className="font-mono bg-amber-100 px-1 font-bold text-amber-900">{`{PRIORIDAD}`}</code>, <code className="font-mono bg-amber-100 px-1 font-bold text-amber-900">{`{USUARIO}`}</code>, <code className="font-mono bg-amber-100 px-1 font-bold text-amber-900">{`{RAZON_SOCIAL}`}</code>, <code className="font-mono bg-amber-100 px-1 font-bold text-amber-900">{`{CONTACTO}`}</code> para dinámicos de base de datos.
                  </div>

                  <button 
                    type="button" 
                    onClick={async () => {
                      // FIX v2.87 — Guardar plantilla en el backend (email_templates.json)
                      try {
                        const response = await fetch(getApiUrl("save_email_template"), {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            template_id: selectedTemplateId,
                            asunto: templateAsunto,
                            cuerpo: templateCuerpo
                          })
                        });
                        const data = await response.json();
                        if (data.status === "success") {
                          // Actualizar estado local
                          setEmailTemplates(prev => ({
                            ...prev,
                            [selectedTemplateId]: { asunto: templateAsunto, cuerpo: templateCuerpo }
                          }));
                          alert("✓ Plantilla guardada exitosamente en el servidor. Los próximos correos usarán esta plantilla.");
                        } else {
                          alert("❌ Error al guardar la plantilla: " + (data.message || "desconocido"));
                        }
                      } catch (err: any) {
                        alert("❌ Error de conexión al guardar la plantilla: " + (err?.message || err));
                      }
                    }}
                    className="w-full bg-[#141414] text-[#E4E3E0] py-2 hover:bg-[#141414]/90 font-bold uppercase text-[10px] transition-all cursor-pointer"
                  >
                    ✓ Guardar Plantilla Seleccionada
                  </button>

                  {/* FIX v2.87 — Botón para enviar email de prueba */}
                  <div className="border-t border-[#141414]/20 pt-3 mt-3 space-y-2">
                    <label className="block text-[10px] font-bold uppercase mb-1">📧 Probar configuración SMTP</label>
                    <div className="flex gap-2">
                      <input 
                        type="email" 
                        value={testEmailTarget} 
                        onChange={(e) => setTestEmailTarget(e.target.value)} 
                        placeholder="correo@ejemplo.com"
                        className="flex-1 bg-slate-50 border border-[#141414]/30 p-2 text-xs text-[#141414]"
                      />
                      <button 
                        type="button" 
                        onClick={async () => {
                          if (!testEmailTarget) {
                            alert("⚠ Ingrese un correo de destino para la prueba.");
                            return;
                          }
                          try {
                            const response = await fetch(getApiUrl("test_email"), {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ to: testEmailTarget })
                            });
                            const data = await response.json();
                            if (data.status === "success") {
                              alert("✓ " + data.message);
                            } else {
                              alert("❌ " + (data.message || "Error al enviar email de prueba"));
                            }
                          } catch (err: any) {
                            alert("❌ No se pudo conectar con el servidor. Intente nuevamente.");
                          }
                        }}
                        className="bg-blue-700 text-white px-3 py-1.5 text-[10px] font-bold uppercase hover:bg-blue-800 cursor-pointer whitespace-nowrap"
                      >
                        📨 Enviar Prueba
                      </button>
                    </div>
                  </div>
                </div>

              </div>

              {/* Col 2: Ticket States catalog and security */}
              <div className="space-y-6">
                
                {/* DETAILED TICKET STATES CATALOG */}
                <div className="border border-[#141414] bg-white p-5 space-y-4">
                  <div className="border-b border-[#141414] pb-2 font-bold uppercase tracking-wider text-[#141414]">
                    🚦 Catálogo Maestro de Estados de Ticket
                  </div>

                  <div className="max-h-52 overflow-y-auto border border-[#141414]/20 rounded">
                    <table className="w-full text-left text-[11px] border-collapse font-mono">
                      <thead>
                        <tr className="bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase font-mono">
                          <th className="py-2 px-3">Código (ID)</th>
                          <th className="py-2 px-3">Nombre</th>
                          <th className="py-2 px-3">Estado</th>
                          <th className="py-2 px-3 text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {db.systemConfig?.ticketStates.map((st) => {
                          return (
                            <tr key={st.id} className="hover:bg-slate-50 bg-white">
                              <td className="py-2 px-3 font-bold text-[#141414]/60">{st.id}</td>
                              <td className="py-2 px-3">
                                <span className="font-bold uppercase tracking-tight">{st.nombre}</span>
                              </td>
                              <td className="py-2 px-3">
                                <span className={`px-1.5 py-0.5 border text-[9px] font-bold uppercase ${
                                  st.activo ? "bg-emerald-500/10 text-emerald-800 border-emerald-500" : "bg-red-500/10 text-red-00 border-red-500"
                                }`}>
                                  {st.activo ? "ACTIVO" : "INACTIVO"}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!db.systemConfig) return;
                                    const nextStates = db.systemConfig.ticketStates.map(s => {
                                      if (s.id === st.id) return { ...s, activo: !s.activo };
                                      return s;
                                    });
                                    updateDb({
                                      ...db,
                                      systemConfig: { ...db.systemConfig, ticketStates: nextStates }
                                    });
                                  }}
                                  className="text-[10px] font-bold uppercase hover:underline text-[#141414] cursor-pointer"
                                >
                                  Tog_Activo
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-slate-50 p-3 border border-[#141414]/15 space-y-3">
                    <span className="font-bold text-[10px] block uppercase text-[#141414]">Agregar Nuevo Estado de Servicio:</span>
                    <div className="grid grid-cols-2 gap-2">
                      <input 
                        type="text" 
                        value={newStateId} 
                        onChange={(e) => setNewStateId(e.target.value.toUpperCase().trim())} 
                        placeholder="REABIERTO" 
                        className="bg-white border border-[#141414]/30 p-2 text-[11px]" 
                      />
                      <input 
                        type="text" 
                        value={newStateName} 
                        onChange={(e) => setNewStateName(e.target.value)} 
                        placeholder="Reabierto" 
                        className="bg-white border border-[#141414]/30 p-2 text-[11px]" 
                      />
                    </div>
                    <button 
                      type="button" 
                      onClick={() => {
                        if (!newStateId || !newStateName) {
                          alert("Defina un identificador y etiqueta del estado.");
                          return;
                        }
                        if (!db.systemConfig) return;
                        if (db.systemConfig.ticketStates.some(st => st.id === newStateId)) {
                          alert("Mapeo existente: El código de estado ya pertenece al catálogo.");
                          return;
                        }
                        const updatedStates = [...db.systemConfig.ticketStates, { id: newStateId, nombre: newStateName, activo: true, color: newStateColor, es_inicial: false }];
                        updateDb({
                          ...db,
                          systemConfig: { ...db.systemConfig, ticketStates: updatedStates }
                        });
                        setNewStateId("");
                        setNewStateName("");
                        alert(`INSERT SUCCESS: Estado '${newStateName}' incorporado al catálogo dinámico.`);
                      }}
                      className="w-full bg-[#141414] text-[#E4E3E0] py-1.5 hover:bg-[#141414]/90 font-bold uppercase text-[9px] transition-all cursor-pointer"
                    >
                      ✓ Registrar Estado en Catálogo
                    </button>
                  </div>
                </div>

                {/* DETAILED DOCUMENT TYPES CATALOG */}
                <div className="border border-[#141414] bg-white p-5 space-y-4">
                  <div className="border-b border-[#141414] pb-2 font-bold uppercase tracking-wider text-[#141414]">
                    📄 Mantenimiento Catálogo de Tipos de Documento
                  </div>

                  <div className="max-h-52 overflow-y-auto border border-[#141414]/20 rounded">
                    <table className="w-full text-left text-[11px] border-collapse font-mono">
                      <thead>
                        <tr className="bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase font-mono">
                          <th className="py-2 px-3">ID</th>
                          <th className="py-2 px-3">Descripción</th>
                          <th className="py-2 px-3 text-center">Longitud</th>
                          <th className="py-2 px-3 text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {db.systemConfig?.documentTypes.map((dt) => {
                          return (
                            <tr key={dt.id} className="hover:bg-slate-50 bg-white">
                              <td className="py-2 px-3 font-bold text-[#141414]/60">{dt.id}</td>
                              <td className="py-2 px-3">
                                <span className="font-bold uppercase tracking-tight">{dt.nombre}</span>
                              </td>
                              <td className="py-2 px-3 text-center font-bold">
                                {dt.longitud_requerida} chars
                              </td>
                              <td className="py-2 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!db.systemConfig) return;
                                    const nextDocs = db.systemConfig.documentTypes.map(d => {
                                      if (d.id === dt.id) return { ...d, activo: !d.activo };
                                      return d;
                                    });
                                    updateDb({
                                      ...db,
                                      systemConfig: { ...db.systemConfig, documentTypes: nextDocs }
                                    });
                                  }}
                                  className="text-[10px] font-bold uppercase hover:underline text-[#141414] cursor-pointer"
                                >
                                  Toggle_Activo
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-slate-50 p-3 border border-[#141414]/15 space-y-3">
                    <span className="font-bold text-[10px] block uppercase text-[#141414]">Agregar Nuevo Tipo de Identificación:</span>
                    <div className="grid grid-cols-3 gap-2">
                      <input 
                        type="text" 
                        value={newDocId} 
                        onChange={(e) => setNewDocId(e.target.value.toUpperCase().trim())} 
                        placeholder="CURP" 
                        className="bg-white border border-[#141414]/30 p-2 text-[11px] col-span-1" 
                      />
                      <input 
                        type="text" 
                        value={newDocName} 
                        onChange={(e) => setNewDocName(e.target.value)} 
                        placeholder="Clave Unica Población" 
                        className="bg-white border border-[#141414]/30 p-2 text-[11px] col-span-1" 
                      />
                      <input 
                        type="number" 
                        value={newDocLength} 
                        onChange={(e) => setNewDocLength(parseInt(e.target.value) || 18)} 
                        placeholder="18" 
                        className="bg-white border border-[#141414]/30 p-2 text-[11px] col-span-1 font-bold" 
                      />
                    </div>
                    <button 
                      type="button" 
                      onClick={() => {
                        if (!newDocId || !newDocName) {
                          alert("Defina un identificador y etiqueta del documento.");
                          return;
                        }
                        if (!db.systemConfig) return;
                        if (db.systemConfig.documentTypes.some(dt => dt.id === newDocId)) {
                          alert("Mapeo existente: El código de documento ya pertenece al catálogo.");
                          return;
                        }
                        const updatedDocs = [...db.systemConfig.documentTypes, { id: newDocId, nombre: newDocName, activo: true, longitud_requerida: newDocLength }];
                        updateDb({
                          ...db,
                          systemConfig: { ...db.systemConfig, documentTypes: updatedDocs }
                        });
                        setNewDocId("");
                        setNewDocName("");
                        setNewDocLength(8);
                        alert(`INSERT SUCCESS: Tipo documento '${newDocName}' incorporado al catálogo dinámico.`);
                      }}
                      className="w-full bg-[#141414] text-[#E4E3E0] py-1.5 hover:bg-[#141414]/90 font-bold uppercase text-[9px] transition-all cursor-pointer"
                    >
                      ✓ Registrar Tipo de Documento
                    </button>
                  </div>
                </div>

                {/* SECURITY POLICIES SECTION */}
                <div className="border border-[#141414] bg-white p-5 space-y-4">
                  <div className="border-b border-[#141414] pb-2 font-bold uppercase tracking-wider text-[#141414]">
                    🛡️ Directrices de Seguridad & Bloqueos de Cuenta
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase mb-1">Intentos Permitidos</label>
                      <input 
                        type="number" 
                        value={maxAttempts} 
                        onChange={(e) => setMaxAttempts(parseInt(e.target.value) || 3)} 
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs font-bold" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase mb-1">Cooldown de Bloqueo (seg)</label>
                      <input 
                        type="number" 
                        value={lockoutSeconds} 
                        onChange={(e) => setLockoutSeconds(parseInt(e.target.value) || 30)} 
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs font-bold" 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase mb-1">Inactividad Cierre (min)</label>
                      <input 
                        type="number" 
                        value={inactivityMinutes} 
                        onChange={(e) => setInactivityMinutes(parseInt(e.target.value) || 15)} 
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs font-bold" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase mb-1">Expiración Clave (días)</label>
                      <input 
                        type="number" 
                        value={pwdExpireDays} 
                        onChange={(e) => setPwdExpireDays(parseInt(e.target.value) || 90)} 
                        className="w-full bg-slate-50 border border-[#141414]/20 p-2 text-xs font-bold" 
                      />
                    </div>
                  </div>

                  <div className="border-t border-[#141414]/15 pt-3 space-y-2">
                    <span className="font-bold text-[10px] uppercase block tracking-wider text-[#141414]">Monitoreo y Toggles Transaccionales de Auditoría:</span>
                    
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={logEmpresas} onChange={(e) => setLogEmpresas(e.target.checked)} />
                        <span>Log_Empresas CRUD</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={logSucursales} onChange={(e) => setLogSucursales(e.target.checked)} />
                        <span>Log_Sucursales CRUD</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={logTickets} onChange={(e) => setLogTickets(e.target.checked)} />
                        <span>Log_Tickets CRUD</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={logUsuarios} onChange={(e) => setLogUsuarios(e.target.checked)} />
                        <span>Log_Usuarios CRUD</span>
                      </label>
                    </div>
                  </div>

                  <button 
                    type="button" 
                    onClick={() => {
                      if (!db.systemConfig) return;
                      const nextConfig = {
                        ...db.systemConfig,
                        security: {
                          intentosMaximos: maxAttempts,
                          tiempoBloqueoSegundos: lockoutSeconds,
                          inactividadMinutos: inactivityMinutes,
                          vencimientoContrasenaDias: pwdExpireDays,
                          dobleFactorOpcional: mfaOptional
                        },
                        auditConfig: {
                          logEmpresas,
                          logSucursales,
                          logTickets,
                          logUsuarios,
                          logGeografico
                        }
                      };
                      updateDb({ ...db, systemConfig: nextConfig });
                      alert("CONFIRMACIÓN: Políticas de seguridad, acceso y bloqueo de cuentas actualizadas exitosamente.");
                    }}
                    className="w-full bg-[#141414] text-[#E4E3E0] py-2 hover:bg-[#141414]/95 font-bold uppercase text-[10px] transition-all cursor-pointer"
                  >
                    ✓ Guardar Políticas de Seguridad & Toggles
                  </button>
                </div>

              </div>

            </div>

          </div>
        )}

      </div>

      {/* USER FORM DIALOG MODAL */}
      {showUserModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-xl w-full max-h-[90vh] overflow-y-auto text-xs">
            
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-800 text-sm">
                {selectedPersonaId === null ? "Registrar Operador en Base de Datos" : "Editar Datos de Persona de Sistema"}
              </h3>
            </div>

            <form onSubmit={handleSaveUser} className="p-5 space-y-4">
              
              <div className="grid grid-cols-2 gap-3">
                
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tipo Documento <span className="text-red-500">*</span></label>
                  <select
                    required
                    value={formTipoDoc}
                    onChange={(e) => setFormTipoDoc(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-slate-800 focus:outline-none"
                  >
                    <option value="DNI">DNI (Perú)</option>
                    <option value="CE">Cédula Extranjería (CE)</option>
                    <option value="PASAPORTE">Pasaporte</option>
                    <option value="RUC">RUC Corporativo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Nro de Documento</label>
                  <input
                    type="text"
                    value={formNumDoc}
                    onChange={(e) => setFormNumDoc(e.target.value)}
                    placeholder="44558899"
                    className="w-full bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Nombres <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={formNombres}
                    onChange={(e) => setFormNombres(e.target.value)}
                    placeholder="Enrique"
                    className="w-full bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Apellido Paterno <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={formApPaterno}
                    onChange={(e) => setFormApPaterno(e.target.value)}
                    placeholder="Carrillo"
                    className="w-full bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Apellido Materno</label>
                  <input
                    type="text"
                    value={formApMaterno}
                    onChange={(e) => setFormApMaterno(e.target.value)}
                    placeholder="Soto"
                    className="w-full bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Fec. Nacimiento</label>
                  <input
                    type="date"
                    value={formBirthday}
                    onChange={(e) => setFormBirthday(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded p-1.5"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Teléfono Personal</label>
                  <input
                    type="text"
                    value={formTel}
                    onChange={(e) => setFormTel(e.target.value)}
                    placeholder="+51 988776655"
                    className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Sexo</label>
                  <select
                    value={formSexo}
                    onChange={(e) => setFormSexo(e.target.value as "M" | "F")}
                    className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-slate-800"
                  >
                    <option value="M">Varón (M)</option>
                    <option value="F">Mujer (F)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Correo Electrónico (Login ID) <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  required
                  value={formCorreo}
                  onChange={(e) => setFormCorreo(e.target.value)}
                  placeholder="operador@soporte.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded p-2"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Dirección Domiciliaria</label>
                <input
                  type="text"
                  value={formDireccion}
                  onChange={(e) => setFormDireccion(e.target.value)}
                  placeholder="Calle Las Palmeras Nro 124, Dpto 204"
                  className="w-full bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none"
                />
              </div>

               {/* ASOCIACIÓN DE EMPRESA Y SUCURSAL */}
              {formRolId === 4 ? (
                <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200 grid grid-cols-2 gap-3 font-sans">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Empresa Asociada *</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        readOnly
                        className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-semibold focus:outline-none font-mono text-xs"
                        value={db.empresas.find(emp => emp.id_empresa === formEmpresaId)?.razon_social || ""}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEmpresaSearchQuery("");
                          setShowEmpresaSearchModal(true);
                        }}
                        className="bg-slate-900 hover:bg-slate-850 text-white px-2 py-1 text-[11px] font-bold uppercase rounded cursor-pointer"
                      >
                        Buscar
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Sucursal Asociada (Opcional)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        readOnly
                        className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 focus:outline-none font-mono text-xs"
                        value={formSucursalId === "null" ? "SIN SUCURSAL (ACCESO CENTRAL)" : (db.sucursales.find(suc => suc.id_sucursal === formSucursalId)?.nombre || "")}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setSucursalSearchQuery("");
                          setShowSucursalSearchModal(true);
                        }}
                        className="bg-slate-900 hover:bg-slate-850 text-white px-2 py-1 text-[11px] font-bold uppercase rounded cursor-pointer"
                      >
                        Buscar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-blue-50/80 border border-blue-200 p-3.5 rounded-xl font-sans flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-blue-900 uppercase">💼 COBERTURA CORPORATIVA GLOBAL (Soporte Interno)</span>
                  <p className="text-[10px] text-blue-700 leading-normal">
                    Este usuario tiene un rol de soporte del sistema (<strong>{db.roles.find(r => r.id_rol === formRolId)?.nombre || "Operativo"}</strong>). 
                    <strong> No requiere asociarse a una sola empresa</strong> ya que dispone de visibilidad global para registrar y gestionar tickets de cualquier organización.
                  </p>
                </div>
              )}

              {/* CONTRASEÑA Y ESTADO DE BLOQUEO DE SEGURIDAD */}
              <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-[#141414] uppercase mb-1">Contraseña ERP / SQL</label>
                  <input
                    type="text"
                    value={formContrasena}
                    onChange={(e) => setFormContrasena(e.target.value)}
                    placeholder="Mínimo 8 caracteres (A-Z, 0-9)"
                    className="w-full bg-white border border-slate-200 rounded p-2 text-[#141414] font-mono focus:outline-none font-bold"
                  />
                </div>

                <div className="flex flex-col justify-center pl-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Bloqueo de Seguridad</label>
                  <label className="flex items-center gap-2 cursor-pointer mt-1 bg-white border border-red-200 rounded p-1.5 px-3 self-start hover:bg-red-50 text-red-950 font-bold font-mono">
                    <input
                      type="checkbox"
                      checked={formBloqueado}
                      onChange={(e) => setFormBloqueado(e.target.checked)}
                      className="accent-red-700 font-bold"
                    />
                    <span>{formBloqueado ? "⚠️ BLOQUEADO" : "✅ NORMAL"}</span>
                  </label>
                </div>
              </div>

              <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200">
                <span className="font-bold text-slate-600 block mb-2">🔑 Asignación de Rol de Seguridad (Persona_Rol)</span>
                
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Rol Operativo</label>
                  <select
                    value={formRolId}
                    onChange={(e) => setFormRolId(parseInt(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-semibold"
                  >
                    {db.roles.filter(r => r.nombre !== "Cliente / Contacto empresarial").map(r => (
                      <option key={r.id_rol} value={r.id_rol}>{r.nombre} - [ {r.descripcion?.substring(0, 48)}... ]</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
                >
                  Guardar Cambios
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* DIALOGS FOR MASTER CATALOGS (NUEVAS VENTANAS DE SELECCIÓN) */}

      {/* 1. SELECCIÓN DE EMPRESA */}
      {showEmpresaSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in-quick">
          <div className="bg-[#E4E3E0] max-w-lg w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[80vh] font-mono text-[#141414] text-xs">
            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">🔎 BUSCAR Y SELECCIONAR EMPRESA</span>
              <button 
                type="button"
                onClick={() => setShowEmpresaSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>
            <div className="p-3 bg-zinc-200 border-b border-[#141414]">
              <input
                type="text"
                autoFocus
                placeholder="RUC O NOMBRE DE EMPRESA..."
                value={empresaSearchQuery}
                onChange={(e) => setEmpresaSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">RUC</th>
                    <th className="p-2 border-r border-[#141414]">Razón Social / Comercial</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45 bg-white">
                  {db.empresas
                    .filter(e => e.ruc.includes(empresaSearchQuery) || e.razon_social.toLowerCase().includes(empresaSearchQuery.toLowerCase()) || (e.nombre_comercial && e.nombre_comercial.toLowerCase().includes(empresaSearchQuery.toLowerCase())))
                    .map(e => (
                      <tr 
                        key={e.id_empresa} 
                        className="hover:bg-[#141414]/5 cursor-pointer" 
                        onClick={() => {
                          setFormEmpresaId(e.id_empresa);
                          setFormSucursalId("null"); // Reset cascade
                          setShowEmpresaSearchModal(false);
                        }}
                      >
                        <td className="p-2 border-r border-[#141414] font-bold">{e.ruc}</td>
                        <td className="p-2 border-r border-[#141414] uppercase">{e.nombre_comercial || e.razon_social}</td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                          >
                            [Seleccionar]
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-[#141414] bg-zinc-200 text-right">
              <button
                type="button"
                onClick={() => setShowEmpresaSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. SELECCIÓN DE SUCURSAL */}
      {showSucursalSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in-quick">
          <div className="bg-[#E4E3E0] max-w-md w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[80vh] font-mono text-[#141414] text-xs">
            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">🔎 BUSCAR Y SELECCIONAR SUCURSAL</span>
              <button 
                type="button"
                onClick={() => setShowSucursalSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>
            <div className="p-3 bg-zinc-200 border-b border-[#141414]">
              <input
                type="text"
                autoFocus
                placeholder="FILTRAR POR NOMBRE DE SUCURSAL..."
                value={sucursalSearchQuery}
                onChange={(e) => setSucursalSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">Sede ID</th>
                    <th className="p-2 border-r border-[#141414]">Establecimiento</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45 bg-white">
                  <tr 
                    className="hover:bg-[#141414]/5 cursor-pointer text-indigo-900 font-bold" 
                    onClick={() => {
                      setFormSucursalId("null");
                      setShowSucursalSearchModal(false);
                    }}
                  >
                    <td className="p-2 border-r border-[#141414]">SED_NULL</td>
                    <td className="p-2 border-r border-[#141414] uppercase">-- Sin sucursal (Acceso Corporativo Central) --</td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        className="bg-indigo-900 text-white hover:bg-indigo-950 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                      >
                        [Quitar]
                      </button>
                    </td>
                  </tr>
                  {db.sucursales
                    .filter(s => s.id_empresa === formEmpresaId)
                    .filter(s => s.nombre.toLowerCase().includes(sucursalSearchQuery.toLowerCase()))
                    .map(s => (
                      <tr 
                        key={s.id_sucursal} 
                        className="hover:bg-[#141414]/5 cursor-pointer" 
                        onClick={() => {
                          setFormSucursalId(s.id_sucursal);
                          setShowSucursalSearchModal(false);
                        }}
                      >
                        <td className="p-2 border-r border-[#141414] font-bold">SED_{s.id_sucursal}</td>
                        <td className="p-2 border-r border-[#141414] uppercase">{s.nombre}</td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                          >
                            [Seleccionar]
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-[#141414] bg-zinc-200 text-right">
              <button
                type="button"
                onClick={() => setShowSucursalSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
