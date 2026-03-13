# Bot de Soporte por WhatsApp (Meta Cloud API + LLM)

Bot de soporte tecnico por WhatsApp con flujo RAG sobre historicos (`archivos/*.csv`) y manuales de producto (`archivos/Manuales/**/*.pdf`).

## 1) Instalar dependencias

```bash
npm install
```

## 2) Configurar variables

Copiar `.env.example` a `.env` y completar:

- `LLM_PROVIDER`: `openai` u `openrouter`.
- `LLM_MODEL`: modelo activo (recomendado usar este para cambiar rapido).
- `OPENAI_API_KEY`: clave de OpenAI (si usas OpenAI).
- `OPENROUTER_API_KEY`: clave de OpenRouter (si usas OpenRouter).
- `WHATSAPP_VERIFY_TOKEN`: token secreto para validar webhook.
- `WHATSAPP_ACCESS_TOKEN`: token de Meta para enviar mensajes.
- `WHATSAPP_PHONE_NUMBER_ID`: ID del numero de WhatsApp.
- `KOMMO_SUBDOMAIN`: subdominio de Kommo (sin `.kommo.com`).
- `KOMMO_LONG_LIVED_TOKEN`: token de larga duracion de integracion privada.

Variables utiles:

- `MOCK_WHATSAPP_SEND=true`: no envia a Meta, solo simula.
- `KNOWLEDGE_BASE_FILE=data/knowledge-base.json`: salida de base local.
- `PRODUCT_CATALOG_FILE=archivos/Productos.xlsx`: catalogo para bloquear producto en chat.
- `PRODUCT_MATCH_MIN_SCORE`: sensibilidad del matcher de productos.
- `SESSION_TTL_HOURS` / `SESSION_HISTORY_LIMIT`: memoria conversacional por telefono.
- `SESSION_STORE_PREFIX`: prefijo de claves para sesiones persistentes.
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`: store persistente recomendado para Netlify/serverless.
- `KB_MAX_WHATSAPP_DOCS` / `KB_MAX_EMAIL_DOCS`: limite de documentos para el indice.
- `KB_ENABLE_MANUALS`: activa indexado de manuales PDF.
- `KB_MANUALS_DIR`: carpeta base de manuales (default `archivos/Manuales`).
- `KB_MANUAL_BRANDS`: marcas a indexar (ej. `Arturia`, `Arturia,Midiplus`).
- `KB_MAX_MANUAL_DOCS`: limite de chunks de manual en la base.
- `KB_MANUAL_TOP_K`: cantidad de referencias de manual para mezclar en retrieval.
- `KB_MANUAL_CHUNK_SIZE` / `KB_MANUAL_CHUNK_OVERLAP`: tamano y solape de chunks de manual.
- `KB_MAX_STYLE_EXAMPLES`: pares historicos `cliente -> soporte` para estilo.
- `STYLE_TOP_K`: cantidad de ejemplos historicos usados al responder.
- `KB_MIN_STYLE_QUALITY`: puntaje minimo para aceptar respuestas historicas.
- `KB_STYLE_REQUIRE_RESOLVED=true`: usa solo ejemplos con senal de resolucion positiva.
- `KOMMO_SYNC_ENABLED=true`: activa sincronizacion de conversaciones hacia Kommo.
- `KOMMO_SYNC_ON_SIMULATE=false`: evita crear leads cuando usas `/simulate`.
- `KOMMO_PIPELINE_ID`: pipeline de soporte (opcional pero recomendado).
- `KOMMO_STAGE_DIAGNOSIS_ID` / `KOMMO_STAGE_ESCALATION_ID`: etapas de diagnostico y escalado.
- `KOMMO_OWNER_ID`: usuario responsable (ej. Ivan).
- `KOMMO_WIDGET_ENDPOINT_ENABLED=true`: habilita endpoint `/kommo/widget-request` para Salesbot.
- `KOMMO_WIDGET_VERIFY_TOKEN=true`: valida JWT del `widget_request` (requiere `KOMMO_WIDGET_SECRET`).
- `KOMMO_WIDGET_SECRET`: clave secreta de la integracion para validar JWT.

Para usar OpenRouter, ejemplo:

```env
LLM_PROVIDER=openrouter
LLM_MODEL=moonshotai/kimi-k2
OPENROUTER_API_KEY=tu_key
OPENROUTER_MODEL=moonshotai/kimi-k2
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

## Cambiar modelo rapido

Mostrar configuracion actual:

```bash
npm run model:show
```

Cambiar modelo en un comando:

