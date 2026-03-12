# Kommo por mensaje entrante

## Objetivo

Evitar depender de que el Salesbot quede abierto dentro del mismo chat. En este modo, cada mensaje entrante de Kommo dispara un webhook a tu backend y el backend vuelve a lanzar el Salesbot por API.

## Arquitectura

```text
Cliente -> Kommo chat -> Webhook "Incoming message received" -> /kommo/incoming-message -> API run Salesbot -> widget_request -> /kommo/widget-request -> respuesta al chat
```

## Variables necesarias

```env
KOMMO_INCOMING_WEBHOOK_ENABLED=true
KOMMO_INCOMING_WEBHOOK_SECRET=tu_token_opcional
KOMMO_SALESBOT_ID=pega_el_id_del_bot
```

`KOMMO_INCOMING_WEBHOOK_SECRET` es opcional, pero recomendado. Si lo usas, agregalo como query string en la URL del webhook.

## URL del webhook

Sin secreto:

```text
https://soportepcmidi.netlify.app/kommo/incoming-message
```

Con secreto:

```text
https://soportepcmidi.netlify.app/kommo/incoming-message?token=TU_SECRETO
```

## Como encontrar el Salesbot ID

1. Abrir la lista de Salesbots en Kommo.
2. Abrir DevTools del navegador.
3. Inspeccionar el item del bot.
4. Buscar algo como:

```text
id="list_item_36143"
```

o:

```text
data-id="36143"
```

Ese numero es `KOMMO_SALESBOT_ID`.

## Configuracion en Kommo

### 1. Webhook general

En `Ajustes -> Integraciones -> Webhooks`:

1. Crear un webhook nuevo.
2. Pegar la URL de `POST /kommo/incoming-message`.
3. Activar solo el evento `Incoming message received`.
4. Guardar.

### 2. Salesbot

Dejar un flujo simple:

```text
Inicio -> Enviar a backend de soporte
```

Recomendaciones:

- no poner saludo manual antes del bloque
- no depender de `Cualquier conversacion nueva` como trigger principal
- guardar el bloque despues de subir una nueva version del widget

## Que hace el backend

`POST /kommo/incoming-message`:

- acepta webhooks `x-www-form-urlencoded` de Kommo
- detecta el `message.id` y deduplica eventos
- toma `entity_id` y `entity_type`
- llama a `POST /api/v4/bots/{id}/run`

`POST /kommo/widget-request`:

- recibe el mensaje actual del chat
- genera la respuesta con LLM + RAG + contexto
- responde a Kommo por `return_url`

## Verificacion

En `https://soportepcmidi.netlify.app/health` revisar:

- `runtime.kommoIncomingWebhookEvents`
- `runtime.lastKommoIncomingWebhookStatus`
- `runtime.lastKommoIncomingWebhookError`
- `runtime.kommoWidgetEvents`
- `runtime.lastKommoWidgetStatus`

Estado esperado:

- `lastKommoIncomingWebhookStatus = salesbot-launched`
- `lastKommoWidgetStatus = replied`

## Nota importante

Si dejas al mismo tiempo:

- `Cualquier conversacion nueva`
- y el webhook `Incoming message received`

podrias duplicar el primer disparo del bot. Para este modo, la recomendacion es usar el webhook como mecanismo principal.
