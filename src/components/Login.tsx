/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Shield, KeyRound, Mail, AlertTriangle, RefreshCw, UserCheck, Eye, EyeOff } from "lucide-react";
import { MockDatabase } from "../db/mockDb";
import { Persona, AccesoAuditoria } from "../types";
import { getApiUrl } from "../utils/api";

// Fast SHA-256 helper for password security hashing
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

interface LoginProps {
  db: MockDatabase;
  onLoginSuccess: (user: Persona, roleName: string) => void;
  updateDb: (newDb: MockDatabase) => void;
}

export function Login({ db, onLoginSuccess, updateDb }: LoginProps) {
  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("remember_me") === "true";
    }
    return false;
  });

  const [email, setEmail] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("remembered_email");
      return saved || "";
    }
    return "";
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockTimer, setBlockTimer] = useState(0);
  
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoverySuccess, setRecoverySuccess] = useState(false);

  // Password Reset state (Token simulation)
  const [resetTokenActive, setResetTokenActive] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetSuccessMsg, setResetSuccessMsg] = useState("");

  // Filter default passwords info popup for fast review helper
  const [showFaq, setShowFaq] = useState(false);

  // Load block options from systemConfig
  const lockLimit = db.systemConfig?.security?.intentosMaximos || 3;
  const cooldownSeconds = db.systemConfig?.security?.tiempoBloqueoSegundos || 30;

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isBlocked && blockTimer > 0) {
      interval = setInterval(() => {
        setBlockTimer((prev) => {
          if (prev <= 1) {
            setIsBlocked(false);
            setAttempts(0);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isBlocked, blockTimer]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBlocked) return;

    setError(null);
    setSuccess(null);

    const matchEmail = email.trim().toLowerCase();
    
    try {
      // Use PHP authentication API
      const apiUrl = getApiUrl("authenticate");
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo: matchEmail,
          contrasena: password
        })
      });

      const data = await response.json();

      if (data.status === "success") {
        // Manage explicit credential remembering
        if (rememberMe) {
          localStorage.setItem("remember_me", "true");
          localStorage.setItem("remembered_email", email);
        } else {
          localStorage.removeItem("remember_me");
          localStorage.removeItem("remembered_email");
        }

        const user = data.user;
        const targetRole = user.rol_nombre || "Externo";

        // Check role restrictions
        if (targetRole === "Cliente / Contacto empresarial") {
          setError("Este tipo de usuario no tiene acceso al sistema. Si cree que es un error, contacte al administrador.");
          return;
        }

        setSuccess(`¡Ingreso exitoso como ${user.nombres} (${targetRole})! Redirigiendo a consola de servicios...`);
        setAttempts(0);
        
        const p = {
          id_persona: user.id_persona,
          tipo_documento: user.tipo_documento,
          numero_documento: user.numero_documento,
          nombres: user.nombres,
          apellido_paterno: user.apellido_paterno,
          apellido_materno: user.apellido_materno,
          correo: user.correo,
          telefono: user.telefono,
          estado: user.estado,
          bloqueado: user.bloqueado,
          id_empresa: user.id_empresa,
          id_sucursal: user.id_sucursal
        } as Persona;
        
        setTimeout(() => {
          onLoginSuccess(p, targetRole);
        }, 800);
      } else {
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);
        
        if (response.status === 403 || data.message?.toLowerCase().includes("bloquead")) {
          setIsBlocked(true);
          setBlockTimer(cooldownSeconds);
          setError(data.message || "Cuenta bloqueada temporalmente. Por favor, espere o use el botón de restauración.");
        } else {
          setError(data.message || `Credenciales incorrectas. Intento ${nextAttempts} de ${lockLimit} antes de bloqueo.`);
          
          if (nextAttempts >= lockLimit) {
            setIsBlocked(true);
            setBlockTimer(cooldownSeconds);
          }
        }
      }
    } catch (err) {
      console.error("Authentication error:", err);
      setError("Error de conexión con el servidor. Por favor, intente nuevamente.");
    }
  };

  const handleRecovery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryEmail.trim()) return;

    // FIX v2.31: Llamar al backend para recuperar contraseña por correo
    const apiUrl = getApiUrl("recover_password");
    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: recoveryEmail.trim().toLowerCase() })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "success") {
        setRecoverySuccess(true);
        setError(null);
        // Si hay contraseña temporal (no se pudo enviar por correo), mostrarla
        if (data.temp_password) {
          setResetSuccessMsg(`Tu contraseña temporal es: ${data.temp_password}\n\nÚsala para iniciar sesión y luego cámbiala.`);
        } else {
          setResetSuccessMsg("Se ha enviado una contraseña temporal a tu correo electrónico. Revisa tu bandeja de entrada.");
        }
      } else {
        setError(data.message || "No se pudo procesar la solicitud.");
      }
    })
    .catch(err => {
      setError("Error de conexión. Intente nuevamente.");
      console.error("Recovery error:", err);
    });
  };

  // Perform secure password restore
  const handleResetPasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError("Seguridad insuficiente: La contraseña nueva debe tener al menos 6 caracteres.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Fallo de coincidencia: Ambas contraseñas deben ser exactamente idénticas.");
      return;
    }

    const nextPersonas = db.personas.map(p => {
      if (p.correo.toLowerCase() === recoveryEmail.toLowerCase().trim()) {
        // Update password and unlock them simultaneously!
        return { ...p, contrasena: newPassword, bloqueado: false };
      }
      return p;
    });

    updateDb({ ...db, personas: nextPersonas });
    setResetSuccessMsg("¡Contraseña restablecida exitosamente! Cuenta desbloqueada. Ingrese con sus nuevas credenciales.");
    setResetTokenActive(false);
  };

  const forceUnlock = () => {
    setIsBlocked(false);
    setAttempts(0);
    setBlockTimer(0);
    setError(null);

    // Persistently unlock accounts in DB too
    const nextPersonas = db.personas.map(p => {
      if (p.correo.toLowerCase() === email.trim().toLowerCase()) {
        return { ...p, bloqueado: false };
      }
      return p;
    });
    updateDb({ ...db, personas: nextPersonas });
  };

  return (
    <div className="flex min-h-screen bg-[#E4E3E0] text-[#141414] flex-col justify-center py-12 sm:px-6 lg:px-8 relative font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="flex flex-col items-center justify-center gap-2 mb-6">
          <div className="border border-[#141414] p-2 bg-[#141414] text-[#E4E3E0]">
            <Shield className="w-8 h-8" />
          </div>
          <span className="text-3xl font-serif italic tracking-wide text-[#141414]">
            ERP SOPORTE
          </span>
          <p className="text-[10px] uppercase font-bold tracking-widest text-[#141414]/65">
            Plataforma de Atención y Soporte Técnico
          </p>
        </div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="bg-[#E4E3E0] border-2 border-[#141414] p-8 shadow-[6px_6px_0px_0px_#141414]">
          
          {!recoveryMode ? (
            <form onSubmit={handleLogin} className="space-y-6">
              
              {/* Header block */}
              <div className="border-b border-[#141414] pb-3 mb-4">
                <h3 className="text-xs uppercase font-extrabold tracking-wider text-[#141414]">Iniciar sesión</h3>
                <p className="text-[11px] font-serif italic text-[#141414]/70">
                  Ingrese su correo electrónico y contraseña para acceder al sistema
                </p>
              </div>

              {/* General Alerts */}
              {error && (
                <div id="login-error" className="bg-red-100 border border-red-700 text-red-950 p-3 text-xs font-mono space-y-1">
                  <div className="font-bold flex items-center gap-1.5 uppercase">
                    <AlertTriangle className="w-4 h-4 text-red-750 shrink-0" /> Aviso
                  </div>
                  <div>
                    <span>{error}</span>
                    {isBlocked && (
                      <button
                        type="button"
                        onClick={forceUnlock}
                        className="block mt-2 font-bold underline cursor-pointer"
                      >
                        Desbloquear cuenta
                      </button>
                    )}
                  </div>
                </div>
              )}

              {success && (
                <div id="login-success" className="bg-emerald-100 border border-emerald-700 text-emerald-950 p-3 text-xs font-mono flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-emerald-850 shrink-0" />
                  <span>{success}</span>
                </div>
              )}

              {/* Inputs */}
              <div className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-[11px] font-bold uppercase tracking-wider text-[#141414]/80">
                    Correo Electrónico
                  </label>
                  <div className="mt-1 relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-4.5 w-4.5 text-[#141414]" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      required
                      disabled={isBlocked}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2 bg-white/50 border border-[#141414] text-[#141414] text-sm font-mono focus:outline-none focus:bg-white"
                      placeholder="ejemplo@soporte.com"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="block text-[11px] font-bold uppercase tracking-wider text-[#141414]/80">
                      Contraseña
                    </label>
                    <button
                      type="button"
                      onClick={() => setRecoveryMode(true)}
                      className="text-xs font-serif italic hover:underline text-[#141414]"
                    >
                      ¿Olvidó contraseña?
                    </button>
                  </div>
                  <div className="mt-1 relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <KeyRound className="h-4.5 w-4.5 text-[#141414]" />
                    </div>
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      disabled={isBlocked}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full pl-10 pr-10 py-2 bg-white/50 border border-[#141414] text-[#141414] text-sm font-mono focus:outline-none focus:bg-white"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#141414]/60 hover:text-[#141414]"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Opción Recordarme */}
              <div className="flex items-center">
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 accent-[#141414] text-[#141414] focus:ring-[#141414] border-[#141414] rounded-none cursor-pointer"
                />
                <label htmlFor="remember-me" className="ml-2 block text-[11px] font-bold uppercase tracking-wider text-[#141414]/80 cursor-pointer select-none">
                  Recordar mi usuario
                </label>
              </div>

              {/* Timer for Block */}
              {isBlocked && (
                <div className="text-center text-xs text-red-700 font-mono font-bold uppercase tracking-wider">
                  Cuenta bloqueada temporalmente: <span className="underline">{blockTimer}s</span>
                </div>
              )}

              {/* Submit Button */}
              <div>
                <button
                  type="submit"
                  disabled={isBlocked || !!success}
                  className="w-full flex justify-center py-2.5 px-4 border border-[#141414] bg-[#141414] hover:bg-[#141414]/95 text-[#E4E3E0] text-xs font-bold uppercase tracking-widest focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
                >
                  {isBlocked ? "Cuenta bloqueada" : "Iniciar sesión"}
                </button>
              </div>

            </form>
          ) : (
            <form onSubmit={resetTokenActive ? handleResetPasswordSubmit : handleRecovery} className="space-y-6">
              <div className="border-b border-[#141414] pb-3 mb-4">
                <h3 className="text-xs uppercase font-extrabold tracking-wider text-[#141414]">
                  {resetTokenActive ? "🔑 Restablecer contraseña" : "Recuperar contraseña"}
                </h3>
                <p className="text-[11px] font-serif italic text-[#141414]/70">
                  {resetTokenActive 
                    ? `Ingrese su nueva contraseña para ${recoveryEmail}` 
                    : "Le enviaremos un enlace de recuperación a su correo corporativo"}
                </p>
              </div>

              {resetSuccessMsg ? (
                <div className="bg-emerald-50 border-2 border-emerald-600 text-emerald-950 p-4 space-y-3 text-xs font-mono">
                  <div className="font-bold flex items-center gap-1.5 uppercase text-emerald-800">
                    <UserCheck className="w-4 h-4" /> Listo
                  </div>
                  <p>{resetSuccessMsg}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setRecoveryMode(false);
                      setRecoverySuccess(false);
                      setResetSuccessMsg("");
                      setNewPassword("");
                      setConfirmPassword("");
                      setError(null);
                    }}
                    className="w-full bg-[#141414] text-[#E4E3E0] py-2 hover:bg-[#141414]/90 transition-colors font-bold uppercase text-[10px] tracking-wider font-mono cursor-pointer"
                  >
                    Ir al formulario de ingreso
                  </button>
                </div>
              ) : resetTokenActive ? (
                <>
                  {error && (
                    <div className="bg-red-55 border border-red-700 text-red-950 p-2 text-xs font-mono flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-750 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-[#141414]/85">
                        Nueva contraseña
                      </label>
                      <input
                        type="password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        className="block w-full mt-1 px-3 py-2 bg-white border border-[#141414] text-sm font-mono focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-[#141414]/85">
                        Confirmar contraseña
                      </label>
                      <input
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Reingrese la contraseña"
                        className="block w-full mt-1 px-3 py-2 bg-white border border-[#141414] text-sm font-mono focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setResetTokenActive(false);
                        setRecoverySuccess(false);
                        setError(null);
                      }}
                      className="w-1/2 py-2 px-4 bg-transparent border border-[#141414] hover:bg-[#141414]/10 text-xs font-bold uppercase transition-colors"
                    >
                      Atrás
                    </button>
                    <button
                      type="submit"
                      className="w-1/2 py-2 px-4 bg-[#141414] hover:bg-[#141414]/95 text-[#E4E3E0] text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      Guardar contraseña
                    </button>
                  </div>
                </>
              ) : recoverySuccess ? (
                <div className="bg-emerald-50 border border-emerald-700 text-emerald-950 p-4 space-y-3 text-xs font-mono">
                  <div className="font-bold flex items-center gap-1.5 uppercase text-emerald-800">
                    📧 Correo enviado
                  </div>
                  <p>
                    Se ha enviado la plantilla de recuperación exitosamente a <strong>{recoveryEmail.toUpperCase()}</strong> mediante el host de correo corporativo <strong>{db.systemConfig?.smtpHost || "smtp.corp-mail.com"}</strong>.
                  </p>
                  
                  <div className="p-3 bg-white border border-emerald-300 rounded text-[10px] space-y-1 text-slate-700">
                    <div className="font-bold text-emerald-900 border-b pb-1 mb-1 uppercase text-[9px] tracking-wider">Vista previa del correo:</div>
                    <div><strong>De:</strong> system-notifications@soporte-erp.com</div>
                    <div><strong>Para:</strong> {recoveryEmail.toLowerCase()}</div>
                    <div><strong>Asunto:</strong> Solicitud de restablecimiento de contraseña</div>
                    <div className="mt-1 pt-1 border-t text-slate-500 font-serif italic text-[11px] leading-relaxed">
                      "Para ingresar una nueva contraseña, use el siguiente enlace seguro (válido por {db.systemConfig?.security.inactividadMinutos || 15} minutos):"
                    </div>
                  </div>

                  <div className="py-1">
                    <button
                      type="button"
                      onClick={() => setResetTokenActive(true)}
                      className="w-full bg-blue-700 hover:bg-blue-800 text-white rounded font-bold uppercase text-[10px] tracking-wider py-2.5 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      🔓 Abrir enlace de restablecimiento
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setRecoveryMode(false);
                      setRecoverySuccess(false);
                      setRecoveryEmail("");
                      setError(null);
                    }}
                    className="w-full bg-[#141414] text-[#E4E3E0] py-1.5 hover:bg-[#141414]/90 transition-colors font-bold uppercase text-[10px] tracking-wider"
                  >
                    Volver al inicio de sesión
                  </button>
                </div>
              ) : (
                <>
                  {error && (
                    <div className="bg-red-50 border border-red-700 text-red-950 p-2 text-xs font-mono flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-750 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div>
                    <label htmlFor="recovery-email" className="block text-[11px] font-bold uppercase tracking-wider text-[#141414]/80">
                      Correo registrado
                    </label>
                    <div className="mt-1 relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Mail className="h-4.5 w-4.5 text-[#141414]" />
                      </div>
                      <input
                        id="recovery-email"
                        type="email"
                        required
                        value={recoveryEmail}
                        onChange={(e) => setRecoveryEmail(e.target.value)}
                        className="block w-full pl-10 pr-3 py-2 bg-white/50 border border-[#141414] text-[#141414] text-sm font-mono focus:outline-none focus:bg-white"
                        placeholder="colegio@empresa.com"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryMode(false);
                        setError(null);
                      }}
                      className="w-1/2 py-2 px-4 bg-transparent border border-[#141414] hover:bg-[#141414]/10 text-xs font-bold uppercase transition-colors"
                    >
                      Regresar
                    </button>
                    <button
                      type="submit"
                      className="w-1/2 py-2 px-4 bg-[#141414] hover:bg-[#141414]/95 text-[#E4E3E0] text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      Enviar enlace
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
        </div>

        {/* Quick evaluation credentials helper removed */}
      </div>
    </div>
  );
}
