/**
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ErrorLogDetails {
  timestamp: string;
  user: string;
  requestedUrl: string;
  exceptionName: string;
  exceptionMessage: string;
  stackTrace: string;
  sqlServiceStatus: string;
  diagnosticInfo: any;
}

/**
 * Logs technical error details in the console for system support and administrators to inspect,
 * while preventing end-users from seeing raw infrastructure details in the main application UI.
 */
export function logTechnicalError(
  error: any,
  context: {
    url?: string;
    sqlStatus?: string;
    customInfo?: any;
    currentUser?: any;
  }
) {
  const timestamp = new Date().toISOString();
  
  let userDetails = "Usuario no autenticado / Sesión no iniciada";
  if (context.currentUser) {
    const u = context.currentUser;
    userDetails = `ID: #${u.id_persona || u.id_usuario || "N/A"} - ${u.nombres || ""} ${u.apellido_paterno || ""} (${u.correo || "Sin correo"})`;
  }

  const requestedUrl = context.url || window.location.href;
  const exceptionName = error instanceof Error ? error.name : "SystemException";
  const exceptionMessage = error instanceof Error ? error.message : String(error);
  const stackTrace = error instanceof Error && error.stack ? error.stack : "No Stack Trace Available";
  const sqlServiceStatus = context.sqlStatus || "SQL_SERVICE_ERROR_DISCONNECTED";
  const diagnosticInfo = context.customInfo || {};

  const structuredLog: ErrorLogDetails = {
    timestamp,
    user: userDetails,
    requestedUrl,
    exceptionName,
    exceptionMessage,
    stackTrace,
    sqlServiceStatus,
    diagnosticInfo,
  };

  // Structured print in developers' and server console logs
  console.error(
    `%c[SOPORTE ERP - LOG DIAGNÓSTICO INTERNO] %cError registrado a las ${timestamp}`,
    "background: #141414; color: #ff5555; font-weight: bold; padding: 3px; font-family: monospace;",
    "color: #ff3333; font-weight: normal; font-family: monospace;"
  );
  console.error("Detalles del Diagnóstico Técnico de Infraestructura:", JSON.stringify(structuredLog, null, 2));
  console.error(
    `%c[FIN REGISTRO DIAGNÓSTICO INTERNO]`,
    "background: #141414; color: #ff5555; font-weight: bold; padding: 2px; font-family: monospace;"
  );
}

/**
 * Returns generic, clean, user-friendly messages for any infrastructure failures.
 */
export function getFriendlyErrorMessage(errorType: "connection" | "database" | "server" | "generic"): string {
  switch (errorType) {
    case "connection":
      return "El sistema no se encuentra disponible en este momento.";
    case "database":
      return "No fue posible completar la operación. Intente nuevamente en unos minutos.";
    case "server":
    case "generic":
    default:
      return "Se presentó un inconveniente temporal. Si el problema persiste, comuníquese con el administrador del sistema.";
  }
}
