import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  PermissionResolvable,
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
    | 'music';
  userPermissions?: PermissionResolvable[];
  botPermissions?: PermissionResolvable[];
  cooldown?: number; // seconds
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