```bash
npm run model:set -- moonshotai/kimi-k2-thinking
```

Luego reiniciar:

```bash
npm start
```

## 3) Generar base de conocimiento (CSV + manuales)

El script toma:

- `archivos/exported_message_db (1).csv`
- `archivos/Mail.csv`
- `archivos/Manuales/Arturia/*.pdf` (o las marcas configuradas en `KB_MANUAL_BRANDS`)

y genera `data/knowledge-base.json` con:

- documentos de soporte filtrados
- referencias tecnicas de manuales (chunk + pagina + archivo)
- ejemplos historicos de respuesta (`consulta cliente -> respuesta de soporte`) con filtro de calidad y resolucion

```bash
npm run build:kb
```

Nota: para indexar PDF se usa el binario `pdftotext` (Poppler). Si no esta disponible, el script continua con CSV/mail y omite manuales.

## 4) Levantar servidor

```bash
npm start
```

`npm start` ahora levanta el runtime nuevo de `Chat SDK + WhatsApp + Redis`.
Si necesitas volver temporalmente al servidor legado con Kommo/Salesbot, usa:

```bash
npm run start:legacy
```

## Runtime nuevo con Chat SDK + Redis

Para el flujo recomendado de conversacion continua por WhatsApp, usar `src/server-chat.mjs`.

Variables extra:

```env
REDIS_URL=redis://...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_APP_SECRET=...
WHATSAPP_BOT_USERNAME=whatsapp-bot
```

Comando:

```bash
npm run start:chat
```

Webhook de Meta:

```text
GET/POST https://TU-DOMINIO/api/webhooks/whatsapp
```

Este runtime usa:

- `Chat SDK` para el loop multi-turno
- `Redis` para suscripciones, locks y dedupe
- `Turso` para el contexto conversacional de soporte
- `Kommo` solo para sync CRM

## Deploy en Netlify con contexto conversacional

Para Netlify, este proyecto ya incluye:

- `netlify/functions/api.js`: wrapper serverless para las rutas existentes.
- `netlify.toml`: redirects para `/health`, `/simulate`, `/webhook` y `/kommo/widget-request`.
- soporte de sesiones persistentes con Turso cuando cargas `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`.

Recomendado para no perder contexto entre mensajes:

```env
TURSO_DATABASE_URL=libsql://tu-db-tu-org.turso.io
TURSO_AUTH_TOKEN=pega_tu_token_de_turso
TURSO_SESSION_TABLE=conversation_sessions
SESSION_STORE_PREFIX=soporte:sessions:
```

En Netlify, el endpoint critico de Kommo queda asi:

```text
https://TU-SITIO.netlify.app/kommo/widget-request
```

Y el healthcheck:

```text
https://TU-SITIO.netlify.app/health
```

La guia paso a paso esta en `docs/netlify-kommo-setup.md`.

Para Kommo/Salesbot:

- el widget actualizado deja que el backend muestre la respuesta con `execute_handlers`, asi que conviene dejar el bloque `Enviar a backend de soporte` sin un saludo manual previo si no queres mensajes duplicados.
- despues de subir un zip nuevo del widget, reabri el bloque en Salesbot, guardalo y publica otra vez el bot.
- para un flujo mas solido, conviene relanzar el Salesbot en cada mensaje entrante usando `POST /kommo/incoming-message` + `KOMMO_SALESBOT_ID`, en vez de depender de que el bot quede abierto en la conversacion.
- la guia operativa de ese rediseño esta en `docs/kommo-incoming-webhook-setup.md`.
- si activas ese webhook, saca el trigger `Cualquier conversacion nueva` del bot para no dispararlo dos veces.

## 5) Probar local (sin WhatsApp)

```bash
curl -X POST http://localhost:3000/simulate -H "Content-Type: application/json" -d "{\"text\":\"quiero devolver un producto\"}"
```

Para simular una conversacion multi-turn con memoria:

```bash
curl -X POST http://localhost:3000/simulate -H "Content-Type: application/json" -d "{\"sessionId\":\"demo-1\",\"text\":\"tengo un keylab 61 mk3 y no enciende\"}"
curl -X POST http://localhost:3000/simulate -H "Content-Type: application/json" -d "{\"sessionId\":\"demo-1\",\"text\":\"sigue igual\"}"
```

Respuesta esperada:

- `reply`: texto final para usuario.
- `mode`: `ai-rag` si uso LLM + base.
- `hits`: cantidad de casos recuperados.
- `styleHits`: ejemplos historicos usados para estilo.
- `activeProduct`: producto bloqueado para esa sesion.
- `pendingProductSwitch`: producto pendiente de confirmacion si detecta cambio.

