# Widget privado de Kommo para Railway

## Que hace

Este widget agrega un paso de Salesbot llamado `Enviar a backend de soporte`.

Cuando el cliente manda un mensaje en Kommo:

- Kommo ejecuta `widget_request`
- Railway recibe el mensaje en `POST /kommo/widget-request`
- Railway procesa el flujo del bot
- Railway devuelve el texto a Kommo usando `return_url`
- Kommo envia la respuesta al cliente dentro del mismo chat

## Endpoint de Railway

Usar esta URL publica:

```text
https://TU-DOMINIO.up.railway.app/kommo/widget-request
```

## Generar el zip del widget

Opcionalmente, definir en `.env` local:

```env
KOMMO_WIDGET_DEFAULT_BACKEND_URL=https://TU-DOMINIO.up.railway.app/kommo/widget-request
KOMMO_WIDGET_SUPPORT_EMAIL=soporte@pcmidicenter.com
```

Empaquetar:

```bash
npm run kommo:package
```

Se genera:

```text
dist/kommo-widget.zip
```

## Subir la integracion privada en Kommo

1. Ir a `Ajustes -> Integraciones`.
2. Crear una integracion privada nueva.
3. Subir el archivo `dist/kommo-widget.zip`.
4. Instalar la integracion en la cuenta.

## Usar el widget en Salesbot

1. Abrir el bot de soporte.
2. Agregar `Paso personalizado (codigo)`.
3. Elegir `Enviar a backend de soporte`.
4. Si el zip ya tiene URL por defecto, dejar `endpoint_url` vacio.
5. Si no, pegar la URL de Railway manualmente.

## Parametros del paso

- `endpoint_url`: URL de Railway
- `session_id`: valor estable por contacto; recomendado telefono o `{{contact.id}}`
- `message_text`: dejar `{{message_text}}`
- `contact_phone`: telefono del contacto
- `lead_id`: `{{lead.id}}`
- `contact_id`: `{{contact.id}}`

## Flujo recomendado del bot de soporte

1. `Iniciar Salesbot`
2. `Paso personalizado (codigo)` -> `Enviar a backend de soporte`
3. No agregar mensajes fijos despues; Railway ya responde por el mismo flujo

## Prueba rapida

Mensajes esperados:

1. `Tengo un problema con un minilab 3`
2. Railway responde pidiendo el problema exacto
3. `No me anda cuando lo conecto`
4. Railway responde pidiendo factura
5. `73828192`
6. Railway deriva a humano y pide video
