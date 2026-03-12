# Widget Kommo - Salesbot bridge

Este paquete contiene un widget privado minimo para Kommo.

## Para que sirve

- agrega un paso en `salesbot_designer`
- ejecuta `widget_request`
- envia el mensaje del cliente al endpoint `POST /kommo/widget-request`

## Archivos

- `manifest.json`
- `script.js`
- `i18n/es.json`

## Como usarlo

1. Generar el paquete listo para subir:

```bash
npm run kommo:package
```

Si queres que el zip ya salga con la URL final del backend precargada, definir antes `KOMMO_WIDGET_DEFAULT_BACKEND_URL` en `.env`.

2. Subir `dist/kommo-widget.zip` a la integracion privada de Kommo.
3. En la configuracion del widget, completar la URL publica del backend.
4. En Salesbot, agregar el paso `Enviar a backend de soporte`.
5. Si queres, sobrescribir la URL por bloque; si no, dejalo vacio para que use la URL por defecto de la integracion.
6. Usar una direccion publica de backend, por ejemplo:

```text
https://tu-dominio/kommo/widget-request
```

No subas un zip armado manualmente con la carpeta completa, porque Kommo necesita encontrar `manifest.json` e `i18n/es.json` en la raiz del archivo.

Este widget esta pensado para responder un turno por ejecucion. Para conversaciones mas estables en Kommo, la recomendacion es relanzar el Salesbot en cada mensaje entrante mediante el webhook `POST /kommo/incoming-message`.

## Datos que envia

El paso envia este payload base a Kommo `widget_request`:

```json
{
  "message": "{{message_text}}",
  "lead_id": "{{lead.id}}",
  "contact_id": "{{contact.id}}",
  "talk_id": "{{talk_id}}",
  "source": "kommo_salesbot",
  "render_mode": "salesbot_show"
}
```

## Nota

Si algun placeholder no estuviera disponible en tu flujo, Kommo igual enviara los demas. El backend ya tolera datos faltantes mientras tenga al menos mensaje y contexto suficiente para armar la sesion.
