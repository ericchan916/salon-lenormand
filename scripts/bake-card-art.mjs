import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run from the project root with a local HTTP server and Playwright installed.
const { chromium } = await import(process.env.SALON_PLAYWRIGHT || 'playwright');
const origin = process.argv[2] || 'http://127.0.0.1:8768/';
const out = await mkdtemp(join(tmpdir(), 'salon-deck-'));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.route(new URL('/__bake', origin).href, route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta charset=utf-8><link rel=stylesheet href="/styles.css"><body></body>'
  }));
  await page.goto(new URL('/__bake', origin).href);
  const textures = await page.evaluate(async () => {
    const { LENORMAND_CARDS } = await import('/js/cards-data.js');
    const { bakeCardFace } = await import('/scripts/card-face-baker.js');
    await document.fonts.load('600 20px "Cormorant Garamond"');
    const sheet = (width, height) => Object.assign(document.createElement('canvas'), {width,height});
    const width = 224;
    const height = 336;
    const faces = sheet(width * 8, height * 5);
    const foils = sheet(width * 4, height * 2.5);
    const faceCtx = faces.getContext('2d');
    const foilCtx = foils.getContext('2d');
    let plate;
    const result = [];
    for (const [index, card] of LENORMAND_CARDS.entries()) {
      if (index % 4 === 0) {
        plate = new Image();
        plate.src = '/assets/cards/plate_' + String(index / 4 + 1).padStart(2, '0') + '.jpg';
        await plate.decode();
      }
      const {face,foil} = bakeCardFace(card,plate);
      const col = index % 8, row = Math.floor(index / 8);
      faceCtx.drawImage(face,col*width,row*height,width,height);
      foilCtx.drawImage(foil,col*width/2,row*height/2,width/2,height/2);
      result.push({name:'face-'+card.num, image:face.toDataURL('image/png').split(',')[1]});
      face.width = foil.width = 0;
    }
    result.push({name:'faces',image:faces.toDataURL('image/png').split(',')[1]});
    result.push({name:'foils',image:foils.toDataURL('image/png').split(',')[1]});
    return result;
  });
  for (const {name,image} of textures) {
    const png = join(out, name + '.png');
    await writeFile(png, Buffer.from(image,'base64'));
    if (name !== 'foils') {
      execFileSync('cwebp', ['-quiet','-q', name === 'faces' ? '90' : '88', png, '-o', join(out, name + '.webp')]);
      await unlink(png);
    }
  }
} finally {
  await browser.close();
}
const hash = createHash('sha256');
for (const name of (await readdir(out)).sort()) hash.update(await readFile(join(out,name)));
const revision = hash.digest('hex').slice(0,12);
await mkdir('assets/deck', {recursive:true});
await cp(out, join('assets/deck',revision), {recursive:true});
console.log(revision);
