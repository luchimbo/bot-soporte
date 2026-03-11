# Netlify + contexto conversacional

## Que cambia para Netlify

Netlify no mantiene memoria estable entre invocaciones, asi que para conservar contexto conversacional hay que persistir las sesiones fuera del proceso.

En este proyecto eso ya queda resuelto asi:

- `memory` por defecto para local y servidores tradicionales
- `Turso` automaticamente cuando cargas:
  - `TURSO_DATABASE_URL`
  - `TURSO_AUTH_TOKEN`

## Variables minimas para Netlify

Ademas de tus variables habituales de LLM, Kommo y WhatsApp, agrega estas dos para el contexto:

```env
TURSO_DATABASE_URL=libsql://tu-db-tu-org.turso.io
TURSO_AUTH_TOKEN=pega_tu_token_de_turso
TURSO_SESSION_TABLE=conversation_sessions
SESSION_STORE_PREFIX=soporte:sessions:
```

## Como desplegar

1. Subi el repo a GitHub.
2. En Netlify, crea un sitio desde ese repo.
3. En `Site configuration -> Environment variables`, carga:
   - tus variables de Kommo
   - tus variables de OpenRouter/OpenAI
   - las variables de Turso
4. Hace deploy.

Este repo ya trae `netlify.toml`, asi que las rutas quedan expuestas automaticamente.

## URLs esperadas

- Health: `https://TU-SITIO.netlify.app/health`
- Kommo widget: `https://TU-SITIO.netlify.app/kommo/widget-request`
- Meta webhook: `https://TU-SITIO.netlify.app/webhook`

## Verificacion rapida

1. Abrir `https://TU-SITIO.netlify.app/health`.
2. Confirmar que `sessions.backend` muestre `turso`.
3. Confirmar que `kommo.configured` este en `true`.

## Kommo

Cuando ya tengas la URL final de Netlify, en tu `.env` local deja:

```env
KOMMO_WIDGET_DEFAULT_BACKEND_URL=https://TU-SITIO.netlify.app/kommo/widget-request
KOMMO_WIDGET_SUPPORT_EMAIL=soporte@pcmidicenter.com
```

Despues:

```bash
npm run kommo:package
```

Y subis `dist/kommo-widget.zip` a la integracion privada de Kommo.

## Nota sobre archivos de runtime

Netlify necesita incluir estos archivos en la funcion:

- `data/knowledge-base.json`
- `archivos/Productos.xlsx`

Eso ya queda cubierto por `netlify.toml`.
