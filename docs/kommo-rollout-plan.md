# Plan de implementacion y salida a produccion de Kommo

## Objetivo

Dejar operativo el flujo completo `Kommo -> Salesbot -> /kommo/widget-request -> bot -> return_url -> chat`, con validacion local, prueba end-to-end y configuracion lista para produccion.

## Estado actual

### Ya resuelto

- Existe el endpoint `POST /kommo/widget-request` en `src/server.js`.
- Existe el paquete base del widget privado en `kommo-widget/`.
- Existe el empaquetado con `npm run kommo:package`.
- Existe la prueba local con `npm run kommo:smoke`.
- El `README.md` ya documenta el flujo general.

### Pendiente inmediato

- Reemplazar URLs temporales `trycloudflare` en `kommo-widget/manifest.json` y `kommo-widget/script.js`.
- Reemplazar el email placeholder de soporte en `kommo-widget/manifest.json`.
- Generar el zip final y subirlo a la integracion privada.
- Validar el flujo real con Kommo y WhatsApp.

## Etapas

### Etapa 0 - Preparacion

**Objetivo:** dejar definidos los datos base antes de tocar Kommo real.

**Tareas:**

1. Confirmar URL publica final del backend para `POST /kommo/widget-request`.
2. Confirmar si se va a usar verificacion JWT del widget (`KOMMO_WIDGET_VERIFY_TOKEN=true`).
3. Completar variables `.env` de Kommo:
   - `KOMMO_SUBDOMAIN`
   - `KOMMO_LONG_LIVED_TOKEN`
   - `KOMMO_PIPELINE_ID`
   - `KOMMO_STAGE_DIAGNOSIS_ID`
   - `KOMMO_STAGE_ESCALATION_ID`
   - `KOMMO_OWNER_ID`
4. Confirmar mail de soporte real para el `manifest.json`.

**Entregable:** datos finales definidos para configurar widget y backend.

**Criterio de salida:** no quedan placeholders funcionales pendientes.

### Etapa 1 - Cierre tecnico local

**Objetivo:** dejar el widget consistente con el backend actual.

**Tareas:**

1. Ajustar `kommo-widget/manifest.json`:
   - `support.email`
   - `settings.default_backend_url`
   - `salesbot_designer.support_request.settings.endpoint_url.default_value`
2. Ajustar `kommo-widget/script.js` para que el `PLACEHOLDER_URL` no apunte al tunel temporal.
3. Revisar que el widget siga usando el fallback correcto:
   - primero `endpoint_url`
   - despues `default_backend_url`
   - por ultimo placeholder seguro
4. Verificar que el backend responda por `return_url` con el payload esperado por Kommo.

**Entregable:** widget listo para empaquetar.

**Criterio de salida:** `manifest.json`, `script.js` y backend apuntan a una estrategia de URL consistente.

### Etapa 2 - Empaquetado y validacion local

**Objetivo:** comprobar que el artefacto y el flujo tecnico funcionan antes de subir nada.

**Tareas:**

1. Generar el zip:

```bash
npm run kommo:package
```

2. Levantar el backend:

```bash
npm start
```

3. Ejecutar smoke test local:

```bash
npm run kommo:smoke
```

4. Revisar salud:

```bash
curl http://localhost:3000/health
```

5. Verificar especialmente:
   - `runtime.kommoWidgetEvents`
   - `runtime.lastKommoWidgetStatus`
   - `runtime.lastKommoWidgetError`

**Entregable:** `dist/kommo-widget.zip` validado localmente.

**Criterio de salida:** smoke test exitoso y `lastKommoWidgetStatus=replied`.

### Etapa 3 - Alta del widget en Kommo

**Objetivo:** dejar la integracion privada lista para usar el bloque en Salesbot.

**Tareas:**

1. Entrar a la integracion privada de Kommo.
2. Subir `dist/kommo-widget.zip`.
3. Guardar la integracion.
4. Completar la `URL por defecto del backend` con la URL publica terminada en `/kommo/widget-request`.
5. Confirmar que el bloque `Enviar a backend de soporte` aparezca en `salesbot_designer`.

**Entregable:** widget instalado en Kommo.

**Criterio de salida:** el bloque se puede agregar en el constructor de Salesbot.

### Etapa 4 - Configuracion del flujo en Salesbot

**Objetivo:** conectar el bloque del widget dentro del flujo de soporte.

**Tareas:**

