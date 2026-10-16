/**
 * API Utils for Soporte ERP - Dicon Soporte
 * Handles dynamic IIS Server base URL routing and remote API configuration.
 */

export function getIisServerUrl(): string {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("iis_server_url");
    if (stored) {
      return stored.trim();
    }
    // Smart dynamic detection for IIS:
    // If running outside the AI Studio dev/preview environment, we default to the current page origin.
    // This supports running the frontend and API under the same IIS site/application, which:
    // 1. Completely avoids CORS issues.
    // 2. Automatically supports HTTP or HTTPS protocols without modifying the code.
    const hostname = window.location.hostname;
    const isAiStudio = hostname.endsWith(".run.app") || hostname.endsWith(".google.com") || hostname.includes("aistudio-preview");
    
    if (hostname && !isAiStudio) {
      return window.location.origin;
    }
  }
  return "http://localhost:806";
}

export function getApiUrl(action?: string, queryParams?: URLSearchParams): string {
  const baseUrl = getIisServerUrl();
  const params = queryParams ? new URLSearchParams(queryParams) : new URLSearchParams();
  if (action) {
    params.set("action", action);
  }
  const queryString = params.toString();
  return queryString ? `${baseUrl}/api_tickets.php?${queryString}` : `${baseUrl}/api_tickets.php`;
}
