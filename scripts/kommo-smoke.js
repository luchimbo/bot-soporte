require("dotenv").config();

const express = require("express");
const axios = require("axios");

const targetBaseUrl = String(process.env.KOMMO_SMOKE_BASE_URL || "http://localhost:3000").trim();
const callbackPort = Number(process.env.KOMMO_SMOKE_CALLBACK_PORT || 4011);
const waitTimeoutMs = Number(process.env.KOMMO_SMOKE_WAIT_MS || 45000);
const message = process.argv.slice(2).join(" ") || "tengo una arturia minifuse 2 y no tengo audio";

async function main() {
  let receivedPayload = null;
  let resolveCallback;
  const callbackPromise = new Promise((resolve) => {
    resolveCallback = resolve;
  });

  const app = express();
  app.use(express.json());
  app.post("/continue", (req, res) => {
    receivedPayload = req.body || null;
    res.status(200).json({ ok: true });
    resolveCallback();
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(callbackPort, () => resolve(listener));
  });

  try {
    const widgetRequestPayload = {
      data: {
        message,
        lead_id: 123456,
        contact_id: 654321,
        talk_id: "local-smoke-test",
        source: "kommo_salesbot",
      },
      return_url: `http://127.0.0.1:${callbackPort}/continue`,
    };

    const response = await axios.post(
      `${targetBaseUrl.replace(/\/$/, "")}/kommo/widget-request`,
      widgetRequestPayload,
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`Widget request status: ${response.status}`);

    await Promise.race([
      callbackPromise,
      wait(waitTimeoutMs).then(() => {
        throw new Error(`Timeout esperando callback a return_url (${waitTimeoutMs} ms)`);
      }),
    ]);

    console.log("\n=== CALLBACK PAYLOAD ===");
    console.log(JSON.stringify(receivedPayload, null, 2));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
