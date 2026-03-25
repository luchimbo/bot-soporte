# Guía de Integración Kapso + Knowledge Base

## 📱 Configuración Actual

**Número:** +54 9 11 3200-2154 (Soporte Pc Midi)  
**Webhook:** https://bot-soporte-production-595c.up.railway.app/webhook  
**Estado:** ✅ Conectado y funcionando

---

## 🔧 Opción 1: Usar Nuestra API desde Workflow Kapso

Como Kapso no tiene Knowledge Base nativo, usamos tu servidor.

### Paso 1: En tu Workflow de Kapso

Agregá un nodo **HTTP Request** antes del LLM:

**Configuración:**
```
Tipo: HTTP Request
Método: POST
URL: https://bot-soporte-production-595c.up.railway.app/api/kb/search
Headers:
  Content-Type: application/json
Body:
  {
    "query": "{{message.text}}",
    "limit": 3
  }
```

**Guardar resultado en variable:** `kb_results`

### Paso 2: Usar resultado en el Prompt

En tu System Prompt o instrucciones del LLM, agregá:

```
Contexto adicional del knowledge base:
{{kb_results.results}}

Usá esta información si es relevante para responder la consulta.
```

---

## 🔧 Opción 2: Webhook con KB Integrado (Más Simple)

Si preferís que el servidor maneje todo automáticamente:

### Cambiar webhook en Kapso:

1. Andá a Kapso Dashboard → Webhooks
2. Editá el webhook actual
3. Cambiá la URL a:
   ```
   https://bot-soporte-production-595c.up.railway.app/webhook-with-kb
   ```

**Ventaja:** El servidor busca automáticamente en KB antes de responder.

**Desventaja:** Menos control desde el workflow visual.

---

## 📚 Estructura de Respuesta API

### Endpoint: `/api/kb/search`

**Request:**
```json
{
  "query": "como configuro minifuse",
  "limit": 3
}
```

**Response:**
```json
{
  "query": "como configuro minifuse",
  "resultsFound": 3,
  "results": [
    {
      "id": "manual-arturia-xxx",
      "text": "Para configurar MiniFuse...",
      "source": "manual_arturia",
      "score": 15
    }
  ]
}
```

---

## 📊 Estadísticas del Knowledge Base

Consultá en cualquier momento:
```bash
curl https://bot-soporte-production-595c.up.railway.app/api/kb/stats
```

**Total documentos:** 11,556  
- 6,681 manuales técnicos
- 4,875 casos históricos

---

## 🧪 Testing

### Probar la API:
```bash
# Desde terminal
curl -X POST https://bot-soporte-production-595c.up.railway.app/api/kb/search \
  -H "Content-Type: application/json" \
  -d '{"query": "minifuse phantom power", "limit": 2}'
```

### Ver webhook:
```bash
kapso whatsapp webhooks list --phone-number-id "1062277090297627"
```

---

## 💡 Mejores Prácticas

1. **Limitá a 3 resultados** en la búsqueda para no saturar el contexto
2. **Verificá el score** - resultados con score > 5 son más confiables
3. **Combiná con tu FAQ** - primero buscá en FAQ, si no hay match usá KB
4. **Logging** - revisá los logs en Railway para ver qué está buscando

---

## 🆘 Troubleshooting

**"No encuentra resultados"**
- Probá con términos más generales
- El KB tiene contenido de manuales en inglés también

**"Timeout en el workflow"**
- Limitá a 2 resultados en vez de 3
- Agregá timeout de 3 segundos en el HTTP request

**"Respuesta muy larga"**
- El KB trunca automáticamente a 500 caracteres por documento

