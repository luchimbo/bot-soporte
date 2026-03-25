/**
 * Endpoint webhook mejorado para Kapso
 * Busca en KB antes de responder
 */

const express = require('express');
const router = express.Router();
const { buildAssistantReply } = require('../assistant');
const { startTurn, finishTurn } = require('../conversation-state');
const { sendWhatsAppMessage } = require('../kapso-client');
const fs = require('fs');
const path = require('path');

// Cargar KB en memoria
let knowledgeBase = [];
try {
  const kbPath = path.join(__dirname, '..', '..', 'data', 'knowledge-base.json');
  const data = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
  knowledgeBase = data.documents || [];
  console.log(`[KB] Cargados ${knowledgeBase.length} documentos para búsqueda`);
} catch (error) {
  console.error('[KB] Error cargando:', error.message);
}

// Búsqueda simple
function searchKB(query, limit = 3) {
  if (!knowledgeBase.length || !query) return [];
  
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3);
  
  const scored = knowledgeBase.map(doc => {
    const text = (doc.text || '').toLowerCase();
    let score = 0;
    
    if (text.includes(queryLower)) score += 10;
    queryWords.forEach(word => {
      if (text.includes(word)) score += 2;
    });
    if (doc.source?.includes('manual')) score += 1;
    
    return { doc, score };
  });
  
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => ({
      text: item.doc.text?.substring(0, 800),
      source: item.doc.source,
      score: item.score
    }));
}

// Webhook mejorado con KB
router.post('/kapso-webhook', async (req, res) => {
  try {
    res.sendStatus(200); // Responder inmediatamente
    
    const message = req.body.messages?.[0] || req.body.message;
    if (!message) return;
    
    const from = message.from || message.sender;
    const text = message.text?.body || message.text || message.content;
    
    console.log(`[Webhook-KB] Mensaje de ${from}: ${text?.substring(0, 50)}...`);
    
    // 1. Buscar en KB
    const kbResults = searchKB(text, 3);
    console.log(`[KB] Encontrados ${kbResults.length} resultados`);
    
    // 2. Preparar contexto
    const sessionId = from;
    const sessionContext = await startTurn(sessionId, text);
    
    // 3. Enriquecer contexto con KB si hay resultados
    if (kbResults.length > 0) {
      sessionContext.kbContext = kbResults.map(r => 
        `[${r.source}] ${r.text}`
      ).join('\n\n');
    }
    
    // 4. Generar respuesta con contexto enriquecido
    const result = await buildAssistantReply(text, {
      sessionContext,
      sessionId,
    });
    
    await finishTurn(sessionId, result.text, result.stateUpdate, {
      mode: result.mode,
      kbResults: kbResults.length
    });
    
    // 5. Enviar respuesta
    await sendWhatsAppMessage(from, result.text);
    
    console.log(`[Webhook-KB] Respuesta enviada`);
    
  } catch (error) {
    console.error('[Webhook-KB] Error:', error);
  }
});

module.exports = router;