1. Abrir el flujo de soporte en Salesbot.
2. Insertar el bloque `Enviar a backend de soporte` en el tramo correcto.
3. Definir `endpoint_url` si queres sobrescribir la URL por defecto.
4. Si no se completa `endpoint_url`, validar que tome `default_backend_url`.
5. Publicar el flujo actualizado.

**Entregable:** Salesbot configurado para llamar al backend.

**Criterio de salida:** el flujo guarda correctamente y no pierde la URL configurada.

### Etapa 5 - Prueba end-to-end desde local

**Objetivo:** validar el circuito real con Kommo usando un backend local expuesto por HTTPS.

**Tareas:**

1. Levantar el servidor local:

```bash
npm start
```

2. Abrir tunel HTTPS:

```bash
cloudflared tunnel --url http://localhost:3000
```

3. Copiar la URL publica y usarla en:
   - configuracion del widget
   - `endpoint_url` del paso en Salesbot, si corresponde
4. Enviar un mensaje real desde WhatsApp conectado a Kommo.
5. Confirmar que Kommo ejecute el `widget_request`.
6. Confirmar que el backend haga callback a `return_url`.
7. Revisar `curl http://localhost:3000/health` y los logs del servidor.
8. Verificar que la respuesta aparezca en el chat de Kommo.

**Entregable:** evidencia funcional del flujo real.

**Criterio de salida:** respuesta visible en el chat y sin errores en `lastKommoWidgetError`.

### Etapa 6 - Endurecimiento y limpieza

**Objetivo:** cerrar riesgos tecnicos antes de dejarlo estable.

**Tareas:**

1. Activar JWT del widget si la integracion final lo requiere:
   - `KOMMO_WIDGET_VERIFY_TOKEN=true`
   - `KOMMO_WIDGET_SECRET=...`
2. Reemplazar cualquier URL temporal que haya quedado en widget o docs.
3. Revisar timeouts del callback (`KOMMO_WIDGET_CONTINUE_TIMEOUT_MS`).
4. Confirmar que el `README.md` y `kommo-widget/UPLOAD_STEPS.md` reflejen el flujo final.
5. Definir una convencion minima de logs y chequeo de salud para soporte operativo.

**Entregable:** configuracion lista para uso estable.

**Criterio de salida:** no quedan placeholders, secretos ni configuraciones temporales.

### Etapa 7 - Salida a produccion

**Objetivo:** dejar el circuito estable sobre la URL definitiva.

**Tareas:**

1. Apuntar widget y Salesbot al dominio final de produccion.
2. Regenerar y volver a subir el zip si hubo cambios de configuracion.
3. Ejecutar una prueba controlada con un caso real o interno.
4. Validar en Kommo:
   - creacion/actualizacion de lead
   - asociacion de contacto
   - trazabilidad del caso
5. Validar en el backend:
   - salud general
   - eventos de widget
   - errores de callback
6. Dejar documentado el procedimiento operativo basico.

**Entregable:** integracion corriendo sobre entorno final.

**Criterio de salida:** prueba de produccion aprobada de punta a punta.

## Checklist resumido

- [x] Endpoint `POST /kommo/widget-request`
- [x] Widget privado base en `kommo-widget/`
- [x] Script de empaquetado
- [x] Smoke test local
- [ ] Reemplazo de placeholders finales
- [ ] Generacion de zip final
- [ ] Subida a integracion privada
- [ ] Configuracion en Salesbot
- [ ] Prueba end-to-end con tunel HTTPS
- [ ] Paso a URL final de produccion

## Orden recomendado para avanzar hoy

1. Cerrar placeholders del widget.
2. Generar `dist/kommo-widget.zip`.
3. Correr `npm run kommo:smoke`.
4. Subir el zip a Kommo.
5. Probar con tunel HTTPS.
6. Pasar a URL final estable.

## Riesgos y decisiones pendientes

- Definir si el widget queda apuntando a staging, tunel temporal o dominio final.
- Definir si la validacion JWT se activa ya o en una segunda pasada.
- Confirmar IDs finales de pipeline, etapas y owner.
- Confirmar mail de soporte real del `manifest.json`.
- Confirmar si el flujo de Salesbot va a usar siempre `default_backend_url` o un `endpoint_url` por bloque.

## Criterio de listo

El trabajo se considera terminado cuando se cumpla todo esto:

1. `npm run kommo:package` genera el zip correcto.
2. `npm run kommo:smoke` responde bien en local.
3. El widget se puede subir y usar desde `salesbot_designer`.
4. Un mensaje real en Kommo recibe respuesta del backend.
5. `curl http://localhost:3000/health` no muestra error del widget.
6. No quedan placeholders de URL o mail en archivos productivos.
