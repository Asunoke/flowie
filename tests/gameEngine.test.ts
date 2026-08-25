import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/services/gameEngine.js';

describe('GameEngine - Casino & Games Business Logic', () => {
  it('Coinflip should return valid outcome pile or face', () => {
    const res = GameEngine.playCoinflip('pile');
    expect(['pile', 'face']).toContain(res.outcome);
    expect(typeof res.win).toBe('boolean');
  });

  it('Dice should return rolled number between 1 and 6 and x5 multiplier on win', () => {
    const res = GameEngine.playDice(4);
    expect(res.rolledNumber).toBeGreaterThanOrEqual(1);
    expect(res.rolledNumber).toBeLessThanOrEqual(6);
    if (res.win) {
      expect(res.multiplier).toBe(5);
    } else {
      expect(res.multiplier).toBe(0);
    }
  });

  it('Slots should return 3 reels and appropriate multiplier on win', () => {
    const res = GameEngine.playSlots();
    expect(res.reels).toHaveLength(3);
    if (res.win) {
      expect(res.multiplier).toBeGreaterThan(0);
    } else {
      expect(res.multiplier).toBe(0);
    }
  });

  it('RPS should evaluate win, loss, or draw correctly', () => {
    const drawRes = GameEngine.playRPS('pierre');
    if (drawRes.botChoice === 'pierre') {
      expect(drawRes.result).toBe('DRAW');
    } else if (drawRes.botChoice === 'ciseaux') {
      expect(drawRes.result).toBe('WIN');
    } else {
      expect(drawRes.result).toBe('LOSS');
    }
  });

  it('Blackjack hand calculation should adjust Aces from 11 to 1 when over 21', () => {
    const handWithAces = [
      { suit: '♠️', value: 'A', weight: 11 },
      { suit: '♥️', value: 'A', weight: 11 },
      { suit: '♦️', value: '9', weight: 9 },
    ] as const;

    const score = GameEngine.calculateHandScore([...handWithAces]);
    // 11 + 1 + 9 = 21
    expect(score).toBe(21);
  });
});
