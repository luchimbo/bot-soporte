function normalize(input = "") {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildSupportReply(userText) {
  const text = normalize(userText);

  if (!text) {
    return "Te ayudo con soporte tecnico. Contame producto y problema para empezar.";
  }

  if (/(hola|buenas|buen dia|hello)/.test(text)) {
    return "Hola. Soy tu asistente de soporte. Decime producto y que esta pasando.";
  }

  if (/(devolucion|devolver|reembolso|cambio|garantia)/.test(text)) {
    return "Te guio con la devolucion. Pasame producto, fecha de compra y si tenes comprobante. Con eso te digo los pasos exactos.";
  }

  if (/(no funciona|no anda|falla|error|no enciende|no conecta|problema)/.test(text)) {
    return "Vamos paso a paso. 1) Decime producto/modelo. 2) Que mensaje de error ves (si aparece). 3) Desde cuando pasa. Con eso te doy una solucion concreta.";
  }

  if (/(como|configurar|usar|instalar|pasos)/.test(text)) {
    return "Claro. Decime el producto y que queres hacer exactamente. Te paso pasos cortos para resolverlo.";
  }

  return "Puedo ayudarte con fallas, uso de producto o devoluciones. Contame producto y detalle del caso.";
}

module.exports = {
  buildSupportReply,
};