## 6) Conectar webhook en Meta

- Callback URL: `https://TU_DOMINIO/webhook`
- Verify token: el mismo `WHATSAPP_VERIFY_TOKEN`
- Suscribir campo `messages`

Si pruebas localmente, usa un tunel HTTPS (ngrok o cloudflared).

## 7) Integrar Kommo (token largo)

Para integracion privada en la misma cuenta, se recomienda `KOMMO_LONG_LIVED_TOKEN` (sin OAuth en MVP).

1. Crear integracion privada en Kommo.
2. Generar token de larga duracion en `Llaves y alcances`.
3. Cargar `KOMMO_SUBDOMAIN` y `KOMMO_LONG_LIVED_TOKEN` en `.env`.
4. (Recomendado) completar `KOMMO_PIPELINE_ID`, etapas y `KOMMO_OWNER_ID`.
5. Configurar en Salesbot un paso `widget_request` apuntando a `https://TU_DOMINIO/kommo/widget-request`.

El paquete minimo del widget privado para Kommo esta en `kommo-widget/`.
Subilo como `.zip` dentro de la integracion privada para poder usarlo en `salesbot_designer`.

Para generar el `.zip` listo para subir:

```bash
npm run kommo:package
```

Eso crea `dist/kommo-widget.zip`.
Subi ese archivo tal cual; no zipees manualmente la carpeta `kommo-widget/` porque Kommo necesita los archivos del widget en la raiz del zip.
Ese zip ya incluye la carpeta `images/` con los logos obligatorios del widget.
Si queres que el zip salga ya preconfigurado con la URL final del backend, defini antes `KOMMO_WIDGET_DEFAULT_BACKEND_URL` en `.env` con la URL completa terminada en `/kommo/widget-request`.

Comando util para descubrir IDs de usuarios/pipelines/campos:

```bash
npm run kommo:discover
```

El endpoint `/health` muestra el bloque `kommo` con el estado de configuracion.

Para probar manualmente el endpoint de Kommo:

```bash
curl -X POST http://localhost:3000/kommo/widget-request -H "Content-Type: application/json" -d "{\"data\":{\"message\":\"tengo una minifuse 2 y no tengo audio\",\"lead_id\":12345},\"return_url\":\"https://example.com/continue\"}"
```

### Probar local sin Kommo real

1. Levantar el servidor:

```bash
npm start
```

2. En otra terminal, correr el smoke test:

```bash
npm run kommo:smoke
```

Eso hace este flujo local:

- envia un `widget_request` sintetico a `POST /kommo/widget-request`
- levanta un callback local temporal para capturar el `return_url`
- imprime el payload final que Kommo recibiria

### Probar end-to-end con Kommo real desde local

1. Levantar el servidor local:

```bash
npm start
```

2. Abrir un tunel HTTPS a tu maquina (ej. cloudflared):

```bash
cloudflared tunnel --url http://localhost:3000
```

3. Tomar la URL publica generada y usarla en Salesbot:

```text
https://TU-URL.trycloudflare.com/kommo/widget-request
```

4. En Kommo:

- subir el widget de `kommo-widget/`
- agregar el paso `Enviar a backend de soporte` en Salesbot
- pegar la URL publica del paso

5. Enviar un mensaje desde el chat de WhatsApp conectado a Kommo.

6. Verificar en local:

```bash
curl http://localhost:3000/health
```

Mirar especialmente:

- `runtime.kommoWidgetEvents`
- `runtime.lastKommoWidgetStatus`
- `runtime.lastKommoWidgetError`

## Flujo de respuesta

1. Llega mensaje de WhatsApp.
2. Se detecta y bloquea producto usando `Productos.xlsx`.
3. Si detecta modelos muy parecidos (ej. `KeyLab 61 MK3` vs `KeyLab Essential 61 MK3`), pide confirmar version antes de seguir.
4. Se usa memoria por telefono para mantener contexto entre mensajes.
5. Se buscan casos similares en `knowledge-base.json` filtrando por producto cuando aplica.
6. Se buscan referencias tecnicas de manual cuando hay match de producto (piloto inicial: Arturia).
7. Se buscan ejemplos historicos de como respondio soporte en casos parecidos (priorizando calidad y resolucion).
8. El LLM (OpenAI u OpenRouter) redacta la respuesta usando casos + manual + estilo historico.
9. Si detecta posible cambio de producto, pide confirmacion antes de cambiar.
10. Si no hay API key o falla el LLM, usa un fallback guiado apoyado en casos recuperados.
