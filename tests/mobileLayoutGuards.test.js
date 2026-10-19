import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The page must never scroll sideways on a phone. These guard the structural causes (they cannot
// replace looking at the page on a real phone, but they stop the known ones from coming back).
const root = new URL('..', import.meta.url).pathname;
function tsxFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('mobile layout guards', () => {
  it('every <table> sits inside its own horizontal scroller', () => {
    const offenders = [];
    for (const file of tsxFiles(join(root, 'components'))) {
      const src = readFileSync(file, 'utf8');
      let i = -1;
      while ((i = src.indexOf('<table', i + 1)) !== -1) {
        if (!/overflow-x-auto[^<]*>\s*<table/.test(src.slice(Math.max(0, i - 260), i + 6))) offenders.push(file.replace(root, '') + ':' + src.slice(0, i).split('\n').length);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the page itself is clipped horizontally (without making html/body a scroll container)', () => {
    const css = readFileSync(join(root, 'index.css'), 'utf8');
    expect(css).toMatch(/@supports \(overflow: clip\)[\s\S]*overflow-x:\s*clip/);
    expect(css).not.toMatch(/(html|body)[^{]*\{[^}]*overflow-x:\s*hidden/); // `hidden` would break position: sticky
  });

  it('the football menu button is part of the navbar, not a fixed overlay on top of the content', () => {
    const sidebar = readFileSync(join(root, 'components/sportsbook/SportsSidebar.tsx'), 'utf8');
    expect(sidebar).not.toMatch(/fixed left-\d+ top-\[/);
    const navbar = readFileSync(join(root, 'components/Navbar.tsx'), 'utf8');
    expect(navbar).toMatch(/onOpenMenu/);
  });

  it('the navbar top bar cannot outgrow a phone: sections move to the second bar, right group never shrinks past its content', () => {
    const navbar = readFileSync(join(root, 'components/Navbar.tsx'), 'utf8');
    expect(navbar).toMatch(/hidden md:flex gap-4/); // SPORTS/CASINO leave the top bar on phones
    expect(navbar).toMatch(/shrink-0/);
    expect(navbar).not.toMatch(/max-w-\[1450px\]/);
  });
});
