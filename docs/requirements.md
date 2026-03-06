# 🎧 Bot de Soporte Técnico — WhatsApp + LLM
## Documento de Requerimientos · Versión 1.0 · Marzo 2026

---

## 1. Objetivo del Proyecto

Implementar un bot de soporte técnico sobre WhatsApp, potenciado por un LLM (Large Language Model), capaz de resolver autónomamente la mayoría de consultas de clientes sobre productos de audio. El bot tomará el relevo del flujo actual de Kommo en el tramo de soporte y solo escalará a un representante humano cuando haya agotado sus recursos o ante situaciones que lo requieran explícitamente.

| Campo | Detalle |
|---|---|
| **Empresa** | Empresa de Audio (B2C) |
| **Canal de atención** | WhatsApp Business |
| **Motor del bot** | LLM con RAG (base de conocimiento interna) |
| **Integración CRM** | Kommo (reemplaza el bot actual en tramo de soporte) |
| **Plataformas de venta** | Tienda Nube y Mercado Libre |
| **Representante humano** | Iván (escalado solo cuando el bot falla o el cliente lo pide) |
| **Idioma** | Español (Argentina) |

---

## 2. Contexto y Situación Actual

### 2.1 Flujo Actual (Kommo)

El flujo vigente opera de forma completamente predefinida, sin inteligencia adaptativa:

- El cliente inicia conversación → el bot de Kommo ofrece Ventas o Soporte.
- Si elige Soporte → elige entre "Condiciones de venta" o "Necesito ayuda con mi equipo".
- El bot ofrece ver FAQ o hablar con un representante.
- Si elige representante → pide N° de orden (Tienda Nube) o usuario (Mercado Libre) y descripción del problema.
- Recién ahí Iván entra en la conversación.

### 2.2 Problemas del Flujo Actual

- El bot no intenta resolver el problema antes de escalar.
- Las FAQ son estáticas y no se adaptan al contexto del cliente.
- Iván recibe casos que podrían haberse resuelto automáticamente.
- No hay trazabilidad del historial del cliente al escalar.

---

## 3. Flujo Propuesto — Bot con LLM

El nuevo flujo incorpora resolución autónoma antes de cualquier escalado. El bot solo transfiere a Iván si no logra resolver el problema tras múltiples intentos, o si el cliente lo solicita explícitamente.

| # | Fase | Descripción | Actor |
|---|---|---|---|
| 1 | **Entrada** | El cliente escribe al WhatsApp de soporte. El bot da la bienvenida e identifica si viene de Tienda Nube o Mercado Libre (puede detectarlo por contexto o preguntarlo). | Bot |
| 2 | **Identificación** | El bot solicita el N° de orden (TN) o usuario (ML) y consulta automáticamente el historial del pedido vía API. Esto ocurre **antes** de que el cliente describa el problema. | Bot + API |
| 3 | **Descripción** | El bot pide una descripción libre del problema usando lenguaje conversacional natural. El LLM clasifica internamente el tipo de problema: configuración inicial, falla de hardware, garantía/reemplazo o duda de uso. | Bot / LLM |
| 4 | **Diagnóstico RAG** | El LLM consulta la base de conocimiento interna (manuales, FAQs, casos previos) y opcionalmente busca en internet si no encuentra la respuesta. Formula una solución paso a paso adaptada al equipo y modelo del cliente. | LLM + RAG |
| 5 | **Resolución guiada** | El bot presenta la solución en pasos claros. Pregunta al cliente si el paso funcionó antes de avanzar. Si el cliente confirma, se cierra el ticket. Si no, el bot intenta una solución alternativa. | Bot / LLM |
| 6 | **Garantía / RMA** | Si el diagnóstico determina que se trata de una falla de hardware o corresponde una garantía, el bot recaba los datos necesarios (fotos, descripción, N° de serie), genera un pre-ticket y lo envía a Iván con toda la info organizada. | Bot + Iván |
| 7 | **Escalado** | Se escala a Iván **SOLO** si: (a) el bot no pudo resolver tras 2 intentos, (b) el cliente lo pide explícitamente, o (c) es un caso de garantía/reemplazo confirmado. Iván recibe un resumen estructurado del caso. | Iván |
| 8 | **Cierre** | Al resolver, el bot envía un mensaje de cierre, ofrece encuesta de satisfacción (1-5 estrellas) y registra el caso en el CRM. | Bot |

---

## 4. Capacidades del Motor LLM

### 4.1 Comprensión Conversacional

- Mantener contexto a lo largo de toda la conversación sin perder el hilo.
- Interpretar descripciones vagas o informales del problema ("no prende", "hace ruido raro", "no lo reconoce la PC").
- Detectar emociones: frustración, urgencia, desconfianza — ajustar el tono en consecuencia.
- Distinguir entre múltiples problemas en un mismo mensaje y abordarlos ordenadamente.

