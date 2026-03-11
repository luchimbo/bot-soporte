# Netlify + contexto conversacional

## Que cambia para Netlify

Netlify no mantiene memoria estable entre invocaciones, asi que para conservar contexto conversacional hay que persistir las sesiones fuera del proceso.

En este proyecto eso ya queda resuelto asi:

- `memory` por defecto para local y servidores tradicionales
- `Upstash Redis` automaticamente cuando cargas:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

## Variables minimas para Netlify

Ademas de tus variables habituales de LLM, Kommo y WhatsApp, agrega estas dos para el contexto:

```env
UPSTASH_REDIS_REST_URL=pega_tu_url_de_upstash
UPSTASH_REDIS_REST_TOKEN=pega_tu_token_de_upstash
SESSION_STORE_PREFIX=soporte:sessions:
```

## Como desplegar

1. Subi el repo a GitHub.
2. En Netlify, crea un sitio desde ese repo.
3. En `Site configuration -> Environment variables`, carga:
   - tus variables de Kommo
   - tus variables de OpenRouter/OpenAI
   - las variables de Upstash
4. Hace deploy.

Este repo ya trae `netlify.toml`, asi que las rutas quedan expuestas automaticamente.

## URLs esperadas

- Health: `https://TU-SITIO.netlify.app/health`
- Kommo widget: `https://TU-SITIO.netlify.app/kommo/widget-request`
- Meta webhook: `https://TU-SITIO.netlify.app/webhook`

## Verificacion rapida

1. Abrir `https://TU-SITIO.netlify.app/health`.
2. Confirmar que `sessions.backend` muestre `upstash-redis`.
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
