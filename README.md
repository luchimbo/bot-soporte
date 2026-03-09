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

Comando util para descubrir IDs de usuarios/pipelines/campos:

```bash
npm run kommo:discover
```

El endpoint `/health` muestra el bloque `kommo` con el estado de configuracion.

Para probar manualmente el endpoint de Kommo:

```bash
curl -X POST http://localhost:3000/kommo/widget-request -H "Content-Type: application/json" -d "{\"data\":{\"message\":\"tengo una minifuse 2 y no tengo audio\",\"lead_id\":12345},\"return_url\":\"https://example.com/continue\"}"
```

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
