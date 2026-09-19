# 10-preguntas-abiertas.md

> **Propósito:** Preguntas concretas pendientes que requieren respuesta humana para completar la documentación y el sistema.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir del código; todo lo marcado [PENDIENTE] del resto de `docs/ai/` se condensa aquí.

## Negocio y operación

1. **¿Cuál es el proveedor de delivery local y las agencias de encomienda habituales?**
   - El código guarda `carrier` (Interior) y `paymentMethodPreferred` (Asunción), pero no hay catálogo de transportadoras.

2. **¿Cómo se verifica que una transferencia bancaria llegó? ¿Quién confirma los pagos?**
   - Hoy el operador marca `confirmPayment` manualmente. No hay integración con banco ni conciliación automática.

3. **¿Cuáles son los campos exactos de dirección/localización para delivery en Asunción?**
   - Se guarda `locationText`, `locationLat`, `locationLng` y `preferredTime`. ¿Se requiere barrio, calle, número, referencia?

4. **¿Cuál es el criterio de reposición de stock?**
   - `Product.reorderPoint` existe en schema pero está marcado como `TODO negocio` y no se usa.

5. **¿Cómo se manejan cancelaciones/devoluciones/reembolsos completos?**
   - El código revierte reservas, asientos y crea un pago `REEMBOLSADO`, pero faltan políticas de plazos, condiciones y mayorista.

6. **¿Qué política aplica para pedidos >8 unidades (mayorista)?**
   - Marcado como TODO de negocio; hoy el sistema acepta cualquier cantidad sin descuento automático.

7. **¿Se integrará Meta Ads para captación automática de leads?**
   - Hoy los leads llegan por WhatsApp manualmente. No hay webhook de Meta ni estructura `Lead`/`Customer`.

## Técnico y despliegue

8. **¿Cómo se despliega Kampro CRM en el VPS?**
   - No hay Dockerfile, systemd unit ni script de despliegue en el repo. Actualmente corre manual con `npm run dev` o `npm run start`.

9. **¿Cuál es la URL pública/proxy inverso real del VPS?**
   - Se menciona `https://app.kampro.store`. ¿Kampro API está expuesta bajo subdominio o path `/kampro-api`?

10. **¿Dónde se almacenan y rotan los secretos de producción?**
    - `.env` del VPS contiene `OPENWA_API_KEY`, `KAMPRO_API_KEY`, etc. ¿Se usa algún vault?

11. **¿Se planea migrar Kampro a PostgreSQL?**
    - Hoy usa SQLite (`DATABASE_URL=file:../data/kampro.sqlite`).

12. **¿Cómo se hace backup de `data/kampro.sqlite` y `data/openwa.sqlite`?**
    - No hay política documentada.

## Código y producto

13. **¿Por qué la UI de importaciones está en vanilla JS en lugar del dashboard React?**
    - Decisión documentada como [PENDIENTE] en `07-historial-y-decisiones.md`.

14. **¿Se agregará un bot/LLM que responda chats automáticamente?**
    - Hoy no hay prompts, modelos ni RAG en el CRM. Solo existe MCP server de OpenWA para agentes externos.

15. **¿Cuál es el proveedor/modelo de IA que se usará?**
    - OpenAI, Anthropic (Claude), local u otro.

16. **¿Se integrará el sistema fiscal para facturación electrónica?**
    - Hoy se guarda `invoiceNumber`, `invoiceIssuer` y `invoiceIssuedAt`, pero no hay API fiscal.

## Historial y gobernanza

17. **¿Cuál es la cronología real de los commits locales?**
    - Los mensajes actuales (`asd`, `asdasd`, `ssss`, `asa`) no permiten auditar el trabajo. ¿Se puede reconstruir o se adopta convención a partir de ahora?

18. **¿Quiénes son los mantenedores actuales?**
    - Git log muestra `pablocanale-lang <pablo.canale@upa.edu.py>`.

---

**Prioridad recomendada:** responder primero las preguntas 1-4 (operación diaria), 8-10 (despliegue y secretos), y 14-16 (hoja de ruta de IA/facturación).
