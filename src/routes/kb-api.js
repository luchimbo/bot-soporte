/**
 * API endpoint para consultar knowledge base
 * Kapso puede llamar a este endpoint para buscar información
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Cargar knowledge base en memoria (una sola vez)
let knowledgeBase = null;
let lastLoadTime = 0;

function loadKnowledgeBase() {
  const now = Date.now();
  // Recargar cada 5 minutos si hay cambios
  if (knowledgeBase && (now - lastLoadTime) < 300000) {
    return knowledgeBase;
  }
  
  try {
    const kbPath = path.join(__dirname, '..', 'data', 'knowledge-base.json');
    const data = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
    knowledgeBase = data.documents || [];
    lastLoadTime = now;
    console.log(`[KB] Cargados ${knowledgeBase.length} documentos`);
    return knowledgeBase;
  } catch (error) {
    console.error('[KB] Error cargando:', error.message);
    return [];
  }
}

// Función simple de búsqueda
function searchDocuments(query, limit = 3) {
  const docs = loadKnowledgeBase();
  if (!docs.length) return [];
  
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  
  // Scoring simple
  const scored = docs.map(doc => {
    const text = (doc.text || '').toLowerCase();
    let score = 0;
    
    // Coincidencia exacta
    if (text.includes(queryLower)) score += 10;
    
    // Coincidencia por palabras
    queryWords.forEach(word => {
      if (text.includes(word)) score += 2;
    });
    
    // Boost por source
    if (doc.source?.includes('manual')) score += 1;
    
    return { doc, score };
  });
  
  // Filtrar y ordenar
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => ({
      id: item.doc.id,
      text: item.doc.text?.substring(0, 500) + '...',
      source: item.doc.source,
      category: item.doc.category,
      score: item.score
    }));
}

// GET /api/kb/search?q=consulta
router.get('/search', (req, res) => {
  const query = req.query.q || req.query.query;
  const limit = parseInt(req.query.limit) || 3;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter required' });
  }
  
  console.log(`[KB Search] Query: "${query}"`);
  
  const results = searchDocuments(query, limit);
  
  res.json({
    query,
    resultsFound: results.length,
    results
  });
});

// POST /api/kb/search (para webhooks)
router.post('/search', (req, res) => {
  const query = req.body?.query || req.body?.q || req.body?.text;
  const limit = parseInt(req.body?.limit) || 3;
  
  if (!query) {
    return res.status(400).json({ error: 'Query required in body' });
  }
  
  const results = searchDocuments(query, limit);
  
  res.json({
    query,
    resultsFound: results.length,
    results
  });
});

// GET /api/kb/stats
router.get('/stats', (req, res) => {
  const docs = loadKnowledgeBase();
  const stats = {
    totalDocuments: docs.length,
    bySource: {},
    byCategory: {}
  };
  
  docs.forEach(doc => {
    stats.bySource[doc.source] = (stats.bySource[doc.source] || 0) + 1;
    stats.byCategory[doc.category] = (stats.byCategory[doc.category] || 0) + 1;
  });
  
  res.json(stats);
});

module.exports = router;
