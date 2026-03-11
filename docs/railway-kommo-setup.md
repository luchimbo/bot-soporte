# Deploy en Railway + Kommo

## Objetivo

Publicar este backend en Railway para que Kommo pueda llamar a `POST /kommo/widget-request` por HTTPS y, opcionalmente, usar tambien `GET/POST /webhook` si mas adelante quieren conectar Meta directo.

## Importante

- Si van a usar **Kommo para todo**, el endpoint critico es `POST /kommo/widget-request`.
- La URL de Kommo es la del CRM: `https://guillermopcmidicentercom.kommo.com`.
- La URL del backend va a ser una URL publica de Railway o un dominio propio, por ejemplo:

```text
https://bot-soporte-production.up.railway.app/kommo/widget-request
```

o despues:

```text
https://bot.pcmidi.com.ar/kommo/widget-request
```

## Paso 1 - Subir el repo a GitHub

Railway trabaja mejor desplegando desde GitHub.

1. Subir este proyecto a un repo de GitHub.
2. Verificar que el repo incluya estos archivos necesarios en produccion:
   - `src/**`
   - `package.json`
   - `data/knowledge-base.json`
   - `archivos/Productos.xlsx`
3. No subir `.env`.

## Paso 2 - Crear el proyecto en Railway

1. Entrar a Railway.
2. Crear `New Project`.
3. Elegir `Deploy from GitHub repo`.
4. Seleccionar este repositorio.
5. Esperar el primer deploy.

## Paso 3 - Configuracion del servicio

En el servicio de Railway:

- `Start Command`: `npm start`
- `Healthcheck path`: `/health`
- `Root Directory`: vacio

No hace falta fijar `PORT`; Railway lo inyecta automaticamente y la app ya lo toma.

## Paso 4 - Variables de entorno en Railway

### Copiar desde tu `.env` local (secretos)

Copiar estos valores desde tu `.env` local a Railway, sin commitearlos:

- `OPENROUTER_API_KEY`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `KOMMO_LONG_LIVED_TOKEN`

### Cargar en Railway (no secretos / configuracion)

```env
MOCK_WHATSAPP_SEND=false
LLM_PROVIDER=openrouter
LLM_MODEL=moonshotai/kimi-k2
OPENROUTER_MODEL=moonshotai/kimi-k2
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_APP_TITLE=whatsapp-soporte-bot

OPENAI_TIMEOUT_MS=30000
KB_TOP_K=4
STYLE_TOP_K=3
KNOWLEDGE_BASE_FILE=data/knowledge-base.json
PRODUCT_CATALOG_FILE=archivos/Productos.xlsx
PRODUCT_MATCH_MIN_SCORE=7
SESSION_TTL_HOURS=72
SESSION_HISTORY_LIMIT=12
KB_MAX_WHATSAPP_DOCS=4500
KB_MAX_EMAIL_DOCS=1000
KB_MAX_STYLE_EXAMPLES=2500
KB_PAIR_WINDOW_HOURS=72
KB_RESOLUTION_WINDOW_HOURS=96
KB_MIN_STYLE_QUALITY=3
KB_STYLE_REQUIRE_RESOLVED=true

KOMMO_SYNC_ENABLED=true
KOMMO_SYNC_ON_SIMULATE=false
KOMMO_TIMEOUT_MS=12000

KOMMO_SUBDOMAIN=guillermopcmidicentercom
KOMMO_PIPELINE_ID=8711199
KOMMO_STAGE_DIAGNOSIS_ID=68404167
KOMMO_STAGE_ESCALATION_ID=68404171
KOMMO_OWNER_ID=11098535

KOMMO_WIDGET_ENDPOINT_ENABLED=true
KOMMO_WIDGET_VERIFY_TOKEN=false
KOMMO_WIDGET_SECRET=
KOMMO_WIDGET_CONTINUE_TIMEOUT_MS=12000
```

### Variables opcionales de campos custom en Kommo

Solo si ya tienen los IDs de campos custom:

