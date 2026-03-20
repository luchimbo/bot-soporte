function normalize(input = "") {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildSupportReply(userText) {
  const text = normalize(userText);
  const intro =
    "Soy un asistente virtual de soporte de PC MIDI Center. Si hace falta intervencion humana, el equipo responde de 9 a 14 hs.";

  if (!text) {
    return `${intro} Contame producto/modelo y problema para empezar.`;
  }

  if (/(hola|buenas|buen dia|hello)/.test(text)) {
    return `${intro} Decime producto/modelo y que esta pasando.`;
  }

  if (/(devolucion|devolver|reembolso|cambio|garantia)/.test(text)) {
    return `${intro} Este tipo de caso necesita revision humana. Pasame producto, fecha de compra y comprobante para dejarlo listo.`;
  }

  if (/(no funciona|no anda|falla|error|no enciende|no conecta|problema)/.test(text)) {
    return `${intro} Decime producto/modelo exacto y que problema tenes. Si aparece un error, pasamelo textual.`;
  }

  if (/(como|configurar|usar|instalar|pasos)/.test(text)) {
    return `${intro} Decime el producto y que queres hacer exactamente. Te paso pasos cortos para resolverlo.`;
  }

  return `${intro} Puedo ayudarte con uso del producto, fallas simples o relevamiento del caso. Contame producto/modelo y detalle del inconveniente.`;
}

module.exports = {
  buildSupportReply,
};
