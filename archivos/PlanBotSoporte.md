# Plan de Implementacion - Bot de Soporte Tecnico (WhatsApp + LLM + Kommo)
Version 1.0 - Marzo 2026

## 1) Objetivo
Implementar un bot de soporte tecnico en WhatsApp, con LLM + RAG, que:
- resuelva la mayoria de consultas de forma autonoma,
- escale a Ivan solo cuando corresponda,
- deje trazabilidad completa en Kommo.

## 2) Alcance
### Incluye
- Canal: WhatsApp.
- Motor: LLM + RAG (manuales, FAQs internas, casos historicos).
- CRM: Kommo (leads, contactos, etapas, notas, tareas, trazabilidad).
- Integraciones: Tienda Nube (TN), Mercado Libre (ML), KB.
- Escalado: automatico por reglas y manual por pedido del cliente.

### No incluye en MVP
- Aprobacion automatica de garantia.
- Dependencia de busqueda web abierta como fuente principal.

---

## 3) Arquitectura objetivo
Cliente WhatsApp -> Kommo (Salesbot + `widget_request`) -> Backend de soporte (LLM/RAG + reglas) -> `return_url` de Kommo -> respuesta al cliente en el mismo chat de Kommo.

### Rol de cada componente
- **Kommo**: orquestacion de flujo, CRM, etapas, asignacion a Ivan, historial.
- **Backend bot**: diagnostico, clasificacion, respuesta tecnica, decision de escalado.
- **TN/ML**: validacion de compra/orden/usuario y datos de garantia.
- **KB/RAG**: recuperacion de contexto tecnico y resolucion guiada.

---

## 4) Flujo funcional final (alineado al documento)
1. **Entrada**: cliente escribe por WhatsApp.
2. **Identificacion**: bot pide N de orden TN o usuario ML y consulta APIs.
3. **Descripcion**: cliente describe problema; LLM clasifica tipo de caso.
4. **Diagnostico RAG**: bot propone solucion tecnica contextual.
5. **Resolucion guiada**: pasos numerados con confirmacion por paso.
6. **Garantia/RMA**: si aplica, recolecta evidencia y arma pre-ticket.
7. **Escalado**: a Ivan solo si falla en 2 intentos, cliente lo pide, o RMA confirmado.
8. **Cierre**: confirmacion de resolucion + encuesta CSAT + registro CRM.

---

## 5) Checklist maestro por fases

## Fase 0 - Preparacion
- [ ] Confirmar cuenta Kommo con permisos necesarios (admin + API).
- [ ] Crear integracion privada en Kommo.
- [ ] Definir pipeline y etapas:
  - [ ] Diagnostico Bot
  - [ ] Esperando Cliente
  - [ ] Escalado Ivan
  - [ ] Resuelto
- [ ] Definir `owner_id` de Ivan.
- [ ] Definir campos custom en lead/contacto:
  - [ ] canal_compra
  - [ ] orden_tn
  - [ ] usuario_ml
  - [ ] producto_modelo
  - [ ] categoria_problema
  - [ ] intentos_bot
  - [ ] resumen_llm
  - [ ] urgencia
  - [ ] estado_garantia
- [ ] Confirmar endpoint publico estable para webhooks (evitar tuneles efimeros en prod).

## Fase 1 - Puente Kommo <-> Backend
- [ ] Implementar endpoint `POST /kommo/widget-request`.
- [ ] Validar token/JWT de requests de Kommo.
- [ ] Responder HTTP 200 en <= 2 segundos.
- [ ] Procesar conversacion de forma async.
- [ ] Enviar resultado al `return_url` de Kommo con `execute_handlers`.
- [ ] Implementar OAuth2 + refresh token de Kommo.
- [ ] Loguear `conversation_id`, `lead_id`, `chat_id`, estado y errores.

## Fase 2 - Core conversacional (LLM + reglas)
- [ ] Mantener contexto de conversacion por sesion.
- [ ] Clasificar en 4 categorias:
  - [ ] configuracion inicial
  - [ ] falla hardware
  - [ ] garantia/RMA
  - [ ] duda de uso
- [ ] Pedir faltantes minimos de forma dinamica.
- [ ] Detectar emocion/frustracion y ajustar tono.
- [ ] Limitar a 2 intentos automaticos de resolucion.
- [ ] Escalar por reglas (seccion 7).

## Fase 3 - Integracion TN / ML
- [ ] TN: consultar orden, producto, fecha compra, estado envio.
- [ ] ML: consultar usuario/pedido/historial relevante.
- [ ] Validar consistencia producto consultado vs comprado.
- [ ] Persistir datos en campos de Kommo.

## Fase 4 - RAG operativo
- [ ] Usar KB interna (manuales + casos previos + FAQs internas).
- [ ] Priorizar evidencias por producto/modelo detectado.
- [ ] Responder en pasos accionables.
- [ ] Confirmar resultado de cada paso antes de avanzar.
- [ ] Registrar que evidencias y pasos se usaron.

## Fase 5 - Garantia / RMA
- [ ] Detectar elegibilidad por fecha de compra.
- [ ] Pedir evidencia minima:
  - [ ] fotos/video
  - [ ] N de serie
  - [ ] descripcion del defecto
- [ ] Generar pre-ticket RMA estructurado.
- [ ] Adjuntar toda la evidencia en Kommo.
- [ ] Marcar etapa para revision humana.