```env
KOMMO_FIELD_CHANNEL_ID=
KOMMO_FIELD_ORDER_TN_ID=
KOMMO_FIELD_USER_ML_ID=
KOMMO_FIELD_PRODUCT_ID=
KOMMO_FIELD_CATEGORY_ID=
KOMMO_FIELD_SUMMARY_ID=
KOMMO_FIELD_URGENCY_ID=
KOMMO_FIELD_ATTEMPTS_ID=
```

## Paso 5 - Obtener la URL publica de Railway

En Railway:

1. Ir a `Settings` o `Networking` del servicio.
2. Generar dominio publico.
3. Copiar la URL generada.

Ejemplo:

```text
https://bot-soporte-production.up.railway.app
```

Con esa base, tus URLs quedan:

- Health: `https://bot-soporte-production.up.railway.app/health`
- Kommo widget: `https://bot-soporte-production.up.railway.app/kommo/widget-request`
- Meta webhook: `https://bot-soporte-production.up.railway.app/webhook`

## Paso 6 - Verificar el deploy

Probar en navegador o con curl:

```bash
curl https://TU-DOMINIO-RAILWAY/health
```

Tiene que responder `ok: true` y mostrar `kommo.configured: true`.

## Paso 7 - Configurar Kommo

### 7.1 URL del CRM

Tu cuenta Kommo es:

```text
https://guillermopcmidicentercom.kommo.com
```

### 7.2 URL del backend para Salesbot

Usar esta URL en el widget y/o en el paso de Salesbot:

```text
https://TU-DOMINIO-RAILWAY/kommo/widget-request
```

### 7.3 Subir el widget privado

En tu maquina local, una vez que ya tengas el dominio publico de Railway, agregar en `.env` local:

```env
KOMMO_WIDGET_DEFAULT_BACKEND_URL=https://TU-DOMINIO-RAILWAY/kommo/widget-request
KOMMO_WIDGET_SUPPORT_EMAIL=soporte@pcmidicenter.com
```

Despues generar el zip:

```bash
npm run kommo:package
```

Eso produce:

```text
dist/kommo-widget.zip
```

Subir ese archivo a la integracion privada de Kommo.

### 7.4 Configurar Salesbot

1. Abrir Salesbot.
2. Agregar el bloque `Enviar a backend de soporte`.
3. Si el widget ya tiene la URL por defecto cargada, dejar `endpoint_url` vacio.
4. Si queres sobrescribirla por bloque, poner manualmente:

```text
https://TU-DOMINIO-RAILWAY/kommo/widget-request
```

## Paso 8 - Meta webhook (solo si tambien usas Meta directo)

Si van a operar exclusivamente por Kommo, este paso puede esperar.

Si quieren mantener tambien el webhook directo de Meta:

- `Callback URL`: `https://TU-DOMINIO-RAILWAY/webhook`
- `Verify token`: el mismo `WHATSAPP_VERIFY_TOKEN`
- Suscripcion: `messages`

## Paso 9 - Dominio propio opcional

Cuando todo funcione con Railway, pueden pasar a un dominio mas prolijo, por ejemplo:

```text
https://bot.pcmidi.com.ar
```

En Railway:

1. Ir a `Custom Domain`.
2. Agregar `bot.pcmidi.com.ar`.
3. Crear en DNS el registro que Railway indique.
4. Esperar validacion TLS.

Luego reemplazar en Kommo:

```text
https://bot.pcmidi.com.ar/kommo/widget-request
```

Y regenerar el zip del widget con esa URL final.

## Checklist corto

- [ ] Repo subido a GitHub
- [ ] Servicio creado en Railway
- [ ] Variables cargadas en Railway
- [ ] URL publica generada en Railway
- [ ] `GET /health` respondiendo OK
- [ ] `KOMMO_WIDGET_DEFAULT_BACKEND_URL` actualizado en `.env` local
- [ ] `dist/kommo-widget.zip` regenerado
- [ ] Widget subido a Kommo
- [ ] Bloque agregado en Salesbot
- [ ] Prueba real de mensaje desde Kommo

## URL final esperada

### Temporal para salir rapido

```text
https://TU-DOMINIO-RAILWAY/kommo/widget-request
```

### Recomendada al cerrar produccion

```text
https://bot.pcmidi.com.ar/kommo/widget-request
```