### 4.2 Clasificación de Problemas

El LLM clasificará internamente cada consulta en alguna de las siguientes categorías:

- **Configuración inicial del equipo** — Drivers, pairing Bluetooth, configuración de DAC/amplificadores, etc.
- **Falla de hardware** — El equipo no enciende, tiene canales muertos, ruido, distorsión física, etc.
- **Garantía / Reemplazo (RMA)** — Falla dentro del período de garantía, producto defectuoso de fábrica.
- **Duda de uso / operación** — Cómo usar funciones, qué significa un LED, compatibilidad, comparativas.

### 4.3 Consulta de Fuentes (RAG)

- **Base de conocimiento interna:** manuales de producto, procedimientos de garantía, FAQs internas, casos resueltos históricos.
- **API de Tienda Nube:** consulta del estado de la orden, producto comprado, fecha de compra, estado de envío.
- **Historial de Mercado Libre:** datos del pedido, reputación del comprador, mensajería previa.
- **Internet (opcional):** búsqueda de soluciones para problemas específicos de modelos concretos cuando la base interna no tiene respuesta.

### 4.4 Tono y Estilo

- Lenguaje coloquial rioplatense, sin tecnicismos innecesarios.
- Pasos numerados y concisos al dar instrucciones técnicas.
- Confirmación explícita en cada paso antes de avanzar al siguiente.
- Empatía ante la frustración; nunca invalidar al cliente.

---

## 5. Lógica de Escalado a Iván

### 5.1 Condiciones de Escalado Automático

- El bot no pudo resolver el problema luego de 2 intentos de soluciones distintas.
- El diagnóstico determina falla de hardware (requiere intervención física o RMA).
- El caso corresponde a una garantía activa y necesita aprobación humana.
- El cliente expresa explícitamente querer hablar con una persona.
- El bot detecta alto nivel de frustración o enojo del cliente.

### 5.2 Paquete de Escalado (info que recibe Iván)

Cuando se escala, Iván recibe automáticamente en Kommo:

- Nombre del cliente e identificador (N° de orden o usuario ML).
- Producto involucrado y fecha de compra.
- Resumen del problema en 2-3 líneas (generado por el LLM).
- Soluciones ya intentadas por el bot y sus resultados.
- Clasificación del tipo de problema.
- Archivos adjuntos del cliente (fotos, videos, audios) si los hubiera.
- Nivel de urgencia estimado por el LLM.

---

## 6. Requerimientos Funcionales

### 6.1 Core del Bot

| ID | Requerimiento | Prioridad | Notas |
|---|---|---|---|
| RF-01 | El bot debe identificar si el cliente viene de Tienda Nube o Mercado Libre y solicitar el identificador correspondiente. | 🔴 Alta | Puede inferirse por contexto o preguntando directamente. |
| RF-02 | El bot debe consultar la API de Tienda Nube con el N° de orden y recuperar: producto, fecha de compra, estado de envío. | 🔴 Alta | Requiere integración API TN. |
| RF-03 | El bot debe consultar el historial de ML con el nombre de usuario del comprador. | 🔴 Alta | Requiere API de ML o scraping autorizado. |
| RF-04 | El LLM debe clasificar el tipo de problema en una de las 4 categorías definidas. | 🔴 Alta | La clasificación es interna, no se muestra al cliente. |
| RF-05 | El bot debe consultar la base de conocimiento interna (RAG) para formular soluciones paso a paso. | 🔴 Alta | Vector DB + embeddings sobre manuales y FAQs. |
| RF-06 | El bot debe confirmar si la solución funcionó antes de cerrar el ticket o intentar alternativas. | 🔴 Alta | Bucle de confirmación explícita en cada paso. |
| RF-07 | El bot debe escalar a Iván en Kommo cuando se cumplan las condiciones de escalado, con el resumen del caso. | 🔴 Alta | Integración con Kommo API. |
| RF-08 | El bot debe poder recibir y almacenar fotos, videos y audios enviados por el cliente. | 🔴 Alta | WhatsApp Business API soporta media. |

### 6.2 Garantías y RMA

| ID | Requerimiento | Prioridad | Notas |
|---|---|---|---|
| RF-09 | El bot debe verificar si el producto está en período de garantía basándose en la fecha de compra. | 🔴 Alta | Calcular desde fecha de orden TN / ML. |
| RF-10 | El bot debe guiar al cliente para recolectar evidencia (fotos del defecto, N° de serie) antes de escalar el caso de garantía. | 🔴 Alta | Checklist de evidencia por tipo de falla. |
| RF-11 | El bot debe generar un pre-ticket estructurado de RMA que Iván pueda aprobar o rechazar. | 🟡 Media | Template predefinido completado por el LLM. |

### 6.3 Cierre y Métricas

