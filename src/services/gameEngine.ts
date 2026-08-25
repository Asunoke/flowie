import { ModerationService } from './moderationService.js';
import { EmbedService } from './embedService.js';

export interface Card {
  suit: '♠️' | '♥️' | '♦️' | '♣️';
  value: string;
  weight: number;
}

export type RouletteChoice = 'rouge' | 'noir' | 'pair' | 'impair' | string;

export class GameEngine {
  /**
   * Coinflip resolution (50/50 chance)
   */
  static playCoinflip(userChoice: 'pile' | 'face'): { outcome: 'pile' | 'face'; win: boolean } {
    const outcome: 'pile' | 'face' = Math.random() < 0.5 ? 'pile' : 'face';
    return { outcome, win: userChoice === outcome };
  }

  /**
   * Dice roll resolution (1 to 6)
   */
  static playDice(predictedNumber: number): { rolledNumber: number; win: boolean; multiplier: number } {
    const rolledNumber = Math.floor(Math.random() * 6) + 1;
    const win = rolledNumber === predictedNumber;
    return { rolledNumber, win, multiplier: win ? 5 : 0 };
  }

  /**
   * Slots machine resolution
   */
  static playSlots(): { reels: [string, string, string]; win: boolean; multiplier: number } {
    const symbols = ['🍒', '🍋', '🍇', '💎', '7️⃣', '🔔'];
    const r1 = symbols[Math.floor(Math.random() * symbols.length)];
    const r2 = symbols[Math.floor(Math.random() * symbols.length)];
    const r3 = symbols[Math.floor(Math.random() * symbols.length)];

    let win = false;
    let multiplier = 0;

    if (r1 === r2 && r2 === r3) {
      win = true;
      multiplier = r1 === '7️⃣' ? 10 : r1 === '💎' ? 7 : 5;
    } else if (r1 === r2 || r2 === r3 || r1 === r3) {
      win = true;
      multiplier = 1.5;
    }

    return { reels: [r1, r2, r3], win, multiplier };
  }

  /**
   * Rock-Paper-Scissors resolution
   */
  static playRPS(userChoice: 'pierre' | 'papier' | 'ciseaux'): {
    botChoice: 'pierre' | 'papier' | 'ciseaux';
    result: 'WIN' | 'LOSS' | 'DRAW';
  } {
    const choices: ('pierre' | 'papier' | 'ciseaux')[] = ['pierre', 'papier', 'ciseaux'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];

    if (userChoice === botChoice) {
      return { botChoice, result: 'DRAW' };
    }

    if (
      (userChoice === 'pierre' && botChoice === 'ciseaux') ||
      (userChoice === 'papier' && botChoice === 'pierre') ||
      (userChoice === 'ciseaux' && botChoice === 'papier')
    ) {
      return { botChoice, result: 'WIN' };
    }

    return { botChoice, result: 'LOSS' };
  }

  /**
   * Roulette resolution (European: 0 to 36)
   */
  static playRoulette(userChoice: string): {
    spunNumber: number;
    color: '🔴 Rouge' | '⚫ Noir' | '🟢 Vert';
    win: boolean;
    multiplier: number;
  } {
    const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    const spunNumber = Math.floor(Math.random() * 37);

    let color: '🔴 Rouge' | '⚫ Noir' | '🟢 Vert';
    if (spunNumber === 0) {
      color = '🟢 Vert';
    } else if (redNumbers.includes(spunNumber)) {
      color = '🔴 Rouge';
    } else {
      color = '⚫ Noir';
    }

    const choiceLower = userChoice.trim().toLowerCase();
    let win = false;
    let multiplier = 0;

    if (choiceLower === 'rouge' && color === '🔴 Rouge') {
      win = true;
      multiplier = 2;
    } else if (choiceLower === 'noir' && color === '⚫ Noir') {
      win = true;
      multiplier = 2;
    } else if (choiceLower === 'pair' && spunNumber !== 0 && spunNumber % 2 === 0) {
      win = true;
      multiplier = 2;
    } else if (choiceLower === 'impair' && spunNumber % 2 !== 0) {
      win = true;
      multiplier = 2;
    } else if (!isNaN(parseInt(choiceLower, 10)) && parseInt(choiceLower, 10) === spunNumber) {
      win = true;
      multiplier = 36;
    }

    return { spunNumber, color, win, multiplier };
  }

  /**
   * Hangman ASCII Figure
   */
  static getHangmanASCII(wrongCount: number): string {
    const stages = [
      `\`\`\`
  +---+
  |   |
      |
      |
      |
      |
=========
\`\`\``,
      `\`\`\`
  +---+
  |   |
  O   |
      |
      |
      |
=========
\`\`\``,
      `\`\`\`
  +---+
  |   |
  O   |
  |   |
      |
      |
=========
\`\`\``,
      `\`\`\`
  +---+
  |   |
  O   |
 /|   |
      |
      |
=========
\`\`\``,
      `\`\`\`
  +---+
  |   |
  O   |
 /|\\  |
      |
      |
=========
\`\`\``,
      `\`\`\`
  +---+
  |   |
  O   |
 /|\\  |
 /    |
      |
=========
\`\`\``,
      `\`\`\`
  +---+
  |   |
  O   |
 /|\\  |
 / \\  |
      |
=========
\`\`\``,
    ];
    return stages[Math.min(wrongCount, 6)];
  }

  /**
   * Check and log suspicious game winnings (>= 1000 Flow) to modlog
   */
  static async checkSuspiciousWin(
    guildId: string,
    userId: string,
    netProfit: number,
    gameName: string,
    guild?: any
  ) {
    if (netProfit >= 1000 && guild) {
      const embed = EmbedService.warning(
        '⚠️ Gain de jeu suspect détecté',
        `**Utilisateur** : <@${userId}> (\`${userId}\`)\n**Jeu** : ${gameName}\n**Gain Net** : **+${netProfit}**`
      );
      await ModerationService.sendModLog(guildId, embed, guild);
    }
  }

  /**
   * Blackjack Deck and Hand Math
   */
  static createDeck(): Card[] {
    const suits: ('♠️' | '♥️' | '♦️' | '♣️')[] = ['♠️', '♥️', '♦️', '♣️'];
    const values = [
      { v: '2', w: 2 },
      { v: '3', w: 3 },
      { v: '4', w: 4 },
      { v: '5', w: 5 },
      { v: '6', w: 6 },
      { v: '7', w: 7 },
      { v: '8', w: 8 },
      { v: '9', w: 9 },
      { v: '10', w: 10 },
      { v: 'J', w: 10 },
      { v: 'Q', w: 10 },
      { v: 'K', w: 10 },
      { v: 'A', w: 11 },
    ];

    const deck: Card[] = [];
    for (const suit of suits) {
      for (const val of values) {
        deck.push({ suit, value: val.v, weight: val.w });
      }
    }
    return deck.sort(() => Math.random() - 0.5);
  }

  static calculateHandScore(hand: Card[]): number {
    let score = hand.reduce((acc, card) => acc + card.weight, 0);
    let aceCount = hand.filter((c) => c.value === 'A').length;

    while (score > 21 && aceCount > 0) {
      score -= 10;
      aceCount--;
    }

    return score;
  }
}
