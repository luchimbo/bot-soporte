/**
 * Clasificador de intenciones usando LLM
 * Diferencia entre:
 * - capability_query: Preguntas sobre características/capacidades
 * - problem_diagnosis: Problemas técnicos a resolver
 * - how_to: Consultas de cómo hacer/configurar
 * - general_info: Información general
 */

const OpenAI = require("openai");

// Cache de cliente LLM
let llmClient = null;

function getLLMClient() {
  if (llmClient) return llmClient;
  
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  
  const baseURL = process.env.OPENROUTER_API_KEY 
    ? "https://openrouter.ai/api/v1"
    : undefined;
    
  llmClient = new OpenAI({
    apiKey,
    baseURL,
    timeout: 10000,
  });
  
  return llmClient;
}

/**
 * Clasifica la intención de la consulta del usuario
 * @param {string} userText - Texto del usuario
 * @param {object} activeProduct - Producto activo (opcional)
 * @returns {Promise<{intent: string, confidence: number, reasoning: string}>}
 */
async function classifyIntent(userText, activeProduct = null) {
  const client = getLLMClient();
  if (!client) {
    // Fallback a clasificación simple basada en regex
    return classifyIntentFallback(userText);
  }
  
  const productContext = activeProduct 
    ? `Producto: ${activeProduct.name}` 
    : 'Sin producto específico';
  
  const prompt = `Analiza esta consulta de soporte técnico y clasifícala en una de estas categorías:

CATEGORÍAS:
1. **capability_query** - Preguntas sobre características/capacidades del producto:
   - "¿Tiene phantom power?"
   - "¿Se conecta a PC?"
   - "¿Tiene Bluetooth?"
   - "¿Es condensador?"
   - "¿Tiene parlantes?"

2. **problem_diagnosis** - Problemas técnicos que necesitan solución:
   - "No funciona"
   - "No se conecta"
   - "No emite sonido"
   - "Tengo un problema con..."
   - "Falló"
   - "Error"

3. **how_to** - Consultas de configuración/uso:
   - "¿Cómo configuro...?"
   - "¿Cómo instalo...?"
   - "¿Cómo uso...?"
   - "Necesito ayuda para..."

4. **general_info** - Información general (envíos, garantía, stock, etc.):
   - "¿Cuánto tarda el envío?"
   - "¿Tienen stock?"
   - "¿Cuál es la garantía?"

CONTEXTO:
${productContext}

CONSULTA DEL USUARIO:
"${userText}"

Responde EXACTAMENTE en este formato JSON (sin markdown, sin comillas extras):
{"intent": "nombre_de_categoria", "confidence": 0.95, "reasoning": "breve explicación"}

Intent:`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.LLM_SIMPLE_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "Eres un clasificador de intenciones para soporte técnico. Responde solo con JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 150,
    });
    
    const content = response.choices[0].message.content.trim();
    
    // Limpiar posible markdown
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    
    const result = JSON.parse(jsonStr);
    
    return {
      intent: result.intent || 'general_info',
      confidence: result.confidence || 0.5,
      reasoning: result.reasoning || 'Sin razonamiento'
    };
  } catch (error) {
    console.error('Error clasificando intención:', error.message);
    return classifyIntentFallback(userText);
  }
}

/**
 * Clasificación fallback basada en patrones
 */
function classifyIntentFallback(userText) {
  const text = userText.toLowerCase();
  
  // Problemas
  if (/no (funciona|anda|prende|enciende|conecta|emite|detecta)|falla|error|problema|defectuoso|fallo/.test(text)) {
    return { intent: 'problem_diagnosis', confidence: 0.8, reasoning: 'Detectado patrón de problema técnico' };
  }
  
  // Capacidades
  if (/\b(tiene|es|incluye|viene con|soporta|compatible)\b.*\?(tiene|es|phantom|bluetooth|midi|condensador|dinamico|wireless)/.test(text) ||
      /\b(phantom power|bluetooth|midi|condensador|dinamico|wireless|usb-c|aftertouch|secuenciador|arpegiador)\b/.test(text)) {
    return { intent: 'capability_query', confidence: 0.7, reasoning: 'Detectado patrón de consulta de características' };
  }
  
  // Cómo hacer
  if (/\b(como|como se|como hago|como configuro|como instalo|como uso|necesito ayuda para|ayudame a)\b/.test(text)) {
    return { intent: 'how_to', confidence: 0.75, reasoning: 'Detectado patrón de consulta de configuración' };
  }
  
  return { intent: 'general_info', confidence: 0.6, reasoning: 'Por defecto - información general' };
}

/**
 * Determina si es una consulta de característica específica
 */
function isCapabilityQuery(text) {
  const capabilityPatterns = [
    /\b(tiene|incluye|viene con|soporta)\b.*\b(phantom power|bluetooth|midi|condensador|dinamico|wireless|usb-c|aftertouch|secuenciador|arpegiador|vocoder|mesh|parlantes|loopback|dsp)\b/i,
    /\b(es)\b.*\b(condensador|dinamico|cardioide|cerrado|abierto)\b/i,
    /\b(phantom|bluetooth|midi|wireless|aftertouch|secuenciador|arpegiador|vocoder|mesh)\b/i,
  ];
  
  return capabilityPatterns.some(pattern => pattern.test(text));
}

/**
 * Determina si es un problema técnico
 */
function isProblemQuery(text) {
  const problemPatterns = [
    /\b(no (funciona|anda|prende|enciende|conecta|emite|detecta|reconoce|responde|sirve))\b/i,
    /\b(falla|error|problema|defectuoso|fallo|mal|ruido|cortado|intermitente|bug)\b/i,
    /\b(dejo de|dejó de|empezo a|empezó a)\b/i,
    /\b(no se (conecta|detecta|reconoce|escucha|ve))\b/i,
  ];
  
  return problemPatterns.some(pattern => pattern.test(text));
}

module.exports = {
  classifyIntent,
  classifyIntentFallback,
  isCapabilityQuery,
  isProblemQuery,
};