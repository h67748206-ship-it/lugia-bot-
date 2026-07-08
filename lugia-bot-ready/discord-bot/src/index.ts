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

const PREFIX = '!';
const DATA_DIR = join(process.cwd(), 'data');

// ── Helpers JSON (toutes les données namespaced par guildId) ───────────────
function loadJson<T>(filename: string, fallback: T): T {
  const file = join(DATA_DIR, filename);
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function saveJson(filename: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
}

// Blacklist par guild : { [guildId]: string[] }
function getBlacklist(guildId: string): string[] {
  return (loadJson<Record<string, string[]>>('blacklist.json', {}))[guildId] ?? [];
}
function saveBlacklist(guildId: string, list: string[]): void {
  const all = loadJson<Record<string, string[]>>('blacklist.json', {});
  all[guildId] = list;
  saveJson('blacklist.json', all);
}

// Rôles par guild : { [guildId]: { [userId]: roleId } }
function getRoles(guildId: string): Record<string, string> {
  return (loadJson<Record<string, Record<string, string>>>('roles.json', {}))[guildId] ?? {};
}
function saveRoles(guildId: string, data: Record<string, string>): void {
  const all = loadJson<Record<string, Record<string, string>>>('roles.json', {});
  all[guildId] = data;
  saveJson('roles.json', all);
}

// Config par guild : { [guildId]: { key: value } }
function getConfig(guildId: string): Record<string, string> {
  return (loadJson<Record<string, Record<string, string>>>('config.json', {}))[guildId] ?? {};
}
function saveConfig(guildId: string, data: Record<string, string>): void {
  const all = loadJson<Record<string, Record<string, string>>>('config.json', {});
  all[guildId] = data;
  saveJson('config.json', all);
}

// Warns par guild : { [guildId]: { [userId]: { reason, date, by }[] } }
interface Warn { reason: string; date: string; by: string }
function getWarns(guildId: string, userId: string): Warn[] {
  const all = loadJson<Record<string, Record<string, Warn[]>>>('warns.json', {});
  return all[guildId]?.[userId] ?? [];
}
function saveWarns(guildId: string, userId: string, warns: Warn[]): void {
  const all = loadJson<Record<string, Record<string, Warn[]>>>('warns.json', {});
  if (!all[guildId]) all[guildId] = {};
  all[guildId][userId] = warns;
  saveJson('warns.json', all);
}

// ── Client Discord ─────────────────────────────────────────────────────────
// Suivi en mémoire des participants "Show your face" en attente d'envoi DM
// { userId: { guildId, gender, anon, attachmentUrl } }
interface SFPending { guildId: string; gender: string; anon: boolean; attachmentUrl?: string }
const pendingSF = new Map<string, SFPending>();


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot connecté : ${c.user.tag}`);
  console.log(`📋 Serveurs : ${c.guilds.cache.size}`);
});

// ══════════════════════════════════════════════════════════════════════════
// COMMANDES PREFIX (!)
// ══════════════════════════════════════════════════════════════════════════

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;
  if (!message.guild) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  const guildId = message.guild.id;
  const isOwner = message.guild.ownerId === message.author.id;
  const isStaff = isOwner || (message.member?.permissions.has(PermissionFlagsBits.ManageMessages) ?? false);

  // ── !help ─── Liste des commandes ───────────────────────────────────
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Liste des commandes')
      .setColor(0x5865f2)
      .addFields(
        {
          name: '🌍 Tout le monde',
          value: [
            '`!help` — Voir toutes les commandes',
            '`!ping` — Latence du bot',
            '`!info` — Infos du serveur',
            '`!bllust` — Voir la blacklist',
          ].join('\n'),
        },
        {
          name: '🛡️ Staff (Gérer les messages)',
          value: [
            '`!kick @user [raison]` — Expulser',
            '`!ban @user [raison]` — Bannir',
            '`!unban <userId>` — Débannir',
            '`!mute @user [minutes] [raison]` — Timeout (défaut 10 min)',
            '`!unmute @user` — Lever le timeout',
            '`!warn @user [raison]` — Avertir',
            '`!warns @user` — Voir les avertissements',
            '`!clearwarns @user` — Effacer les avertissements',
            '`!clear <1-100>` — Supprimer des messages',
            '`!slowmode <secondes>` — Slowmode (0 = désactiver)',
            '`!lock` — Verrouiller le salon',
            '`!unlock` — Déverrouiller le salon',
            '`!antilink on/off` — Anti-lien',
            '`!antilink whitelist @role` — Rôle exempté d\'anti-lien',
          ].join('\n'),
        },
        {
          name: '👑 Propriétaire seulement',
          value: [
            '`!bl @user` — Blacklister + bannir',
            '`!unbl @user|<userId>` — Retirer blacklist + débannir',
            '`!dmall <message>` — DM à tous les membres',
            '`!setvoc <channelId>` — Salon "crée ta voc"',
            '`!setwelcome <channelId>` — Salon de bienvenue',
            '`!setuproles` — Panneau rôle perso',
            '`!setuproleselect` — Panneau sélection de rôle (dropdown)',
            '`!setupshowface` — Panneau Show your face + SP',
            '`!setsfvote male|female <channelId>` — Salon vote SF',
            '`!setsfvalidation male|female <channelId>` — Salon validation SF',
          ].join('\n'),
        },
      )
      .setFooter({
        text: `Préfixe : ${PREFIX} • ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
      });

    await message.reply({ embeds: [embed] });
    return;
  }

  // ── !ping ─── Latence du bot ─────────────────────────────────────────
  if (command === 'ping') {
    const sent = await message.reply('⏳ Calcul...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const wsLatency = client.ws.ping;
    await sent.edit(
      `🏓 **Pong !**\n> Latence : **${latency}ms**\n> WebSocket : **${wsLatency}ms**`,
    );
    return;
  }

  // ── !info ─── Infos du serveur ───────────────────────────────────────
  if (command === 'info') {
    const guild = message.guild;
    await guild.fetch();
    const embed = new EmbedBuilder()
      .setTitle(`📊 Infos — ${guild.name}`)
      .setThumbnail(guild.iconURL())
      .setColor(0x5865f2)
      .addFields(
        { name: '👑 Propriétaire', value: `<@${guild.ownerId}>`, inline: true },
        { name: '👥 Membres', value: `${guild.memberCount}`, inline: true },
        {
          name: '📅 Créé le',
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
          inline: true,
        },
        { name: '💬 Salons', value: `${guild.channels.cache.size}`, inline: true },
        { name: '🎭 Rôles', value: `${guild.roles.cache.size}`, inline: true },
        { name: '🔰 Niveau boost', value: `${guild.premiumTier}`, inline: true },
      )
      .setFooter({ text: `ID : ${guild.id}` });

    await message.reply({ embeds: [embed] });
    return;
  }

  // ── !bllust ─── Voir la blacklist ────────────────────────────────────
  if (command === 'bllust') {
    const blacklist = getBlacklist(guildId);
    if (blacklist.length === 0) {
      await message.reply('✅ La blacklist est vide.');
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle('🚫 Blacklist')
      .setColor(0xff0000)
      .setDescription(blacklist.map((id) => `• <@${id}> (\`${id}\`)`).join('\n'))
      .setFooter({ text: `${blacklist.length} utilisateur(s) blacklisté(s)` });
    await message.reply({ embeds: [embed] });
    return;
  }

  // ── !bl @user ─── Blacklister + bannir ──────────────────────────────
  if (command === 'bl') {
    if (!isOwner) {
      await message.reply('❌ Cette commande est réservée au **propriétaire** du serveur.');
      return;
    }

    const target = message.mentions.users.first();
    if (!target) {
      await message.reply('❌ Mentionne un utilisateur. Ex : `!bl @user`');
      return;
    }

    const blacklist = getBlacklist(guildId);
    if (blacklist.includes(target.id)) {
      await message.reply(`⚠️ ${target.tag} est déjà dans la blacklist.`);
      return;
    }

    blacklist.push(target.id);
    saveBlacklist(guildId, blacklist);

    try {
      await message.guild.bans.create(target.id, {
        reason: `Blacklisté par ${message.author.tag}`,
      });
      await message.reply(`✅ **${target.tag}** a été ajouté à la blacklist et banni.`);
    } catch {
      await message.reply(
        `✅ **${target.tag}** ajouté à la blacklist. (Impossible de bannir — permissions insuffisantes)`,
      );
    }
    return;
  }

  // ── !unbl @user | <userId> ─── Retirer de la blacklist + débannir ────
  // Accepte une mention OU un ID brut (utile pour les utilisateurs déjà bannis)
  if (command === 'unbl') {
    if (!isOwner) {
      await message.reply('❌ Cette commande est réservée au **propriétaire** du serveur.');
      return;
    }

    const targetId = message.mentions.users.first()?.id ?? args[0];
    if (!targetId || !/^\d{17,19}$/.test(targetId)) {
      await message.reply(
        '❌ Spécifie un utilisateur (mention ou ID). Ex : `!unbl @user` ou `!unbl 123456789012345678`',
      );
      return;
    }

    const blacklist = getBlacklist(guildId);
    const index = blacklist.indexOf(targetId);
    if (index === -1) {
      await message.reply(`⚠️ Cet utilisateur n'est pas dans la blacklist.`);
      return;
    }

    blacklist.splice(index, 1);
    saveBlacklist(guildId, blacklist);

    try {
      await message.guild.bans.remove(targetId, `Retiré de la blacklist par ${message.author.tag}`);
      await message.reply(`✅ <@${targetId}> retiré de la blacklist et débanni.`);
    } catch {
      await message.reply(`✅ <@${targetId}> retiré de la blacklist. (Non banni ou déjà débanni)`);
    }
    return;
  }

  // ══════════════════════════════════════════════════════════════════════
  // COMMANDES DE MODÉRATION (staff)
  // ══════════════════════════════════════════════════════════════════════

  // ── !kick @user [raison] ─────────────────────────────────────────────
  if (command === 'kick') {
    if (!isOwner && !message.member?.permissions.has(PermissionFlagsBits.KickMembers)) { await message.reply('❌ Permission **Expulser des membres** requise.'); return; }
    const target = message.mentions.members?.first();
    if (!target) { await message.reply('❌ Mentionne un membre. Ex : `!kick @user raison`'); return; }
    if (!target.kickable) { await message.reply('❌ Impossible d\'expulser ce membre (permissions insuffisantes).'); return; }
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    await target.kick(reason);
    await message.reply(`✅ **${target.user.tag}** a été expulsé. Raison : ${reason}`);
    return;
  }

  // ── !ban @user [raison] ──────────────────────────────────────────────
  if (command === 'ban') {
    if (!isOwner && !message.member?.permissions.has(PermissionFlagsBits.BanMembers)) { await message.reply('❌ Permission **Bannir des membres** requise.'); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply('❌ Mentionne un utilisateur. Ex : `!ban @user raison`'); return; }
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    try {
      await message.guild.bans.create(target.id, { reason: `${message.author.tag} : ${reason}` });
      await message.reply(`✅ **${target.tag}** a été banni. Raison : ${reason}`);
    } catch {
      await message.reply('❌ Impossible de bannir ce membre (permissions insuffisantes).');
    }
    return;
  }

  // ── !unban <userId> ───────────────────────────────────────────────────
  if (command === 'unban') {
    if (!isOwner && !message.member?.permissions.has(PermissionFlagsBits.BanMembers)) { await message.reply('❌ Permission **Bannir des membres** requise.'); return; }
    const targetId = args[0];
    if (!targetId || !/^\d{17,19}$/.test(targetId)) { await message.reply('❌ Fournis un ID valide. Ex : `!unban 123456789012345678`'); return; }
    try {
      await message.guild.bans.remove(targetId);
      await message.reply(`✅ <@${targetId}> a été débanni.`);
    } catch {
      await message.reply('❌ Utilisateur introuvable dans les bans.');
    }
    return;
  }

  // ── !mute @user [minutes] [raison] ───────────────────────────────────
  if (command === 'mute') {
    if (!isOwner && !message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) { await message.reply('❌ Permission **Mettre en sourdine** requise.'); return; }
    const target = message.mentions.members?.first();
    if (!target) { await message.reply('❌ Mentionne un membre. Ex : `!mute @user 10 spam`'); return; }
    const minutes = parseInt(args[1] ?? '') || 10;
    const reason = args.slice(isNaN(parseInt(args[1] ?? '')) ? 1 : 2).join(' ') || 'Aucune raison fournie';
    if (minutes < 1 || minutes > 40320) { await message.reply('❌ Durée entre 1 et 40320 minutes (28 jours max).'); return; }
    try {
      await target.timeout(minutes * 60 * 1000, `${message.author.tag} : ${reason}`);
      await message.reply(`🔇 **${target.user.tag}** mis en sourdine pour **${minutes} min**. Raison : ${reason}`);
    } catch {
      await message.reply('❌ Impossible de mettre en sourdine (permissions insuffisantes).');
    }
    return;
  }

  // ── !unmute @user ─────────────────────────────────────────────────────
  if (command === 'unmute') {
    if (!isOwner && !message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) { await message.reply('❌ Permission **Mettre en sourdine** requise.'); return; }
    const target = message.mentions.members?.first();
    if (!target) { await message.reply('❌ Mentionne un membre.'); return; }
    try {
      await target.timeout(null);
      await message.reply(`🔊 **${target.user.tag}** n'est plus en sourdine.`);
    } catch {
      await message.reply('❌ Impossible de lever la sourdine (permissions insuffisantes).');
    }
    return;
  }

  // ── !warn @user [raison] ─────────────────────────────────────────────
  if (command === 'warn') {
    if (!isStaff) { await message.reply('❌ Réservé au staff.'); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply('❌ Mentionne un utilisateur. Ex : `!warn @user raison`'); return; }
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    const warns = getWarns(guildId, target.id);
    warns.push({ reason, date: new Date().toLocaleDateString('fr-FR'), by: message.author.tag });
    saveWarns(guildId, target.id, warns);
    try { await target.send(`⚠️ Tu as reçu un avertissement sur **${message.guild.name}**.\nRaison : **${reason}**\nAvertissements : **${warns.length}**`); } catch { /* DMs fermés */ }
    await message.reply(`⚠️ **${target.tag}** averti. Total : **${warns.length}** avertissement(s).`);
    return;
  }

  // ── !warns @user ─────────────────────────────────────────────────────
  if (command === 'warns') {
    if (!isStaff) { await message.reply('❌ Réservé au staff.'); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply('❌ Mentionne un utilisateur.'); return; }
    const warns = getWarns(guildId, target.id);
    if (warns.length === 0) { await message.reply(`✅ **${target.tag}** n'a aucun avertissement.`); return; }
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ Avertissements — ${target.tag}`)
      .setColor(0xffa500)
      .setDescription(warns.map((w, i) => `**${i + 1}.** ${w.reason} — par ${w.by} le ${w.date}`).join('\n'))
      .setFooter({ text: `${warns.length} avertissement(s)` });
    await message.reply({ embeds: [embed] });
    return;
  }

  // ── !clearwarns @user ────────────────────────────────────────────────
  if (command === 'clearwarns') {
    if (!isStaff) { await message.reply('❌ Réservé au staff.'); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply('❌ Mentionne un utilisateur.'); return; }
    saveWarns(guildId, target.id, []);
    await message.reply(`✅ Avertissements de **${target.tag}** effacés.`);
    return;
  }

  // ── !clear <1-100> ───────────────────────────────────────────────────
  if (command === 'clear') {
    if (!isStaff) { await message.reply('❌ Réservé au staff.'); return; }
    const amount = parseInt(args[0] ?? '');
    if (isNaN(amount) || amount < 1 || amount > 100) { await message.reply('❌ Indique un nombre entre 1 et 100.'); return; }
    if (!message.channel.isTextBased() || message.channel.isDMBased()) return;
    try {
      await message.delete();
      const deleted = await message.channel.bulkDelete(amount, true);
      const confirm = await message.channel.send(`🗑️ **${deleted.size}** message(s) supprimé(s).`);
      setTimeout(() => confirm.delete().catch(() => null), 3000);
    } catch {
      await message.channel.send('❌ Impossible de supprimer (messages > 14 jours non supprimables en masse).');
    }
    return;
  }

  // ── !slowmode <secondes> ─────────────────────────────────────────────
  if (command === 'slowmode') {
    if (!isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) { await message.reply('❌ Permission **Gérer les salons** requise.'); return; }
    const sec = parseInt(args[0] ?? '');
    if (isNaN(sec) || sec < 0 || sec > 21600) { await message.reply('❌ Entre 0 (désactiver) et 21600 secondes.'); return; }
    if (!message.channel.isTextBased() || message.channel.isDMBased() || !('setRateLimitPerUser' in message.channel)) return;
    await (message.channel as { setRateLimitPerUser: (v: number) => Promise<unknown> }).setRateLimitPerUser(sec);
    await message.reply(sec === 0 ? '✅ Slowmode désactivé.' : `✅ Slowmode défini à **${sec}s**.`);
    return;
  }

  // ── !lock ────────────────────────────────────────────────────────────
  if (command === 'lock') {
    if (!isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) { await message.reply('❌ Permission **Gérer les salons** requise.'); return; }
    if (!message.channel.isTextBased() || message.channel.isDMBased() || message.channel.isThread()) return;
    const everyone = message.guild.roles.everyone;
    await message.channel.permissionOverwrites.edit(everyone, { SendMessages: false });
    await message.reply('🔒 Salon verrouillé.');
    return;
  }

  // ── !unlock ──────────────────────────────────────────────────────────
  if (command === 'unlock') {
    if (!isOwner && !message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) { await message.reply('❌ Permission **Gérer les salons** requise.'); return; }
    if (!message.channel.isTextBased() || message.channel.isDMBased() || message.channel.isThread()) return;
    const everyone = message.guild.roles.everyone;
    await message.channel.permissionOverwrites.edit(everyone, { SendMessages: null });
    await message.reply('🔓 Salon déverrouillé.');
    return;
  }

  // ── !antilink on|off|whitelist @role ─────────────────────────────────
  if (command === 'antilink') {
    if (!isStaff) { await message.reply('❌ Réservé au staff.'); return; }
    const sub = args[0]?.toLowerCase();
    const cfg = getConfig(guildId);

    if (sub === 'on') {
      cfg['antilink'] = 'true'; saveConfig(guildId, cfg);
      await message.reply('✅ Anti-lien **activé**. Les liens seront supprimés automatiquement.');
    } else if (sub === 'off') {
      cfg['antilink'] = 'false'; saveConfig(guildId, cfg);
      await message.reply('✅ Anti-lien **désactivé**.');
    } else if (sub === 'whitelist') {
      const role = message.mentions.roles.first();
      if (!role) { await message.reply('❌ Mentionne un rôle. Ex : `!antilink whitelist @Modérateur`'); return; }
      const wl = (cfg['antilink_wl'] ?? '').split(',').filter(Boolean);
      if (!wl.includes(role.id)) { wl.push(role.id); cfg['antilink_wl'] = wl.join(','); saveConfig(guildId, cfg); }
      await message.reply(`✅ Le rôle **${role.name}** est exempté de l'anti-lien.`);
    } else {
      const status = cfg['antilink'] === 'true' ? '🟢 activé' : '🔴 désactivé';
      await message.reply(`ℹ️ Anti-lien : **${status}**\n\`!antilink on/off\` — \`!antilink whitelist @role\``);
    }
    return;
  }

  // ── !dmall <message> ─── Envoyer un DM à tous les membres ───────────
  if (command === 'dmall') {
    if (!isOwner) {
      await message.reply('❌ Cette commande est réservée au **propriétaire** du serveur.');
      return;
    }

    const content = args.join(' ');
    if (!content) {
      await message.reply('❌ Spécifie un message. Ex : `!dmall Bonjour tout le monde !`');
      return;
    }

    const status = await message.reply('⏳ Envoi des DMs en cours...');
    const members = await message.guild.members.fetch();
    let sent = 0;
    let failed = 0;

    for (const [, member] of members) {
      if (member.user.bot) continue;
      try {
        await member.send(`📨 **Message de ${message.guild.name} :**\n${content}`);
        sent++;
      } catch {
        failed++;
      }
    }

    await status.edit(
      `✅ DMs envoyés : **${sent}** réussis, **${failed}** échoués (DMs fermés).`,
    );
    return;
  }

  // ── !setvoc <channelId> ─── Définir le salon "crée ta voc" ──────────
  if (command === 'setvoc') {
    if (!isOwner) {
      await message.reply('❌ Cette commande est réservée au **propriétaire** du serveur.');
      return;
    }

    const channelId = args[0];
    if (!channelId) {
      await message.reply('❌ Spécifie un ID de salon. Ex : `!setvoc 1234567890`');
      return;
    }

    const channel = message.guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await message.reply("❌ Salon introuvable ou ce n'est pas un salon vocal.");
      return;
    }

    const config = getConfig(guildId);
    config['voc_channel'] = channelId;
    saveConfig(guildId, config);

    await message.reply(
      `✅ Salon vocal **${channel.name}** défini comme salon "crée ta voc". Quand un membre le rejoint, un salon temporaire sera créé automatiquement.`,
    );
    return;
  }

  // ── !setwelcome <channelId> ─── Définir le salon de bienvenue ────────
  if (command === 'setwelcome') {
    if (!isOwner) {
      await message.reply('❌ Cette commande est réservée au **propriétaire** du serveur.');
      return;
    }

    const channelId = args[0];
    if (!channelId) {
      await message.reply('❌ Spécifie un ID de salon. Ex : `!setwelcome 1234567890`');
      return;
    }

    const channel = message.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      await message.reply("❌ Salon introuvable ou ce n'est pas un salon texte.");
      return;
    }

    const config = getConfig(guildId);
    config['welcome_channel'] = channelId;
    saveConfig(guildId, config);

    await message.reply(
      `✅ Salon **${channel.name}** défini comme salon de bienvenue.\nLes nouveaux membres recevront : *Bienvenue @pseudo ! Mets lugia dans ton statut pour avoir ton rôle 🌿*`,
    );
    return;
  }

  // ── !setuproles ─── Poster le panneau de création de rôle perso ──────
  if (command === 'setuproles') {
    if (!isOwner) {
      await message.reply('❌ Cette commande est réservée au **propriétaire** du serveur.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✨ Crée ton rôle personnalisé')
      .setDescription("Clique sur le bouton pour créer **ton propre rôle** !")
      .addFields({
        name: '\u200b',
        value: [
          '• **1 rôle par personne** (sauf rôle VIP)',
          '• Choisis le **nom**, la **couleur** et un **emoji**',
          '• Le rôle sera placé sous "rôle perso"',
          "• Icône d'image possible après (boost niveau 2)",
        ].join('\n'),
      })
      .setColor(0x5865f2);

    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('creer_role')
        .setLabel('✨ Créer mon rôle')
        .setStyle(ButtonStyle.Primary),
    );

    await message.delete().catch(() => null);
    if (!message.channel.isTextBased() || message.channel.isDMBased()) return;
    await message.channel.send({ embeds: [embed], components: [button] });
    return;
  }

  // ── !setsfvote male|female <channelId> ───────────────────────────────
  if (command === 'setsfvote') {
    if (!isOwner) { await message.reply('❌ Propriétaire uniquement.'); return; }
    const genre = args[0]?.toLowerCase();
    if (genre !== 'male' && genre !== 'female') {
      await message.reply('❌ Précise le genre. Ex : `!setsfvote male #salon` ou `!setsfvote female #salon`');
      return;
    }
    const ch = message.guild.channels.cache.get(args[1] ?? '');
    if (!ch || !ch.isTextBased()) { await message.reply('❌ Salon introuvable ou non-texte.'); return; }
    const cfg = getConfig(guildId);
    cfg[`sf_vote_${genre}`] = ch.id;
    saveConfig(guildId, cfg);
    await message.reply(`✅ Salon de vote **${genre}** défini : **${ch.name}**`);
    return;
  }

  // ── !setsfvalidation male|female <channelId> ──────────────────────────
  if (command === 'setsfvalidation') {
    if (!isOwner) { await message.reply('❌ Propriétaire uniquement.'); return; }
    const genre = args[0]?.toLowerCase();
    if (genre !== 'male' && genre !== 'female') {
      await message.reply('❌ Précise le genre. Ex : `!setsfvalidation male #salon` ou `!setsfvalidation female #salon`');
      return;
    }
    const ch = message.guild.channels.cache.get(args[1] ?? '');
    if (!ch || !ch.isTextBased()) { await message.reply('❌ Salon introuvable ou non-texte.'); return; }
    const cfg = getConfig(guildId);
    cfg[`sf_validation_${genre}`] = ch.id;
    saveConfig(guildId, cfg);
    await message.reply(`✅ Salon de validation **${genre}** défini : **${ch.name}**`);
    return;
  }

  // ── !setuproleselect ─── Panneau de sélection de rôle ────────────────
  if (command === 'setuproleselect') {
    if (!isOwner) { await message.reply('❌ Propriétaire uniquement.'); return; }
    if (!message.channel.isTextBased() || message.channel.isDMBased()) return;

    const embed = new EmbedBuilder()
      .setTitle('Sélection de rôle')
      .setDescription(
        '**Choisis ton rôle d\'affichage** parmi les options disponibles.\n' +
        'Ce rôle sera visible par tous les membres du serveur.\n\n' +
        '*Tu peux changer de rôle à tout moment.*\n\n' +
        '🐾  Sélectionne une option ci-dessous',
      )
      .setColor(0x2b2d31);

    const select = new StringSelectMenuBuilder()
      .setCustomId('role_select')
      .setPlaceholder('Choisir un rôle...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setValue('none').setLabel('Aucun rôle').setDescription('Retirer tous les rôles'),
        new StringSelectMenuOptionBuilder().setValue('Bunny').setLabel('Bunny').setDescription('Rôle bunny'),
        new StringSelectMenuOptionBuilder().setValue('PS').setLabel('PS').setDescription('Rôle PS'),
        new StringSelectMenuOptionBuilder().setValue('Sweetheart').setLabel('Sweetheart').setDescription('Rôle sweetheart'),
        new StringSelectMenuOptionBuilder().setValue('Romance').setLabel('Romance').setDescription('Rôle romance'),
        new StringSelectMenuOptionBuilder().setValue('Lovely').setLabel('Lovely').setDescription('Rôle lovely'),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    await message.delete().catch(() => null);
    await message.channel.send({ embeds: [embed], components: [row] });
    return;
  }

  // ── !setupshowface ─── Poster le panneau Show your face + SP ─────────
  if (command === 'setupshowface') {
    if (!isOwner) { await message.reply('❌ Propriétaire uniquement.'); return; }
    if (!message.channel.isTextBased() || message.channel.isDMBased()) return;

    const sfEmbed = new EmbedBuilder()
      .setTitle('Show your face 🌟')
      .setDescription(
        'Tu te sens prêt à te montrer ? C\'est ici que ça se passe.\n\n' +
        'Poste ta **photo ou vidéo**, laisse la communauté voter et découvre ce qu\'elle pense de toi. ' +
        'Tu choisis ta catégorie, tu choisis si tu restes **anonyme** – le reste, c\'est le public qui décide.\n\n' +
        '**Comment participer ?**\n' +
        '1. Clique sur le bouton ci-dessous\n' +
        '2. Envoie ta photo ou vidéo en DM au bot\n' +
        '3. Indique si tu es un garçon ou une fille\n' +
        '4. Choisis si tu veux rester anonyme ou non\n' +
        '5. Attends la validation — puis la communauté vote !\n\n' +
        '*En participant tu confirmes avoir l\'âge légal requis et acceptes que ton contenu soit visible par les membres du serveur.*\n' +
        '[Règlement du serveur](https://discord.com)',
      )
      .setColor(0x5865f2);

    const spEmbed = new EmbedBuilder()
      .setDescription('Clique sur le bouton pour être ping et pouvoir react au smash or pass !')
      .setColor(0x2b2d31);

    const sfRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('sf_participe').setLabel('Je participe').setStyle(ButtonStyle.Secondary),
    );
    const spRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('sp_role').setLabel('SP').setStyle(ButtonStyle.Secondary),
    );

    await message.delete().catch(() => null);
    await message.channel.send({ embeds: [sfEmbed], components: [sfRow] });
    await message.channel.send({ embeds: [spEmbed], components: [spRow] });
    return;
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ANTI-LIEN
// ══════════════════════════════════════════════════════════════════════════

