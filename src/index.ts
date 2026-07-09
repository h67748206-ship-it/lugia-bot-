import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
  ChannelType,
  VoiceChannel,
  Message,
} from 'discord.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ── Token (Secrets Replit — jamais dans le code) ───────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN manquant. Ajoute-le dans les Secrets Replit.');
  process.exit(1);
}

// ── Faux serveur web (pour satisfaire les plateformes d'hébergement type Render) ──
import { createServer } from 'http';
const PORT = process.env.PORT || 3000;
createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Lugia bot is running');
}).listen(PORT, () => {
  console.log(`Serveur factice a l'ecoute sur le port ${PORT}`);
});

const PREFIX = '!';
// Auto-ping pour forcer Render à rester éveillé
setInterval(() => {
  fetch('https://lugia-bot.onrender.com')
    .then(() => console.log('Auto-ping réussi !'))
    .catch((err: any) => console.error('Erreur auto-ping :', err.message));
}, 10 * 60 * 1000); // S'exécute toutes les 10 minutes
