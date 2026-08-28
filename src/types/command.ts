import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  PermissionResolvable,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
} from 'discord.js';

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  category:
    | 'core'
    | 'moderation'
    | 'management'
    | 'giveaways'
    | 'games'
    | 'economy'
    | 'uptimer'
    | 'tickets'
    | 'leveling'
    | 'news'
    | 'automod'
    | 'starboard'
    | 'suggestions'
    | 'tags'
    | 'utility'
    | 'music'
    | 'verify'
    | 'tempvoice'
    | 'invites'
    | 'notify'
    | 'timecapsule'
    | 'report'
    | 'community';


  userPermissions?: PermissionResolvable[];
  botPermissions?: PermissionResolvable[];
  cooldown?: number; // seconds
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface ContextMenuCommand {
  data: ContextMenuCommandBuilder;
  category:
    | 'core'
    | 'moderation'
    | 'management'
    | 'giveaways'
    | 'games'
    | 'economy'
    | 'uptimer'
    | 'tickets'
    | 'leveling'
    | 'news'
    | 'automod'
    | 'starboard'
    | 'suggestions'
    | 'tags'
    | 'utility'
    | 'music'
    | 'verify'
    | 'tempvoice'
    | 'invites'
    | 'notify'
    | 'timecapsule'
    | 'report'
    | 'community';

  userPermissions?: PermissionResolvable[];
  cooldown?: number;
  execute: (interaction: MessageContextMenuCommandInteraction | UserContextMenuCommandInteraction) => Promise<void>;
}
