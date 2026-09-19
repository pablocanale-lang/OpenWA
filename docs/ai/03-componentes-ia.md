# 03-componentes-ia.md

> **Propósito:** Listar todo lo que depende de un proveedor/modelo de IA concreto, y documentar las capacidades actuales del MCP server de OpenWA.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir del código; revisar con lógica de negocio antes de actuar.

## Estado actual de IA en el repo

[PENDIENTE] No se encontró código propio que consuma un proveedor de IA (OpenAI, Anthropic, etc.). El único componente relacionado con IA es el **MCP server** de OpenWA, que permite a agentes externos (Claude, Cursor, etc.) invocar herramientas sobre WhatsApp.

## MCP server de OpenWA

[CONFIRMADO] `README.md` sección *MCP Server (AI Agents)*.

- Transporte: Streamable-HTTP en `POST /mcp`.
- Activación: `MCP_ENABLED=true`.
- Modos:
  - `MCP_READONLY=true` → 25 tools solo lectura (sesiones, mensajes, contactos, grupos, webhooks, etiquetas, reglas de automatización).
  - `MCP_READONLY=false` → 51 tools incluyendo escritura (enviar mensajes, operar grupos).
- Autenticación: misma API key de OpenWA (`X-API-Key` o `Authorization: Bearer`).
- Rate limit: `MCP_RATE_LIMIT_MAX` (default 60) por ventana `MCP_RATE_LIMIT_WINDOW_MS` (default 60 000 ms).

## Ejemplo de configuración de cliente MCP

```json
{
  "mcpServers": {
    "openwa": {
      "type": "http",
      "url": "http://localhost:2785/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

[CONFIRMADO] Tomado del README.md. La URL y token son placeholders; los reales están en el `.env` del VPS.

## Dependencias a adaptar si se migra a Claude

Actualmente no hay prompts, function calling, RAG, vector store ni agentes propios. Si en el futuro se agregan, estos son los puntos a versionar y parametrizar para que sean agnósticos del proveedor:

| Aspecto | Dónde viviría | Qué documentar |
|--------|---------------|----------------|
| Prompts de sistema | `kampro/src/prompts/` o similar | Versión, variables de reemplazo, idioma, ejemplos few-shot. |
| Tools / function calling | En MCP o en un router de agente | Nombre, descripción, schema JSON, a qué servicio ERP llaman. |
| Selección de modelo | Variables de entorno | Modelo por tarea: resumen chat, extracción datos, generación mensajes. |
| Parámetros (temperatura, max_tokens) | Config o env vars | Valores por tipo de tarea. |
| RAG / embeddings | Configurable | Fuente de documentos, chunking, overlap, vector store, refresh. |
| Memoria de conversación | Prisma / Redis | TTL, clave (sessionId+chatId), privacidad. |
| Costos y logging | Métricas / trazas | Modelo invocado, tokens, latencia, id de traza. |

## Guardrails y validaciones existentes

- **Zod** en todas las rutas Fastify de Kampro (`kampro/src/api/routes.ts`).
- **Reglas de negocio** en funciones puras del dominio (`kampro/src/domain/order-transitions.ts`, `iva.ts`, `purchase-orders.ts`).
- **Rate limiting** global de OpenWA y MCP.
- **IP allow-list** opcional por API key de OpenWA (no funciona con MCP porque no hay IP real del cliente).

## Observabilidad

- Logs por consola en Kampro (`console.warn` en fallos de notificación a grupo).
- Prometheus endpoint en OpenWA bajo `METRICS_TOKEN`.
- No hay trazabilidad de llamadas a modelos de IA porque aún no se usan.