## Fase 6 - Escalado a Ivan
- [ ] Reglas de escalado implementadas:
  - [ ] 2 intentos fallidos
  - [ ] pedido explicito de humano
  - [ ] falla hardware confirmada
  - [ ] garantia/reemplazo confirmado
  - [ ] frustracion alta
- [ ] Crear paquete de escalado automatico con:
  - [ ] identificador cliente (orden/usuario)
  - [ ] producto + fecha compra
  - [ ] resumen 2-3 lineas
  - [ ] intentos ya hechos y resultado
  - [ ] categoria del problema
  - [ ] adjuntos recibidos
  - [ ] urgencia estimada
- [ ] Asignar a Ivan + mover etapa.
- [ ] Activar modo `humano_activo` para evitar respuestas automaticas en paralelo.

## Fase 7 - Cierre y metricas
- [ ] Enviar CSAT 1-5 al resolver.
- [ ] Guardar resolucion, duracion, categoria y satisfaccion en CRM.
- [ ] Dashboard basico de KPIs.
- [ ] Reporte semanal de mejora continua.

---

## 6) Checklist tecnico por sistema

### Kommo
- [ ] Integracion privada creada.
- [ ] Salesbot con paso `widget_request` configurado.
- [ ] Webhooks activos para mensajes/conversaciones/leads.
- [ ] Pipeline y etapas validadas.
- [ ] Campos custom creados y mapeados.
- [ ] Usuario Ivan definido para asignacion.

### Backend Bot
- [ ] Endpoints Kommo operativos.
- [ ] Modulo Kommo API (OAuth2 + refresh).
- [ ] Modulo TN API.
- [ ] Modulo ML API.
- [ ] Modulo clasificacion + reglas de escalado.
- [ ] Modulo RAG activo.
- [ ] Persistencia de sesion y estado humano/bot.
- [ ] Auditoria/logs estructurados.

### Seguridad / Operacion
- [ ] Secrets en variables de entorno.
- [ ] Rotacion de tokens.
- [ ] Manejo de PII minimo necesario.
- [ ] Monitoreo + alertas.
- [ ] Retencion de logs (minimo 6 meses).

---

## 7) Reglas de escalado (operativas)
Escalar automaticamente si:
- [ ] Bot no resolvio tras 2 intentos distintos.
- [ ] Cliente pide persona humana.
- [ ] Caso de garantia/reemplazo.
- [ ] Evidencia de falla fisica.
- [ ] Frustracion/enojo alto detectado.

No escalar si:
- [ ] Caso tecnico simple resuelto o encaminado en primer intento.
- [ ] Falta un dato menor que puede pedirse y seguir.

---

## 8) Plan de pruebas (UAT)
- [ ] Caso simple: configuracion de audio en DAW.
- [ ] Caso de ambiguedad de modelo.
- [ ] Caso con 2 intentos y escalado correcto.
- [ ] Caso garantia con pre-ticket completo.
- [ ] Caso cliente pide humano de entrada.
- [ ] Caso con adjuntos (foto/video/audio).
- [ ] Caso TN valido / TN invalido.
- [ ] Caso ML valido / ML invalido.
- [ ] Carga de 50 conversaciones simultaneas.
- [ ] Latencia media de respuesta < 10s.

---

## 9) Go-live y rollback
### Go-live
- [ ] Activar en entorno piloto (porcentaje acotado de chats).
- [ ] Monitoreo intensivo primeras 72h.
- [ ] Revision diaria de conversaciones escaladas.

### Rollback
- [ ] Regla de bypass inmediato a humano.
- [ ] Desactivar paso de bot en Salesbot sin downtime.
- [ ] Mantener continuidad de atencion en Kommo.

---

## 10) KPIs objetivo (90 dias)
- [ ] Resolucion autonoma > 70%.
- [ ] Tiempo medio de resolucion < 8 min.
- [ ] CSAT > 4.0 / 5.0.
- [ ] Reduccion de carga de Ivan > 60%.
- [ ] Garantias con pre-ticket completo: 100%.
- [ ] Tiempo de respuesta del bot < 10s.

---

## 11) Riesgos y mitigaciones
- **Riesgo**: dependencia de APIs externas TN/ML.
  **Mitigacion**: fallback con solicitud manual de datos + retry con cola.
- **Riesgo**: respuestas fuera de politica.
  **Mitigacion**: guardrails de prompt + plantillas para garantias/condiciones.
- **Riesgo**: escalado tardio por sobre-automatizacion.
  **Mitigacion**: reglas estrictas y limites de intentos.
- **Riesgo**: webhooks inestables.
  **Mitigacion**: endpoint productivo estable + healthchecks + alertas.

---

## 12) Decisiones pendientes (bloqueantes)
- [ ] Proveedor LLM final para produccion.
- [ ] Vector DB final (si se migra de indice actual).
- [ ] Politica fuera de horario de Ivan (mensaje ETA).
- [ ] Si se habilita busqueda en internet en fase posterior.
- [ ] Idioma adicional (ingles) en fase futura.

---

## 13) Cronograma sugerido
- **Semana 1**: Fase 0 + Fase 1.
- **Semana 2**: Fase 2 + Fase 4.
- **Semana 3**: Fase 3 + Fase 5.
- **Semana 4**: Fase 6 + Fase 7 + UAT + go-live controlado.

---

## 14) Proximo paso inmediato
1. Cerrar IDs reales de Kommo (pipeline/stages/owner/custom fields).
2. Montar endpoint `widget_request` y validacion de token.
3. Probar primer flujo E2E: mensaje entrante -> diagnostico -> respuesta -> registro en Kommo.
