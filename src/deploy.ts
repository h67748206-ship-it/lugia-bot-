/**
 * Script à exécuter UNE FOIS pour enregistrer les commandes slash sur Discord.
 * Lance avec : pnpm --filter @workspace/discord-bot run deploy-commands
 */
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN manquant dans les Secrets Replit.');
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error('❌ DISCORD_CLIENT_ID manquant dans les Secrets Replit.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup-roles')
    .setDescription('Affiche le message de création de rôle personnalisé')
    .setDefaultMemberPermissions('268435456') // MANAGE_ROLES
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('⏳ Enregistrement des commandes slash...');
    await rest.put(Routes.applicationCommands(CLIENT_ID!), { body: commands });
    console.log('✅ Commandes enregistrées avec succès !');
  } catch (err) {
    console.error('❌ Erreur :', err);
    process.exit(1);
  }
})();
