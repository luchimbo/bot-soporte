# Arbol de decisiones del bot de soporte

## Vista general

```text
Cliente escribe
-> Bot se presenta como asistente virtual
-> Informa que, si hace falta intervencion humana, el equipo responde de 9 a 14 hs
-> Analiza el mensaje
   -> Detecta si hay insulto/maltrato
   -> Detecta producto/modelo
   -> Clasifica el tipo de consulta
   -> Busca respuesta en playbook FAQ
   -> Si no alcanza, usa RAG/manuales
   -> Si el caso es sensible, deriva a humano
```

## Arbol principal

```text
1. Cliente escribe
   -> Si el mensaje es /nuevo, /reset o /reiniciar
      -> borrar contexto anterior
      -> responder: "Listo. Borre el contexto anterior..."
      -> fin del turno

   -> Si el mensaje esta vacio o no aporta texto util
      -> pedir producto/modelo y problema
      -> fin del turno

   -> Si el cliente insulta o maltrata
      -> derivar directo a humano
      -> informar horario humano
      -> fin del turno

   -> Si es saludo simple
      -> presentarse como bot
      -> informar horario humano
      -> pedir producto/modelo y problema
      -> fin del turno

   -> Si no hay producto claro
      -> pedir producto/modelo exacto
      -> fin del turno

   -> Si hay producto ambiguo o posible cambio de producto
      -> pedir confirmacion
      -> no cambiar de producto automaticamente
      -> fin del turno

   -> Si hay producto confirmado
      -> clasificar la consulta
         -> FAQ simple
         -> falla de producto
         -> equivocacion en envio
         -> garantia/devolucion
         -> otro caso humano
```

## Rama FAQ simple

```text
2. Si la consulta coincide con una FAQ del playbook
   -> responder con respuesta aprobada
   -> agregar link si existe
   -> preguntar: "¿Con esto pudiste resolverlo?"

3. Esperar respuesta del cliente
   -> Si responde SI
      -> cerrar intervencion del bot
      -> ofrecer /nuevo si quiere iniciar otro caso

   -> Si responde NO
      -> pasar a triage humano
      -> pedir datos segun la categoria

   -> Si responde algo ambiguo
      -> insistir solo con si/no
```

## Rama falla de producto

```text
4. Si el caso requiere intervencion humana por falla
   -> pedir:
      1) producto/modelo exacto
      2) factura de compra
      3) video mostrando la falla
      4) desde cuando comenzo a ocurrir
   -> dejar el caso listo para revision humana
   -> bot deja de intervenir
```

## Rama equivocacion en envio

```text
5. Si el caso es equivocacion en envio
   -> pedir:
      1) factura de compra
      2) producto esperado y producto recibido
      3) direccion completa
      4) piso/departamento si aplica
      5) nombre completo
      6) DNI
      7) telefono de quien recibe
   -> dejar el caso listo para revision humana
   -> bot deja de intervenir
```

## Rama garantia / devolucion / reembolso

```text
6. Si el caso toca garantia, devolucion o reembolso
   -> pedir:
      1) producto/modelo exacto
      2) factura o comprobante
      3) fecha y canal de compra
      4) descripcion breve del inconveniente
   -> dejar el caso listo para revision humana
   -> bot deja de intervenir
```

## Rama tecnica sin FAQ exacta

```text
7. Si no hay FAQ exacta pero hay contexto tecnico suficiente
   -> buscar en manuales + base historica
   -> usar LLM para redactar respuesta conservadora
   -> no cambiar de producto si no hay evidencia clara
   -> si la confianza es baja
      -> pedir aclaracion
      -> o pasar a humano si el caso es sensible
```

## Reglas duras del bot

```text
- Nunca confirmar que el equipo esta en garantia
- Nunca confirmar que se enviara el equipo
- Nunca prometer reemplazo, devolucion o reembolso
- Nunca improvisar politicas internas
- Si hay insultos, derivar a humano
- Si no hay producto claro, pedirlo antes de diagnosticar
- Si el cambio de producto no es explicito, pedir confirmacion
- Los cambios de color/estetica no cuentan como producto distinto tecnico
```

## Prioridad de fuentes

```text
1. Politicas del bot
2. Playbook FAQ (faq_respuestas)
3. Playbook de triage humano (triage_humano)
4. Manuales tecnicos / RAG
5. Historico de soporte
6. LLM para clasificar y redactar
```

## Resultado esperado

```text
- El bot resuelve automaticamente preguntas repetidas
- El bot evita cambiar de producto por error
- El bot junta los datos correctos para soporte humano
- El bot no toma decisiones sensibles de postventa
- Kommo recibe el caso resumido y listo para continuar
```
