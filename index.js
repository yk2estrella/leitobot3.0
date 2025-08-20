// ====== Servidor Express para Render ======
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

let lastQR = ""; // guardamos el QR aquí

app.get("/", (req, res) => res.send("✅ Leitobot corriendo en Render 🚀"));
app.get("/qr", (req, res) => {
  if (!lastQR) {
    res.send("<h2>⏳ Esperando a que se genere un nuevo QR...</h2>");
  } else {
    res.send(`
      <h2>📲 Escanea este QR con tu WhatsApp</h2>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${lastQR}" />
    `);
  }
});
app.listen(PORT, () => console.log(`🌐 Servidor web en puerto ${PORT}`));

// ====== Dependencias de Baileys ======
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");

// ====== Base de datos simple en JSON ======
const dbPath = "./carpetas.json";
let carpetas = fs.existsSync(dbPath)
  ? JSON.parse(fs.readFileSync(dbPath))
  : {
      carpeta01: [],
      carpeta02: [],
      carpeta03: [],
      carpeta04: [],
      carpeta05: [],
    };

function guardarDB() {
  fs.writeFileSync(dbPath, JSON.stringify(carpetas, null, 2));
}

// ====== Función principal del bot ======
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");

  const sock = makeWASocket({
    auth: state,
    logger: require("pino")({ level: "silent" }),
    browser: ["Leitobot", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQR = qr; // guardamos el QR para mostrar en /qr
      console.log("✅ Nuevo QR disponible en /qr");
    }

    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("🔌 Conexión cerrada. Reconectar:", shouldReconnect);
      if (shouldReconnect) startBot();
    }

    if (connection === "open") {
      console.log("✅ Conectado exitosamente a WhatsApp.");
    }
  });

  // Bienvenida a nuevos miembros
  sock.ev.on("group-participants.update", async (update) => {
    const { id, participants, action } = update;
    if (action === "add") {
      for (const user of participants) {
        try {
          const perfil = await sock.profilePictureUrl(user, "image");
          await sock.sendMessage(id, {
            image: { url: perfil || "https://i.ibb.co/fD0bDKZ/default-pfp.png" },
            caption: `¡Hola! Soy Leitobot ⭐ y espero que disfrutes el grupo @${user.split("@")[0]} 👋`,
            mentions: [user],
          });
        } catch (err) {
          console.log("❌ Error al dar la bienvenida:", err);
        }
      }
    }
  });

  // Mensajes entrantes
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    const from = msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const sender = msg.key.participant || msg.key.remoteJid;

    if (!text) return;
    const lower = text.toLowerCase();

    if (!isGroup && lower === "leitobot") {
      await sock.sendMessage(from, { text: "Hola, soy Leitobot ⭐" });
      return;
    }

    if (lower.startsWith("#ayuda")) {
      const help = `🧠 *Comandos disponibles de Leitobot*:

#tag "texto" — Etiqueta a todos y replica el texto.
#actualizarcarpeta01...05 — Guarda texto en carpeta.
#carpeta01...05 — Muestra lo guardado.
#leitobotbusca "texto" — Busca en todas las carpetas.
#ban — Elimina al usuario que respondió el mensaje.
#cerrargrupo — Cierra el grupo.
#abrirgrupo — Abre el grupo.`;
      await sock.sendMessage(from, { text: help });
      return;
    }

    const matchTag = text.match(/^#tag\s+"(.+)"$/);
    if (matchTag && isGroup) {
      const texto = matchTag[1];
      const metadata = await sock.groupMetadata(from);
      const mentions = metadata.participants.map((p) => p.id);
      await sock.sendMessage(from, { text: texto, mentions });
      return;
    }

    const matchGuardar = text.match(/^#actualizarcarpeta(0[1-5])\s+([\s\S]+)/i);
    if (matchGuardar) {
      const num = matchGuardar[1];
      const contenido = matchGuardar[2].trim().split("\n");
      carpetas[`carpeta${num}`] = contenido;
      guardarDB();
      await sock.sendMessage(from, { text: `📂 Carpeta ${num} actualizada.` });
      return;
    }

    const matchMostrar = text.match(/^#carpeta(0[1-5])$/i);
    if (matchMostrar) {
      const num = matchMostrar[1];
      const contenido = carpetas[`carpeta${num}`] || [];
      const respuesta = contenido.length > 0
        ? `📄 Lista de carpeta ${num}:\n\n- ${contenido.join("\n- ")}`
        : "🚫 Carpeta vacía.";
      await sock.sendMessage(from, { text: respuesta });
      return;
    }

    const matchBuscar = text.match(/^#leitobotbusca\s+"(.+)"$/i);
    if (matchBuscar) {
      const busqueda = matchBuscar[1].toLowerCase();
      let encontrado = false;
      for (let i = 1; i <= 5; i++) {
        const carpeta = carpetas[`carpeta0${i}`] || [];
        if (carpeta.find((item) => item.toLowerCase().includes(busqueda))) {
          await sock.sendMessage(from, {
            text: `✅ ¡Manhwa encontrado, está añadido en la carpeta 0${i}. ⭐`,
          });
          encontrado = true;
          break;
        }
      }
      if (!encontrado) {
        await sock.sendMessage(from, {
          text: `😥 Ouh... El manhwa aún no está añadido, dile a mi papi Leo que lo suba.`,
        });
      }
      return;
    }

    if (lower === "#cerrargrupo" && isGroup) {
      await sock.groupSettingUpdate(from, "announcement");
      await sock.sendMessage(from, { text: "Buena noche, el grupo será cerrado, hasta mañana. 💕" });
      return;
    }

    if (lower === "#abrirgrupo" && isGroup) {
      await sock.groupSettingUpdate(from, "not_announcement");
      await sock.sendMessage(from, { text: "¡Buen día! El grupo ya está abierto, no se olviden de leer las reglas." });
      return;
    }

    if (lower === "#ban" && isGroup) {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
      if (quoted) {
        await sock.groupParticipantsUpdate(from, [quoted], "remove");
        await sock.sendMessage(from, {
          text: "🚫 Fuiste baneado por Leo.",
          mentions: [quoted],
        });
      } else {
        await sock.sendMessage(from, { text: "❌ Usa #ban como respuesta a un mensaje." });
      }
      return;
    }
  });
}

// Iniciar el bot
startBot();