| ID | Requerimiento | Prioridad | Notas |
|---|---|---|---|
| RF-12 | Al resolver exitosamente, el bot debe enviar encuesta de satisfacción de 1-5 estrellas. | 🟡 Media | Respuesta vía botones de WA. |
| RF-13 | El bot debe registrar en el CRM: tipo de problema, resolución, duración, satisfacción. | 🔴 Alta | Para análisis de performance del bot. |
| RF-14 | El bot debe estar disponible 24/7 y responder en menos de 10 segundos. | 🔴 Alta | SLA técnico del proveedor LLM. |
| RF-15 | El bot debe buscar en internet si la base de conocimiento no tiene respuesta para un modelo específico. | 🟢 Baja | Opcional según configuración. Requiere filtros de fuentes confiables. |

---

## 7. Requerimientos No Funcionales

| ID | Requerimiento | Prioridad | Notas |
|---|---|---|---|
| RNF-01 | El sistema debe funcionar 24/7 con una disponibilidad mínima del 99%. | 🔴 Alta | Monitoreo y alertas automáticas. |
| RNF-02 | Los datos del cliente y sus pedidos deben manejarse con confidencialidad. No deben enviarse a terceros no autorizados. | 🔴 Alta | Revisar política de datos del proveedor LLM. |
| RNF-03 | El sistema debe poder manejar hasta 50 conversaciones simultáneas sin degradación. | 🟡 Media | Escalar horizontalmente si crece la demanda. |
| RNF-04 | La base de conocimiento interna debe poder actualizarse sin redeployar el sistema. | 🔴 Alta | Panel de administración o pipeline de ingestión de documentos. |
| RNF-05 | El bot debe registrar logs de todas las conversaciones para auditoría y mejora continua. | 🔴 Alta | Retención mínima de 6 meses. |
| RNF-06 | El tono y las instrucciones del bot deben poder ajustarse vía un archivo de configuración sin modificar código. | 🟡 Media | System prompt editable por un administrador. |

---

## 8. Integraciones Requeridas

| Sistema | Para qué se usa | Tipo de acceso | Prioridad |
|---|---|---|---|
| WhatsApp Business API | Canal de comunicación principal con el cliente | API (Meta Cloud / BSP) | ✅ Esencial |
| Kommo CRM | Escalado a Iván, registro de tickets, historial | API de Kommo | ✅ Esencial |
| Tienda Nube | Consulta de órdenes, productos, fechas de compra | API REST de TN | ✅ Esencial |
| Mercado Libre | Consulta de historial de pedidos y usuario | API de ML | ✅ Esencial |
| Base de Conocimiento (RAG) | Manuales, FAQs, procedimientos internos | Vector DB (embeddings) | ✅ Esencial |
| Proveedor LLM | Motor de razonamiento y respuestas | API (OpenAI / Anthropic / etc.) | ✅ Esencial |
| Internet (búsqueda) | Soluciones específicas no cubiertas por KB interna | Web search API | ⚠️ Opcional |

---

## 9. Métricas de Éxito

KPIs objetivo para los primeros 90 días de operación:

| Métrica | Meta | Cómo se mide |
|---|---|---|
| Tasa de resolución autónoma | > 70% de casos | Casos cerrados sin escalar / total de casos |
| Tiempo promedio de resolución | < 8 minutos | Desde primer mensaje hasta cierre |
| Satisfacción del cliente (CSAT) | > 4.0 / 5.0 | Encuesta post-atención |
| Reducción de carga de Iván | > 60% menos escalados | Comparativa vs. flujo anterior |
| Tasa de escalado por garantía | 100% con pre-ticket completo | Casos de garantía con toda la info |
| Tiempo de respuesta del bot | < 10 segundos | Latencia de API + LLM |

---

## 10. Consideraciones y Puntos a Definir

Los siguientes puntos requieren decisión antes de comenzar el desarrollo:

- **Proveedor LLM:** OpenAI GPT-4o, Anthropic Claude, Google Gemini u otro. Evaluar costo por token vs. calidad de respuesta en soporte técnico.
- **Plataforma de RAG:** Pinecone, Weaviate, Chroma u otro vector store para la base de conocimiento interna.
- **Proveedor WhatsApp Business API:** Meta Cloud API directo o a través de un BSP (ej. Twilio, 360dialog, Gupshup).
- **Límite de intentos del bot:** ¿2 intentos fallidos antes de escalar? ¿O también considerar el tiempo transcurrido?
- **Horario de Iván:** ¿Qué pasa cuando se escala fuera del horario laboral? ¿El bot avisa el tiempo estimado de respuesta?
- **Base de conocimiento:** ¿Quién es responsable de mantenerla actualizada? ¿Con qué frecuencia?
- **Manejo de garantías:** ¿El bot puede aprobar garantías directamente o siempre requiere aprobación humana?
- **Idioma:** ¿El bot debe soportar consultas en inglés de compradores internacionales?

---

*Documento preparado para revisión · Versión 1.0 · Marzo 2026*
