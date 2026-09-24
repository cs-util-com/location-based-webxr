// Export only: presentation HTML/CSS and its runtime transitions remain untouched.
import { chromium } from '../../GpsPlusSlamJs_RecorderApp/node_modules/@playwright/test/index.mjs';
import { server } from './serve.mjs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: process.env.DECK_BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.Reveal?.isReady());
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
  await page.emulateMedia({ media: 'screen' });
  await page.addStyleTag({ content: `
    @page { size:1280px 720px; margin:0; }
    html,body { width:1280px!important; height:auto!important; overflow:visible!important; margin:0!important; }
    .reveal { width:1280px!important; height:auto!important; overflow:visible!important; }
    .reveal .slides { position:static!important; width:1280px!important; height:auto!important; margin:0!important; inset:auto!important; transform:none!important; perspective:none!important; }
    .reveal .slides>section { display:block!important; position:relative!important; width:1280px!important; height:720px!important; min-height:720px!important; margin:0!important; inset:auto!important; transform:none!important; opacity:1!important; visibility:visible!important; break-after:page; break-inside:avoid; }
    .reveal .slides>section:last-child { break-after:auto; }
    *,*::before,*::after { animation:none!important; transition:none!important; -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; }
    aside.notes,.controls,.progress,.slide-number,.deck-footer,.pause-overlay,.aria-status,.speaker-notes { display:none!important; }
    .fragment { opacity:1!important; visibility:visible!important; transform:none!important; }
  ` });
  assert.equal(await page.locator('.slides>section').count(), 13);
  const clipping = await page.evaluate(() => [...document.querySelectorAll('.slides>section')].flatMap((slide,index) => {
    const box=slide.getBoundingClientRect();
    return [...slide.querySelectorAll('h1,h2,h3,p,article,figure,img,.demo-cue,.review-outcome,.closing')]
      .filter(e => !e.closest('aside.notes'))
      .filter(e => {const r=e.getBoundingClientRect();return r.left<box.left-1||r.right>box.right+1||r.top<box.top-1||r.bottom>box.bottom+1;})
      .map(e=>({page:index+1,element:e.tagName,text:e.textContent.slice(0,60)}));
  }));
  assert.deepEqual(clipping, [], 'No slide content may cross page boundaries');
  const path=fileURLToPath(new URL('./sun-driven-lighting-presentation.pdf',import.meta.url));
  await page.pdf({path,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false,margin:{top:0,bottom:0,left:0,right:0}});
  console.log(`Exported 13 slides; no content crosses page boundaries.\n${path}`);
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
