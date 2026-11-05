import { describe, expect, it } from 'vitest';
import { sceneMode } from './mode';

describe('sceneMode', () => {
  it('shows only the sky without WebGL', () => {
    expect(sceneMode({ webgl: false, reducedMotion: false })).toBe('off');
    expect(sceneMode({ webgl: false, reducedMotion: true })).toBe('off');
  });

  it('holds a still frame for reduced motion', () => {
    expect(sceneMode({ webgl: true, reducedMotion: true })).toBe('still');
  });

  it('runs the loop otherwise', () => {
    expect(sceneMode({ webgl: true, reducedMotion: false })).toBe('live');
  });
});
