# Subida a Kommo

## Que subir

Subi este archivo:

- `dist/kommo-widget.zip`

Ese zip se genera desde el contenido de `kommo-widget/`.
No subas un zip armado manualmente de la carpeta completa porque Kommo necesita encontrar `manifest.json` e `i18n/es.json` en la raiz del archivo.
El zip nuevo tambien incluye la carpeta `images/` con los logos requeridos por Kommo.

## Como generarlo

Desde la raiz del proyecto:

```bash
npm run kommo:package
```

Opcionalmente, para dejar la URL final ya precargada en el zip, definir en `.env`:

```env
KOMMO_WIDGET_DEFAULT_BACKEND_URL=https://TU-DOMINIO/kommo/widget-request
```

## Como subirlo a Kommo

1. Entrar a `https://guillermopcmidicentercom.kommo.com`
2. Ir a `Ajustes -> Integracion`
3. Abrir tu integracion privada
4. En la seccion del widget, subir el archivo `dist/kommo-widget.zip`
5. Guardar cambios
6. En la configuracion de la integracion, completar `URL por defecto del backend` con tu URL publica terminada en `/kommo/widget-request`

## Como usarlo en Salesbot

1. Ir a `Salesbot`
2. Editar el flujo de soporte
3. Agregar el bloque `Enviar a backend de soporte`
4. En `endpoint_url` pegar tu URL publica:

```text
https://TU-DOMINIO/kommo/widget-request
```

Si Kommo no deja editar ese campo o queda vacio, el widget toma automaticamente la `URL por defecto del backend` configurada a nivel integracion.
No agregues un saludo manual antes del bloque si queres evitar respuestas duplicadas en el chat.
Despues de subir un zip nuevo del widget, reabri este bloque, guardalo de nuevo y republica el bot para que tome la version nueva.

Si estas probando local, usar un tunel HTTPS, por ejemplo:

```text
https://TU-URL.trycloudflare.com/kommo/widget-request
```

## Que hace ese bloque

Kommo envia al backend:

- mensaje del cliente
- `lead_id`
- `contact_id`
- `talk_id`

El backend responde por `return_url` y Kommo muestra la respuesta en el mismo chat.

## Verificacion rapida

1. Levantar el servidor:

```bash
npm start
```

2. Probar sin Kommo real:

```bash
npm run kommo:smoke
```

3. Revisar salud:

```bash
curl http://localhost:3000/health
```

Mirar:

- `kommo`
- `runtime.kommoWidgetEvents`
- `runtime.lastKommoWidgetStatus`
- `runtime.lastKommoWidgetError`
