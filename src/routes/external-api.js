const express = require('express');
const router = express.Router();
const { sendWhatsAppMessage } = require('../kapso-client');
const { lookupProductByModel } = require('../product-kb-integration');

/**
 * Endpoint para recibir eventos de apps externas
 * Ejemplo: Notificación de stock, actualización de estado, etc.
 */
router.post('/external-event', async (req, res) => {
  try {
    const { eventType, phoneNumber, data } = req.body;
    
    console.log(`[External] Evento recibido: ${eventType} para ${phoneNumber}`);
    
    switch (eventType) {
      case 'order_shipped':
        // Notificar al cliente que su pedido fue enviado
        await sendWhatsAppMessage(phoneNumber, 
          `🚚 ¡Tu pedido #${data.orderId} ha sido enviado!\n` +
          `Producto: ${data.productName}\n` +
          `Podés seguirlo aquí: ${data.trackingLink}`
        );
        break;
        
      case 'back_in_stock':
        // Notificar que un producto volvió a stock
        await sendWhatsAppMessage(phoneNumber,
          `✅ ¡Buenas noticias!\n` +
          `El ${data.productName} que estabas buscando ya está disponible nuevamente.\n` +
          `¿Te gustaría realizar el pedido?`
        );
        break;
        
      case 'warranty_reminder':
        // Recordatorio de garantía
        await sendWhatsAppMessage(phoneNumber,
          `📅 Recordatorio de garantía\n` +
          `Tu ${data.productName} tiene garantía activa hasta ${data.warrantyDate}.\n` +
          `¿Todo funciona correctamente?`
        );
        break;
        
      default:
        console.log(`[External] Evento no manejado: ${eventType}`);
    }
    
    res.json({ success: true, eventProcessed: eventType });
  } catch (error) {
    console.error('[External] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint para enviar mensajes masivos (con consentimiento)
 */
router.post('/broadcast', async (req, res) => {
  try {
    const { phoneNumbers, message } = req.body;
    
    if (!Array.isArray(phoneNumbers)) {
      return res.status(400).json({ error: 'phoneNumbers debe ser un array' });
    }
    
    const results = [];
    for (const phone of phoneNumbers) {
      try {
        await sendWhatsAppMessage(phone, message);
        results.push({ phone, status: 'sent' });
      } catch (err) {
        results.push({ phone, status: 'error', error: err.message });
      }
    }
    
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint para consultar info de producto vía API
 * Útil para integrar con tu tienda online
 */
router.get('/product-info/:modelo', (req, res) => {
  const info = lookupProductByModel(req.params.modelo);
  if (info) {
    res.json({
      found: true,
      product: {
        name: info.nombre,
        connectivity: info.conectividad,
        manuals: info.manuales.length,
        hasManuals: info.tiene_manuales
      }
    });
  } else {
    res.status(404).json({ found: false });
  }
});

module.exports = router;