const LINK_REGEX = /https?:\/\/\S+|discord\.gg\/\S+|www\.\S+\.\S+/i;

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  if (!msg.guild) return;
  if (msg.channel.isDMBased()) return;

  const cfg = getConfig(msg.guild.id);
  if (cfg['antilink'] !== 'true') return;

  // Vérifier si le message contient un lien
  if (!LINK_REGEX.test(msg.content)) return;

  // Vérifier les permissions du membre (staff bypass)
  const member = msg.member ?? await msg.guild.members.fetch(msg.author.id).catch(() => null);
  if (!member) return;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  // Vérifier whitelist rôles
  const wl = (cfg['antilink_wl'] ?? '').split(',').filter(Boolean);
  if (wl.some((roleId) => member.roles.cache.has(roleId))) return;

  await msg.delete().catch(() => null);
  const warn = await msg.channel.send(`🚫 ${msg.author}, les liens sont interdits sur ce serveur.`);
  setTimeout(() => warn.delete().catch(() => null), 5000);
});

// ══════════════════════════════════════════════════════════════════════════
// MESSAGE DE BIENVENUE
// ══════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// RÔLE AUTOMATIQUE — statut contenant "lugia"
// ══════════════════════════════════════════════════════════════════════════

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  const member = newPresence.member;
  if (!member || member.user.bot) return;
  const guild = newPresence.guild;
  if (!guild) return;

  // Rôle "Lugia on top" — ID fixe
  const role = guild.roles.cache.get('1524134058555215963');
  if (!role) return;

  // Vérifier si le statut custom contient "lugia"
  const customStatus = newPresence.activities.find((a) => a.type === 4);
  const hasLugia = (customStatus?.state ?? '').toLowerCase().includes('lugia');

  if (hasLugia && !member.roles.cache.has(role.id)) {
    await member.roles.add(role).catch(() => null);
  } else if (!hasLugia && member.roles.cache.has(role.id)) {
    await member.roles.remove(role).catch(() => null);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const config = getConfig(member.guild.id);
  const channelId = config['welcome_channel'];
  if (!channelId) return;

  const channel = member.guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) return;

  try {
    await channel.send(
      `Bienvenue ${member} ! Mets **lugia** dans ton statut pour avoir ton rôle 🌿`,
    );
  } catch (err) {
    console.error('Erreur envoi bienvenue :', err);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// SALONS VOCAUX TEMPORAIRES
// ══════════════════════════════════════════════════════════════════════════

const tempVoiceChannels = new Set<string>();

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild;
  const config = getConfig(guild.id);
  const vocChannelId = config['voc_channel'];
  if (!vocChannelId) return;

  // Membre rejoint le salon "crée ta voc"
  if (newState.channelId === vocChannelId && newState.member) {
    const member = newState.member;
    const parentCategory = (newState.channel as VoiceChannel | null)?.parent ?? undefined;

    try {
      const newChannel = await guild.channels.create({
        name: `🔊 ${member.displayName}`,
        type: ChannelType.GuildVoice,
        parent: parentCategory,
        reason: `Salon vocal temporaire pour ${member.user.tag}`,
      });

      await member.voice.setChannel(newChannel);
      tempVoiceChannels.add(newChannel.id);
    } catch (err) {
      console.error('Erreur création voc temporaire :', err);
    }
  }

  // Supprimer le salon temporaire vide
  if (oldState.channelId && tempVoiceChannels.has(oldState.channelId)) {
    const channel = oldState.channel as VoiceChannel | null;
    if (channel && channel.members.size === 0) {
      try {
        await channel.delete('Salon vocal temporaire vide');
        tempVoiceChannels.delete(oldState.channelId);
      } catch {
        // Salon déjà supprimé ou permissions insuffisantes
      }
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
// COMMANDES SLASH — Rôle personnalisé (/setup-roles)
// ══════════════════════════════════════════════════════════════════════════

client.on(Events.InteractionCreate, async (interaction) => {
  // ── /setup-roles ─────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-roles') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: '❌ Tu dois avoir la permission **Gérer les rôles** pour utiliser cette commande.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✨ Crée ton rôle personnalisé')
      .setDescription("Clique sur le bouton pour créer **ton propre rôle** !")
      .addFields({
        name: '\u200b',
        value: [
          '• **1 rôle par personne** (sauf rôle VIP)',
          '• Choisis le **nom**, la **couleur** et un **emoji**',
          '• Le rôle sera placé sous "rôle perso"',
          "• Icône d'image possible après (boost niveau 2)",
        ].join('\n'),
      })
      .setColor(0x5865f2);

    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('creer_role')
        .setLabel('✨ Créer mon rôle')
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.reply({ embeds: [embed], components: [button] });
    return;
  }

  // ── Bouton → Modal ────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'creer_role') {
    if (!interaction.guild) return;

    // Vérifier que le membre booste le serveur
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.premiumSince) {
      await interaction.reply({
        content: '❌ Tu dois **booster le serveur** pour créer un rôle personnalisé ! 🚀',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const userRoles = getRoles(guildId);

    if (userRoles[interaction.user.id]) {
      const existingRole = interaction.guild.roles.cache.get(userRoles[interaction.user.id]);
      if (existingRole) {
        await interaction.reply({
          content: `❌ Tu as déjà un rôle personnalisé : ${existingRole}. Tu ne peux en avoir qu'un seul (sauf rôle VIP).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      // Rôle supprimé manuellement — nettoyage
      delete userRoles[interaction.user.id];
      saveRoles(guildId, userRoles);
    }

    const modal = new ModalBuilder()
      .setCustomId('modal_role')
      .setTitle('✨ Crée ton rôle personnalisé');

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('role_nom')
          .setLabel('Nom du rôle')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex : Architecte des étoiles')
          .setMaxLength(32)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('role_couleur')
          .setLabel('Couleur (code hex, ex : #FF5733)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#FF5733')
          .setMaxLength(7)
          .setMinLength(4)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('role_emoji')
          .setLabel('Emoji du rôle (optionnel)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('🌟')
          .setMaxLength(2)
          .setRequired(false),
      ),
    );

    await interaction.showModal(modal);
    return;
  }

  // ── Soumission du Modal ───────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_role') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('❌ Serveur introuvable.');
      return;
    }
    const guildId = guild.id;

    const nom = interaction.fields.getTextInputValue('role_nom').trim();
    const couleurRaw = interaction.fields.getTextInputValue('role_couleur').trim();
    const emoji = interaction.fields.getTextInputValue('role_emoji').trim();

    if (!/^#?([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(couleurRaw)) {
      await interaction.editReply(
        '❌ Couleur invalide. Utilise un code hex valide (ex : `#FF5733`).',
      );
      return;
    }

    const couleur = parseInt(couleurRaw.replace('#', ''), 16);
    const rolePerso = guild.roles.cache.find(
      (r) => r.name.toLowerCase() === 'rôle perso' || r.name.toLowerCase() === 'role perso',
    );

    try {
      const newRole = await guild.roles.create({
        name: emoji ? `${emoji} ${nom}` : nom,
        color: couleur,
        position: rolePerso ? rolePerso.position - 1 : undefined,
        reason: `Rôle personnalisé créé par ${interaction.user.tag}`,
      });

      const member = await guild.members.fetch(interaction.user.id);
      await member.roles.add(newRole);

      const userRoles = getRoles(guildId);
      userRoles[interaction.user.id] = newRole.id;
      saveRoles(guildId, userRoles);

      await interaction.editReply(`✅ Ton rôle **${newRole.name}** a été créé et assigné !`);
    } catch (err) {
      console.error('Erreur création rôle :', err);
      await interaction.editReply(
        '❌ Erreur lors de la création du rôle. Vérifie que le bot a bien la permission **Gérer les rôles**.',
      );
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
// SHOW YOUR FACE — RÉCEPTION DM (photo/vidéo après timer 5 min)
// ══════════════════════════════════════════════════════════════════════════

client.on(Events.MessageCreate, async (msg) => {
  if (!msg.channel.isDMBased()) return;
  if (msg.author.bot) return;

  const pending = pendingSF.get(msg.author.id);
  if (!pending) return;

  const attachment = msg.attachments.first();
  if (!attachment) {
    await msg.reply('❌ Envoie uniquement une **photo ou vidéo**.');
    return;
  }

  // Validation MIME — uniquement images et vidéos
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'];
  const contentType = attachment.contentType?.split(';')[0]?.trim() ?? '';
  if (!ALLOWED_TYPES.includes(contentType)) {
    await msg.reply('❌ Seuls les formats acceptés sont : JPG, PNG, GIF, WEBP, MP4, MOV, WEBM.');
    return;
  }

  const guild = client.guilds.cache.get(pending.guildId);
  if (!guild) return;
  const config = getConfig(pending.guildId);
  const valChannelId = config[`sf_validation_${pending.gender}`];
  if (!valChannelId) {
    await msg.reply(`❌ Aucun salon de validation configuré pour **${pending.gender}**. Contacte un admin.`);
    return;
  }
  const valChannel = guild.channels.cache.get(valChannelId);
  if (!valChannel?.isTextBased()) return;

  // Embed admin — format des screenshots
  const adminEmbed = new EmbedBuilder()
    .setTitle('📧 Nouvelle demande de participation')
    .setDescription(
      `**Utilisateur :** <@${msg.author.id}>\n` +
      `**Genre :** \`${pending.gender}\`\n` +
      `**Mode :** \`${pending.anon ? 'anonyme' : 'public'}\``,
    )
    .setImage(attachment.url)
    .setColor(0x5865f2)
    .setFooter({ text: `userId:${msg.author.id}` });

  const adminRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`sf_approve_${msg.author.id}`).setLabel('✅ Accepter').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`sf_reject_${msg.author.id}`).setLabel('❌ Refuser').setStyle(ButtonStyle.Danger),
  );

  pendingSF.delete(msg.author.id);
  await valChannel.send({ embeds: [adminEmbed], components: [adminRow] });
  await msg.reply('✅ Ta participation a été envoyée aux administrateurs pour validation !');
});

// ══════════════════════════════════════════════════════════════════════════
// SHOW YOUR FACE — BOUTONS (genre → visibilité → DM)
// ══════════════════════════════════════════════════════════════════════════

client.on(Events.InteractionCreate, async (interaction) => {
  // ── Étape 1 : "Je participe" → choix du genre ─────────────────────────
  if (interaction.isButton() && interaction.customId === 'sf_participe') {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('sf_genre_male').setLabel('Male').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('sf_genre_female').setLabel('Female').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ content: 'Choisis ton genre :', components: [row], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── Étape 2 : genre choisi → choix visibilité ─────────────────────────
  if (interaction.isButton() && (interaction.customId === 'sf_genre_male' || interaction.customId === 'sf_genre_female')) {
    const gender = interaction.customId === 'sf_genre_male' ? 'male' : 'female';
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`sf_vis_${gender}_public`).setLabel('Public (Ping)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`sf_vis_${gender}_anon`).setLabel('Anonyme').setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ content: `Genre choisi : **${gender}**.\nChoisis ta visibilité :`, components: [row] });
    return;
  }

  // ── Étape 3 : visibilité choisie → DM instructions + timer 5 min ──────
  if (interaction.isButton() && interaction.customId.startsWith('sf_vis_')) {
    if (!interaction.guild) return;
    // customId = sf_vis_<gender>_<public|anon>
    const parts = interaction.customId.split('_'); // ['sf','vis','male','public']
    const gender = parts[2] ?? 'male';
    const anon = parts[3] === 'anon';

    // Stocker en attente
    pendingSF.set(interaction.user.id, { guildId: interaction.guild.id, gender, anon });

    // Timer 5 minutes — supprimer si pas envoyé
    setTimeout(() => {
      if (pendingSF.has(interaction.user.id)) {
        pendingSF.delete(interaction.user.id);
      }
    }, 5 * 60 * 1000);

    const dmEmbed = new EmbedBuilder()
      .setTitle('Envoi de ta participation')
      .setDescription(
        `Tu as **5 minutes** pour envoyer une photo ou une vidéo ici.\n\n` +
        `Mode : ${anon ? 'anonyme' : 'public'}\n` +
        `Genre : ${gender}`,
      )
      .setColor(0x5865f2);

    try {
      await interaction.user.send({ embeds: [dmEmbed] });
      await interaction.update({ content: '✅ Consulte tes DMs et envoie ta photo/vidéo au bot dans les **5 minutes** !', components: [] });
    } catch {
      pendingSF.delete(interaction.user.id);
      await interaction.update({ content: '❌ Impossible de t\'envoyer un DM. Active tes DMs depuis ce serveur.', components: [] });
    }
    return;
  }

  // ── Admin : accepter une soumission ──────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('sf_approve_')) {
    if (!interaction.guild) return;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: '❌ Réservé au staff.', flags: MessageFlags.Ephemeral });
      return;
    }
    const targetId = interaction.customId.replace('sf_approve_', '');

    // Lire les infos depuis l'embed admin
    const adminEmbed = interaction.message.embeds[0];
    const imageUrl = adminEmbed?.image?.url ?? '';
    const desc = adminEmbed?.description ?? '';
    const genderMatch = desc.match(/\*\*Genre :\*\* `(.+?)`/);
    const anonMatch = desc.match(/\*\*Mode :\*\* `(.+?)`/);
    const gender = genderMatch?.[1] ?? '';
    const anon = anonMatch?.[1] === 'anonyme';

    const config = getConfig(interaction.guild.id);
    const voteChannelId = config[`sf_vote_${gender}`];
    if (!voteChannelId) {
      await interaction.reply({ content: `❌ Aucun salon de vote configuré pour **${gender}**. Utilise \`!setsfvote ${gender} <channelId>\``, flags: MessageFlags.Ephemeral });
      return;
    }
    const voteChannel = interaction.guild.channels.cache.get(voteChannelId);
    if (!voteChannel?.isTextBased()) return;

    const display = anon ? '🎭 Anonyme' : `<@${targetId}>`;
    const voteEmbed = new EmbedBuilder()
      .setTitle('Show your face 🌟')
      .setDescription(`**${gender}** • ${display}`)
      .setImage(imageUrl)
      .setColor(0xff6b9d);

    // Ping rôle Smash or Pass si configuré
    const spRole = interaction.guild.roles.cache.find((r) => r.name === 'Smash or Pass');
    if (spRole) {
      await voteChannel.send({ content: `${spRole} 📸 Nouvelle participation — venez voter !`, allowedMentions: { roles: [spRole.id] } });
    }
    const voteMsg = await voteChannel.send({ embeds: [voteEmbed] });
    await voteMsg.react('✅');
    await voteMsg.react('❌');

    try {
      const user = await client.users.fetch(targetId);
      await user.send('✅ Ta soumission **Show your face** a été validée ! Elle est maintenant visible sur le serveur 🎉');
    } catch { /* DMs fermés */ }

    await interaction.update({ content: `✅ Accepté par <@${interaction.user.id}>`, embeds: interaction.message.embeds, components: [] });
    return;
  }

  // ── Admin : refuser une soumission ───────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('sf_reject_')) {
    if (!interaction.guild) return;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: '❌ Réservé au staff.', flags: MessageFlags.Ephemeral });
      return;
    }
    const targetId = interaction.customId.replace('sf_reject_', '');
    try {
      const user = await client.users.fetch(targetId);
      await user.send('❌ Ta soumission **Show your face** a été refusée par un admin.');
    } catch { /* DMs fermés */ }
    await interaction.update({ content: `❌ Refusé par <@${interaction.user.id}>`, embeds: interaction.message.embeds, components: [] });
    return;
  }

  // ── Sélection de rôle (dropdown) ─────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'role_select') {
    if (!interaction.guild) return;
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const ROLE_NAMES = ['Bunny', 'PS', 'Sweetheart', 'Romance', 'Lovely'];
    const chosen = interaction.values[0];

    // Retirer tous les rôles du groupe
    for (const name of ROLE_NAMES) {
      const r = interaction.guild.roles.cache.find((ro) => ro.name === name);
      if (r && member.roles.cache.has(r.id)) {
        await member.roles.remove(r).catch(() => null);
      }
    }

    if (chosen === 'none') {
      await interaction.reply({ content: '✅ Tes rôles ont été retirés.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Trouver ou créer le rôle choisi
    let role = interaction.guild.roles.cache.find((r) => r.name === chosen);
    if (!role) {
      role = await interaction.guild.roles.create({ name: chosen, reason: 'Rôle sélection panel' });
    }
    await member.roles.add(role).catch(() => null);
    await interaction.reply({ content: `✅ Tu as maintenant le rôle **${chosen}** !`, flags: MessageFlags.Ephemeral });
    return;
  }

  // ── Bouton SP — toggle rôle Smash or Pass ────────────────────────────
  if (interaction.isButton() && interaction.customId === 'sp_role') {
    if (!interaction.guild) return;
    const member = await interaction.guild.members.fetch(interaction.user.id);
    let spRole = interaction.guild.roles.cache.find((r) => r.name === 'Smash or Pass');
    if (!spRole) {
      spRole = await interaction.guild.roles.create({ name: 'Smash or Pass', reason: 'Rôle ping Smash or Pass' });
    }
    if (member.roles.cache.has(spRole.id)) {
      await member.roles.remove(spRole);
      await interaction.reply({ content: '🔕 Tu ne seras plus notifié(e) pour les Smash or Pass.', flags: MessageFlags.Ephemeral });
    } else {
      await member.roles.add(spRole);
      await interaction.reply({ content: '🔔 Tu seras maintenant notifié(e) pour les Smash or Pass !', flags: MessageFlags.Ephemeral });
    }
    return;
  }

});

// ── Démarrage ──────────────────────────────────────────────────────────────
client.login(TOKEN);
